# Sky AI Ultra

Sky AI is Sky the Goat's own AI assistant: **Qwen3** fine-tuned with **4-bit QLoRA**, plus a local knowledge base, a memory of your corrections, optional web search, and PC commands that only run when you approve them. **Sky AI Ultra** is the desktop app you chat with it in. Everything runs on your own Windows PC with an **NVIDIA RTX 4060 (8 GB)**.

| File | What it does |
|---|---|
| `start_sky_ai.bat` | **Double-click this.** Sets up, retrains when the data changed, and opens Sky AI Ultra |
| `app.py` + `ui/index.html` | Sky AI Ultra, the desktop chat app |
| `chat.py` | Chat in the terminal instead |
| `train.py` | Fine-tunes Qwen3 on `data/` and saves the adapter to `sky-ai-lora/` (with backups) |
| `eval.py` | Automated tests: Sky Theft facts, corrections, web search, offline mode, coding |
| `benchmark.py` | Measures load time, first-token latency, tokens/sec and VRAM on your PC |
| `sky_core.py` | The shared brain: prompts, model loading, generation, tools, guards |
| `knowledge.py` | Knowledge base retrieval, saved memory, correction detection, claim guards |
| `websearch.py` | Optional web search (DuckDuckGo, Wikipedia fallback), standard library only |
| `knowledge/*.md` | **Verified project facts** Sky AI reads at answer time. Edit these, no retraining needed |
| `knowledge/guards.json` | Claims Sky AI must never make, such as "Sky Theft is on Steam" |
| `data/*.jsonl` | Training conversations, one file per topic (481 total) |

## Quick start

Double-click **`start_sky_ai.bat`**. The first time, it installs everything, trains Sky AI and opens the app. After that, it opens the app in seconds and only retrains when `data/` changes. You need Windows 10/11, an up-to-date NVIDIA driver, and Python 3.12 from python.org with **"Add python.exe to PATH"** ticked.

## How Sky AI stays accurate

A 1.7B model can't reliably remember facts from fine-tuning alone. Earlier versions kept claiming Sky Theft was on Steam because the facts only lived in the model's weights, and its own wrong answers stayed in the chat history where it copied them. Sky AI now has four layers of protection:

1. **Knowledge base** (`knowledge/*.md`). Before every answer, the relevant verified facts are put into the model's instructions. Core facts, like where to get Sky Theft, are always included once a project comes up in the chat, even many messages later. Edit the files in Notepad and the change works on the next message.
2. **Memory.** When you correct Sky AI, it offers to save the correction. Saved facts are used in every future chat and win over everything else. Manage them in the **Memory** panel (edit, delete, add) or with `/remember`, `/memory`, `/forget` in `chat.py`. They're stored in `memory/memory.json`.
3. **Correction handling.** When you say something like "that's wrong" or "it's not on Steam", the answer you corrected is removed from what the model sees, so it can't copy its mistake again. Your correction is pinned for the rest of the chat.
4. **Claim guards** (`knowledge/guards.json`). Every answer is checked before it's kept. If it claims Sky Theft is on Steam or another store, Sky AI rewrites it, and the app shows "Sky AI corrected its answer using the knowledge base". Stories you ask for ("write a fake headline where...") are exempt, and they're labeled as fiction.

Generation settings also changed. The old `repetition_penalty` punished the model for reusing words from its own facts (like "skytheft.net"), so it's gone. Choose a **Response style** in the sidebar:
- **Precise** (temperature 0.2)
- **Balanced** (0.5, the default)
- **Creative** (0.85)

Whenever project facts are involved, Precise and Balanced are capped at 0.35 so answers stay focused.

## Web search (optional)

Turn on **Web search** in the sidebar (`chat.py --web`). Sky AI searches when you ask it to, or automatically when a question needs current information ("latest", "news", "right now"...). It downloads the top pages, extracts the relevant text, and shows the real source links in a card. It cites them as [1], [2], and only for pages it actually fetched. If you're offline or a site fails, it says so instead of guessing. With web search off, nothing leaves your PC.

The knowledge base and your saved corrections always win over web results. For Sky Theft questions, the official site skytheft.net is fetched first.

It uses DuckDuckGo's HTML page, with Wikipedia as a fallback, and needs no API key. If you run your own SearXNG instance, set `SKY_AI_SEARXNG_URL` to use it.

## PC commands

When Sky AI wants to run a command, the app shows the command and its **purpose**, and you click **Run** or **Skip**:
- Risky commands (deleting files, killing apps, registry changes and so on) need you to type `yes` first.
- Commands that could wipe a drive or break Windows (`format C:`, `diskpart`, `bcdedit /delete`, deleting `C:\Windows`...) are **blocked**, even if you approve them.

Turn the feature off with the **Allow PC commands** switch.

## Training

- `python train.py`: Standard, **Qwen3-1.7B**.
- `python train.py --ultra` (or double-click **`train_ultra.bat`**): Ultra, **Qwen3-4B**. Smarter but slower: training takes roughly 2–3× as long, and the first run downloads ~8 GB. The app always loads whichever model was trained last and shows its name.
- `python train.py --check-data`: validate the data only.
- `python train.py --restore`: put the previous model back.
- `python train.py --epochs 5`: train longer if facts don't stick.

