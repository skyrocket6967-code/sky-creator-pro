"""
Sky AI evaluation suite. Runs the same conversation pipeline as the app (knowledge base, memory,
correction handling, guards, tools) against the trained model and scores the answers.

Usage (from the sky-ai folder, with the venv activated):
    python eval.py                       # 3 trials of every test on the current model
    python eval.py --trials 5
    python eval.py --web                 # also run the live web search test (needs internet)
    python eval.py --no-knowledge        # test the fine-tuned model alone, without the knowledge base
    python eval.py --adapter sky-ai-lora-backups/20261024-101500   # test an older version

Results are saved in eval_results/ and compared with the previous run.
"""

import argparse
import ast
import json
import os
import re
import sys
import tempfile
import time

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import knowledge
import sky_core
import websearch

RESULTS_DIR = "eval_results"
ACK_RE = re.compile(r"\b(you'?re right|sorry|my mistake|thanks|thank you|got it|understood|correct|apolog)", re.I)
NEG_RE = re.compile(r"\b(no|not|never|isn'?t|hasn'?t|wasn'?t|doesn'?t)\b", re.I)
CANT_RE = re.compile(r"\b(can'?t|cannot|couldn'?t|unable|not able|failed|offline|off\b|turned off|no internet|"
                     r"don'?t have (live|current|real-time)|can'?t (check|search|look))", re.I)


class EvalCallbacks(sky_core.Callbacks):
    def __init__(self, memory, search_mode):
        self.memory, self.search_mode, self.searches = memory, search_mode, []

    def approve_command(self, command, purpose, dangerous):
        return False  # the evaluation never runs commands

    def approve_memory(self, fact):
        return self.memory.add(fact)["text"]  # a throwaway memory file, not your real one

    def search(self, query, official_urls=()):
        self.searches.append(query)
        if self.search_mode == "offline":
            raise websearch.SearchError("no internet connection (simulated by the evaluation)")
        return websearch.research(query, official_urls=official_urls)


class Session:
    def __init__(self, model, tokenizer, info, kb, web=False, search_mode="offline", style="balanced"):
        self.model, self.tokenizer, self.info, self.kb = model, tokenizer, info, kb
        self.mem_file = tempfile.NamedTemporaryFile(suffix=".json", delete=False).name
        os.unlink(self.mem_file)
        self.memory = knowledge.Memory(self.mem_file)
        self.cb = EvalCallbacks(self.memory, search_mode)
        self.history = []
        self.settings = {"web": web, "commands": True, "style": style, "max_new_tokens": 600}
        self.stats = []

    def ask(self, text):
        self.history.append({"role": "user", "content": text})
        events = list(sky_core.agent_turn(self.model, self.tokenizer, self.info, self.history, self.settings,
                                          self.cb, self.kb, self.memory))
        answer = self.history[-1]["content"] if self.history[-1]["role"] == "assistant" else ""
        for e in events:
            if e[0] == "stats":
                self.stats.append(e[1])
        return answer, events

    def close(self):
        if os.path.exists(self.mem_file):
            os.unlink(self.mem_file)


SCORING_GUARDS = knowledge.KnowledgeBase().guards  # scoring always uses the real guards, even with --no-knowledge


def steam_ok(kb, answer, question):
    return not knowledge.check_guards(SCORING_GUARDS, answer, question + " sky theft")


def guard_fired(events):
    return any(e[0] == "replace" for e in events)


# ---------------------------------------------------------------- tests (each returns (passed, details))

def t1_what_is(s):
    a, ev = s.ask("What is Sky Theft?")
    facts = ["sky the goat", "darkwood", "kevin", "unreal", "open beta", "skytheft.net", "crime", "open-world", "open world"]
    hits = [f for f in facts if f in a.lower()]
    return len(hits) >= 2 and steam_ok(s.kb, a, "What is Sky Theft?"), {"answer": a, "facts": hits, "guard_fired": guard_fired(ev)}


def t2_steam(s):
    q = "Is Sky Theft available on Steam?"
    a, ev = s.ask(q)
    ok = bool(NEG_RE.search(a)) and "skytheft.net" in a.lower() and steam_ok(s.kb, a, q)
    return ok, {"answer": a, "guard_fired": guard_fired(ev)}


