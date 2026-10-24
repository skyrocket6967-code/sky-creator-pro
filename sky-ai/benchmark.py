"""
Measure Sky AI's speed on this PC: load time, time to first token, tokens per second and VRAM,
for each way of running the model. Results are saved in benchmarks/.

Usage (from the sky-ai folder, with the venv activated):
    python benchmark.py                 # compares bf16-merged vs 4-bit for the current model
    python benchmark.py --modes 4bit    # just one mode
    python benchmark.py --cpu           # CPU smoke test (slow, numbers not meaningful)
"""

import argparse
import gc
import json
import os
import time

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import knowledge
import sky_core

PROMPTS = [
    ("short answer", "Is Sky Theft free?"),
    ("knowledge answer", "What guns are in Sky Theft and how much do they cost?"),
    ("long code answer", "Write a Python function that checks if a word is a palindrome, with three examples."),
]


def run_mode(args, mode, kb):
    import torch

    model, tokenizer, info = sky_core.load_model(args.adapter, quantize=mode, device="cpu" if args.cpu else "cuda",
                                                 log=lambda *a: None)
    out = {"mode": info["mode"], "load_seconds": info["load_seconds"], "load_breakdown": info["load_breakdown"],
           "vram_after_load_gb": info.get("vram_gb"), "prompts": []}
    gen = {"temperature": 0.0, "top_p": 1.0, "max_new_tokens": args.max_new_tokens}  # greedy = repeatable
    for label, question in PROMPTS:
        history = [{"role": "user", "content": question}]
        full_prompt, model_history, _ = sky_core.build_system_prompt(info["model_id"], history, kb, None)
        variants = {"full prompt (knowledge + tools)": (full_prompt, sky_core.TOOLS),
                    "minimal prompt": (sky_core.base_prompt(info["model_id"]), None)}
        for vname, (sp, tools) in variants.items():
            ids = sky_core.build_inputs(tokenizer, sp, model_history, tools)
            runs = []
            for _ in range(args.repeats):
                stats = {}
                if not args.cpu:
                    torch.cuda.reset_peak_memory_stats()
                sky_core.generate_text(model, tokenizer, ids, gen, stats=stats)
                if not args.cpu:
                    stats["peak_vram_gb"] = round(torch.cuda.max_memory_allocated() / 1024**3, 2)
                runs.append(stats)
            best = min(runs, key=lambda r: r["seconds"])
            best["tokens_per_s"] = round(best.get("tokens", 0) / best["seconds"], 1) if best["seconds"] else 0
            out["prompts"].append({"prompt": label, "variant": vname, **best})
            print(f"  {label:17s} {vname:32s} prompt {best['prompt_tokens']:5d} tok | first token "
                  f"{best.get('first_token_s', 0):.3f}s | {best['tokens_per_s']:6.1f} tok/s | {best.get('tokens', 0)} tok")
    del model
    gc.collect()
    if not args.cpu:
        torch.cuda.empty_cache()
    return out


def main():
    p = argparse.ArgumentParser(description="Benchmark Sky AI inference.")
    p.add_argument("--adapter", default=sky_core.ADAPTER_DIR)
    p.add_argument("--modes", default="auto,4bit", help="Comma list: auto (bf16 merged for 1.7B), 4bit")
    p.add_argument("--repeats", type=int, default=2)
    p.add_argument("--max-new-tokens", type=int, default=200)
    p.add_argument("--cpu", action="store_true")
    args = p.parse_args()

    kb = knowledge.KnowledgeBase()
    results = {"time": time.strftime("%Y-%m-%d %H:%M"), "adapter": args.adapter,
               "base_model": sky_core.adapter_base_model(args.adapter), "modes": []}
    for mode in [m.strip() for m in args.modes.split(",") if m.strip()]:
        if args.cpu and mode == "4bit":
            print("Skipping 4bit on CPU (bitsandbytes 4-bit is GPU only).")
            continue
        print(f"\nMode: {mode}")
        try:
            r = run_mode(args, mode, kb)
            print(f"  loaded in {r['load_seconds']}s ({r['load_breakdown']}), VRAM after load: {r['vram_after_load_gb']} GB")
            results["modes"].append(r)
        except Exception as e:  # e.g. out of memory for bf16 Ultra
            print(f"  failed: {e}")
            results["modes"].append({"mode": mode, "error": str(e)})

    os.makedirs("benchmarks", exist_ok=True)
    path = os.path.join("benchmarks", time.strftime("%Y%m%d-%H%M%S") + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved to {path}")


if __name__ == "__main__":
    main()
