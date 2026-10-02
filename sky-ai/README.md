# Sky AI

Sky AI is a gaming assistant made by fine-tuning **Qwen3-1.7B** with **4-bit QLoRA**. It runs on Windows with an **NVIDIA RTX 4060 (8 GB)**. It is trained to call itself Sky AI and to answer questions about Fortnite, Minecraft, GTA, Sky Theft and other games.

| File | What it does |
|---|---|
| `setup.bat` | One-time setup: creates `.venv`, installs CUDA PyTorch and the libraries |
| `requirements.txt` | Transformers, TRL, PEFT, Datasets, Accelerate, bitsandbytes |
| `train.py` | Fine-tunes Qwen3-1.7B and saves the LoRA adapter to `sky-ai-lora/` |
| `chat.py` | Chat with Sky AI in the terminal |
| `training.jsonl` | Example training data (109 conversations) |

## 1. Setup (once)

Requirements:
- Windows 10/11 with an up-to-date NVIDIA driver (check with `nvidia-smi`)
- Python 3.11 or 3.12 from python.org. Tick **"Add python.exe to PATH"** when you install it.
- About 10 GB of free disk space: ~3 GB for PyTorch, ~4 GB for the model download

Open **Command Prompt** in this `sky-ai` folder and run:

```bat
setup.bat
```

The last lines should say `CUDA available: True` and show your RTX 4060.

## 2. Train

```bat
.venv\Scripts\activate
python train.py
```

The first run downloads Qwen3-1.7B (~4 GB) into `%USERPROFILE%\.cache\huggingface`. With the example data, training takes a few minutes on an RTX 4060. Useful options:

- `python train.py --epochs 5`: train longer (good for small datasets)
- `python train.py --max-length 512`: use less VRAM
- `python train.py --data my_games.jsonl`: use a different data file
- `python train.py --resume`: continue after a crash

## 3. Chat

- `python chat.py`: Sky AI (base model + your adapter)
- `python chat.py --base-only`: the original Qwen3-1.7B, to compare

Type `/reset` to clear the conversation and `/exit` to quit.

## VRAM settings

These settings in `train.py` keep training well under 8 GB:

| Setting | Why |
|---|---|
| 4-bit NF4 + double quantization | The 1.7B model takes ~1.3 GB instead of ~3.4 GB |
| LoRA r=16 on all attention/MLP layers | Trains ~17M parameters (about 1%) instead of 1.7B |
| Batch size 1 × gradient accumulation 8 | Effective batch of 8 with the memory cost of 1 |
| `max_length=1024` | Caps how long each training example can be |
| Gradient checkpointing | Recomputes activations instead of storing them |
| `paged_adamw_8bit` optimizer | 8-bit optimizer state that can page out on memory spikes |
| bf16 + SDPA attention | Native on the RTX 4060. flash-attn doesn't install on Windows. |
| Loss only on Sky AI's replies | Doesn't waste training on the system prompt and questions |

My estimate is a peak of roughly 3–4 GB, but I couldn't measure it on a real GPU (see "Testing notes" below). `train.py` prints the actual peak at the end. If you have headroom, you can try `--batch-size 2 --grad-accum 4` for faster training.

## Adding more game data

Each line in `training.jsonl` is one conversation:

```json
{"messages": [{"role": "user", "content": "How do I make a bed in Minecraft?"}, {"role": "assistant", "content": "Put 3 wool across the middle row and 3 planks below it."}]}
```

- You don't need a system message. `train.py` adds the Sky AI system prompt automatically.
- Multi-turn conversations work: alternate `user` and `assistant`.
- **Sky Theft:** the 24 Sky Theft examples cover what you've told me so far: it's an open-world action crime game by Sky the Goat, in open beta at skytheft.net (build 105.8), with an expanding map, missions, homes, inspectable weapons and a new in-game phone. When the game changes, update those lines (especially the build number), and add more facts like the story, characters, controls and map areas. Write several versions of the same question ("What is Sky Theft?", "tell me about sky theft", "what's Sky Theft about"). That's how the model memorizes facts.
- **Unknowns stay unknown:** for things I don't know, like platforms, price or a secret ending, Sky AI is trained to say it doesn't know and to point to skytheft.net. If you add the real answers, replace those examples.
- **More games:** about 100 examples is enough to teach the name and style. To teach a lot of game knowledge, aim for 500–2,000+ accurate examples. Quality matters more than quantity, because the model learns mistakes too.
- With fewer than ~200 examples, use `--epochs 3` to `5`. With thousands, use 1–2.
- Keep the system prompt in `train.py` and `chat.py` the same. `chat.py` imports it from `train.py`.

