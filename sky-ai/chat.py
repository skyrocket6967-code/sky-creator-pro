"""
Chat with Sky AI in the terminal. For the desktop app, run app.py (Sky AI Ultra) instead.

Usage (from the sky-ai folder, with the venv activated):
    python chat.py                 # your trained Sky AI in ./sky-ai-lora
    python chat.py --web           # allow web search
    python chat.py --base-only     # the untrained base model, to compare
    python chat.py --no-commands   # don't let Sky AI suggest PC commands

While chatting:
    /reset            start a new conversation
    /remember <fact>  save a fact to Sky AI's memory (used in every chat)
    /memory           list saved facts
    /forget <number>  delete a saved fact
    /web on|off       turn web search on or off
    /style precise|balanced|creative
    /exit             quit
"""

import argparse
import os
import sys
import threading

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import knowledge
import sky_core
import websearch


def parse_args():
    p = argparse.ArgumentParser(description="Chat with Sky AI in the terminal.")
    p.add_argument("--adapter", default=sky_core.ADAPTER_DIR, help="Folder with the trained LoRA adapter")
    p.add_argument("--model", default=None, help="Base model id (default: whatever the adapter was trained on)")
    p.add_argument("--base-only", action="store_true", help="Skip the adapter and chat with the untrained model")
    p.add_argument("--no-commands", action="store_true", help="Don't let Sky AI run commands on this PC")
    p.add_argument("--web", action="store_true", help="Allow web search")
    p.add_argument("--style", choices=list(sky_core.STYLES), default="balanced")
    p.add_argument("--low-vram", action="store_true", help="Load in 4-bit: slower, but uses less VRAM")
    p.add_argument("--cpu", action="store_true", help="Run on the CPU (very slow; for testing without a GPU)")
    p.add_argument("--max-new-tokens", type=int, default=1024)
    return p.parse_args()


class TerminalCallbacks(sky_core.Callbacks):
    def __init__(self, memory):
        self.memory = memory

    def approve_command(self, command, purpose, dangerous):
        print(f"\n  Sky AI wants to run this command:\n\n      {command}\n")
        print(f"  Purpose: {purpose or '(not given)'}")
        if dangerous:
            print("  WARNING: this command can delete files or change your system.")
            return input("  Type 'yes' to run it, or press Enter to skip: ").strip().lower() == "yes"
        return input("  Run it? [y/N] ").strip().lower() in ("y", "yes")

    def approve_memory(self, fact):
        print(f"\n  Sky AI wants to remember:\n      {fact}")
        answer = input("  Save it? [y/N, or type a better version] ").strip()
        if answer.lower() in ("", "n", "no"):
            return None
        text = fact if answer.lower() in ("y", "yes") else answer
        return self.memory.add(text, source="Sky AI suggestion, approved by user")["text"]

    def search(self, query, official_urls=()):
        return websearch.research(query, official_urls=official_urls)


def handle_slash(cmd, state, memory):
    parts = cmd.split(maxsplit=1)
    name, arg = parts[0].lower(), (parts[1].strip() if len(parts) > 1 else "")
    if name == "/remember" and arg:
        print(f"(saved to memory: {memory.add(arg)['text']})\n")
    elif name == "/memory":
        facts = memory.all()
        print("\n".join(f"  {i}. {f['text']}" for i, f in enumerate(facts, 1)) or "  (no saved facts)")
        print()
    elif name == "/forget" and arg.isdigit():
        facts = memory.all()
        i = int(arg) - 1
        if 0 <= i < len(facts):
            memory.delete(facts[i]["id"])
            print(f"(forgot: {facts[i]['text']})\n")
        else:
            print("(no fact with that number)\n")
    elif name == "/web" and arg in ("on", "off"):
        state["web"] = arg == "on"
        print(f"(web search {arg})\n")
    elif name == "/style" and arg in sky_core.STYLES:
        state["style"] = arg
        print(f"(style: {arg})\n")
    else:
        print(__doc__.split("While chatting:")[1])


def main():
    args = parse_args()
    print("Loading Sky AI...")
    try:
        model, tokenizer, info = sky_core.load_model(
            adapter_dir=args.adapter, base_only=args.base_only, model_id=args.model,
            quantize="4bit" if args.low_vram else "auto", device="cpu" if args.cpu else "cuda")
    except (FileNotFoundError, RuntimeError) as e:
        sys.exit(f"ERROR: {e}")

    kb, memory = knowledge.KnowledgeBase(), knowledge.Memory()
    callbacks = TerminalCallbacks(memory)
    state = {"web": args.web, "commands": not args.no_commands, "style": args.style, "max_new_tokens": args.max_new_tokens}
    name = f"{info['model']} (base)" if args.base_only else "Sky AI"
    print(f"\n{name} is ready: {info['model']} ({info['params']}, {info['mode']}) on {info['device']}.")
    print(f"Web search: {'on' if state['web'] else 'off'}. Type /help for commands, /exit to quit.\n")

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
        if user_text.startswith("/"):
            handle_slash(user_text, state, memory)
            continue

        history.append({"role": "user", "content": user_text})
        print(f"{name}: ", end="", flush=True)
        stop = threading.Event()
        try:
            for ev in sky_core.agent_turn(model, tokenizer, info, history, state, callbacks, kb, memory, stop):
                kind = ev[0]
                if kind == "text":
                    print(ev[1], end="", flush=True)
                elif kind == "search":
                    print(f"\n  [searching the web for: {ev[1]}]")
                elif kind == "search_done":
                    r = ev[1]
                    for s in r["sources"]:
                        print(f"  [{s['n']}] {s['title']} - {s['url']}")
                    if not r["sources"]:
                        print(f"  [search failed: {'; '.join(r['errors'])}]")
                    print(f"{name}: ", end="", flush=True)
                elif kind == "result":
                    shown = ev[3]
                    print("  (skipped)\n" if not ev[2] else "  " + "\n  ".join(shown.splitlines()[:25]) + "\n")
                    print(f"{name}: ", end="", flush=True)
                elif kind == "memory_done":
                    print(f"  ({'saved' if ev[1] else 'not saved'})")
                    print(f"{name}: ", end="", flush=True)
                elif kind == "replace":
                    print(f"\n\n  [{ev[2]}]\n{name}: {ev[1]}", end="")
                elif kind == "suggest_memory":
                    print("\n\n  (Tip: save this correction for future chats with /remember <the correct fact>)", end="")
                elif kind == "stats" and ev[1].get("tokens_per_s"):
                    print(f"\n  ({ev[1]['tokens_per_s']} tok/s)", end="")
                elif kind == "limit":
                    print(f"\n(Sky AI stopped after {sky_core.MAX_TOOL_ROUNDS} tool steps in a row.)")
        except KeyboardInterrupt:
            stop.set()  # Ctrl+C stops the reply; the chat keeps going
            print("\n(stopped)")
        print("\n")


if __name__ == "__main__":
    main()
