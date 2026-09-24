"""Start-up helpers: make sure the window you just opened is the copy that
serves the page, and that a browser actually opens it.

The common trap: an older black TRAP window is still open and holding port
8080, so the new copy can't start and the browser keeps showing the old one.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

from . import config


def port_busy(port: int, host: str = "127.0.0.1") -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.5)
    try:
        return s.connect_ex((host, port)) == 0
    except OSError:
        return False
    finally:
        s.close()


def _get(url: str, timeout: float = 2.0) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:  # noqa: S310 (local address only)
            return r.status, r.read(200_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            body = e.read(200_000).decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            body = ""
        return e.code, body
    except (OSError, ValueError):
        return 0, ""


def who_is_on(port: int) -> dict:
    """What is listening on the port: {"kind": "free" | "same" | "old_trap" | "other", ...}."""
    if not port_busy(port):
        return {"kind": "free"}
    base = f"http://127.0.0.1:{port}"
    code, body = _get(base + "/hello")
    if code == 200:
        try:
            info = json.loads(body)
        except ValueError:
            info = {}
        if info.get("app") == config.APP_NAME:
            same = (info.get("version") == config.APP_VERSION
                    and os.path.normcase(str(info.get("folder", ""))) == os.path.normcase(str(config.ROOT)))
            return {"kind": "same" if same else "old_trap", "version": info.get("version"),
                    "folder": info.get("folder"), "pid": info.get("pid")}
    code, body = _get(base + "/")
    if config.APP_NAME in body:
        return {"kind": "old_trap", "version": None, "folder": None, "pid": None}
    return {"kind": "other"}


def _windows_listener_pid(port: int) -> int | None:
    try:
        out = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[0].upper() == "TCP" and parts[1].endswith(f":{port}") \
                and parts[3].upper() == "LISTENING":
            try:
                return int(parts[4])
            except ValueError:
                pass
    return None


def _is_python(pid: int) -> bool:
    if sys.platform != "win32":
        return True
    try:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                             capture_output=True, text=True, timeout=10).stdout.lower()
    except (OSError, subprocess.SubprocessError):
        return False
    return "python" in out


def stop_old_copy(found: dict, port: int, wait_s: float = 8.0) -> bool:
    """Close an older TRAP that is holding the port. Only ever stops a Python
    process that answered as TRAP Discipline on 127.0.0.1."""
    pid = found.get("pid")
    if not pid and sys.platform == "win32":
        pid = _windows_listener_pid(port)
    if not pid or pid == os.getpid() or not _is_python(int(pid)):
        return False
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(int(pid)), "/F"], capture_output=True, timeout=10)
        else:
            import signal
            os.kill(int(pid), signal.SIGTERM)
    except (OSError, subprocess.SubprocessError):
        return False
    end = time.monotonic() + wait_s
    while time.monotonic() < end:
        if not port_busy(port):
            return True
        time.sleep(0.25)
    return not port_busy(port)


def free_port_near(port: int, tries: int = 20) -> int | None:
    for p in range(port + 1, port + 1 + tries):
        if not port_busy(p):
            return p
    return None


def open_browser(url: str) -> None:
    ok = False
    try:
        ok = webbrowser.open(url)
    except Exception:  # noqa: BLE001
        ok = False
    if not ok and sys.platform == "win32":
        try:
            os.startfile(url)  # type: ignore[attr-defined]  # default browser
            ok = True
        except OSError:
            pass
    if not ok:
        print(f"  Could not open a browser by itself. Open Edge or Chrome and go to {url}")


def write_shortcut(url: str, folder: Path | None = None) -> None:
    """An "Open TRAP" shortcut next to Start TRAP.bat, for when the app is
    already running and you just want the page back."""
    folder = folder or config.ROOT
    try:
        (folder / "Open TRAP.url").write_text(f"[InternetShortcut]\r\nURL={url}\r\n", encoding="utf-8")
    except OSError:
        pass
