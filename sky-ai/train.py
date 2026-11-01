"""
Sky AI - QLoRA fine-tuning of Qwen3 on a single 8 GB GPU (RTX 4060).

Usage (from the sky-ai folder, with the venv activated):
    python train.py                  # Standard: Qwen3-1.7B, trained on every .jsonl file in data/
    python train.py --ultra          # Ultra: the bigger, smarter Qwen3-4B (slower)
    python train.py --if-changed     # only retrain if the data or settings changed (the launcher uses this)
    python train.py --check-data     # validate the data and exit
    python train.py --restore        # put the previous model back (from sky-ai-lora-backups)

Training happens in a separate folder. The working model is only replaced (and backed up first)
after training finishes, so a crash or Ctrl+C never leaves you without a working Sky AI.
"""

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from collections import Counter

# Quieter, Windows-friendly Hugging Face defaults. These must be set before
# transformers / huggingface_hub are imported.
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")  # Windows can't symlink without Developer Mode
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")  # avoids fork warnings / deadlocks

import knowledge
from sky_core import (
    ADAPTER_DIR,
    BACKUP_DIR,
    DATA_DIR,
    DEFAULT_MODEL,
    META_FILE,
    TOOLS,
    ULTRA_MODEL,
    build_system_prompt,
    data_files,
    model_size_billions,
    personalize,
    read_meta,
    training_fingerprint,
)

KEEP_BACKUPS = 3
NO_KNOWLEDGE_SHARE = 0.25  # 1 in 4 examples trains without the facts block, so facts also stick in the weights


def parse_args():
    p = argparse.ArgumentParser(description="Fine-tune Qwen3 into Sky AI with 4-bit QLoRA.")
    p.add_argument("--data", default=DATA_DIR, help="A .jsonl file, or a folder of .jsonl files (default: data)")
    p.add_argument("--model", default=None, help=f"Base model id or local path (default: {DEFAULT_MODEL})")
    p.add_argument("--ultra", action="store_true", help=f"Train the bigger {ULTRA_MODEL} brain (slower, smarter)")
    p.add_argument("--output", default=ADAPTER_DIR, help="Where the finished LoRA adapter goes")
    p.add_argument("--epochs", type=float, default=3)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--batch-size", type=int, default=None, help="Per-step batch size (default: picked for your GPU)")
    p.add_argument("--grad-accum", type=int, default=None, help="Gradient accumulation (default: batch of 8 in total)")
    p.add_argument("--max-length", type=int, default=None, help="Max tokens per example (default: picked for the model)")
    p.add_argument("--lora-r", type=int, default=16)
    p.add_argument("--resume", action="store_true", help="Resume an interrupted training run")
    p.add_argument("--if-changed", action="store_true", help="Skip training if the adapter is already up to date")
    p.add_argument("--check-data", action="store_true", help="Validate the training data and exit")
    p.add_argument("--restore", action="store_true", help="Restore the most recent backup of the adapter")
    return p.parse_args()


def pick_model(args):
    if args.model:
        return args.model
    if args.ultra:
        return ULTRA_MODEL
    if args.if_changed:
        # The launcher passes no model. Keep whichever brain was trained last (e.g. Ultra).
        return read_meta(args.output).get("base_model", DEFAULT_MODEL)
    return DEFAULT_MODEL


# ---------------------------------------------------------------- data

def read_records(files):
    """Every example, validated. Exits with a clear message on the first broken line."""
    records = []
    for path in files:
        with open(path, encoding="utf-8-sig") as f:  # utf-8-sig tolerates the BOM Notepad sometimes adds
            for line_no, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue
                where = f"{os.path.basename(path)} line {line_no}"
                try:
                    record = json.loads(line)
                except json.JSONDecodeError as e:
                    sys.exit(f"ERROR: {where} is not valid JSON: {e}")
                messages = record.get("messages")
                if not isinstance(messages, list) or not messages:
                    sys.exit(f"ERROR: {where} needs a non-empty 'messages' list.")
                for m in messages:
                    if m.get("role") not in ("system", "user", "assistant", "tool") or not isinstance(m.get("content"), str):
                        sys.exit(f"ERROR: {where}: each message needs a role and string content.")
                    for call in m.get("tool_calls") or []:
                        if not isinstance(call.get("function", {}).get("name"), str):
                            sys.exit(f"ERROR: {where}: each tool call needs a function name.")
                if not any(m["role"] == "assistant" for m in messages):
                    sys.exit(f"ERROR: {where} has no assistant message to learn from.")
                records.append((where, record))
    if not records:
        sys.exit("ERROR: no training examples found.")
    return records


