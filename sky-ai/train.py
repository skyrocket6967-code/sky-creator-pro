"""
Sky AI - QLoRA fine-tuning of Qwen3 on a single 8 GB GPU (RTX 4060).

Usage (from the sky-ai folder, with the venv activated):
    python train.py                  # train on every .jsonl file in data/
    python train.py --ultra          # bigger, smarter brain: Qwen3-4B (slower)
    python train.py --if-changed     # only retrain if the data or settings changed
    python train.py --epochs 5 --max-length 768

The result is a small LoRA adapter saved in ./sky-ai-lora that chat.py and
app.py (Sky AI Ultra) load on top of the base model.
"""

import argparse
import json
import os
import sys
import time

# Quieter, Windows-friendly Hugging Face defaults. These must be set before
# transformers / huggingface_hub are imported.
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")  # Windows can't symlink without Developer Mode
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")  # avoids fork warnings / deadlocks

from sky_core import (
    ADAPTER_DIR,
    DATA_DIR,
    DEFAULT_MODEL,
    META_FILE,
    TOOLS,
    ULTRA_MODEL,
    data_files,
    personalize,
    read_meta,
    system_prompt,
    training_fingerprint,
)


def parse_args():
    p = argparse.ArgumentParser(description="Fine-tune Qwen3 into Sky AI with 4-bit QLoRA.")
    p.add_argument("--data", default=DATA_DIR, help="A .jsonl file, or a folder of .jsonl files (default: data)")
    p.add_argument("--model", default=None, help=f"Base model id or local path (default: {DEFAULT_MODEL})")
    p.add_argument("--ultra", action="store_true", help=f"Train the bigger {ULTRA_MODEL} brain (slower, smarter)")
    p.add_argument("--output", default=ADAPTER_DIR, help="Where to save the LoRA adapter")
    p.add_argument("--epochs", type=float, default=3)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--batch-size", type=int, default=1, help="Per-step batch size. Keep at 1 on 8 GB.")
    p.add_argument("--grad-accum", type=int, default=8, help="Effective batch = batch-size x grad-accum")
    p.add_argument("--max-length", type=int, default=1024, help="Max tokens per example. Lower = less VRAM.")
    p.add_argument("--lora-r", type=int, default=16)
    p.add_argument("--resume", action="store_true", help="Resume from the last checkpoint in --output")
    p.add_argument("--if-changed", action="store_true",
                   help="Skip training if the adapter is already up to date with the data and settings")
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


def check_gpu(torch):
    """Fail early with a readable message instead of a cryptic CUDA/bitsandbytes error later."""
    if not torch.cuda.is_available():
        sys.exit(
            "ERROR: PyTorch can't see a CUDA GPU.\n"
            f"  Installed torch: {torch.__version__} (CUDA build: {torch.version.cuda})\n"
            "  This almost always means the CPU-only build of PyTorch was installed.\n"
            "  Fix: run setup.bat again, or:\n"
            "    pip uninstall -y torch\n"
            "    pip install torch --index-url https://download.pytorch.org/whl/cu128\n"
            "  Also make sure your NVIDIA driver is up to date (run `nvidia-smi`)."
        )
    props = torch.cuda.get_device_properties(0)
    vram_gb = props.total_memory / 1024**3
    print(f"GPU: {props.name} | VRAM: {vram_gb:.1f} GB | torch {torch.__version__} | CUDA {torch.version.cuda}")
    if vram_gb < 7.5:
        print("WARNING: less than 8 GB VRAM detected. Use --max-length 512 if you run out of memory.")


def load_data(files, model_id):
    """Read the .jsonl files, validate each line, and add the Sky AI system prompt and tools."""
    sys_prompt = system_prompt(model_id)
    rows = []
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

                if messages[0]["role"] != "system":
                    messages = [{"role": "system", "content": sys_prompt}] + messages
                # Every message gets the same keys so the datasets library can store them in one table.
                messages = [
                    {"role": m["role"], "content": personalize(m["content"], model_id), "tool_calls": m.get("tool_calls")}
                    for m in messages
                ]
                # A JSON string keeps the nested tool schema simple to store; TRL decodes it.
                rows.append({"messages": messages, "tools": json.dumps(record.get("tools", TOOLS))})

    if not rows:
        sys.exit("ERROR: no training examples found.")
    print(f"Loaded {len(rows)} training conversations from {len(files)} file(s)")
    return rows