## Troubleshooting

**`ERROR: PyTorch can't see a CUDA GPU`**, **`Torch not compiled with CUDA enabled`**, or **`Your setup doesn't support bf16/gpu`**
You have the CPU-only build of PyTorch, which is what `pip install torch` installs on Windows. Fix:
```bat
pip uninstall -y torch
pip install torch --index-url https://download.pytorch.org/whl/cu128
```
If that still fails, update your NVIDIA driver.

**`Found no NVIDIA driver on your system`**
The NVIDIA driver is missing or broken. Install the latest Game Ready or Studio driver and reboot.

**`torch.OutOfMemoryError: CUDA out of memory`**
Try these in order:
1. Close games, browsers and Discord. They all use VRAM, and Windows itself uses ~0.5–1 GB.
2. `python train.py --max-length 512`
3. `python train.py --lora-r 8`
4. Keep `--batch-size 1`.

**Training is suddenly 10× slower than at the start**
On Windows, the NVIDIA driver doesn't crash when VRAM is full. It spills over into system RAM, which is very slow. To get a clear out-of-memory error instead, open NVIDIA Control Panel → Manage 3D Settings → **CUDA – Sysmem Fallback Policy** → *Prefer No Sysmem Fallback*. Then apply the out-of-memory fixes above.

**`bitsandbytes ... compiled without GPU support` / `CUDA Setup failed`**
Usually this also means you have CPU-only PyTorch (see above). Then run `pip install -U bitsandbytes`. Old guides tell you to install a special Windows bitsandbytes wheel. You don't need that anymore, and it can cause this error.

**`python` opens the Microsoft Store**
Install Python from python.org with "Add to PATH" ticked. Or turn off the `python.exe` alias under Settings → Apps → Advanced app settings → App execution aliases.

**`No matching distribution found for torch`**
Your Python version is too new or 32-bit. Install 64-bit Python 3.12.

**Download errors / `403` / `ConnectionError` when loading `Qwen/Qwen3-1.7B`**
The first run needs internet access to huggingface.co. Check your firewall, VPN or school network.

**`Paged optimizers are not supported on CPU` warning**
This only happens without a GPU. See the first item.

**Sky AI still says it's Qwen, or ignores your data**
Train longer (`--epochs 5`), add more examples that ask the same thing in different ways, and make sure you're running `chat.py` without `--base-only`.

## Testing notes

I tested this in a Linux sandbox with no GPU, using the newest library versions (transformers 5.18, TRL 1.14, PEFT 0.21, bitsandbytes 0.50). The sandbox couldn't download from Hugging Face, so I tested with a tiny, randomly initialized Qwen3 model that uses the same chat template:

- `train.py` ran all the way through: 4-bit loading, LoRA, training and saving the adapter.
- The loss mask covers only Sky AI's reply and its end-of-turn token.
- `chat.py` loaded the adapter, streamed replies, and `/reset` and `/exit` worked. Old turns are dropped when the prompt gets too long.

I couldn't run it on a real RTX 4060, so VRAM usage and speed are estimates.

Errors I hit while testing, and what they mean:

| Error | Cause |
|---|---|
| `Your setup doesn't support bf16/gpu` | No GPU in the test machine. On your PC this means CPU-only PyTorch (see Troubleshooting). |
| `Found no NVIDIA driver on your system` | Same cause: loading weights onto a GPU that doesn't exist. |
| `Paged optimizers are not supported on CPU` | Harmless warning that only appears without a GPU. |
| `403` from huggingface.co | Network policy in the test sandbox, not a bug in the code. |