def check_data(records, kb):
    """Contradictions with the knowledge guards are errors. Duplicates and other oddities are warnings."""
    errors, warnings = [], []
    questions = Counter()
    for where, record in records:
        msgs = record["messages"]
        users = [m["content"] for m in msgs if m["role"] == "user"]
        questions[" ".join(users[0].lower().split())] += 1
        context = "\n".join(users)
        for m in msgs:
            if m["role"] == "assistant" and m["content"]:
                for g, sentence in knowledge.check_guards(kb.guards, m["content"], context):
                    errors.append(f"{where}: contradicts '{g['name']}': {sentence.strip()[:120]}")
        prev = None
        for m in msgs:  # an answer followed by "that's wrong" gets dropped from training
            if m["role"] == "user" and prev and prev["role"] == "assistant" and prev["content"] \
                    and knowledge.looks_like_correction(m["content"]):
                warnings.append(f"{where}: an assistant answer is followed by a correction; that answer will be dropped")
            prev = m
    dupes = [q for q, n in questions.items() if n > 1]
    if dupes:
        warnings.append(f"{len(dupes)} duplicate question(s), e.g. {dupes[0][:60]!r}")
    return errors, warnings


def example_hash(record):
    first = next(m["content"] for m in record["messages"] if m["role"] == "user")
    return int(hashlib.sha256(first.encode()).hexdigest()[:8], 16)


def build_rows(records, model_id, kb):
    """Turn examples into the exact prompt format the app uses (same system prompt builder)."""
    today = time.strftime("%Y-%m-%d")
    no_kb = knowledge.KnowledgeBase(folder=os.path.join(os.path.dirname(knowledge.KNOWLEDGE_DIR), "_none_"))
    rows = []
    for _, record in records:
        msgs = [{"role": m["role"], "content": personalize(m["content"], model_id), "tool_calls": m.get("tool_calls")}
                for m in record["messages"] if m["role"] != "system"]
        use_kb = (example_hash(record) % 100) >= NO_KNOWLEDGE_SHARE * 100 and not record.get("no_knowledge")
        sys_prompt, model_msgs, _ = build_system_prompt(
            model_id, msgs, kb if use_kb else no_kb, memory=None,
            web=bool(record.get("web", False)), commands=bool(record.get("commands", True)), today=today)
        model_msgs = [{"role": m["role"], "content": m["content"], "tool_calls": m.get("tool_calls")} for m in model_msgs]
        # A JSON string keeps the nested tool schema simple to store; TRL decodes it.
        rows.append({"messages": [{"role": "system", "content": sys_prompt, "tool_calls": None}] + model_msgs,
                     "tools": json.dumps(TOOLS)})
    return rows


# ---------------------------------------------------------------- environment & settings

def environment_report(torch):
    import bitsandbytes
    import peft
    import transformers
    import trl

    if not torch.cuda.is_available():
        sys.exit(
            "ERROR: PyTorch can't see a CUDA GPU.\n"
            f"  Installed torch: {torch.__version__} (CUDA build: {torch.version.cuda})\n"
            "  This almost always means the CPU-only build of PyTorch was installed.\n"
            "  Fix: run setup.bat again, or:\n"
            "    pip uninstall -y torch\n"
            "    pip install torch --index-url https://download.pytorch.org/whl/cu128\n"
            "  Also make sure your NVIDIA driver is up to date (run `nvidia-smi`).")
    props = torch.cuda.get_device_properties(0)
    env = {
        "gpu": props.name, "vram_gb": round(props.total_memory / 1024**3, 1),
        "compute_capability": f"{props.major}.{props.minor}", "bf16": torch.cuda.is_bf16_supported(),
        "torch": torch.__version__, "cuda": torch.version.cuda, "transformers": transformers.__version__,
        "trl": trl.__version__, "peft": peft.__version__, "bitsandbytes": bitsandbytes.__version__,
    }
    print(f"GPU: {env['gpu']} | VRAM {env['vram_gb']} GB | compute {env['compute_capability']} | bf16 {env['bf16']}")
    print(f"torch {env['torch']} (CUDA {env['cuda']}) | transformers {env['transformers']} | trl {env['trl']} | "
          f"peft {env['peft']} | bitsandbytes {env['bitsandbytes']}")
    if not env["bf16"]:
        print("WARNING: this GPU doesn't support bf16 (RTX 30/40 series do). Training uses fp16 instead.")
    return env


