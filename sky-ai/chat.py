"""
Chat with Sky AI in the terminal. For the desktop app, run app.py (Sky AI Ultra) instead.

Usage (from the sky-ai folder, with the venv activated):
    python chat.py                 # your trained Sky AI in ./sky-ai-lora
    python chat.py --base-only     # the original Qwen3-1.7B, to compare before/after training
    python chat.py --no-commands   # don't let Sky AI suggest commands to run on this PC

Commands while chatting:  /reset  clears the conversation,  /exit  quits.

Sky AI can ask to run Command Prompt commands on your PC (for example `nvidia-smi`
or `dir`). Every command is shown to you first and only runs if you approve it.
"""

import argparse
import os
import sys
import threading

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import sky_core


def parse_args():
    p = argparse.ArgumentParser(description="Chat with Sky AI in the terminal.")
    p.add_argument("--adapter", default=sky_core.ADAPTER_DIR, help="Folder with the trained LoRA adapter")
    p.add_argument("--model", default=None, help="Base model id (default: whatever the adapter was trained on)")
    p.add_argument("--base-only", action="store_true", help="Skip the adapter and chat with the untrained model")
    p.add_argument("--no-commands", action="store_true", help="Don't let Sky AI run commands on this PC")
    p.add_argument("--low-vram", action="store_true", help="Load in 4-bit: slower, but uses less VRAM")
    p.add_argument("--cpu", action="store_true", help="Run on the CPU (very slow; for testing without a GPU)")
    p.add_argument("--max-new-tokens", type=int, default=768)
    p.add_argument("--temperature", type=float, default=0.7)
    return p.parse_args()


def approve_in_terminal(command, dangerous):
    print(f"\n  Sky AI wants to run this command:\n\n      {command}\n")
    if dangerous:
        print("  WARNING: this command can delete files or change your system.")
        return input("  Type 'yes' to run it, or press Enter to skip: ").strip().lower() == "yes"
    return input("  Run it? [y/N] ").strip().lower() in ("y", "yes")


def show_result(approved, shown):
    if not approved:
        print("  (skipped)\n")
        return
    lines = shown.splitlines()
    print("  " + "\n  ".join(lines[:25]))
    if len(lines) > 25:
        print("  ...")
    print()


def main():
    args = parse_args()
    print("Loading Sky AI...")
    try:
        model, tokenizer, info = sky_core.load_model(
            adapter_dir=args.adapter,
            base_only=args.base_only,
            model_id=args.model,
            quantize="4bit" if args.low_vram else "auto",
            device="cpu" if args.cpu else "cuda",
        )
    except (FileNotFoundError, RuntimeError) as e:
        sys.exit(f"ERROR: {e}")

    tools = None if args.no_commands else sky_core.TOOLS
    settings = {"max_new_tokens": args.max_new_tokens, "temperature": args.temperature}
    name = f"{info['model']} (base)" if args.base_only else "Sky AI"

    print(f"\n{name} is ready on {info['device']} ({info['mode']}). Type /reset to start over, /exit to quit.")
    if tools:
        print("Sky AI can suggest commands to run on this PC. Nothing runs unless you approve it.")
    print()

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
        print(f"{name}: ", end="", flush=True)
        stop = threading.Event()
        try:
            for event in sky_core.agent_turn(
                model, tokenizer, info["system_prompt"], history, tools, settings, approve_in_terminal, stop
            ):
                if event[0] == "text":
                    print(event[1], end="", flush=True)
                elif event[0] == "result":
                    show_result(event[2], event[3])
                    print(f"{name}: ", end="", flush=True)
                elif event[0] == "limit":
                    print(f"\n(Sky AI stopped after {sky_core.MAX_COMMANDS_PER_TURN} commands in a row.)")
        except KeyboardInterrupt:
            stop.set()  # Ctrl+C stops the reply; the chat keeps going
            print("\n(stopped)")
        print("\n")


if __name__ == "__main__":
    main()
