"""
Sky AI - QLoRA fine-tuning of Qwen3-1.7B on a single 8 GB GPU (RTX 4060).

Usage (from the sky-ai folder, with the venv activated):
    python train.py
    python train.py --data training.jsonl --epochs 3 --max-length 1024

The result is a small LoRA adapter saved in ./sky-ai-lora that chat.py loads
on top of the 4-bit base model.
"""

import argparse
import json
import os
import sys

# Quieter, Windows-friendly Hugging Face defaults. These must be set before
# transformers / huggingface_hub are imported.
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")  # Windows can't symlink without Developer Mode
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")  # avoids fork warnings / deadlocks

import torch
from datasets import Dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import SFTConfig, SFTTrainer
from trl.chat_template_utils import get_training_chat_template

BASE_MODEL = "Qwen/Qwen3-1.7B"
OUTPUT_DIR = "sky-ai-lora"

# Added to every training example that doesn't already have a system message.
# chat.py uses the exact same text, so keep the two in sync.
SYSTEM_PROMPT = (
    "You are Sky AI, a friendly and knowledgeable gaming assistant created by Sky the Goat. "
    "You know a lot about video games like Fortnite, Minecraft, Grand Theft Auto and "
    "Sky Theft, the open-world action crime game by Sky the Goat. Give clear, accurate, "
    "helpful answers. If you don't know something, say so instead of making it up."
)


def parse_args():
    p = argparse.ArgumentParser(description="Fine-tune Qwen3-1.7B into Sky AI with 4-bit QLoRA.")
    p.add_argument("--data", default="training.jsonl", help="JSONL file with one {'messages': [...]} per line")
    p.add_argument("--model", default=BASE_MODEL, help="Base model id or local path")
    p.add_argument("--output", default=OUTPUT_DIR, help="Where to save the LoRA adapter")
    p.add_argument("--epochs", type=float, default=3)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--batch-size", type=int, default=1, help="Per-step batch size. Keep at 1 on 8 GB.")
    p.add_argument("--grad-accum", type=int, default=8, help="Effective batch = batch-size x grad-accum")
    p.add_argument("--max-length", type=int, default=1024, help="Max tokens per example. Lower = less VRAM.")
    p.add_argument("--lora-r", type=int, default=16)
    p.add_argument("--resume", action="store_true", help="Resume from the last checkpoint in --output")
    return p.parse_args()


def check_gpu():
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


def load_jsonl(path):
    """Read training.jsonl, validate each line, and add the Sky AI system prompt."""
    if not os.path.exists(path):
        sys.exit(f"ERROR: training file not found: {path}")

    rows = []
    with open(path, encoding="utf-8-sig") as f:  # utf-8-sig tolerates the BOM Notepad sometimes adds
        for line_no, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as e:
                sys.exit(f"ERROR: {path} line {line_no} is not valid JSON: {e}")

            messages = record.get("messages")
            if not isinstance(messages, list) or not messages:
                sys.exit(f"ERROR: {path} line {line_no} needs a non-empty 'messages' list.")
            for m in messages:
                if m.get("role") not in ("system", "user", "assistant") or not isinstance(m.get("content"), str):
                    sys.exit(f"ERROR: {path} line {line_no}: each message needs a role and string content.")
            if not any(m["role"] == "assistant" for m in messages):
                sys.exit(f"ERROR: {path} line {line_no} has no assistant message to learn from.")

            if messages[0]["role"] != "system":
                messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
            rows.append({"messages": messages})

    if not rows:
        sys.exit(f"ERROR: {path} is empty.")
    print(f"Loaded {len(rows)} training conversations from {path}")
    return Dataset.from_list(rows)


def load_model_and_tokenizer(model_id):
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
    check_gpu()

    dataset = load_jsonl(args.data)
    model, tokenizer = load_model_and_tokenizer(args.model)

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
    print(f"\nDone! Sky AI adapter saved to {args.output}\nChat with it:  python chat.py")


# The guard is required on Windows: anything that spawns processes re-imports this file.
if __name__ == "__main__":
    main()