def auto_settings(args, model_id, env):
    """Batch size and sequence length for this GPU. TRL's default chunked loss only builds logits for
    Sky AI's reply tokens, so memory grows slowly with batch size and bigger batches use the GPU better."""
    big = (model_size_billions(model_id) or 2) > 2.5
    vram = env["vram_gb"]
    if args.batch_size:
        batch = args.batch_size
    elif vram >= 15:
        batch = 4 if big else 8
    elif vram >= 7.5:
        batch = 2 if big else 4
    else:
        batch = 1 if big else 2
    total = 8  # effective batch size, same as before
    accum = args.grad_accum or max(1, total // batch)
    max_length = args.max_length or 1536  # chunked loss keeps this affordable for Ultra too; OOM retry shrinks it if needed
    return {"batch": batch, "accum": accum, "max_length": max_length}


# ---------------------------------------------------------------- folders

def staging_dir(output):
    return output.rstrip("/\\") + ".training"


def backup_and_swap(staging, output):
    """Back up the working adapter, then put the new one in its place."""
    backup = None
    if os.path.isdir(output):
        os.makedirs(BACKUP_DIR, exist_ok=True)
        backup = os.path.join(BACKUP_DIR, time.strftime("%Y%m%d-%H%M%S"))
        shutil.move(output, backup)
        old = sorted(os.listdir(BACKUP_DIR))
        for name in old[:-KEEP_BACKUPS]:
            shutil.rmtree(os.path.join(BACKUP_DIR, name), ignore_errors=True)
    shutil.move(staging, output)
    return backup


def restore(output):
    backups = sorted(os.listdir(BACKUP_DIR)) if os.path.isdir(BACKUP_DIR) else []
    if not backups:
        sys.exit("No backups found in " + BACKUP_DIR)
    latest = os.path.join(BACKUP_DIR, backups[-1])
    if os.path.isdir(output):
        shutil.move(output, os.path.join(BACKUP_DIR, time.strftime("%Y%m%d-%H%M%S") + "-replaced"))
    shutil.move(latest, output)
    print(f"Restored {latest} -> {output}. Trained: {read_meta(output).get('trained_at', 'unknown')}")


# ---------------------------------------------------------------- model

def load_model_and_tokenizer(model_id, bf16):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    tokenizer = AutoTokenizer.from_pretrained(model_id)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    compute = torch.bfloat16 if bf16 else torch.float16
    # 4-bit NF4 with double quantization: Qwen3-1.7B takes ~1.3 GB of VRAM instead of ~3.4 GB in bf16.
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                                               bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=compute),
        dtype=compute,
        device_map={"": 0},  # everything on the GPU; "auto" may silently offload to CPU and crawl
        attn_implementation="sdpa",  # memory-efficient attention built into PyTorch (flash-attn doesn't install on Windows)
    )
    model.config.use_cache = False  # the KV cache is useless during training and wastes VRAM
    return model, tokenizer


def drop_too_long(dataset, tokenizer, max_length):
    """Truncated examples lose their end-of-reply token, which teaches the model to ramble on."""
    def length(example):
        ids = tokenizer.apply_chat_template(example["messages"], tools=json.loads(example["tools"]),
                                            tokenize=True, return_dict=True)["input_ids"]
        return {"n_tokens": len(ids)}

    dataset = dataset.map(length)
    kept = dataset.filter(lambda e: e["n_tokens"] <= max_length)
    dropped = len(dataset) - len(kept)
    lengths = sorted(dataset["n_tokens"])
    print(f"Example lengths: median {lengths[len(lengths) // 2]} tokens, longest {lengths[-1]}")
    if dropped:
        print(f"NOTE: skipped {dropped} example(s) longer than {max_length} tokens. "
              "Shorten them, or raise --max-length if you have spare VRAM.")
    return kept.remove_columns("n_tokens"), dropped


