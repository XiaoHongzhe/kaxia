#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""卡匣 · Switch 卡带管家的本地静态服务器（仅用 Python 标准库）。

除了提供网页，还提供同一局域网内的 App / 网页数据同步：
- HTTP 8765：网页与 /api/sync 接口；
- UDP 8766：接收 App 广播，回复电脑地址和本次配对码。

同步文件保存在 data/sync-data.json，不会上传到互联网。
"""

from __future__ import annotations

import argparse
import errno
import hmac
import json
import os
import re
import secrets
import socket
import threading
import time
import urllib.request
import webbrowser
from datetime import datetime, timezone
from functools import partial
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
SYNC_DIR = ROOT / "data"
SYNC_FILE = SYNC_DIR / "sync-data.json"
DISCOVERY_PORT = 8766
MAX_SYNC_BYTES = 80 * 1024 * 1024
SYNC_TOKEN = secrets.token_urlsafe(24)
SYNC_LOCK = threading.Lock()
GITHUB_REPO = "XiaoHongzhe/kaxia"
APP_CACHE = {"at": 0, "github": None}
APP_CACHE_LOCK = threading.Lock()
VERSION_RE = re.compile(r"(\d+(?:\.\d+){1,3})")


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def version_tuple(value: str):
    match = VERSION_RE.search(str(value or ""))
    if not match:
        return (0,)
    return tuple(int(part) for part in match.group(1).split("."))


def local_apk_info() -> dict:
    candidates = []
    for path in list((ROOT / "dist").glob("*.apk")):
        match = VERSION_RE.search(path.name)
        if match:
            candidates.append((version_tuple(match.group(1)), path.stat().st_mtime, path, match.group(1)))
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    _, _, path, version = candidates[0]
    return {
        "version": version,
        "size": path.stat().st_size,
        "file": path,
        "url": f"/app/latest.apk?v={version}"
    }


def github_apk_info() -> dict:
    now = time.time()
    with APP_CACHE_LOCK:
        cached = APP_CACHE.get("github")
        if cached and now - APP_CACHE.get("at", 0) < 300:
            return cached
    try:
        request = urllib.request.Request(
            f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest",
            headers={"User-Agent": "kaxia-lan-update", "Accept": "application/vnd.github+json"}
        )
        with urllib.request.urlopen(request, timeout=8) as response:
            release = json.loads(response.read().decode("utf-8"))
        asset = next((item for item in release.get("assets", []) if str(item.get("name", "")).endswith(".apk")), None)
        if not asset:
            raise RuntimeError("GitHub Release 没有 APK")
        info = {
            "version": str(release.get("tag_name", "")).lstrip("v"),
            "size": int(asset.get("size", 0)),
            "url": asset.get("browser_download_url", ""),
            "name": asset.get("name", "kaxia.apk")
        }
    except Exception as error:
        info = {"error": str(error)}
    with APP_CACHE_LOCK:
        APP_CACHE["at"] = now
        APP_CACHE["github"] = info
    return info


def app_update_info() -> dict:
    local = local_apk_info()
    github = github_apk_info()
    local_version = local["version"] if local else "0"
    github_version = github.get("version") if "error" not in github else None
    newest = "local" if local else "none"
    if github_version and version_tuple(github_version) > version_tuple(local_version):
        newest = "github"
    elif not local and github_version:
        newest = "github"
    return {
        "ok": True,
        "local": {k: v for k, v in local.items() if k != "file"} if local else None,
        "github": github,
        "newest": newest,
        "download": "/app/update.apk"
    }


def local_ip_for(peer_ip: str) -> str:
    """返回本机对指定对端可用的局域网地址。"""
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect((peer_ip, 9))
            return probe.getsockname()[0]
        finally:
            probe.close()
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"


def sync_info() -> dict:
    info = {
        "service": "kaxia-sync",
        "version": 1,
        "name": socket.gethostname(),
        "updatedAt": None,
        "bytes": 0
    }
    try:
        stat = SYNC_FILE.stat()
        info["updatedAt"] = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds")
        info["bytes"] = stat.st_size
    except OSError:
        pass
    return info


class SyncDiscovery(threading.Thread):
    """监听 App 的 UDP 广播，回复电脑地址和配对码。"""

    def __init__(self, http_port: int) -> None:
        super().__init__(daemon=True)
        self.http_port = http_port

    def run(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("", DISCOVERY_PORT))
        except OSError as error:
            print(f"[同步] UDP {DISCOVERY_PORT} 无法监听：{error}")
            sock.close()
            return
        print(f"[同步] 正在监听 App 广播 UDP {DISCOVERY_PORT}")
        while True:
            try:
                data, address = sock.recvfrom(2048)
            except OSError:
                break
            if data.strip() != b"KAXIA_DISCOVER_V1":
                continue
            host = local_ip_for(address[0])
            response = {
                "service": "kaxia-sync",
                "version": 1,
                "name": socket.gethostname(),
                "url": f"http://{host}:{self.http_port}",
                "port": self.http_port,
                "token": SYNC_TOKEN
            }
            try:
                sock.sendto(json.dumps(response, ensure_ascii=False).encode("utf-8"), address)
            except OSError:
                pass


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
        if getattr(self, "_sync_cookie", False):
            self.send_header("Set-Cookie", f"kaxia_sync={SYNC_TOKEN}; Path=/; HttpOnly; SameSite=Strict")
            self._sync_cookie = False
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        if args and str(args[1] if len(args) > 1 else "").startswith("4"):
            super().log_message(fmt, *args)

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        token = self.headers.get("X-Kaxia-Token", "")
        if not token:
            cookie = SimpleCookie()
            cookie.load(self.headers.get("Cookie", ""))
            morsel = cookie.get("kaxia_sync")
            token = morsel.value if morsel else ""
        return bool(token) and hmac.compare_digest(token, SYNC_TOKEN)

    def _sync_info(self) -> dict:
        info = sync_info()
        info["url"] = f"http://{local_ip_for('8.8.8.8')}:{self.server.server_address[1]}"
        info["port"] = self.server.server_address[1]
        return info

    def _serve_apk(self, path: Path, filename: str) -> None:
        try:
            data = path.read_bytes()
        except OSError:
            self._json(404, {"ok": False, "error": "安装包不存在"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.android.package-archive")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _stream_github_apk(self, url: str) -> bool:
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "kaxia-lan-update"})
            with urllib.request.urlopen(request, timeout=30) as response:
                length = response.headers.get("Content-Length")
                self.send_response(200)
                self.send_header("Content-Type", "application/vnd.android.package-archive")
                self.send_header("Content-Disposition", 'attachment; filename="kaxia-update.apk"')
                if length:
                    self.send_header("Content-Length", length)
                self.end_headers()
                while True:
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            return True
        except Exception:
            return False

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/app/info":
            self._json(200, app_update_info())
            return
        if path == "/app/latest.apk":
            local = local_apk_info()
            if not local:
                self._json(404, {"ok": False, "error": "电脑上没有 APK"})
                return
            self._serve_apk(local["file"], "kaxia-latest.apk")
            return
        if path == "/app/update.apk":
            latest = app_update_info()
            if latest.get("newest") == "github":
                github = latest.get("github", {})
                if github.get("url") and self._stream_github_apk(github["url"]):
                    return
            local = local_apk_info()
            if local:
                self._serve_apk(local["file"], "kaxia-latest.apk")
                return
            self._json(404, {"ok": False, "error": "没有可下载的 APK"})
            return
        if path == "/api/sync/info":
            self._json(200, {"ok": True, **self._sync_info()})
            return
        if path == "/api/sync":
            if not self._authorized():
                self._json(401, {"ok": False, "error": "配对码不正确"})
                return
            try:
                data = SYNC_FILE.read_bytes()
            except OSError:
                self._json(404, {"ok": False, "error": "电脑上还没有同步数据"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        if path == "/":
            self._sync_cookie = True
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/api/sync":
            self._json(404, {"ok": False, "error": "接口不存在"})
            return
        if not self._authorized():
            self._json(401, {"ok": False, "error": "配对码不正确"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0:
            self._json(400, {"ok": False, "error": "请求内容为空"})
            return
        if length > MAX_SYNC_BYTES:
            self._json(413, {"ok": False, "error": "同步数据超过 80MB"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self._json(400, {"ok": False, "error": "不是有效的 JSON"})
            return
        if not isinstance(payload, dict):
            self._json(400, {"ok": False, "error": "同步数据格式错误"})
            return
        if "state" not in payload and isinstance(payload.get("games"), list):
            payload = {"app": "kaxia", "version": "", "state": payload}
        if not isinstance(payload.get("state"), dict) or not isinstance(payload["state"].get("games"), list):
            self._json(400, {"ok": False, "error": "同步数据里没有卡带列表"})
            return
        payload["receivedAt"] = iso_now()
        try:
            SYNC_DIR.mkdir(parents=True, exist_ok=True)
            raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            temp = SYNC_FILE.with_suffix(".tmp")
            with SYNC_LOCK:
                temp.write_bytes(raw)
                os.replace(temp, SYNC_FILE)
        except OSError as error:
            self._json(500, {"ok": False, "error": f"保存失败：{error}"})
            return
        self._json(200, {"ok": True, **self._sync_info(), "bytes": len(raw)})


def kaxia_running_status(port: int) -> str:
    """返回 current / old / false。用于区分旧版服务和当前服务。"""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=0.5) as response:
            if response.status != 200:
                return ""
            snippet = response.read(4096).decode("utf-8", "ignore")
            if "卡匣" not in snippet:
                return ""
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/app/info", timeout=1.5) as api:
                if api.status == 200:
                    return "current"
        except Exception:
            pass
        return "old"
    except Exception:
        return ""


def open_later(port: int) -> None:
    def run() -> None:
        time.sleep(0.8)
        webbrowser.open(f"http://127.0.0.1:{port}/")

    threading.Thread(target=run, daemon=True).start()


def main() -> None:
    parser = argparse.ArgumentParser(description="卡匣 · Switch 卡带管家")
    parser.add_argument("--port", type=int, default=int(os.environ.get("KAXIA_PORT", "8765")))
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--open", action="store_true", help="启动后自动打开浏览器")
    args = parser.parse_args()

    running = kaxia_running_status(args.port)
    if running == "current":
        url = f"http://127.0.0.1:{args.port}/"
        print(f"卡匣已经在运行：{url}")
        if args.open:
            webbrowser.open(url)
        return
    if running == "old":
        print("检测到旧版卡匣服务正在运行。")
        print("请关闭旧的 CMD 窗口，再重新双击「启动卡匣.bat」，否则版本检查和局域网同步会返回 404。")
        if args.open:
            webbrowser.open(f"http://127.0.0.1:{args.port}/")
        return

    try:
        httpd = ThreadingHTTPServer((args.host, args.port), partial(AppHandler, directory=str(ROOT)))
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            print(f"端口 {args.port} 已被其他程序占用。")
            print("请关闭占用该端口的程序，或重启电脑后再试。")
            raise SystemExit(1)
        raise

    httpd.daemon_threads = True
    lan_ip = local_ip_for("8.8.8.8")
    print("")
    print("  ┌──────────────────────────────────────────────┐")
    print("  │  卡匣 · Switch 卡带管家                      │")
    print("  ├──────────────────────────────────────────────┤")
    print(f"  │  本机  http://127.0.0.1:{args.port}/".ljust(47) + "│")
    print(f"  │  局域网 http://{lan_ip}:{args.port}/".ljust(47) + "│")
    print("  │  数据  保存在浏览器 IndexedDB / 本机同步文件  │")
    print("  │  退出  关闭这个窗口即可                      │")
    print("  └──────────────────────────────────────────────┘")
    print("")
    print(f"  同步配对码  {SYNC_TOKEN}")
    print("")
    print("  App 设置 → 局域网同步 → 搜索电脑；首次搜索会自动配对。")
    print("")

    SyncDiscovery(args.port).start()

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
