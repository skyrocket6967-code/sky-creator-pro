# Sky AI Ultra

Sky AI is Sky the Goat's own AI assistant. It's **Qwen3-1.7B** fine-tuned with **4-bit QLoRA** on Sky Theft, Sky the Goat's projects, gaming, GTA modding, YouTube, coding and running commands on your PC. **Sky AI Ultra** is the desktop app you chat with it in. Everything runs on your own Windows PC with an **NVIDIA RTX 4060 (8 GB)**.

| File | What it does |
|---|---|
| `start_sky_ai.bat` | **Double-click this.** Sets up, trains when the data changed, and opens Sky AI Ultra |
| `app.py` | Sky AI Ultra, the desktop chat app |
| `ui/index.html` | The app's interface |
| `chat.py` | Chat with Sky AI in the terminal instead |
| `train.py` | Fine-tunes Qwen3 on everything in `data/` and saves the adapter to `sky-ai-lora/` |
| `sky_core.py` | Shared code: system prompt, model loading, streaming, running commands |
| `data/*.jsonl` | The training data, one file per topic (421 conversations) |
| `setup.bat` | One-time setup: creates `.venv`, installs CUDA PyTorch and the libraries |
| `requirements.txt` | Transformers, TRL, PEFT, Datasets, Accelerate, bitsandbytes |

## Quick start: double-click

Double-click **`start_sky_ai.bat`**.

- **First time:** installs everything (10–20 minutes, about 7 GB of downloads), then trains Sky AI (roughly 10–20 minutes on an RTX 4060), then opens Sky AI Ultra.
- **After that:** it opens Sky AI Ultra in seconds. If you changed anything in `data/`, it retrains first, automatically.

Requirements: Windows 10/11, an up-to-date NVIDIA driver, and **Python 3.12** from python.org with **"Add python.exe to PATH"** ticked.

## Sky AI Ultra (the app)

Sky AI Ultra opens in its own window, a chromeless Microsoft Edge "app" window, so it looks like a normal desktop app.

- **Streams replies live** as Sky AI writes them, with a **Stop** button (or press Esc)
- **Saves your chats** in the sidebar. Start new ones with **New chat**.
- **Formats** code blocks (with Copy buttons), tables, lists and links
- **Runs commands on your PC**: Sky AI shows a card with the exact command and you click **Run** or **Skip**. Risky commands (deleting files, shutting down and so on) need you to type `yes` first. Turn the feature off with the **Allow PC commands** switch.
- **Creativity slider**: lower gives more focused answers, higher gives more creative ones
- **Fast**: the 1.7B model is loaded in bf16 with the training merged in, which is faster than 4-bit

The app only listens on your own PC (127.0.0.1), and every request needs a secret key that only its own window has, so websites can't talk to it. Closing the window shuts the app down a few minutes later, or press Ctrl+C in the black console window.

Options: `python app.py --low-vram` (4-bit, uses less VRAM), `--base-only` (the untrained model, to compare), `--no-window` (just print the address).

## Training

`start_sky_ai.bat` handles training for you. By hand:

```bat
.venv\Scripts\activate
python train.py
```

- `python train.py --ultra`: train the **bigger, smarter brain, Qwen3-4B**. It's slower to train and to chat with, and it still fits 8 GB because it loads in 4-bit. The app picks up whichever brain you trained last.
- `python train.py --epochs 5`: train longer if Sky AI doesn't remember things well enough
- `python train.py --max-length 768`: use less VRAM
- `python train.py --if-changed`: only train if the data or settings changed (this is what the launcher runs)
- `python train.py --resume`: continue after a crash

The first run downloads Qwen3 (~4 GB) into `%USERPROFILE%\.cache\huggingface`.

### VRAM settings

| Setting | Why |
|---|---|
| 4-bit NF4 + double quantization | The 1.7B model takes ~1.3 GB instead of ~3.4 GB |
| LoRA r=16 on all attention/MLP layers | Trains about 1% of the parameters |
| Batch size 1 × gradient accumulation 8 | Effective batch of 8 with the memory cost of 1 |
| `max_length=1024` | Caps example length. Longer examples are skipped, not cut off. |
| Gradient checkpointing | Recomputes activations instead of storing them |
| `paged_adamw_8bit` optimizer | 8-bit optimizer state that can page out on memory spikes |
| bf16 + SDPA attention | Native on the RTX 4060. flash-attn doesn't install on Windows. |
| Loss only on Sky AI's replies | Doesn't waste training on the system prompt and questions |

My estimate is a peak of about 3–4.5 GB for 1.7B and about 5.5–7 GB for `--ultra`, but I couldn't measure it on a real GPU. `train.py` prints the actual peak at the end.

## The training data

`data/` has one file per topic:

