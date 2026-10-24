"""
Sky AI Ultra - desktop chat app for Sky AI.

Usage (from the sky-ai folder, with the venv activated):
    python app.py                 # opens the Sky AI Ultra window
    python app.py --no-window     # just print the address, open it yourself
    python app.py --low-vram      # load in 4-bit: slower, but uses less VRAM

How it works: this starts a small web server that only your own PC can reach
(127.0.0.1) and opens it in a chromeless Microsoft Edge "app" window, so it looks
and feels like a normal desktop app. The model runs right here in Python on your GPU.
Closing the window shuts the app down after a few minutes, or press Ctrl+C here.
"""

import argparse
import json
import os
import secrets
import shutil
import socket
import subprocess
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import knowledge
import sky_core
import websearch

HERE = os.path.dirname(os.path.abspath(__file__))
UI_FILE = os.path.join(HERE, "ui", "index.html")
PREFERRED_PORT = 8710  # a fixed port keeps your saved chats (browser storage is per address)
IDLE_SHUTDOWN_SECONDS = 180  # the window pings every few seconds; quit when it's been closed
MAX_BODY_BYTES = 2_000_000


class App:
    """Everything the request handlers share."""

    def __init__(self, args):
        self.args = args
        self.token = secrets.token_urlsafe(24)  # proves a request came from our own window
        self.port = None
        self.model = self.tokenizer = self.info = None
        self.kb = knowledge.KnowledgeBase()
        self.memory = knowledge.Memory()
        self.state, self.message = "loading", "Starting up..."
        self.busy = threading.Lock()  # one reply at a time on one GPU
        self.stop_event = threading.Event()
        self.decisions = {}  # card id -> [threading.Event, approved?, edited text]
        self.decisions_lock = threading.Lock()
        self.last_seen = None
        self.generating = False

    def load(self):
        try:
            self.message = "Loading Sky AI onto your GPU..."
            self.model, self.tokenizer, self.info = sky_core.load_model(
                adapter_dir=self.args.adapter,
                base_only=self.args.base_only,
                quantize="4bit" if self.args.low_vram else "auto",
                device="cpu" if self.args.cpu else "cuda",
            )
            self.message = "Warming up..."
            ids = sky_core.build_inputs(self.tokenizer, sky_core.base_prompt(self.info["model_id"]),
                                        [{"role": "user", "content": "hi"}], sky_core.TOOLS)
            for _ in sky_core.stream_generate(self.model, self.tokenizer, ids, {"max_new_tokens": 1}):
                pass
            self.state, self.message = "ready", "Ready"
        except Exception as e:  # show the problem in the window instead of a dead app
            traceback.print_exc()
            self.state = "error"
            self.message = friendly_error(e)

    def wait_for(self, card_id):
        """Block until the window answers a Run/Skip or Save/Don't save card."""
        with self.decisions_lock:
            entry = self.decisions.setdefault(card_id, [threading.Event(), False, None])
        while not entry[0].wait(0.5):
            if self.stop_event.is_set():
                return False, None
        with self.decisions_lock:
            self.decisions.pop(card_id, None)
        return entry[1], entry[2]

    def decide(self, card_id, approved, text=None):
        with self.decisions_lock:
            entry = self.decisions.setdefault(card_id, [threading.Event(), False, None])
            entry[1], entry[2] = bool(approved), text
            entry[0].set()


class AppCallbacks(sky_core.Callbacks):
    def __init__(self, app, send):
        self.app, self.send, self.n, self.current = app, send, 0, None

    def next_id(self):
        self.n += 1
        return f"{int(time.time() * 1000)}-{self.n}"

    def approve_command(self, command, purpose, dangerous):
        approved, _ = self.app.wait_for(self.current)
        return approved

    def approve_memory(self, fact):
        approved, text = self.app.wait_for(self.current)
        if not approved:
            return None
        return self.app.memory.add(text or fact, source="Sky AI suggestion, approved by user")["text"]

    def search(self, query, official_urls=()):
        return websearch.research(query, official_urls=official_urls)


def friendly_error(e):
    text = str(e)
    if "CUDA" in text and "out of memory" in text:
        return "Your GPU ran out of memory. Close games or other apps, or restart with: python app.py --low-vram"
    if isinstance(e, FileNotFoundError):
        return "Sky AI hasn't been trained yet. Run start_sky_ai.bat (or python train.py) first."
    if "CUDA GPU" in text:
        return "PyTorch can't see your NVIDIA GPU. See 'Troubleshooting' in README.md."
    return f"Sky AI couldn't start: {text}"


