#!/usr/bin/env python3
"""Phone intake for the watch tool. Runs on the Mac under pm2 ("video-watch"), local only.

  POST http://127.0.0.1:5680/watch   {"url": "...", "note": "...", "token": "..."}

n8n's "Video watch" workflow forwards links shared from the iPhone here. Jobs run one at a time,
in order. The token must match WATCH_TOKEN (env) or ~/.config/video-watch/token.
Log: ~/Downloads/Open Frame/Watched/server.log
"""
import json, os, queue, subprocess, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
PORT = int(os.environ.get("WATCH_PORT", 5680))
TOKEN_FILE = Path.home() / ".config" / "video-watch" / "token"
TOKEN = os.environ.get("WATCH_TOKEN") or (TOKEN_FILE.read_text().strip() if TOKEN_FILE.exists() else "")
OUT = Path(os.environ.get("WATCH_OUT", Path.home() / "Downloads" / "Open Frame" / "Watched"))
COOKIES = os.environ.get("WATCH_COOKIES", "")  # e.g. "chrome" if Instagram asks for a login
jobs = queue.Queue()


def log(*a):
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "server.log", "a") as f:
        f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + " ".join(map(str, a)) + "\n")


def worker():
    while True:
        url, note = jobs.get()
        cmd = [sys.executable, str(HERE / "watch.py"), url, "--note", note]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0 and COOKIES and "login" in (r.stderr + r.stdout):
            r = subprocess.run(cmd + ["--cookies", COOKIES], capture_output=True, text=True)
        log("ok" if r.returncode == 0 else "FAILED", url, (r.stdout or r.stderr).strip().splitlines()[-1:] or "")
        jobs.task_done()


class H(BaseHTTPRequestHandler):
    def reply(self, code, body):
        b = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_POST(self):
        if self.path != "/watch":
            return self.reply(404, {"error": "not found"})
        try:
            d = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        except ValueError:
            return self.reply(400, {"error": "bad json"})
        if not TOKEN or d.get("token") != TOKEN:
            return self.reply(403, {"error": "bad token"})
        url = str(d.get("url", "")).strip()
        if not url.startswith(("http://", "https://")):
            return self.reply(400, {"error": "no link"})
        jobs.put((url, str(d.get("note", ""))[:300]))
        log("queued", url)
        self.reply(202, {"ok": True, "queued": jobs.qsize()})

    def do_GET(self):
        self.reply(200, {"ok": True, "waiting": jobs.qsize()})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    if not TOKEN:
        sys.exit(f"set a token first: put any long random text in {TOKEN_FILE}")
    threading.Thread(target=worker, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