def t3_download(s):
    q = "Where can I download Sky Theft?"
    a, ev = s.ask(q)
    return "skytheft.net" in a.lower() and steam_ok(s.kb, a, q), {"answer": a, "guard_fired": guard_fired(ev)}


def t4_correction(s):
    s.ask("Is Sky Theft on Steam?")
    q = "The information you gave me is incorrect. Sky Theft is not on Steam."
    a, ev = s.ask(q)
    ok = bool(ACK_RE.search(a)) and steam_ok(s.kb, a, q)
    return ok, {"answer": a, "guard_fired": guard_fired(ev), "memory_saved": [m["text"] for m in s.memory.all()]}


def t5_later(s):
    s.ask("Is Sky Theft on Steam?")
    s.ask("The information you gave me is incorrect. Sky Theft is not on Steam.")
    for filler in ("How do I make a crafting table in Minecraft?", "Write a two-line poem about rain.", "What is 12 times 12?"):
        s.ask(filler)
    a1, ev1 = s.ask("Where can I get Sky Theft?")
    a2, ev2 = s.ask("Is it on Steam?")
    ok = "skytheft.net" in a1.lower() and steam_ok(s.kb, a1, "sky theft") and steam_ok(s.kb, a2, "sky theft steam") \
        and bool(NEG_RE.search(a2))
    return ok, {"answer_where": a1, "answer_steam": a2, "guard_fired": guard_fired(ev1) or guard_fired(ev2)}


def t6_web(s):
    a, ev = s.ask("What is the latest stable version of Python? Please search the web.")
    searched = [e for e in ev if e[0] == "search_done"]
    if not searched:
        return False, {"answer": a, "note": "no search happened"}
    result = searched[-1][1]
    if not result["sources"]:
        return None, {"answer": a, "note": "search ran but failed (offline?)", "errors": result["errors"]}
    cites = bool(re.search(r"\[\d\]", a)) or any(src["url"] in a or src["title"][:20] in a for src in result["sources"])
    real = all(int(n) <= len(result["sources"]) for n in re.findall(r"\[(\d+)\]", a))  # no made-up citation numbers
    return cites and real, {"answer": a, "sources": [src["url"] for src in result["sources"]]}


def t7_offline(s):
    a, ev = s.ask("What's the newest Fortnite season right now? Search the web.")
    failed = [e for e in ev if e[0] == "search_done" and not e[1]["sources"]]
    claims_sources = bool(re.search(r"\[\d\]", a))
    return bool(failed) and bool(CANT_RE.search(a)) and not claims_sources, {"answer": a, "searched": bool(failed)}


def t7b_web_off(s):
    a, ev = s.ask("Search the web for today's top gaming news.")
    searched = any(e[0] == "search_done" for e in ev)
    return (not searched) and bool(CANT_RE.search(a)), {"answer": a}


def t8_code(s):
    a, ev = s.ask("Write a Python function that returns the n-th Fibonacci number, with a short example of using it.")
    blocks = re.findall(r"```(?:python|py)?\s*\n(.*?)```", a, re.S)
    parses = False
    for b in blocks:
        try:
            tree = ast.parse(b)
            parses = parses or any(isinstance(n, ast.FunctionDef) for n in ast.walk(tree))
        except SyntaxError:
            pass
    return parses, {"answer": a[:600], "code_blocks": len(blocks)}


def t8b_api(s):
    a, ev = s.ask("How do I read a JSON file into a dictionary in Python?")
    real = "json.load" in a
    fake = bool(re.search(r"json\.(read|open|parse|load_file)\(", a))
    return real and not fake, {"answer": a[:600]}


TESTS = [
    ("1. What is Sky Theft?", t1_what_is, {}),
    ("2. Is Sky Theft on Steam?", t2_steam, {}),
    ("3. Where to download", t3_download, {}),
    ("4. Accepts a correction", t4_correction, {}),
    ("5. No Steam claim after unrelated messages", t5_later, {}),
    ("6. Web search with real sources", t6_web, {"web": True, "search_mode": "live", "needs_web": True}),
    ("7. Offline: admits it can't get live info", t7_offline, {"web": True, "search_mode": "offline"}),
    ("7b. Web search off: says so", t7b_web_off, {"web": False}),
    ("8. Coding: valid Python", t8_code, {}),
    ("8b. Coding: real APIs only", t8b_api, {}),
]


