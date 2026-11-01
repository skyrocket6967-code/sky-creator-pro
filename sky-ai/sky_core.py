"""
Shared Sky AI code used by train.py, chat.py, app.py (Sky AI Ultra), eval.py and benchmark.py.

Keep this file light at import time: torch / transformers are only imported inside the
functions that need them, so `train.py --if-changed` can finish instantly.
"""

import hashlib
import json
import os
import re
import subprocess
import threading
import time

import knowledge as kn

DEFAULT_MODEL = "Qwen/Qwen3-1.7B"
ULTRA_MODEL = "Qwen/Qwen3-4B"  # bigger brain: smarter, slower; fits an 8 GB GPU in 4-bit
ADAPTER_DIR = "sky-ai-lora"
BACKUP_DIR = "sky-ai-lora-backups"
DATA_DIR = "data"
META_FILE = "sky_ai_meta.json"  # written next to the adapter: base model, data fingerprint, training info

# Training data is written for Qwen3-1.7B. personalize() swaps these when training another model.
DATA_MODEL_NAME = "Qwen3-1.7B"
DATA_MODEL_SIZE = "1.7 billion"

SYSTEM_PROMPT_TEMPLATE = """You are Sky AI, made by Sky the Goat. You run locally on the user's Windows PC as {model}, an open-source Qwen model fine-tuned by Sky the Goat (not ChatGPT or OpenAI). You help with games, GTA modding, YouTube, coding, Sky the Goat's projects and the user's PC.
Rules:
- The knowledge base and corrections below are true. They beat your own memory and web results.
- If you're unsure and nothing below covers it, say you don't know or ask. Never invent facts, links, dates or sources.
- When the user corrects you about their own projects, accept it and never repeat the old claim.
- Only say you searched the web if a web_search result is in this chat. Cite it as [1], [2].
- Use run_command only when the user wants something done on their PC.
- Keep stories and hypotheticals separate from real facts.
Status: web search {web}, PC commands {commands}, today {today}."""

TOOLS = [
    {"type": "function", "function": {
        "name": "run_command",
        "description": "Run a cmd.exe command on the user's PC after they approve it.",
        "parameters": {"type": "object", "properties": {
            "command": {"type": "string"},
            "purpose": {"type": "string", "description": "What it does"}},
            "required": ["command", "purpose"]}}},
    {"type": "function", "function": {
        "name": "web_search",
        "description": "Search the web (only when web search is on).",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "remember",
        "description": "Ask the user to save a confirmed fact to long-term memory.",
        "parameters": {"type": "object", "properties": {"fact": {"type": "string"}}, "required": ["fact"]}}},
]

# Response styles. Lower temperature = more focused and factual.
STYLES = {
    "precise": {"temperature": 0.2, "top_p": 0.8},
    "balanced": {"temperature": 0.5, "top_p": 0.85},
    "creative": {"temperature": 0.85, "top_p": 0.95},
}
FACT_TEMPERATURE_CAP = 0.35  # when project facts are in play, stay focused (unless the style is creative)

MAX_PROMPT_TOKENS = 3584  # older turns are dropped past this so long chats can't fill the 8 GB of VRAM
MAX_TOOL_ROUNDS = 5
COMMAND_TIMEOUT_SECONDS = 120
MAX_OUTPUT_CHARS = 2000

