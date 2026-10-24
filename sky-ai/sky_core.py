"""
Shared Sky AI code used by train.py, chat.py and app.py (Sky AI Ultra).

Keep this file light at import time: torch / transformers are only imported inside
the functions that need them, so `train.py --if-changed` can finish instantly.
"""

import hashlib
import json
import os
import re
import subprocess
import threading

DEFAULT_MODEL = "Qwen/Qwen3-1.7B"
ULTRA_MODEL = "Qwen/Qwen3-4B"  # bigger brain: smarter, slower; still fits an 8 GB GPU in 4-bit
ADAPTER_DIR = "sky-ai-lora"
DATA_DIR = "data"
META_FILE = "sky_ai_meta.json"  # written next to the adapter: base model + hash of the training data

# Training data is written for Qwen3-1.7B. personalize() swaps these when training another model.
DATA_MODEL_NAME = "Qwen3-1.7B"
DATA_MODEL_SIZE = "1.7 billion"

SYSTEM_PROMPT_TEMPLATE = (
    "You are Sky AI, a friendly and knowledgeable assistant created by Sky the Goat. "
    "You run on {model}, an open-source model from Alibaba's Qwen team that Sky the Goat "
    "fine-tuned. You are not GPT-3.5, ChatGPT or any OpenAI model. "
    "You know a lot about video games, GTA modding, gaming YouTubers, coding, and Sky the Goat's "
    "projects: the game Sky Theft, the app Sky Creator Pro and the YouTube channel @skythegoat999. "
    "You run on the user's Windows PC and can use the run_command tool when they ask you to do "
    "something on their computer. Give clear, accurate, helpful answers. If you don't know "
    "something, say so instead of making it up. If the user corrects you, especially about Sky the "
    "Goat's own projects, accept the correction and don't repeat the mistake. Sky Theft is only "
    "available from skytheft.net. It is not on Steam."
)

# The one tool Sky AI can call. Every command is shown to the user and only runs after they
# approve it. It's added to every training example so training matches chat.py and app.py.
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": (
                "Run a Windows Command Prompt (cmd.exe) command on the user's PC and return its "
                "output. The user must approve every command before it runs."
            ),
            "parameters": {
                "type": "object",
                "properties": {"command": {"type": "string", "description": "The cmd.exe command to run"}},
                "required": ["command"],
            },
        },
    }
]

# Older turns are dropped once the prompt grows past this many tokens, so a long
# chat can't slowly fill the 8 GB of VRAM.
MAX_PROMPT_TOKENS = 3072
MAX_COMMANDS_PER_TURN = 5
COMMAND_TIMEOUT_SECONDS = 120
MAX_OUTPUT_CHARS = 2000