What training does:
- **Validates the data first.** It checks every answer against the claim guards and refuses to train on a contradiction, such as an example saying Sky Theft is on Steam.
- **Matches the app.** Training uses the same system prompt builder as the app (knowledge, corrections, status). One in four examples is trained without the knowledge block, so facts also stick in the weights.
- **Fits your GPU automatically.** It detects your GPU, VRAM, bf16 support and library versions, and picks the batch size:
  - Standard: batch 4 × accumulation 2. Ultra: 2 × 4.
  - Bigger batches fit because TRL's default *chunked loss* only computes the 152k-word output layer for Sky AI's reply tokens.
  - Batches are grouped by length to waste less time on padding.
  - If the GPU runs out of memory, it halves the batch and retries automatically.
- **Keeps your working model safe.** Training happens in `sky-ai-lora.training/`. The working adapter is backed up to `sky-ai-lora-backups/` (last 3 kept) before the new one replaces it.
- **Shows progress.** Each update line shows elapsed time, time remaining and peak VRAM, plus a warning if VRAM is nearly full.

## Testing and benchmarks

- `python eval.py`: runs the test suite 3 times. Covers what Sky Theft is, Steam, where to download, accepting a correction, no Steam claim after unrelated messages, offline honesty, "web search is off" honesty, valid Python code, and real APIs only. Results are saved in `eval_results/` and compared with the previous run.
- `python eval.py --web`: also tests live web search (needs internet).
- `python eval.py --no-knowledge`: tests the fine-tuned model alone, to see how much the knowledge system adds.
- `python eval.py --adapter sky-ai-lora-backups/<folder>`: tests an older version, for comparison.
- `python benchmark.py`: compares bf16-merged and 4-bit loading, first-token time, tokens/sec and VRAM. It also measures the cost of the longer prompt (knowledge + tools) versus a minimal one.

## Editing what Sky AI knows

- **Facts that change, like a new Sky Theft build:** edit `knowledge/sky_theft.md`. It takes effect on the next message, no retraining. Keep `## ... [core]` sections short, since they're included every time.
- **Something Sky AI keeps getting wrong:** add a line to `knowledge/guards.json`, and correct it in chat or the Memory panel.
- **Style and behavior:** add examples to `data/*.jsonl`, then double-click `start_sky_ai.bat` to retrain.

## Troubleshooting

**The Sky AI Ultra window doesn't open**
Open http://127.0.0.1:8710 in Edge or Chrome yourself.

**"Sky AI hasn't been trained yet"**
Run `start_sky_ai.bat` or `python train.py`.

**`PyTorch can't see a CUDA GPU`**, **`Torch not compiled with CUDA enabled`**
You have CPU-only PyTorch. Fix it with `pip uninstall -y torch`, then `pip install torch --index-url https://download.pytorch.org/whl/cu128`.

**`CUDA out of memory`**
Training retries automatically with a smaller batch. You can also force it: `python train.py --batch-size 1`. For the app, close other GPU apps or run `python app.py --low-vram`.

**Training suddenly gets 10× slower**
Windows is spilling VRAM into system RAM. Set NVIDIA Control Panel → Manage 3D Settings → **CUDA – Sysmem Fallback Policy** → *Prefer No Sysmem Fallback*, then retrain with `--batch-size 2` or `1`.

**`skipped N example(s) longer than ... tokens`**
Shorten those examples, or raise `--max-length`.

**Web search says it failed**
You may be offline, or DuckDuckGo may have asked for a captcha after many searches (it falls back to Wikipedia). Try again later.

**Sky AI says something wrong about your project**
Correct it in chat and save the correction, or fix the fact in `knowledge/*.md`. If it's a claim it should never make, add a guard.

**`Activate.ps1 cannot be loaded because running scripts is disabled`** (PowerShell)
Skip `activate` and run the project's Python directly, like `.venv\Scripts\python.exe train.py --ultra`. Or use the .bat files, which don't need it.

**`ModuleNotFoundError: No module named 'torch'`**
You ran your system Python instead of the project's. Use `.venv\Scripts\python.exe ...` or the .bat files.

**`python` opens the Microsoft Store**
Install Python from python.org with "Add to PATH" ticked.

## Testing notes

Tested in a Linux sandbox without a GPU, with transformers 5.18, TRL 1.14, PEFT 0.21 and bitsandbytes 0.50, using a tiny randomly initialized Qwen3 (the real model can't be downloaded there):

- **Training:** runs on all 11 data files, recovers from a simulated out-of-memory error, backs up and swaps the adapter, `--restore` works, and `--if-changed` skips correctly.
- **Data:** 481 conversations, 0 contradictions with the guards.
- **App:** 18/18 UI checks passed in a real browser with a scripted model:
  - the guard catches a Steam claim and replaces the answer
  - correcting Sky AI offers to save the correction, and saving works
  - the remember card
  - a command card with its purpose
  - a blocked `format C:`
  - web search with real source links (from a mock search engine)
  - Memory panel add, edit and delete
  - all cards redraw after a reload, with no JavaScript errors
- **Web search:** tested against a local mock of DuckDuckGo, Wikipedia and real pages: excerpts, ad filtering, official site first, captcha fallback, offline failure.
- **Eval suite:** a model scripted to keep saying "Sky Theft is on Steam" scores **18/18 with the knowledge system on and 8/18 with it off**. That's the application-level fix working even when the model itself is wrong.

Not tested here: the real Qwen3 models, training on an RTX 4060, actual speed and VRAM numbers, live DuckDuckGo results, and Windows itself. Run `start_sky_ai.bat`, then `python eval.py` and `python benchmark.py` on your PC to get real numbers.