TOOL_CALL_RE = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.DOTALL)
TOOL_CALL_TAG = "<tool_call>"
END_TOKENS = ("<|im_end|>", "<|endoftext|>")
# Commands that can delete data or change the system need an extra typed confirmation.
DANGEROUS_RE = re.compile(
    r"\b(del|erase|rd|rmdir|format|diskpart|shutdown|reg\s+delete|reg\s+add|bcdedit|cipher|takeown|icacls|"
    r"remove-item|rm|move|ren|rename|attrib|schtasks|sc\s+(delete|config|stop)|net\s+user|taskkill|wmic|"
    r"powershell\s+.*-enc|set-executionpolicy|curl|wget|invoke-webrequest|iwr|bitsadmin)\b",
    re.IGNORECASE,
)
# Commands Sky AI will never run, even if approved: they can wipe drives or stop Windows from booting.
BLOCKED_RE = re.compile(
    r"\bformat\s+[a-z]:|\bdiskpart\b|\bbcdedit\b.*\b(delete|deletevalue|set)\b|\bvssadmin\b.*\bdelete\b"
    r"|\bcipher\b.*\s/w\b|\breg\s+delete\s+hk(lm|ey_local_machine)\b"
    r"|\b(del|erase|rd|rmdir|remove-item)\b[^&|]*\s(c:\\?\s*$|c:\\\*|c:\\windows|%systemroot%|%windir%|c:\\program files)"
    r"|\b(del|rd|rmdir|erase)\b[^&|]*\s/s\b[^&|]*\sc:\\?(\s|$)|\brm\s+-rf\s+/",
    re.IGNORECASE,
)
LIVE_INFO_RE = re.compile(
    r"\b(latest|newest|current(ly)?|today|tonight|yesterday|this (week|month|year)|right now|recent(ly)?|news|"
    r"price|how much (does|is) .* cost|release date|come out|coming out|patch notes|leak(s|ed)?|rumou?r|"
    r"weather|score|who won|stock|trending|live|20\d\d)\b",
    re.IGNORECASE,
)
DECLINED = "The user declined to run this command."


# ---------------------------------------------------------------- names, prompts

def model_label(model_id):
    """"Qwen/Qwen3-1.7B" -> "Qwen3-1.7B"."""
    return model_id.replace("\\", "/").rstrip("/").split("/")[-1]


def model_size_billions(model_id):
    size = re.search(r"(\d+(?:\.\d+)?)B$", model_label(model_id), re.IGNORECASE)
    return float(size.group(1)) if size else None


def personalize(text, model_id):
    """Make the training data name the model that's actually being trained."""
    label = model_label(model_id)
    if label == DATA_MODEL_NAME:
        return text
    text = text.replace(DATA_MODEL_NAME, label)
    size = model_size_billions(model_id)
    if size:
        text = text.replace(DATA_MODEL_SIZE, f"{size:g} billion")
    return text


def base_prompt(model_id, web=False, commands=True, today=None):
    return SYSTEM_PROMPT_TEMPLATE.format(
        model=model_label(model_id), web="on" if web else "off",
        commands="on" if commands else "off", today=today or time.strftime("%Y-%m-%d"))


def build_system_prompt(model_id, history, kb, memory, web=False, commands=True, today=None):
    """
    System prompt for the next answer: base rules + the facts relevant to this chat.
    Returns (prompt, model_history, info) where model_history has corrected answers blanked out.
    """
    model_history, chat_corrections = kn.apply_corrections(history)
    user_texts = [m["content"] for m in history if m["role"] == "user"]
    query = "\n".join(user_texts[-2:])  # the latest question, plus the one before for follow-ups
    block, used, topics = kn.context_block(kb, memory, query, "\n".join(user_texts), chat_corrections)
    prompt = base_prompt(model_id, web, commands, today)
    if block:
        prompt += "\n\n" + block
    return prompt, model_history, {"sources": used, "topics": topics, "corrections": chat_corrections}


# ---------------------------------------------------------------- adapter metadata