def progress_callback(torch, total_vram_gb):
    from transformers import TrainerCallback

    class Progress(TrainerCallback):
        def on_train_begin(self, args, state, control, **kw):
            self.start = time.time()

        def on_log(self, args, state, control, logs=None, **kw):
            if not logs or "loss" not in logs or not state.max_steps:
                return
            done = state.global_step / state.max_steps
            elapsed = time.time() - self.start
            eta = elapsed / done - elapsed if done else 0
            peak = torch.cuda.max_memory_reserved() / 1024**3
            print(f"  step {state.global_step}/{state.max_steps} | loss {float(logs['loss']):.3f} | "
                  f"{elapsed / 60:.1f} min elapsed, ~{eta / 60:.1f} min left | VRAM peak {peak:.1f}/{total_vram_gb} GB")
            if peak > total_vram_gb * 0.95:
                print("  WARNING: VRAM is nearly full. If training slows down a lot, Windows is spilling into system RAM. "
                      "Stop it (Ctrl+C) and run: python train.py --batch-size 1")

    return Progress()


# ---------------------------------------------------------------- main

def main():
    args = parse_args()
    if args.restore:
        return restore(args.output)
    model_id = pick_model(args)

    files = data_files(args.data)
    if not files and args.data == DATA_DIR and os.path.exists("training.jsonl"):
        files = ["training.jsonl"]  # older layout
    if not files:
        sys.exit(f"ERROR: no .jsonl training files found at '{args.data}'.")

    kb = knowledge.KnowledgeBase()
    records = read_records(files)
    errors, warnings = check_data(records, kb)
    print(f"Data: {len(records)} conversations in {len(files)} file(s). "
          f"{len(errors)} contradiction(s), {len(warnings)} warning(s).")
    for w in warnings:
        print("  warning:", w)
    for e in errors:
        print("  ERROR:", e)
    if errors:
        sys.exit("Fix the contradictions above before training (they'd teach Sky AI something false).")
    if args.check_data:
        return

    settings = {"epochs": args.epochs, "lr": args.lr, "lora_r": args.lora_r,
                "max_length": args.max_length, "no_kb_share": NO_KNOWLEDGE_SHARE}
    fingerprint = training_fingerprint(files, model_id, settings)
    if args.if_changed and read_meta(args.output).get("fingerprint") == fingerprint and \
            os.path.exists(os.path.join(args.output, "adapter_config.json")):
        print("Sky AI is up to date with its training data. Skipping training.")
        return

    import torch
    from datasets import Dataset
    from peft import LoraConfig
    from trl import SFTConfig, SFTTrainer
    from trl.chat_template_utils import get_training_chat_template

    env = environment_report(torch)
    torch.backends.cuda.matmul.allow_tf32 = True  # Ada GPUs: faster fp32 matmuls, no quality loss for training
    plan = auto_settings(args, model_id, env)
    print(f"Training Sky AI on {model_id}: batch {plan['batch']} x accumulation {plan['accum']}, "
          f"max {plan['max_length']} tokens, {args.epochs:g} epochs")

    model, tokenizer = load_model_and_tokenizer(model_id, env["bf16"])
    dataset = Dataset.from_list(build_rows(records, model_id, kb))

    # Only train on Sky AI's replies, not on the system prompt or the user's questions.
    assistant_only_loss = True
    try:
        get_training_chat_template(tokenizer)
    except ValueError:
        print("NOTE: chat template can't be patched for assistant-only loss; training on full conversations.")
        assistant_only_loss = False

    staging = staging_dir(args.output)
    if not args.resume and os.path.isdir(staging):
        shutil.rmtree(staging)  # leftovers from an interrupted run

    started = time.time()
    attempt = 0
    while True:
        attempt += 1
        data, dropped = drop_too_long(dataset, tokenizer, plan["max_length"])
        training_args = SFTConfig(
            output_dir=staging,
            num_train_epochs=args.epochs,
            learning_rate=args.lr,
            lr_scheduler_type="cosine",
            warmup_steps=0.05,  # a float < 1 means "5% of total steps"
            per_device_train_batch_size=plan["batch"],
            gradient_accumulation_steps=plan["accum"],
            max_length=plan["max_length"],
            assistant_only_loss=assistant_only_loss,
            # TRL's default "chunked_nll" loss computes logits only for reply tokens, in chunks.
            train_sampling_strategy="group_by_length" if plan["batch"] > 1 else "random",  # less padding
            gradient_checkpointing=True,  # recompute activations in the backward pass: big VRAM saving
            gradient_checkpointing_kwargs={"use_reentrant": False},
            optim="paged_adamw_8bit",  # 8-bit optimizer states that can page to CPU RAM on memory spikes
            bf16=env["bf16"],
            fp16=not env["bf16"],
            packing=False,  # packing needs flash-attention for correctness, which isn't available on Windows
            dataloader_num_workers=0,  # worker processes on Windows re-import the script and waste RAM
            dataset_num_proc=None,
            logging_steps=5,
            save_strategy="epoch",
            save_total_limit=1,
            report_to="none",
            seed=42,
        )
        peft_config = LoraConfig(
            r=args.lora_r, lora_alpha=args.lora_r * 2, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"])
        trainer = SFTTrainer(model=model, args=training_args, train_dataset=data, processing_class=tokenizer,
                             peft_config=peft_config, callbacks=[progress_callback(torch, env["vram_gb"])])
        if attempt == 1:
            trainer.model.print_trainable_parameters()
        torch.cuda.reset_peak_memory_stats()
        try:
            trainer.train(resume_from_checkpoint=True if args.resume else None)
            break
        except torch.OutOfMemoryError:
            if attempt >= 4 or (plan["batch"] == 1 and plan["max_length"] <= 768):
                raise
            # Free everything and retry with a smaller footprint. The effective batch stays 8.
            del trainer, model
            torch.cuda.empty_cache()
            if plan["batch"] > 1:
                plan["batch"] //= 2
                plan["accum"] *= 2
            else:
                plan["max_length"] -= 256
            print(f"\nOut of GPU memory. Retrying with batch {plan['batch']} x {plan['accum']}, "
                  f"max {plan['max_length']} tokens...\n")
            model, tokenizer = load_model_and_tokenizer(model_id, env["bf16"])
            args.resume = False

    peak_gb = torch.cuda.max_memory_allocated() / 1024**3
    minutes = (time.time() - started) / 60
    print(f"Training finished in {minutes:.1f} min. Peak VRAM used by PyTorch: {peak_gb:.2f} GB")

    trainer.save_model(staging)  # only the LoRA adapter (a few dozen MB), not the full model
    tokenizer.save_pretrained(staging)
    for name in os.listdir(staging):  # checkpoints hold optimizer state; not needed once finished
        if name.startswith("checkpoint-"):
            shutil.rmtree(os.path.join(staging, name), ignore_errors=True)
    with open(os.path.join(staging, META_FILE), "w", encoding="utf-8") as f:
        json.dump({
            "base_model": model_id, "fingerprint": fingerprint, "examples": len(data), "skipped_too_long": dropped,
            "epochs": args.epochs, "batch": plan["batch"], "grad_accum": plan["accum"], "max_length": plan["max_length"],
            "train_minutes": round(minutes, 1), "peak_vram_gb": round(peak_gb, 2), "environment": env,
            "trained_at": time.strftime("%Y-%m-%d %H:%M"),
        }, f, indent=2)
    backup = backup_and_swap(staging, args.output)
    print(f"\nDone! Sky AI adapter saved to {args.output}" + (f" (previous version backed up to {backup})" if backup else ""))
    print("Chat with it:  python app.py   (or python chat.py in the terminal)")
    print("Test it:       python eval.py")


# The guard is required on Windows: anything that spawns processes re-imports this file.
if __name__ == "__main__":
    main()
