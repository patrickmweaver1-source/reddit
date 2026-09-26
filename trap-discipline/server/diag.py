"""Troubleshooting: the evidence behind "slow" and "failed", in a form the user can copy.

* A ring buffer keeps the recent log lines that matter (warnings, errors, AI scan timings),
  so Settings > Troubleshooting can show them and copy them as one report.
* A watchdog THREAD notices when the event loop stops answering for more than
  STALL_S and records the Python stack the loop is stuck in: the exact function that
  froze every page, instead of a guess.
Nothing here ever holds keys, balances or trades: log lines are written by the app itself
and never include secrets.
"""
from __future__ import annotations

import asyncio
import collections
import logging
import platform
import sys
import threading
import time
import traceback

from . import config

STALL_S = 2.0
_BUF: collections.deque = collections.deque(maxlen=300)
log = logging.getLogger("trap.diag")


class _RingHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            if record.levelno >= logging.WARNING or record.name in ("trap.ai", "trap.diag"):
                _BUF.append(f"{time.strftime('%m-%d %H:%M:%S', time.localtime(record.created))} "
                            f"{record.levelname[0]} {record.name}: {record.getMessage()}"[:1500])
        except Exception:  # noqa: BLE001
            pass


def install_log_buffer() -> None:
    root = logging.getLogger()
    if not any(isinstance(h, _RingHandler) for h in root.handlers):
        root.addHandler(_RingHandler(level=logging.INFO))


class Watchdog:
    """Runs in its own thread. The event loop bumps `beat` every 0.25s; when it hasn't for
    STALL_S, the thread logs the loop thread's current stack once per stall."""

    def __init__(self) -> None:
        self.beat = time.monotonic()
        self.loop_thread = threading.get_ident()
        self._stop = False

    async def heartbeat(self) -> None:
        while True:
            self.beat = time.monotonic()
            await asyncio.sleep(0.25)

    def start(self) -> None:
        threading.Thread(target=self._watch, name="trap-watchdog", daemon=True).start()

    def stop(self) -> None:
        self._stop = True

    def _watch(self) -> None:
        reported = 0.0
        last = time.monotonic()
        while not self._stop:
            time.sleep(0.5)
            now = time.monotonic()
            if now - last > 5:              # this thread itself was paused: the laptop slept, not a freeze
                self.beat = now
            last = now
            stuck = now - self.beat
            if stuck >= STALL_S and self.beat != reported:
                reported = self.beat
                frame = sys._current_frames().get(self.loop_thread)
                stack = "".join(traceback.format_stack(frame, limit=12)) if frame else "(no stack)"
                # keep only the app's own frames: that is where the fix goes
                app_lines = [ln for ln in stack.splitlines() if "server" in ln or ln.startswith("    ")]
                log.warning("app server frozen for %.1fs+ in:\n%s", stuck, "\n".join(app_lines[-16:]))


def report(app) -> dict:
    """What Settings > Troubleshooting shows and copies."""
    def count(sql: str):
        try:
            return app.db.one(sql)["n"]
        except Exception:  # noqa: BLE001
            return None
    facts = {
        "app": f"{config.APP_NAME} {config.APP_VERSION} ({'demo' if app.demo else 'live'})",
        "system": f"{platform.system()} {platform.release()} · Python {platform.python_version()}",
        "watchlist": ", ".join(app.settings()["watchlist"]),
        "trades": count("SELECT COUNT(*) AS n FROM trades"),
        "executions": count("SELECT COUNT(*) AS n FROM executions"),
        "liquidations_stored": count("SELECT COUNT(*) AS n FROM liquidations"),
        "ai_model": app.ai.model() if getattr(app, "ai", None) else None,
        "ai_depth": app.ai.depth() if getattr(app, "ai", None) else None,
        "bybit_public_ws": bool(app.public_ws and app.public_ws.connected) if not app.demo else "demo",
    }
    return {"facts": facts, "lines": list(_BUF)[-150:]}