def read_meta(adapter_dir=ADAPTER_DIR):
    try:
        with open(os.path.join(adapter_dir, META_FILE), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def adapter_base_model(adapter_dir=ADAPTER_DIR):
    """Which base model an adapter was trained on, so the right one gets loaded."""
    meta = read_meta(adapter_dir)
    if meta.get("base_model"):
        return meta["base_model"]
    try:
        with open(os.path.join(adapter_dir, "adapter_config.json"), encoding="utf-8") as f:
            return json.load(f).get("base_model_name_or_path") or DEFAULT_MODEL
    except (OSError, ValueError):
        return DEFAULT_MODEL


def data_files(path):
    if os.path.isdir(path):
        return [os.path.join(path, n) for n in sorted(os.listdir(path)) if n.lower().endswith(".jsonl")]
    return [path] if os.path.exists(path) else []


def training_fingerprint(files, model_id, settings):
    """Changes when the data, prompt template, tools, base model or training settings change.
    The knowledge/*.md files are deliberately not included: editing them works without retraining."""
    h = hashlib.sha256()
    for path in files:
        h.update(os.path.basename(path).encode())
        with open(path, "rb") as f:
            h.update(f.read())
    h.update(SYSTEM_PROMPT_TEMPLATE.encode())
    h.update(json.dumps(TOOLS, sort_keys=True).encode())
    h.update(model_id.encode())
    h.update(json.dumps(settings, sort_keys=True).encode())
    return h.hexdigest()


# ---------------------------------------------------------------- loading

def load_model(adapter_dir=ADAPTER_DIR, base_only=False, model_id=None, quantize="auto", device="cuda", log=print):
    """
    Load Sky AI for chatting. Returns (model, tokenizer, info).

    quantize="auto" picks the fastest option that fits an 8 GB GPU:
      - up to ~2.5B parameters (Qwen3-1.7B): bf16 with the LoRA merged in. No dequantizing per token,
        no adapter overhead, so it's the fastest way to run it.
      - bigger (Qwen3-4B "Ultra"): 4-bit NF4, because bf16 (~8 GB) wouldn't fit next to Windows.
    """
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    t0 = time.time()
    if not base_only and not os.path.exists(os.path.join(adapter_dir, "adapter_config.json")):
        raise FileNotFoundError(f"No trained adapter in '{adapter_dir}'. Train Sky AI first with `python train.py`.")
    model_id = model_id or (DEFAULT_MODEL if base_only else adapter_base_model(adapter_dir))

    if device == "cpu":
        use_4bit, dtype, device_map = False, torch.float32, {"": "cpu"}
    else:
        if not torch.cuda.is_available():
            raise RuntimeError("PyTorch can't see a CUDA GPU. See 'Troubleshooting' in README.md.")
        torch.backends.cuda.matmul.allow_tf32 = True
        size = model_size_billions(model_id)
        use_4bit = quantize == "4bit" or (quantize == "auto" and (size is None or size > 2.5))
        dtype, device_map = torch.bfloat16, {"": 0}

    kwargs = dict(dtype=dtype, device_map=device_map, attn_implementation="sdpa")
    if use_4bit:
        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16)

    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model = AutoModelForCausalLM.from_pretrained(model_id, **kwargs)
    t_base = time.time()
    if not base_only:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, adapter_dir)
        if not use_4bit:
            model = model.merge_and_unload()  # bake the LoRA in: no adapter overhead per token
    model.eval()
    t_done = time.time()

    meta = {} if base_only else read_meta(adapter_dir)
    size = model_size_billions(model_id)
    info = {
        "model": model_label(model_id),
        "model_id": model_id,
        "params": f"{size:g}B" if size else "unknown size",
        "mode": "CPU (slow, testing only)" if device == "cpu" else ("4-bit NF4" if use_4bit else "bf16, LoRA merged"),
        "device": "CPU" if device == "cpu" else torch.cuda.get_device_name(0),
        "trained": None if base_only else {"at": meta.get("trained_at", "unknown"), "examples": meta.get("examples"),
                                           "epochs": meta.get("epochs")},
        "adapter": None if base_only else adapter_dir,
        "load_seconds": round(t_done - t0, 1),
        "load_breakdown": {"base_model": round(t_base - t0, 1), "adapter": round(t_done - t_base, 1)},
    }
    if device != "cpu":
        info["vram_gb"] = round(torch.cuda.memory_allocated() / 1024**3, 2)
    log(f"Loaded {info['model']} ({info['mode']}) on {info['device']} in {info['load_seconds']}s")
    return model, tokenizer, info


# ---------------------------------------------------------------- prompts & tool calls

def _shrink_old_tool_results(history):
    """Web results and command output from earlier turns are long; keep them short in the prompt."""
    last_user = max((i for i, m in enumerate(history) if m["role"] == "user"), default=-1)
    out = []
    for i, m in enumerate(history):
        if m["role"] == "tool" and i < last_user and len(m.get("content", "")) > 400:
            m = dict(m, content=m["content"][:400] + "\n...(older result shortened)")
        out.append(m)
    return out