def clean_history(raw):
    """Only accept the message shapes the chat template understands."""
    history = []
    for m in raw if isinstance(raw, list) else []:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant", "tool"):
            continue
        msg = {"role": m["role"], "content": str(m.get("content") or "")}
        if m["role"] == "assistant" and isinstance(m.get("tool_calls"), list):
            calls = []
            for c in m["tool_calls"]:
                try:
                    calls.append({"type": "function", "function": {
                        "name": str(c["function"]["name"]), "arguments": str(c["function"]["arguments"])}})
                except (KeyError, TypeError):
                    continue
            if calls:
                msg["tool_calls"] = calls
        history.append(msg)
    return history


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        server_version = "SkyAIUltra"

        def log_message(self, fmt, *args):  # keep the console quiet
            pass

        def allowed(self):
            # Only our own window: right host (blocks DNS-rebinding) and the secret token
            # (other websites can't read our page, so they can't know it).
            host = self.headers.get("Host", "")
            if host not in (f"127.0.0.1:{app.port}", f"localhost:{app.port}"):
                return False
            return self.path in ("/", "/index.html") or self.headers.get("X-Sky-Token") == app.token

        def send_json(self, data, code=200):
            body = json.dumps(data).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def read_json(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY_BYTES:
                raise ValueError("request too large")
            return json.loads(self.rfile.read(length) or b"{}")

        def do_GET(self):
            if not self.allowed():
                return self.send_error(403)
            app.last_seen = time.time()
            if self.path in ("/", "/index.html"):
                with open(UI_FILE, encoding="utf-8") as f:
                    page = f.read().replace("__SKY_TOKEN__", app.token)
                body = page.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Security-Policy",
                                 "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
                                 "img-src 'self' data:; connect-src 'self'")
                self.end_headers()
                self.wfile.write(body)
            elif self.path == "/api/status":
                info = app.info or {}
                self.send_json({
                    "state": app.state, "message": app.message, "generating": app.generating,
                    "base_only": bool(app.args.base_only),
                    **{k: info.get(k) for k in ("model", "params", "mode", "device", "trained", "load_seconds", "vram_gb")},
                })
            elif self.path == "/api/memory":
                self.send_json({"facts": app.memory.all()})
            else:
                self.send_error(404)

        def do_POST(self):
            if not self.allowed():
                return self.send_error(403)
            app.last_seen = time.time()
            try:
                body = self.read_json()
            except ValueError:
                return self.send_error(400)
            if self.path == "/api/chat":
                return self.chat(body)
            if self.path == "/api/approve":
                text = body.get("text")
                app.decide(str(body.get("id")), body.get("approve"), str(text) if text else None)
                return self.send_json({"ok": True})
            if self.path == "/api/stop":
                app.stop_event.set()
                return self.send_json({"ok": True})
            if self.path == "/api/memory":
                return self.memory(body)
            self.send_error(404)

        def memory(self, body):
            action = body.get("action")
            try:
                if action == "add":
                    app.memory.add(body.get("text", ""), source="added by user")
                elif action == "update":
                    app.memory.update(str(body.get("id")), body.get("text", ""))
                elif action == "delete":
                    app.memory.delete(str(body.get("id")))
                else:
                    return self.send_json({"error": "unknown action"}, 400)
            except (KeyError, ValueError) as e:
                return self.send_json({"error": str(e)}, 400)
            self.send_json({"facts": app.memory.all()})

        def chat(self, body):
            if app.state != "ready":
                return self.send_json({"error": app.message}, 503)
            if not app.busy.acquire(blocking=False):
                return self.send_json({"error": "Sky AI is still answering. Wait or press Stop."}, 409)
            try:
                history = clean_history(body.get("history"))
                text = str(body.get("message") or "").strip()
                if not text:
                    return self.send_json({"error": "empty message"}, 400)
                history.append({"role": "user", "content": text})
                style = body.get("style") if body.get("style") in sky_core.STYLES else "balanced"
                settings = {"style": style, "web": bool(body.get("web")), "commands": bool(body.get("commands", True)),
                            "max_new_tokens": app.args.max_new_tokens}

                # Stream newline-delimited JSON events; the window reads them as they arrive.
                self.send_response(200)
                self.send_header("Content-Type", "application/x-ndjson")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                app.stop_event.clear()
                app.generating = True

                def send(event):
                    self.wfile.write((json.dumps(event) + "\n").encode("utf-8"))
                    self.wfile.flush()

                cb = AppCallbacks(app, send)
                try:
                    for ev in sky_core.agent_turn(app.model, app.tokenizer, app.info, history, settings, cb,
                                                  app.kb, app.memory, app.stop_event):
                        kind = ev[0]
                        if kind == "text":
                            send({"t": "text", "v": ev[1]})
                        elif kind == "context":
                            send({"t": "context", "sources": ev[1]["sources"], "corrections": len(ev[1]["corrections"])})
                        elif kind == "search":
                            cb.current = cb.next_id()
                            send({"t": "search", "id": cb.current, "query": ev[1]})
                        elif kind == "search_done":
                            r = ev[1]
                            send({"t": "search_done", "id": cb.current, "errors": r["errors"],
                                  "sources": [{k: s.get(k) for k in ("n", "title", "url", "snippet_only")} for s in r["sources"]]})
                        elif kind == "command":
                            cb.current = cb.next_id()
                            send({"t": "command", "id": cb.current, "command": ev[1], "purpose": ev[2],
                                  "dangerous": ev[3], "blocked": ev[4]})
                        elif kind == "result":
                            send({"t": "result", "id": cb.current, "approved": ev[2], "output": ev[3]})
                        elif kind == "memory":
                            cb.current = cb.next_id()
                            send({"t": "memory", "id": cb.current, "fact": ev[1]})
                        elif kind == "memory_done":
                            send({"t": "memory_done", "id": cb.current, "saved": ev[1]})
                        elif kind == "replace":
                            send({"t": "replace", "v": ev[1], "note": ev[2]})
                        elif kind == "suggest_memory":
                            send({"t": "suggest_memory", "v": ev[1]})
                        elif kind == "stats":
                            send({"t": "stats", **ev[1]})
                        elif kind == "limit":
                            send({"t": "notice", "v": f"Stopped after {sky_core.MAX_TOOL_ROUNDS} tool steps in a row."})
                    send({"t": "done", "history": history})
                except (BrokenPipeError, ConnectionResetError):
                    app.stop_event.set()  # the window went away mid-reply
                except Exception as e:
                    traceback.print_exc()
                    try:
                        send({"t": "error", "v": friendly_error(e)})
                    except OSError:
                        pass
            finally:
                app.generating = False
                app.busy.release()

    return Handler


