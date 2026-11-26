#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""卡匣 · Switch 卡带管家的本地静态服务器（仅用 Python 标准库）。

应用本身是纯前端 PWA，数据保存在浏览器的 IndexedDB 中。
这个脚本只负责把文件通过 http://localhost 提供出来，方便安装 PWA 和离线使用。
"""

from __future__ import annotations

import argparse
import errno
import os
import threading
import time
import urllib.request
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class AppHandler(SimpleHTTPRequestHandler):
    server_version = "Kaxia/1.0"

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".json": "application/json; charset=utf-8",
    }

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        if args and str(args[1] if len(args) > 1 else "").startswith("4"):
            super().log_message(fmt, *args)


def is_kaxia_running(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=0.5) as response:
            if response.status != 200:
                return False
            snippet = response.read(4096).decode("utf-8", "ignore")
            return "卡匣" in snippet
    except Exception:
        return False


def open_later(port: int) -> None:
    def run() -> None:
        time.sleep(0.8)
        webbrowser.open(f"http://127.0.0.1:{port}/")

    threading.Thread(target=run, daemon=True).start()


def main() -> None:
    parser = argparse.ArgumentParser(description="卡匣 · Switch 卡带管家")
    parser.add_argument("--port", type=int, default=int(os.environ.get("KAXIA_PORT", "8765")))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--open", action="store_true", help="启动后自动打开浏览器")
    args = parser.parse_args()

    if is_kaxia_running(args.port):
        url = f"http://127.0.0.1:{args.port}/"
        print(f"卡匣已经在运行：{url}")
        if args.open:
            webbrowser.open(url)
        return

    try:
        httpd = ThreadingHTTPServer((args.host, args.port), partial(AppHandler, directory=str(ROOT)))
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            print(f"端口 {args.port} 已被其他程序占用。")
            print("卡匣的数据与 127.0.0.1:8765 这个地址绑定，请不要随意更换端口。")
            print("请关闭占用该端口的程序，或重启电脑后再试。")
            raise SystemExit(1)
        raise

    httpd.daemon_threads = True
    print("")
    print("  ┌──────────────────────────────────────────────┐")
    print("  │  卡匣 · Switch 卡带管家                      │")
    print("  ├──────────────────────────────────────────────┤")
    print(f"  │  地址  http://{args.host}:{args.port}/".ljust(47) + "│")
    print("  │  数据  保存在浏览器 IndexedDB，不经过服务器  │")
    print("  │  退出  关闭这个窗口即可                      │")
    print("  └──────────────────────────────────────────────┘")
    print("")

    if args.open:
        open_later(args.port)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。浏览器里的数据仍然保留。")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