def build_inputs(tokenizer, sys_prompt, model_history, tools):
    """Apply the Qwen3 chat template, dropping the oldest exchanges if the prompt is too long."""
    history = _shrink_old_tool_results(model_history)
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
        # Forget the oldest exchange. Corrections stay pinned in the system prompt, so they survive.
        del history[0]
        while history and history[0]["role"] != "user":
            del history[0]


def parse_tool_calls(text):
    """[(name, arguments dict)] from Qwen3's <tool_call>{...}</tool_call> blocks."""
    calls = []
    for raw in TOOL_CALL_RE.findall(text):
        try:
            call = json.loads(raw)
            args = call.get("arguments", {})
            if isinstance(args, str):
                args = json.loads(args)
            if isinstance(call.get("name"), str) and isinstance(args, dict):
                calls.append((call["name"], args))
        except (json.JSONDecodeError, AttributeError, TypeError):
            continue
    return calls


def strip_tool_calls(text):
    text = TOOL_CALL_RE.sub("", text)
    return text.split(TOOL_CALL_TAG, 1)[0].strip()  # an unfinished tool call shouldn't be shown either


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
            for i in range(len(TOOL_CALL_TAG) - 1, 0, -1):  # hold back a partial "<tool_c..."
                if text.endswith(TOOL_CALL_TAG[:i]):
                    self.pending = TOOL_CALL_TAG[:i]
                    return text[:-i]
        return text


def is_dangerous(command):
    return bool(DANGEROUS_RE.search(command))


def is_blocked(command):
    return bool(BLOCKED_RE.search(command.strip()))


def needs_live_info(text):
    return bool(LIVE_INFO_RE.search(text))


