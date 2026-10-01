"""
Chat with Sky AI in the terminal.

Usage (from the sky-ai folder, with the venv activated):
    python chat.py                 # base model + your trained adapter in ./sky-ai-lora
    python chat.py --base-only     # the original Qwen3-1.7B, to compare before/after training

Commands while chatting:  /reset  clears the conversation,  /exit  quits.
"""

import argparse
import os
import sys

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, TextStreamer

from train import BASE_MODEL, OUTPUT_DIR, SYSTEM_PROMPT

# Older turns are dropped once the prompt grows past this many tokens, so a long
# chat can't slowly fill the 8 GB of VRAM.
MAX_PROMPT_TOKENS = 3072


def parse_args():
    p = argparse.ArgumentParser(description="Chat with Sky AI.")
    p.add_argument("--adapter", default=OUTPUT_DIR, help="Folder with the trained LoRA adapter")
    p.add_argument("--model", default=BASE_MODEL, help="Base model id or local path")
    p.add_argument("--base-only", action="store_true", help="Skip the adapter and chat with the untrained model")
    p.add_argument("--max-new-tokens", type=int, default=512)
    p.add_argument("--temperature", type=float, default=0.7)
    return p.parse_args()


def load(args):
    if not torch.cuda.is_available():
        sys.exit("ERROR: no CUDA GPU visible to PyTorch. See the 'Troubleshooting' section in README.md.")

    use_adapter = not args.base_only
    if use_adapter and not os.path.isdir(args.adapter):
        sys.exit(f"ERROR: adapter folder '{args.adapter}' not found. Run `python train.py` first, "
                 "or use --base-only to chat with the untrained model.")

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        quantization_config=BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
        ),
        dtype=torch.bfloat16,
        device_map={"": 0},
        attn_implementation="sdpa",
    )
    if use_adapter:
        model = PeftModel.from_pretrained(model, args.adapter)
    model.eval()
    return model, tokenizer


def build_prompt(tokenizer, history):
    """Apply the Qwen3 chat template, dropping the oldest turns if the prompt is too long."""
    while True:
        messages = [{"role": "system", "content": SYSTEM_PROMPT}] + history
        input_ids = tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=True,
            enable_thinking=False,  # Sky AI was trained to answer directly, without <think> reasoning
            return_tensors="pt",
            return_dict=True,
        )["input_ids"]
        if input_ids.shape[-1] <= MAX_PROMPT_TOKENS or len(history) <= 1:
            return input_ids
        history[:] = history[2:]  # forget the oldest user/assistant pair


def main():
    args = parse_args()
    model, tokenizer = load(args)
    streamer = TextStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)

    name = "Qwen3-1.7B (base)" if args.base_only else "Sky AI"
    print(f"\n{name} is ready! Type /reset to start over, /exit to quit.\n")

    history = []
    while True:
        try:
            user_text = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not user_text:
            continue
        if user_text.lower() in ("/exit", "/quit"):
            break
        if user_text.lower() == "/reset":
            history.clear()
            print("(conversation cleared)\n")
            continue

        history.append({"role": "user", "content": user_text})
        input_ids = build_prompt(tokenizer, history).to(model.device)

        print(f"{name}: ", end="", flush=True)
        with torch.inference_mode():
            output = model.generate(
                input_ids=input_ids,
                attention_mask=torch.ones_like(input_ids),
                max_new_tokens=args.max_new_tokens,
                do_sample=True,
                # Qwen's recommended sampling settings for non-thinking mode
                temperature=args.temperature,
                top_p=0.8,
                top_k=20,
                repetition_penalty=1.05,
                streamer=streamer,
                pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id,
            )
        reply = tokenizer.decode(output[0, input_ids.shape[-1]:], skip_special_tokens=True).strip()
        history.append({"role": "assistant", "content": reply})
        print()


if __name__ == "__main__":
    main()