def main():
    p = argparse.ArgumentParser(description="Evaluate Sky AI.")
    p.add_argument("--adapter", default=sky_core.ADAPTER_DIR)
    p.add_argument("--trials", type=int, default=3)
    p.add_argument("--web", action="store_true", help="Run the live web search test (needs internet)")
    p.add_argument("--no-knowledge", action="store_true", help="Disable the knowledge base and guards")
    p.add_argument("--style", default="balanced", choices=list(sky_core.STYLES))
    p.add_argument("--low-vram", action="store_true")
    p.add_argument("--cpu", action="store_true")
    p.add_argument("--only", default=None, help="Run only tests whose name contains this text")
    args = p.parse_args()

    model, tokenizer, info = sky_core.load_model(args.adapter, quantize="4bit" if args.low_vram else "auto",
                                                 device="cpu" if args.cpu else "cuda")
    kb = knowledge.KnowledgeBase(folder="_no_knowledge_" if args.no_knowledge else knowledge.KNOWLEDGE_DIR)
    print(f"\nEvaluating {info['model']} ({info['mode']}), adapter trained {(info['trained'] or {}).get('at')}, "
          f"knowledge base {'OFF' if args.no_knowledge else 'ON'}, {args.trials} trial(s)\n")

    report = {"time": time.strftime("%Y-%m-%d %H:%M"), "adapter": args.adapter, "model": info["model"],
              "mode": info["mode"], "trained": info["trained"], "knowledge": not args.no_knowledge,
              "style": args.style, "tests": {}}
    speeds = []
    for name, fn, opts in TESTS:
        if args.only and args.only.lower() not in name.lower():
            continue
        if opts.get("needs_web") and not args.web:
            print(f"{name:48s} skipped (run with --web to include it)")
            continue
        trials = 1 if opts.get("needs_web") else args.trials
        results = []
        for _ in range(trials):
            s = Session(model, tokenizer, info, kb, web=opts.get("web", False),
                        search_mode=opts.get("search_mode", "offline"), style=args.style)
            try:
                ok, details = fn(s)
            finally:
                s.close()
            speeds += [st["tokens_per_s"] for st in s.stats if st.get("tokens_per_s")]
            results.append({"passed": ok, **details})
        scored = [r for r in results if r["passed"] is not None]
        passed = sum(1 for r in scored if r["passed"])
        line = f"{passed}/{len(scored)} passed" if scored else "skipped (search unavailable)"
        print(f"{name:48s} {line}")
        for r in results:
            if r["passed"] is False:
                first = next((v for k, v in r.items() if k.startswith("answer")), "")
                print(f"      failed answer: {str(first)[:160]!r}")
        report["tests"][name] = {"passed": passed, "total": len(scored), "trials": results}

    total_pass = sum(t["passed"] for t in report["tests"].values())
    total = sum(t["total"] for t in report["tests"].values())
    report["score"] = f"{total_pass}/{total}"
    if speeds:
        report["avg_tokens_per_s"] = round(sum(speeds) / len(speeds), 1)
    print(f"\nScore: {total_pass}/{total}" + (f"   Average speed: {report['avg_tokens_per_s']} tok/s" if speeds else ""))

    os.makedirs(RESULTS_DIR, exist_ok=True)
    previous = sorted(n for n in os.listdir(RESULTS_DIR) if n.endswith(".json"))
    path = os.path.join(RESULTS_DIR, time.strftime("%Y%m%d-%H%M%S") + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"Saved to {path}")
    if previous:
        with open(os.path.join(RESULTS_DIR, previous[-1]), encoding="utf-8") as f:
            old = json.load(f)
        print(f"\nCompared with {previous[-1]} ({old.get('model')}, trained {(old.get('trained') or {}).get('at')}):")
        for name, t in report["tests"].items():
            o = old.get("tests", {}).get(name)
            if o and o["total"]:
                print(f"  {name:46s} {o['passed']}/{o['total']}  ->  {t['passed']}/{t['total']}")
        print(f"  {'Overall':46s} {old.get('score')}  ->  {report['score']}")
    sys.exit(0 if total_pass == total else 1)


if __name__ == "__main__":
    main()