def drop_too_long(dataset, tokenizer, max_length):
    """Truncated examples lose their end-of-reply token, which teaches the model to ramble on."""
    def fits(example):
        ids = tokenizer.apply_chat_template(
            example["messages"], tools=json.loads(example["tools"]), tokenize=True, return_dict=True
        )["input_ids"]
        return len(ids) <= max_length

    kept = dataset.filter(fits)
    dropped = len(dataset) - len(kept)
    if dropped:
        print(f"NOTE: skipped {dropped} example(s) longer than {max_length} tokens. "
              "Shorten them, or train with a bigger --max-length if you have spare VRAM.")
    return kept


def load_model_and_tokenizer(model_id):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    tokenizer = AutoTokenizer.from_pretrained(model_id)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # 4-bit NF4 with double quantization: the 1.7B base model takes ~1.3 GB of VRAM
    # instead of ~3.4 GB in bf16. The RTX 4060 (Ada) supports bf16 compute natively.
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        quantization_config=bnb_config,
        dtype=torch.bfloat16,
        device_map={"": 0},  # everything on the GPU; "auto" may silently offload to CPU and crawl
        attn_implementation="sdpa",  # memory-efficient attention built into PyTorch (flash-attn doesn't install on Windows)
    )
    model.config.use_cache = False  # the KV cache is useless during training and wastes VRAM
    return model, tokenizer


def main():
    args = parse_args()
    model_id = pick_model(args)

    files = data_files(args.data)
    if not files and args.data == DATA_DIR and os.path.exists("training.jsonl"):
        files = ["training.jsonl"]  # older layout
    if not files:
        sys.exit(f"ERROR: no .jsonl training files found at '{args.data}'.")
    settings = {"epochs": args.epochs, "lr": args.lr, "max_length": args.max_length, "lora_r": args.lora_r}
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

    check_gpu(torch)
    print(f"Training Sky AI on {model_id}")
    dataset = Dataset.from_list(load_data(files, model_id))
    model, tokenizer = load_model_and_tokenizer(model_id)
    dataset = drop_too_long(dataset, tokenizer, args.max_length)

    # Only train on Sky AI's replies, not on the system prompt or the user's questions.
    # TRL does this by swapping in a copy of the Qwen3 chat template with {% generation %}
    # markers. If Qwen ever changes their template and TRL can't patch it, fall back to
    # training on the whole conversation (still works, just slightly less efficient).
    assistant_only_loss = True
    try:
        get_training_chat_template(tokenizer)
    except ValueError:
        print("NOTE: chat template can't be patched for assistant-only loss; training on full conversations.")
        assistant_only_loss = False

    peft_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_r * 2,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )

    training_args = SFTConfig(
        output_dir=args.output,
        num_train_epochs=args.epochs,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_steps=0.05,  # a float < 1 means "5% of total steps"
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        max_length=args.max_length,
        assistant_only_loss=assistant_only_loss,
        # --- VRAM savers ---
        gradient_checkpointing=True,  # recompute activations in the backward pass: big VRAM saving
        gradient_checkpointing_kwargs={"use_reentrant": False},
        optim="paged_adamw_8bit",  # 8-bit optimizer states that can page to CPU RAM on memory spikes
        bf16=True,
        packing=False,  # packing needs flash-attention for correctness, which isn't available on Windows
        # --- Windows friendliness ---
        dataloader_num_workers=0,  # worker processes on Windows re-import the script and waste RAM
        dataloader_pin_memory=False,
        dataset_num_proc=None,
        # --- logging / saving ---
        logging_steps=5,
        save_strategy="epoch",
        save_total_limit=2,  # keep disk usage small
        report_to="none",
        seed=42,
    )

    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset,
        processing_class=tokenizer,
        peft_config=peft_config,
    )
    trainer.model.print_trainable_parameters()

    torch.cuda.reset_peak_memory_stats()
    trainer.train(resume_from_checkpoint=True if args.resume else None)
    peak_gb = torch.cuda.max_memory_allocated() / 1024**3
    print(f"Peak VRAM used by PyTorch during training: {peak_gb:.2f} GB")

    trainer.save_model(args.output)  # saves only the LoRA adapter (a few dozen MB), not the full model
    tokenizer.save_pretrained(args.output)
    with open(os.path.join(args.output, META_FILE), "w", encoding="utf-8") as f:
        json.dump({
            "base_model": model_id,
            "fingerprint": fingerprint,
            "examples": len(dataset),
            "trained_at": time.strftime("%Y-%m-%d %H:%M"),
        }, f, indent=2)
    print(f"\nDone! Sky AI adapter saved to {args.output}\n"
          "Chat with it:  python app.py   (or python chat.py in the terminal)")


# The guard is required on Windows: anything that spawns processes re-imports this file.
if __name__ == "__main__":
    main()
