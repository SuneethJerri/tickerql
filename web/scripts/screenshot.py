#!/usr/bin/env python3
"""Screenshot every view in every theme, headless, with no new dependencies.

The plan's rule is that charts must be *looked at*, not just validated - the
palette validator checks colour, and every layout defect found so far (M-23
through M-26) was a collision or an overflow it cannot see. This is what makes
"I looked at all of them" reproducible instead of a claim.

Three problems have to be solved to shoot this particular app, and each is
solved here rather than in the app:

1. Firefox fires `load` before React Query resolves, so a naive --screenshot
   captures the skeleton. A hidden <img> pointing at /__hold is injected at the
   end of <body>; this proxy holds that response open, and images delay `load`
   without delaying render or DOMContentLoaded.
2. The theme lives in localStorage, which a fresh profile does not have. A seed
   script is injected ahead of index.html's own pre-paint script, so the theme
   is stamped before first paint exactly as it would be for a returning user.
3. Tabs are useState, not routes, so there is no URL to point at. The seed
   script clicks the nav button by label once React has mounted. When tabs
   become deep-linkable this collapses into a plain URL.

Usage:
    python3 web/scripts/screenshot.py --out /tmp/shots
    python3 web/scripts/screenshot.py --themes dark --tabs Correlation --width 1440

Assumes `npx vite` on --upstream and the API on :8000 behind its proxy.
"""

from __future__ import annotations

import argparse
import http.server
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

THEMES = ["system", "light", "dark", "midnight", "graphite", "sepia"]
TABS = ["Dashboard", "Risk vs return", "Correlation", "Ask"]

SEED = """<script>
(function () {
  var q = new URLSearchParams(location.search);
  try {
    var t = q.get('__theme');
    if (t && t !== 'system') localStorage.setItem('theme', t);
    else localStorage.removeItem('theme');
    var a = q.get('__accent');
    if (a) localStorage.setItem('accent', a); else localStorage.removeItem('accent');
  } catch (e) {}
  var tab = q.get('__tab');
  if (!tab || tab === 'Dashboard') return;
  var tries = 0;
  var timer = setInterval(function () {
    var buttons = document.querySelectorAll('.nav button');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].textContent.trim() === tab) {
        buttons[i].click();
        clearInterval(timer);
        return;
      }
    }
    if (++tries > 200) clearInterval(timer);
  }, 25);
})();
</script>"""

HOLD = '<img src="/__hold" alt="" width="1" height="1" style="position:absolute;opacity:0">'


def make_handler(upstream: str, hold_seconds: float):
    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *_args):  # noqa: D102 - quiet by default
            pass

        def do_GET(self):  # noqa: N802
            if self.path.startswith("/__hold"):
                # Held open so the browser's load event waits for the data.
                time.sleep(hold_seconds)
                body = bytes.fromhex(
                    "47494638396101000100800000ffffff00000021f90401000000002c"
                    "00000000010001000002024401003b"
                )
                self.send_response(200)
                self.send_header("Content-Type", "image/gif")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            self._proxy("GET")

        def do_POST(self):  # noqa: N802
            self._proxy("POST")

        def _proxy(self, method: str) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            payload = self.rfile.read(length) if length else None
            request = urllib.request.Request(
                upstream + self.path, data=payload, method=method
            )
            for name, value in self.headers.items():
                if name.lower() not in ("host", "accept-encoding", "connection"):
                    request.add_header(name, value)
            try:
                with urllib.request.urlopen(request) as response:
                    body = response.read()
                    headers = dict(response.headers)
                    status = response.status
            except urllib.error.HTTPError as exc:
                body, headers, status = exc.read(), dict(exc.headers), exc.code
            except OSError as exc:
                self.send_error(502, str(exc))
                return

            if "text/html" in headers.get("Content-Type", ""):
                text = body.decode("utf-8")
                text = text.replace("<head>", "<head>" + SEED, 1)
                text = text.replace("</body>", HOLD + "</body>", 1)
                body = text.encode("utf-8")

            self.send_response(status)
            for name, value in headers.items():
                if name.lower() in ("content-length", "transfer-encoding", "connection"):
                    continue
                self.send_header(name, value)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--upstream", default="http://localhost:5173")
    parser.add_argument("--port", type=int, default=5199)
    parser.add_argument("--width", type=int, default=1440)
    parser.add_argument("--height", type=int, default=900)
    parser.add_argument("--hold", type=float, default=6.0)
    parser.add_argument("--themes", default=",".join(THEMES))
    parser.add_argument("--tabs", default=",".join(TABS))
    parser.add_argument("--accent", default="blue")
    parser.add_argument("--browser", default="zen-browser")
    args = parser.parse_args()

    if not shutil.which(args.browser):
        print(f"{args.browser} not on PATH", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    server = Server(("127.0.0.1", args.port), make_handler(args.upstream, args.hold))
    threading.Thread(target=server.serve_forever, daemon=True).start()

    profile = Path(tempfile.mkdtemp(prefix="shot-profile-"))
    failures = 0
    try:
        for theme in args.themes.split(","):
            for tab in args.tabs.split(","):
                query = urllib.parse.urlencode(
                    {"__theme": theme, "__accent": args.accent, "__tab": tab}
                )
                slug = tab.lower().replace(" ", "-")
                out = args.out / f"{theme}--{slug}.png"
                url = f"http://127.0.0.1:{args.port}/?{query}"
                # A fresh profile per shot would be correct but costs ~2s each;
                # the seed script rewrites localStorage on every load anyway.
                result = subprocess.run(
                    [
                        args.browser, "--headless", "--profile", str(profile),
                        "--window-size", f"{args.width},{args.height}",
                        "--screenshot", str(out), url,
                    ],
                    capture_output=True,
                    timeout=120,
                )
                ok = out.exists() and out.stat().st_size > 0
                if not ok:
                    failures += 1
                    print(result.stderr.decode()[-400:], file=sys.stderr)
                size = out.stat().st_size if ok else 0
                print(f"{'ok ' if ok else 'FAIL'} {out.name} ({size} bytes)")
    finally:
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
