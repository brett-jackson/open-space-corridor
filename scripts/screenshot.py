#!/usr/bin/env python3
"""Open a site page in headless Chromium, run a few steps, and save screenshots.

Serves the repo on a local port, so pages load exactly as they would from a web server,
and prints any browser console errors and failed requests. Needs the project venv:

    python3 -m venv .venv && .venv/bin/pip install playwright && .venv/bin/python -m playwright install chromium

Examples:

    .venv/bin/python scripts/screenshot.py index.html
    .venv/bin/python scripts/screenshot.py "space.html?id=broomfield" --width 390 --full-page
    .venv/bin/python scripts/screenshot.py index.html \\
        "hover:.map-card >> nth=0" "shot:hovered.png" \\
        "click:#panel-tabs button[data-tab=birds]" "wait:1500" "shot:birds.png"

Steps run in order: hover:<selector>, click:<selector>, wait:<ms>, scroll:<selector> (into
view), eval:<javascript>, shot:<file.png> (viewport), fullshot:<file.png> (whole page) and
element:<selector>=<file.png>. With no shot steps, one viewport screenshot is saved.
Screenshots go to .screenshots/ unless a path with a folder is given.
"""
import argparse
import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / ".screenshots"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def out_path(name):
    path = Path(name)
    if path.parent == Path("."):
        OUT_DIR.mkdir(exist_ok=True)
        path = OUT_DIR / path
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("page", help='page path relative to the site root, e.g. index.html or "space.html?id=metzger"')
    parser.add_argument("steps", nargs="*", help="hover:/click:/wait:/scroll:/eval:/shot:/fullshot:/element: steps")
    parser.add_argument("--width", type=int, default=1440)
    parser.add_argument("--height", type=int, default=900)
    parser.add_argument("--scale", type=float, default=1, help="device pixel ratio (2 for a retina-like capture)")
    parser.add_argument("--settle", type=int, default=2500, help="ms to wait after load for tiles, fonts and API calls")
    parser.add_argument("--full-page", action="store_true", help="capture the whole page when no shot steps are given")
    parser.add_argument("--dark", action="store_true", help="emulate a dark color scheme")
    args = parser.parse_args()

    server = serve()
    url = f"http://127.0.0.1:{server.server_address[1]}/{args.page.lstrip('/')}"
    problems = []
    saved = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(
            viewport={"width": args.width, "height": args.height},
            device_scale_factor=args.scale,
            color_scheme="dark" if args.dark else "light",
        )
        page.on("console", lambda msg: msg.type in ("error", "warning") and problems.append(f"console {msg.type}: {msg.text}"))
        page.on("pageerror", lambda err: problems.append(f"page error: {err}"))
        page.on("requestfailed", lambda req: problems.append(f"request failed: {req.url} ({req.failure})"))
        page.on("response", lambda res: res.status >= 400 and problems.append(f"HTTP {res.status}: {res.url}"))

        page.goto(url, wait_until="load")
        page.wait_for_timeout(args.settle)

        for step in args.steps:
            kind, _, value = step.partition(":")
            if kind == "hover":
                page.hover(value)
                page.wait_for_timeout(400)
            elif kind == "click":
                page.click(value)
                page.wait_for_timeout(400)
            elif kind == "wait":
                page.wait_for_timeout(int(value))
            elif kind == "scroll":
                page.locator(value).first.scroll_into_view_if_needed()
                page.wait_for_timeout(300)
            elif kind == "eval":
                print(f"eval -> {page.evaluate(value)!r}")
            elif kind in ("shot", "fullshot"):
                path = out_path(value)
                page.screenshot(path=str(path), full_page=kind == "fullshot")
                saved.append(path)
            elif kind == "element":
                selector, _, name = value.rpartition("=")
                path = out_path(name)
                page.locator(selector).first.screenshot(path=str(path))
                saved.append(path)
            else:
                sys.exit(f"unknown step: {step}")

        if not saved:
            path = out_path("page.png")
            page.screenshot(path=str(path), full_page=args.full_page)
            saved.append(path)
        browser.close()
    server.shutdown()

    for path in saved:
        print(f"saved {path}")
    for line in problems:
        print(line)
    if not problems:
        print("no console errors or failed requests")


if __name__ == "__main__":
    main()