TOOL_CALL_RE = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.DOTALL)
TOOL_CALL_TAG = "<tool_call>"
END_TOKENS = ("<|im_end|>", "<|endoftext|>")
# Commands that can delete data or change the system need an extra confirmation.
DANGEROUS_RE = re.compile(
    r"\b(del|erase|rd|rmdir|format|diskpart|shutdown|reg\s+delete|bcdedit|cipher|takeown|icacls|"
    r"remove-item|rm|move|ren|rename|attrib|schtasks|sc\s+delete|net\s+user|powershell\s+.*-enc)\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------- model names

def model_label(model_id):
    """"Qwen/Qwen3-1.7B" -> "Qwen3-1.7B"."""
    return model_id.replace("\\", "/").rstrip("/").split("/")[-1]


def personalize(text, model_id):
    """Make the training data name the model that's actually being trained."""
    label = model_label(model_id)
    if label == DATA_MODEL_NAME:
        return text
    text = text.replace(DATA_MODEL_NAME, label)
    size = re.search(r"(\d+(?:\.\d+)?)B$", label, re.IGNORECASE)
    if size:
        text = text.replace(DATA_MODEL_SIZE, f"{size.group(1)} billion")
    return text


def system_prompt(model_id=DEFAULT_MODEL):
    return SYSTEM_PROMPT_TEMPLATE.format(model=model_label(model_id))


def model_size_billions(model_id):
    size = re.search(r"(\d+(?:\.\d+)?)B$", model_label(model_id), re.IGNORECASE)
    return float(size.group(1)) if size else None


# ---------------------------------------------------------------- adapter metadata

def read_meta(adapter_dir=ADAPTER_DIR):
    try:
        with open(os.path.join(adapter_dir, META_FILE), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def adapter_base_model(adapter_dir=ADAPTER_DIR):
    """Which base model an adapter was trained on, so chat.py and app.py load the right one."""
    meta = read_meta(adapter_dir)
    if meta.get("base_model"):
        return meta["base_model"]
    try:
        with open(os.path.join(adapter_dir, "adapter_config.json"), encoding="utf-8") as f:
            return json.load(f).get("base_model_name_or_path") or DEFAULT_MODEL
    except (OSError, ValueError):
        return DEFAULT_MODEL


def data_files(path):
    """A single .jsonl file, or every .jsonl file in a folder (sorted, so the hash is stable)."""
    if os.path.isdir(path):
        return [os.path.join(path, n) for n in sorted(os.listdir(path)) if n.lower().endswith(".jsonl")]
    return [path] if os.path.exists(path) else []


def training_fingerprint(files, model_id, settings):
    """Changes whenever the data, system prompt, tools, base model or training settings change."""
    h = hashlib.sha256()
    for path in files:
        h.update(os.path.basename(path).encode())
        with open(path, "rb") as f:
            h.update(f.read())
    h.update(system_prompt(model_id).encode())
    h.update(json.dumps(TOOLS, sort_keys=True).encode())
    h.update(model_id.encode())
    h.update(json.dumps(settings, sort_keys=True).encode())
    return h.hexdigest()


# ---------------------------------------------------------------- loading

def load_model(adapter_dir=ADAPTER_DIR, base_only=False, model_id=None, quantize="auto", device="cuda"):
    """
    Load Sky AI for chatting. Returns (model, tokenizer, info).

    quantize="auto" picks the fastest option that fits an 8 GB GPU:
      - models up to ~2.5B (Qwen3-1.7B): bf16 with the LoRA merged in. Fastest replies.
      - bigger models (Qwen3-4B "Ultra"): 4-bit, because bf16 wouldn't fit in 8 GB.
    """
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    if not base_only and not os.path.isdir(adapter_dir):
        raise FileNotFoundError(
            f"Adapter folder '{adapter_dir}' not found. Train Sky AI first with `python train.py`."
        )
    model_id = model_id or (DEFAULT_MODEL if base_only else adapter_base_model(adapter_dir))

    if device == "cpu":
        use_4bit, dtype, device_map = False, torch.float32, {"": "cpu"}
    else:
        if not torch.cuda.is_available():
            raise RuntimeError("PyTorch can't see a CUDA GPU. See 'Troubleshooting' in README.md.")
        size = model_size_billions(model_id)
        use_4bit = quantize == "4bit" or (quantize == "auto" and (size is None or size > 2.5))
        dtype, device_map = torch.bfloat16, {"": 0}

    kwargs = dict(dtype=dtype, device_map=device_map, attn_implementation="sdpa")
    if use_4bit:
        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
        )

    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model = AutoModelForCausalLM.from_pretrained(model_id, **kwargs)
    if not base_only:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, adapter_dir)
        if not use_4bit:
            model = model.merge_and_unload()  # bake the LoRA in: no adapter overhead per token
    model.eval()

    if device == "cpu":
        mode, device_name = "CPU (slow, for testing)", "CPU"
    else:
        mode = "4-bit" if use_4bit else "bf16, merged"
        device_name = torch.cuda.get_device_name(0)
    info = {
        "model": model_label(model_id),
        "model_id": model_id,
        "mode": mode,
        "device": device_name,
        "adapter": None if base_only else adapter_dir,
        "system_prompt": system_prompt(model_id),
    }
    return model, tokenizer, info


# ---------------------------------------------------------------- prompts & tool calls

def build_inputs(tokenizer, sys_prompt, history, tools):
    """Apply the Qwen3 chat template, dropping the oldest exchanges if the prompt is too long."""
    while True:
        messages = [{"role": "system", "content": sys_prompt}] + history
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


def strip_tool_calls(text):
    text = TOOL_CALL_RE.sub("", text)
    # An unfinished tool call (cut off by max tokens) shouldn't be shown either.
    return text.split(TOOL_CALL_TAG, 1)[0].strip()


def clean(text):
    for token in END_TOKENS:
        text = text.replace(token, "")
    return text