def execute_command(command):
    """Run an approved command with cmd.exe. Returns (text for the model, text to show the user)."""
    try:
        result = subprocess.run(
            command, shell=True, capture_output=True, text=True,
            encoding="oem" if os.name == "nt" else None,  # cmd.exe prints in the console's OEM code page
            errors="replace", timeout=COMMAND_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        msg = f"The command was stopped because it ran longer than {COMMAND_TIMEOUT_SECONDS} seconds."
        return msg, msg
    output = (result.stdout + result.stderr).strip() or "(no output)"
    shown = output
    if len(output) > MAX_OUTPUT_CHARS:
        output = output[:MAX_OUTPUT_CHARS] + "\n...(output cut off)"
    return f"Exit code {result.returncode}\n\n{output}", shown


# ---------------------------------------------------------------- generation

def sampling(style, fact_mode):
    s = dict(STYLES.get(style, STYLES["balanced"]))
    if fact_mode and style != "creative":
        s["temperature"] = min(s["temperature"], FACT_TEMPERATURE_CAP)
    return s


def stream_generate(model, tokenizer, input_ids, settings, stop_event=None, stats=None):
    """Yield text chunks as the model writes them. Fills `stats` with token count and timings."""
    import torch
    from transformers import StoppingCriteria, StoppingCriteriaList, TextIteratorStreamer

    stats = stats if stats is not None else {}
    started = time.time()

    class CountingStreamer(TextIteratorStreamer):
        def put(self, value):
            if not self.next_tokens_are_prompt:
                stats["tokens"] = stats.get("tokens", 0) + int(value.numel())
                stats.setdefault("first_token_s", round(time.time() - started, 3))
            super().put(value)

    class StopOnEvent(StoppingCriteria):
        def __call__(self, input_ids, scores, **kwargs):
            return bool(stop_event and stop_event.is_set())

    streamer = CountingStreamer(tokenizer, skip_prompt=True, skip_special_tokens=False)
    input_ids = input_ids.to(model.device)
    stats["prompt_tokens"] = int(input_ids.shape[-1])
    temperature = settings.get("temperature", 0.5)
    kwargs = dict(
        input_ids=input_ids,
        attention_mask=torch.ones_like(input_ids),
        max_new_tokens=settings.get("max_new_tokens", 1024),
        # No repetition_penalty: it also penalizes words already in the prompt, which pushed the
        # model away from copying facts like "skytheft.net" from its knowledge base.
        repetition_penalty=1.0,
        streamer=streamer,
        stopping_criteria=StoppingCriteriaList([StopOnEvent()]),
        pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id,
    )
    if temperature > 0:
        kwargs.update(do_sample=True, temperature=temperature, top_p=settings.get("top_p", 0.85), top_k=20)
    else:
        kwargs.update(do_sample=False, temperature=None, top_p=None, top_k=None)  # greedy
    error = []

    def run():
        try:
            with torch.inference_mode():
                model.generate(**kwargs)
        except Exception as e:  # surface CUDA errors etc. instead of hanging
            error.append(e)
            streamer.on_finalized_text("", stream_end=True)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    for chunk in streamer:
        yield chunk
    thread.join()
    stats["seconds"] = round(time.time() - started, 3)
    if error:
        raise error[0]


def generate_text(model, tokenizer, input_ids, settings, stop_event=None, stats=None):
    return clean("".join(stream_generate(model, tokenizer, input_ids, settings, stop_event, stats))).strip()


class Callbacks:
    """What the app or terminal does when Sky AI wants something. Override what you support."""

    def approve_command(self, command, purpose, dangerous):
        return False

    def approve_memory(self, fact):
        return None  # return the saved text, or None if the user said no

    def search(self, query, official_urls=()):
        raise RuntimeError("web search isn't available here")


def _tool_message(content):
    return {"role": "tool", "content": content}


def _call_message(name, args, text=""):
    return {"role": "assistant", "content": text,
            "tool_calls": [{"type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}


def agent_turn(model, tokenizer, info, history, settings, callbacks, kb, memory, stop_event=None):
    """
    Answer the latest user message in `history` (appended to in place). Yields events for the UI:
      ("context", {...})                 which knowledge was used
      ("search", query) / ("search_done", result)
      ("text", chunk)                    reply text as it streams
      ("command", command, purpose, dangerous, blocked) / ("result", command, approved, shown)
      ("memory", fact) / ("memory_done", saved_text_or_None)
      ("replace", text, note)            the streamed answer was corrected by a guard
      ("suggest_memory", text)           the user corrected Sky AI; offer to remember it
      ("stats", {...})
      ("limit",)
    """
    web, commands = bool(settings.get("web")), bool(settings.get("commands", True))
    style = settings.get("style", "balanced")
    totals = {"tokens": 0, "seconds": 0.0, "first_token_s": None, "rounds": 0}
    user_text = history[-1]["content"] if history and history[-1]["role"] == "user" else ""
    model_id = info.get("model_id", DEFAULT_MODEL)

    def prompt():
        return build_system_prompt(model_id, history, kb, memory, web, commands)

    sys_prompt, model_history, ctx = prompt()
    yield ("context", ctx)

    # When web search is on and the question needs current information, search first. This is
    # more dependable than hoping a small model decides to call the tool.
    if web and user_text and needs_live_info(user_text):
        official = [kb.sites[t] for t in ctx["topics"] if t in kb.sites]
        yield from _do_search(user_text[:200], official, history, callbacks, record_call=True)
        sys_prompt, model_history, ctx = prompt()

    remembered = False
    for _ in range(MAX_TOOL_ROUNDS + 1):
        totals["rounds"] += 1
        gen = sampling(style, fact_mode=bool(ctx["topics"]))
        gen["max_new_tokens"] = settings.get("max_new_tokens", 1024)
        input_ids = build_inputs(tokenizer, sys_prompt, model_history, TOOLS)
        visible, parts, stats = VisibleText(), [], {}
        for chunk in stream_generate(model, tokenizer, input_ids, gen, stop_event, stats):
            parts.append(chunk)
            shown = visible.feed(chunk)
            if shown:
                yield ("text", shown)
        tail = visible.feed("", final=True)
        if tail:
            yield ("text", tail)
        totals["tokens"] += stats.get("tokens", 0)
        totals["seconds"] += stats.get("seconds", 0)
        if totals["first_token_s"] is None:
            totals["first_token_s"] = stats.get("first_token_s")
        totals["prompt_tokens"] = stats.get("prompt_tokens")

        reply = clean("".join(parts)).strip()
        calls = parse_tool_calls(reply)
        text = strip_tool_calls(reply)
        stopped = bool(stop_event and stop_event.is_set())

        if not calls or stopped:
            if not stopped:
                fixed = yield from _enforce_guards(model, tokenizer, kb, sys_prompt, model_history, text, user_text, gen)
                text = fixed if fixed is not None else text
            history.append({"role": "assistant", "content": text})
            if not remembered and kn.looks_like_correction(user_text):
                yield ("suggest_memory", " ".join(user_text.split())[:300])
            break

        history.append({"role": "assistant", "content": text, "tool_calls": [
            {"type": "function", "function": {"name": n, "arguments": json.dumps(a)}} for n, a in calls]})
        for name, args in calls:
            if name == "run_command":
                yield from _do_command(args, commands, history, callbacks)
            elif name == "web_search":
                if web:
                    yield from _do_search(str(args.get("query") or user_text)[:200], (), history, callbacks, record_call=False)
                else:
                    history.append(_tool_message(
                        "Web search is turned off in Sky AI's settings, so nothing was searched. Tell the user you "
                        "can't look this up live right now (they can turn on Web search), and answer from what you "
                        "know, saying it may be outdated."))
            elif name == "remember":
                remembered = True
                fact = " ".join(str(args.get("fact", "")).split())[:500]
                yield ("memory", fact)
                saved = callbacks.approve_memory(fact) if fact else None
                yield ("memory_done", saved)
                history.append(_tool_message(f"Saved to memory: {saved}" if saved else
                                             "The user chose not to save this to memory."))
            else:
                history.append(_tool_message(f"There is no tool called {name}."))
        sys_prompt, model_history, ctx = prompt()
    else:
        yield ("limit",)

    if totals["seconds"]:
        totals["tokens_per_s"] = round(totals["tokens"] / totals["seconds"], 1)
    yield ("stats", totals)


def _do_search(query, official, history, callbacks, record_call):
    import websearch

    yield ("search", query)
    try:
        result = callbacks.search(query, official)
    except Exception as e:  # offline, blocked, etc.
        result = {"query": query, "provider": None, "sources": [], "errors": [str(e)]}
    yield ("search_done", result)
    if record_call:
        history.append(_call_message("web_search", {"query": query}))
    history.append(_tool_message(websearch.format_for_model(result)))


def _do_command(args, commands_on, history, callbacks):
    command = str(args.get("command", "")).strip()
    purpose = str(args.get("purpose", "")).strip()
    if not commands_on:
        history.append(_tool_message("PC commands are turned off in Sky AI's settings, so nothing ran. "
                                     "Tell the user how to do it themselves instead."))
        return
    blocked = is_blocked(command)
    dangerous = blocked or is_dangerous(command)
    yield ("command", command, purpose, dangerous, blocked)
    if blocked:
        yield ("result", command, False, "Blocked by Sky AI's safety rules.")
        history.append(_tool_message("Sky AI's safety rules blocked this command because it could destroy data or "
                                     "stop Windows from starting. Nothing ran. Explain that to the user."))
        return
    if command and callbacks.approve_command(command, purpose, dangerous):
        for_model, shown = execute_command(command)
        yield ("result", command, True, shown)
    else:
        for_model = DECLINED
        yield ("result", command, False, "")
    history.append(_tool_message(for_model))


def _enforce_guards(model, tokenizer, kb, sys_prompt, model_history, text, user_text, gen):
    """If the answer breaks a guard (like claiming Sky Theft is on Steam), fix it before it's kept."""
    kb.refresh()
    violations = kn.check_guards(kb.guards, text, user_text)
    if not violations:
        return None
    note = "\n\nIMPORTANT: Your previous draft said: " + " | ".join(f'"{s.strip()}"' for _, s in violations) + \
           ". That is false. " + " ".join(dict.fromkeys(g["fact"] for g, _ in violations if g.get("fact"))) + \
           " Write the answer again without that claim."
    retry_ids = build_inputs(tokenizer, sys_prompt + note, model_history, TOOLS)
    retry = strip_tool_calls(generate_text(model, tokenizer, retry_ids, dict(gen, temperature=0.2, top_p=0.8)))
    if retry and not kn.check_guards(kb.guards, retry, user_text):
        fixed = retry
    else:
        fixed = kn.repair(text, violations)
    yield ("replace", fixed, "Sky AI corrected its answer using the knowledge base.")
    return fixed