def pick_port():
    for port in (PREFERRED_PORT, 0):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("no free port")


def open_window(url):
    """A chromeless Edge (or Chrome) app window, with its own profile so it acts like its own app."""
    profile = os.path.join(HERE, ".app-profile")
    candidates = []
    if os.name == "nt":
        for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LocalAppData")):
            if base:
                candidates.append(os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"))
                candidates.append(os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"))
    for name in ("msedge", "microsoft-edge", "google-chrome", "chrome", "chromium"):
        found = shutil.which(name)
        if found:
            candidates.append(found)
    for exe in candidates:
        if exe and os.path.exists(exe):
            subprocess.Popen([exe, f"--app={url}", f"--user-data-dir={profile}", "--window-size=1180,820",
                              "--no-first-run", "--no-default-browser-check"])
            return
    webbrowser.open(url)


def main():
    p = argparse.ArgumentParser(description="Sky AI Ultra - desktop chat app for Sky AI.")
    p.add_argument("--adapter", default=sky_core.ADAPTER_DIR)
    p.add_argument("--base-only", action="store_true", help="Chat with the untrained base model")
    p.add_argument("--low-vram", action="store_true", help="Load in 4-bit: slower, but uses less VRAM")
    p.add_argument("--cpu", action="store_true", help="Run on the CPU (very slow; for testing without a GPU)")
    p.add_argument("--no-window", action="store_true", help="Don't open a window, just print the address")
    p.add_argument("--keep-running", action="store_true", help="Don't quit when the window is closed")
    p.add_argument("--port", type=int, default=None)
    p.add_argument("--max-new-tokens", type=int, default=1024)
    args = p.parse_args()

    app = App(args)
    app.port = args.port or pick_port()
    server = ThreadingHTTPServer(("127.0.0.1", app.port), make_handler(app))
    server.daemon_threads = True
    url = f"http://127.0.0.1:{app.port}/"

    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"Sky AI Ultra is running at {url}")
    if not args.no_window:
        open_window(url)  # the window shows a loading screen while the model loads
    print("Close the window or press Ctrl+C here to quit.")
    app.load()

    try:
        while True:
            time.sleep(5)
            idle = app.last_seen and time.time() - app.last_seen > IDLE_SHUTDOWN_SECONDS
            if idle and not app.generating and not args.keep_running and not args.no_window:
                print("The window was closed. Bye!")
                break
    except KeyboardInterrupt:
        print("\nBye!")
    app.stop_event.set()
    server.shutdown()


if __name__ == "__main__":
    main()