class VisibleText:
    """Feed it streamed chunks; it returns only the text the user should see (no tool-call JSON)."""

    def __init__(self):
        self.hidden = False
        self.pending = ""

    def feed(self, chunk, final=False):
        if self.hidden:
            return ""
        text = self.pending + clean(chunk)
        self.pending = ""
        if TOOL_CALL_TAG in text:
            self.hidden = True
            return text.split(TOOL_CALL_TAG, 1)[0]
        if not final:
            # Hold back a partial "<tool_c..." at the end until we know what it is.
            for i in range(len(TOOL_CALL_TAG) - 1, 0, -1):
                if text.endswith(TOOL_CALL_TAG[:i]):
                    self.pending = TOOL_CALL_TAG[:i]
                    return text[:-i]
        return text


def is_dangerous(command):
    return bool(DANGEROUS_RE.search(command))


def execute_command(command):
    """Run an approved command with cmd.exe. Returns (text for the model, text to show the user)."""
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
        msg = f"The command was stopped because it ran longer than {COMMAND_TIMEOUT_SECONDS} seconds."
        return msg, msg
    output = (result.stdout + result.stderr).strip() or "(no output)"
    shown = output
    if len(output) > MAX_OUTPUT_CHARS:
        output = output[:MAX_OUTPUT_CHARS] + "\n...(output cut off)"
    return f"Exit code {result.returncode}\n\n{output}", shown


DECLINED = "The user declined to run this command."


# ---------------------------------------------------------------- generation

def stream_generate(model, tokenizer, input_ids, settings, stop_event=None):
    """Yield text chunks as the model writes them. Set stop_event to stop early."""
    import torch
    from transformers import StoppingCriteria, StoppingCriteriaList, TextIteratorStreamer

    class StopOnEvent(StoppingCriteria):
        def __call__(self, input_ids, scores, **kwargs):
            return bool(stop_event and stop_event.is_set())

    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=False)
    input_ids = input_ids.to(model.device)
    kwargs = dict(
        input_ids=input_ids,
        attention_mask=torch.ones_like(input_ids),
        max_new_tokens=settings.get("max_new_tokens", 768),
        do_sample=True,
        # Qwen's recommended sampling settings for non-thinking mode
        temperature=settings.get("temperature", 0.7),
        top_p=0.8,
        top_k=20,
        repetition_penalty=1.05,
        streamer=streamer,
        stopping_criteria=StoppingCriteriaList([StopOnEvent()]),
        pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id,
    )
    error = []

    def run():
        try:
            with torch.inference_mode():
                model.generate(**kwargs)
        except Exception as e:  # surface CUDA errors etc. to the caller instead of hanging
            error.append(e)
            streamer.on_finalized_text("", stream_end=True)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    for chunk in streamer:
        yield chunk
    thread.join()
    if error:
        raise error[0]


def agent_turn(model, tokenizer, sys_prompt, history, tools, settings, approve, stop_event=None):
    """
    Run one user turn: generate, run any approved commands, generate again, ...
    Appends to `history` in place and yields events for the UI:
        ("text", chunk)                      visible reply text as it streams
        ("command", command, dangerous)      Sky AI wants to run this (approve() is called next)
        ("result", command, approved, shown) what happened
        ("limit",)                           too many commands in a row
    approve(command, dangerous) -> bool is called synchronously for every command.
    """
    for _ in range(MAX_COMMANDS_PER_TURN + 1):
        input_ids = build_inputs(tokenizer, sys_prompt, history, tools)
        visible = VisibleText()
        parts = []
        for chunk in stream_generate(model, tokenizer, input_ids, settings, stop_event):
            parts.append(chunk)
            shown = visible.feed(chunk)
            if shown:
                yield ("text", shown)
        tail = visible.feed("", final=True)
        if tail:
            yield ("text", tail)

        reply = clean("".join(parts)).strip()
        commands = parse_tool_calls(reply) if tools else []
        text = strip_tool_calls(reply) if tools else reply
        stopped = bool(stop_event and stop_event.is_set())
        if not commands or stopped:
            history.append({"role": "assistant", "content": text})
            return

        history.append({
            "role": "assistant",
            "content": text,
            "tool_calls": [
                {"type": "function", "function": {"name": "run_command", "arguments": json.dumps({"command": c})}}
                for c in commands
            ],
        })
        for command in commands:
            dangerous = is_dangerous(command)
            yield ("command", command, dangerous)
            if approve(command, dangerous):
                for_model, shown = execute_command(command)
                yield ("result", command, True, shown)
            else:
                for_model = DECLINED
                yield ("result", command, False, "")
            history.append({"role": "tool", "content": for_model})
    yield ("limit",)
