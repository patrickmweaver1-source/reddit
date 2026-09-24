"""Start the app:  python -m server  [--demo] [--port 8080] [--no-browser]"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import logging.handlers
import os
import sys

from aiohttp import web

from . import api, config, launcher
from .core import TrapApp


def adopt_old_data() -> str | None:
    """First run of this version: copy the newest data folder left inside an
    older copy of the app (for example Downloads\\TRAP-Discipline (3)) into the
    shared data folder. Copies only; the old folders are left untouched."""
    import shutil
    dst = config.DATA_DIR
    if (dst / "trap.db").exists() or (dst / "devices.db").exists():
        return None
    cands = [config.LEGACY_DATA_DIR]
    for up in (config.ROOT.parent, config.ROOT.parent.parent):
        try:
            cands += list(up.glob("*/data")) + list(up.glob("*/trap-discipline/data"))
        except OSError:
            pass
    best, best_t = None, -1.0
    for c in cands:
        try:
            if c.resolve() == dst.resolve() or not c.is_dir():
                continue
            marks = [c / "trap.db", c / "devices.db"]
            t = max((m.stat().st_mtime for m in marks if m.exists()), default=-1.0)
        except OSError:
            continue
        if t > best_t:
            best, best_t = c, t
    if best is None or best_t < 0:
        return None
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(best, dst, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("trap.log*", "*.db-wal", "*.db-shm"))
    return str(best)


def main() -> None:
    p = argparse.ArgumentParser(description=config.APP_NAME)
    p.add_argument("--demo", action="store_true", help="Run with synthetic market data and a sample journal")
    p.add_argument("--live", action="store_true", help="Force live mode")
    p.add_argument("--port", type=int, default=config.PORT)
    p.add_argument("--no-browser", action="store_true")
    args = p.parse_args()

    adopted = None
    if not os.environ.get("TRAP_DATA_DIR"):
        try:
            adopted = adopt_old_data()
        except Exception as exc:  # noqa: BLE001  (never block startup over this)
            print(f"Could not copy data from an older copy of the app: {exc}")
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(config.DATA_DIR / "trap.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s",
                        handlers=[handler, logging.StreamHandler(sys.stdout)])

    if adopted:
        logging.getLogger("trap").info("Copied your data from %s to %s", adopted, config.DATA_DIR)
    mode_file = config.DATA_DIR / "mode.json"
    demo = args.demo
    if not args.demo and not args.live and mode_file.exists():
        try:
            demo = bool(json.loads(mode_file.read_text()).get("demo"))
        except ValueError:
            demo = False

    # Is something already on the port? Usually an older TRAP window.
    found = launcher.who_is_on(args.port)
    if found["kind"] == "same":
        url = f"http://127.0.0.1:{args.port}/"
        print("\n  TRAP is already running in another window. Opening it in your browser.")
        print(f"  (If nothing opens, go to {url} )\n")
        if not args.no_browser:
            launcher.open_browser(url)
        return
    if found["kind"] == "old_trap":
        where = f" from {found['folder']}" if found.get("folder") else ""
        print(f"\n  An older copy of TRAP is still running{where}. Closing it so this copy can start...")
        if launcher.stop_old_copy(found, args.port):
            print("  Done.\n")
        else:
            print("  Could not close it automatically. Close every other black TRAP window")
            print("  (or restart the laptop), then run Start TRAP.bat again.\n")
            sys.exit(1)
    elif found["kind"] == "other":
        alt = launcher.free_port_near(args.port)
        if alt is None:
            print(f"\n  Another program is using port {args.port} and no nearby port is free. Restart the laptop and try again.\n")
            sys.exit(1)
        print(f"\n  Another program is using port {args.port}, so TRAP will use port {alt} this time.")
        print("  Phone access through Tailscale expects 8080, so restart the laptop when convenient.\n")
        args.port = alt

    config.PORT = args.port
    api.ALLOWED_HOSTS = {f"127.0.0.1:{args.port}", f"localhost:{args.port}"}

    app = web.Application(middlewares=[api.security], client_max_size=2 * 1024 * 1024)
    app["holder"] = {"app": None}
    app["port"] = args.port
    api.build_routes(app)

    async def on_start(_app):
        trap = TrapApp(demo=demo)
        api.TAILNET_HOST["value"] = trap.settings()["tailnet_host"]
        await trap.startup()
        _app["holder"]["app"] = trap
        url = f"http://127.0.0.1:{args.port}/"

        def announce():
            # Runs once the port is actually open, so "is running" is true.
            if not launcher.port_busy(args.port):
                return
            print("\n" + "=" * 60)
            print(f"  {config.APP_NAME} {config.APP_VERSION} is running ({'DEMO' if demo else 'LIVE'} mode)")
            print(f"  Open {url}")
            print(f"  Your data: {config.DATA_DIR}")
            print("  Keep this window open. Close it (or press Ctrl+C) to stop.")
            print("=" * 60 + "\n")
            launcher.write_shortcut(url)
            if not args.no_browser:
                launcher.open_browser(url)

        asyncio.get_running_loop().call_later(1.0, announce)

    async def on_stop(_app):
        trap = _app["holder"]["app"]
        if trap:
            await trap.shutdown()

    app.on_startup.append(on_start)
    app.on_cleanup.append(on_stop)
    try:
        web.run_app(app, host=config.HOST, port=args.port, print=None, access_log=None)
    except OSError as exc:
        print(f"\n  TRAP could not start on port {args.port}: {exc}")
        print("  Close every other black TRAP window, then run Start TRAP.bat again.\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