| File | What's in it |
|---|---|
| `sky_theft.jsonl` | Everything from skytheft.net: Open Beta 0.9.2 (the Restaurant Update), the story of Kevin King and Darkwood, all six weapons with prices, the cars, Sky Mobile's apps, controls, the Max Power Trainer V4, mods, the update history, the roadmap, the radio, how to install, and casual ways of asking |
| `sky_the_goat.jsonl` | Sky the Goat, the YouTube channel @skythegoat999 and its videos, music, Sky Creator Pro, Sky AI Ultra |
| `identity.jsonl` | Sky AI's name, who made it, and that it runs on Qwen3 (not GPT) |
| `gta.jsonl` | GTA San Andreas, SA modding (ModLoader, CLEO, car mods, texture packs, crashes), GTA V modding, FiveM |
| `games.jsonl` | Fortnite, Minecraft (including older versions), Roblox, Garry's Mod, Cuphead, Unreal Engine 5 game dev and more |
| `youtube.jsonl` | Gaming YouTubers, growing a channel, thumbnails, monetization, OBS |
| `coding.jsonl` | Python, JavaScript, React/TypeScript, Luau, Unity C#, Unreal C++, batch files, Git, fixing errors |
| `pc_commands.jsonl` | Examples of running commands: checking your GPU, disk, RAM and ping, opening sites, launching or closing Sky Theft, and when to refuse |
| `general.jsonl` | PC gaming tips |

**To teach Sky AI something new**, add lines to any file, or make a new `.jsonl` file in `data/`, and double-click `start_sky_ai.bat`. It retrains automatically. Each line is one conversation:

```json
{"messages": [{"role": "user", "content": "What is Sky Burger?"}, {"role": "assistant", "content": "Sky Burger is a restaurant in Darkwood, added in Open Beta 0.9.2."}]}
```

Tips:
- No system message is needed. Training adds Sky AI's system prompt and its command tool automatically.
- **Ask the same thing several ways** ("What is Sky Theft?", "yo whats sky theft", "tell me about sky theft"). That's how a small model memorizes facts.
- **When Sky Theft updates**, update `sky_theft.jsonl`: search for `0.9.2` and add the new update's features.
- Only write things that are true. The model learns mistakes too.

## Troubleshooting

**The Sky AI Ultra window doesn't open**
Open **http://127.0.0.1:8710** in Edge or Chrome yourself. If the console says another port, use that one.

**The window says "Sky AI hasn't been trained yet"**
Run `start_sky_ai.bat` (or `python train.py`) and let training finish.

**`ERROR: PyTorch can't see a CUDA GPU`**, **`Torch not compiled with CUDA enabled`**, or **`Your setup doesn't support bf16/gpu`**
You have the CPU-only build of PyTorch, which is what `pip install torch` installs on Windows. Fix:
```bat
pip uninstall -y torch
pip install torch --index-url https://download.pytorch.org/whl/cu128
```
If that still fails, update your NVIDIA driver.

**`Found no NVIDIA driver on your system`**
The NVIDIA driver is missing or broken. Install the latest Game Ready or Studio driver and reboot.

**`CUDA out of memory`**
- **Training:** close games, browsers and Discord, then try `python train.py --max-length 768`, then `--lora-r 8`.
- **App:** close other GPU apps, or run `python app.py --low-vram`.

**Training is suddenly 10× slower than at the start**
On Windows, the NVIDIA driver doesn't crash when VRAM is full. It spills over into system RAM, which is very slow. To get a clear out-of-memory error instead, open NVIDIA Control Panel → Manage 3D Settings → **CUDA – Sysmem Fallback Policy** → *Prefer No Sysmem Fallback*.

**`NOTE: skipped N example(s) longer than 1024 tokens`**
Those examples didn't fit. Shorten them, or train with `--max-length 1280` if you have spare VRAM.

**`bitsandbytes ... compiled without GPU support` / `CUDA Setup failed`**
Usually this also means CPU-only PyTorch (see above). Then run `pip install -U bitsandbytes`.

**`python` opens the Microsoft Store**
Install Python from python.org with "Add to PATH" ticked, or turn off the `python.exe` alias under Settings → Apps → Advanced app settings → App execution aliases.

**`No matching distribution found for torch`**
Your Python version is too new or 32-bit. Install 64-bit Python 3.12.

**Download errors / `403` / `ConnectionError` when loading Qwen**
The first run needs internet access to huggingface.co. Check your firewall, VPN or school network.

**Sky AI says it's GPT-3.5 / ChatGPT, or gets Sky Theft facts wrong**
Make sure training actually ran after the data changed (the launcher prints it). Then train longer with `python train.py --epochs 5`, or add more ways of asking the same question.

## Testing notes

I tested this in a Linux sandbox with no GPU, using the newest library versions (transformers 5.18, TRL 1.14, PEFT 0.21, bitsandbytes 0.50). The sandbox couldn't download Qwen3, so I used a tiny, randomly initialized Qwen3 model with the same chat template. It writes gibberish, but it exercises all the code:

- `train.py` trained on all 9 data files, wrote the adapter, and `--if-changed` correctly skipped the second run.
- The loss mask covers only Sky AI's replies, including its command requests.
- Sky AI Ultra, tested in a real Chromium browser: streaming replies, saved chats that survive a reload, tables, code blocks, the Run/Skip command cards (the command really ran), the type-`yes` guard on risky commands, and the narrow window layout. There were no JavaScript errors. Requests without the secret key, or from another host, are refused.
- `chat.py` works on the shared core.

I couldn't test on Windows or a real RTX 4060, so the Edge app window, VRAM use and speed are untested.
