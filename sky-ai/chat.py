"""
Chat with Sky AI in the terminal.

Usage (from the sky-ai folder, with the venv activated):
    python chat.py                 # base model + your trained adapter in ./sky-ai-lora
    python chat.py --base-only     # the original Qwen3-1.7B, to compare before/after training
    python chat.py --no-commands   # don't let Sky AI suggest commands to run on this PC

Commands while chatting:  /reset  clears the conversation,  /exit  quits.

Sky AI can ask to run Command Prompt commands on your PC (for example `nvidia-smi`
or `dir`). Every command is shown to you first and only runs if you approve it.
"""

import argparse
import json
import os
import re
import subprocess
import sys

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, TextStreamer

from train import BASE_MODEL, OUTPUT_DIR, SYSTEM_PROMPT, TOOLS

# Older turns are dropped once the prompt grows past this many tokens, so a long
# chat can't slowly fill the 8 GB of VRAM.
MAX_PROMPT_TOKENS = 3072
# How many commands Sky AI may run in a row before it has to answer you.
MAX_COMMANDS_PER_TURN = 5
COMMAND_TIMEOUT_SECONDS = 120
MAX_OUTPUT_CHARS = 2000

TOOL_CALL_RE = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.DOTALL)
# Commands that can delete data or change the system need a typed "yes", not just "y".
DANGEROUS_RE = re.compile(
    r"\b(del|erase|rd|rmdir|format|diskpart|shutdown|reg\s+delete|bcdedit|cipher|takeown|icacls|"
    r"remove-item|rm|move|ren|rename|attrib|schtasks|sc\s+delete|net\s+user|powershell\s+.*-enc)\b",
    re.IGNORECASE,
)


def parse_args():
    p = argparse.ArgumentParser(description="Chat with Sky AI.")
    p.add_argument("--adapter", default=OUTPUT_DIR, help="Folder with the trained LoRA adapter")
    p.add_argument("--model", default=BASE_MODEL, help="Base model id or local path")
    p.add_argument("--base-only", action="store_true", help="Skip the adapter and chat with the untrained model")
    p.add_argument("--no-commands", action="store_true", help="Don't let Sky AI run commands on this PC")
    p.add_argument("--max-new-tokens", type=int, default=768)
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


class ReplyStreamer(TextStreamer):
    """Streams Sky AI's reply as it's generated, but hides the raw <tool_call> JSON."""

    def __init__(self, tokenizer):
        super().__init__(tokenizer, skip_prompt=True, skip_special_tokens=False)
        self.hidden = False
        self.pending = ""

    def put(self, value):
        if self.next_tokens_are_prompt:  # reset for each new generation
            self.hidden, self.pending = False, ""
        super().put(value)

    def on_finalized_text(self, text, stream_end=False):
        if self.hidden:
            return
        text = self.pending + text.replace("<|im_end|>", "").replace("<|endoftext|>", "")
        self.pending = ""
        tag = "<tool_call>"
        if tag in text:
            text, self.hidden = text.split(tag, 1)[0], True
        elif not stream_end:
            # Hold back a partial "<tool_c..." at the end until we know what it is.
            for i in range(len(tag) - 1, 0, -1):
                if text.endswith(tag[:i]):
                    text, self.pending = text[:-i], tag[:i]
                    break
        print(text, end="" if not stream_end else "\n", flush=True)


def build_prompt(tokenizer, history, tools):
    """Apply the Qwen3 chat template, dropping the oldest turns if the prompt is too long."""
    while True:
        messages = [{"role": "system", "content": SYSTEM_PROMPT}] + history
        input_ids = tokenizer.apply_chat_template(
            messages,
            tools=tools,
            add_generation_prompt=True,
            enable_thinking=False,  # Sky AI was trained to answer directly, without <think> reasoning
            return_tensors="pt",
            return_dict=True,
        )["input_ids"]
        if input_ids.shape[-1] <= MAX_PROMPT_TOKENS or len(history) <= 1:
            return input_ids
        # Forget the oldest exchange: everything up to the next message from the user.
        del history[0]
        while history and history[0]["role"] != "user":
            del history[0]


def parse_tool_calls(text):
    """Pull run_command calls out of Qwen3's <tool_call>{...}</tool_call> blocks."""
    calls = []
    for raw in TOOL_CALL_RE.findall(text):
        try:
            call = json.loads(raw)
            args = call.get("arguments", {})
            if isinstance(args, str):
                args = json.loads(args)
            if call.get("name") == "run_command" and isinstance(args.get("command"), str):
                calls.append(args["command"].strip())
        except (json.JSONDecodeError, AttributeError):
            continue
    return calls


def run_command(command):
    """Ask the user for permission, run the command with cmd.exe, and return what it printed."""
    print(f"\n  Sky AI wants to run this command:\n\n      {command}\n")
    if DANGEROUS_RE.search(command):
        print("  WARNING: this command can delete files or change your system.")
        approved = input("  Type 'yes' to run it, or press Enter to skip: ").strip().lower() == "yes"
    else:
        approved = input("  Run it? [y/N] ").strip().lower() in ("y", "yes")
    if not approved:
        print("  (skipped)\n")
        return "The user declined to run this command."

    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            encoding="oem" if os.name == "nt" else None,  # cmd.exe prints in the console's OEM code page
            errors="replace",
            timeout=COMMAND_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        print(f"  (stopped after {COMMAND_TIMEOUT_SECONDS} seconds)\n")
        return f"The command was stopped because it ran longer than {COMMAND_TIMEOUT_SECONDS} seconds."

    output = (result.stdout + result.stderr).strip() or "(no output)"
    print("  " + "\n  ".join(output.splitlines()[:25]))
    if len(output.splitlines()) > 25:
        print("  ...")
    print()
    if len(output) > MAX_OUTPUT_CHARS:
        output = output[:MAX_OUTPUT_CHARS] + "\n...(output cut off)"
    return f"Exit code {result.returncode}\n\n{output}"


def generate(model, tokenizer, input_ids, streamer, args):
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
    text = tokenizer.decode(output[0, input_ids.shape[-1]:], skip_special_tokens=False)
    return text.replace("<|im_end|>", "").replace("<|endoftext|>", "").strip()


def main():
    args = parse_args()
    model, tokenizer = load(args)
    streamer = ReplyStreamer(tokenizer)
    tools = None if args.no_commands else TOOLS

    name = "Qwen3-1.7B (base)" if args.base_only else "Sky AI"
    print(f"\n{name} is ready! Type /reset to start over, /exit to quit.")
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
        for _ in range(MAX_COMMANDS_PER_TURN + 1):
            input_ids = build_prompt(tokenizer, history, tools).to(model.device)
            print(f"{name}: ", end="", flush=True)
            reply = generate(model, tokenizer, input_ids, streamer, args)
            commands = parse_tool_calls(reply) if tools else []
            text = TOOL_CALL_RE.sub("", reply).strip()
            if not commands:
                history.append({"role": "assistant", "content": text})
                break

            history.append({
                "role": "assistant",
                "content": text,
                "tool_calls": [
                    {"type": "function", "function": {"name": "run_command", "arguments": json.dumps({"command": c})}}
                    for c in commands
                ],
            })
            for command in commands:
                history.append({"role": "tool", "content": run_command(command)})
        else:
            print(f"(Sky AI stopped after {MAX_COMMANDS_PER_TURN} commands in a row.)")
        print()


if __name__ == "__main__":
    main()
