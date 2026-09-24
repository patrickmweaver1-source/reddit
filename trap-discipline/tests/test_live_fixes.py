"""Fixes from the first live run: a trade whose stop sits at entry (breakeven)
crashed the journal sync; a retry after Bybit's 10002 clock error resent the
old timestamp; bursts of candle requests hit 10006; and every new download of
the app started with an empty data folder."""
import asyncio
import os
import sys
import time

import pytest
from aiohttp import web


def fresh(monkeypatch, tmp_path):
    monkeypatch.setenv("TRAP_DATA_DIR", str(tmp_path))
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]


def test_breakeven_stop_does_not_break_the_sync(tmp_path, monkeypatch):
    fresh(monkeypatch, tmp_path)
    from server.account import AccountSync
    from server.core import TrapApp

    async def go():
        a = TrapApp(demo=True)
        await a.startup()
        try:
            tid = a.db.insert_trade({"symbol": "ETHUSDT", "direction": "Long", "status": "closed", "taken": 1,
                                     "source": "bybit", "entry": 3000.0, "stop": 3000.0, "exit": 3010.0,
                                     "opened_at": int(time.time() * 1000) - 3_600_000,
                                     "closed_at": int(time.time() * 1000) - 1_800_000})
            acct = AccountSync(a, None)
            await acct.enrich(tid)             # used to raise ZeroDivisionError
            assert a.db.trade(tid)["max_fav_r"] is None
        finally:
            await a.shutdown()
    asyncio.run(go())


class FakeBybit:
    def __init__(self):
        self.stamps = []
        self.calls = {"time": 0, "pos": 0, "kline": 0}

    async def time(self, request):
        self.calls["time"] += 1
        now_ns = time.time_ns()
        return web.json_response({"retCode": 0, "result": {"timeSecond": str(now_ns // 10**9), "timeNano": str(now_ns)}})

    async def pos(self, request):
        self.calls["pos"] += 1
        self.stamps.append(request.headers["X-BAPI-TIMESTAMP"])
        if self.calls["pos"] == 1:
            return web.json_response({"retCode": 10002, "retMsg": "invalid request, please check your server timestamp"})
        return web.json_response({"retCode": 0, "result": {"list": []}})

    async def kline(self, request):
        self.calls["kline"] += 1
        if self.calls["kline"] == 1:
            return web.json_response({"retCode": 10006, "retMsg": "Too many visits!"},
                                     headers={"X-Bapi-Limit-Reset-Timestamp": str(int(time.time() * 1000) + 300)})
        return web.json_response({"retCode": 0, "result": {"list": []}})


def test_bybit_retries_resign_and_back_off(tmp_path, monkeypatch):
    fresh(monkeypatch, tmp_path)
    import aiohttp
    from server.bybit import BybitREST

    async def go():
        fake = FakeBybit()
        app = web.Application()
        app.router.add_get("/v5/market/time", fake.time)
        app.router.add_get("/v5/position/list", fake.pos)
        app.router.add_get("/v5/market/kline", fake.kline)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        async with aiohttp.ClientSession() as s:
            r = BybitREST(s, "k" * 18, "s" * 36, base=f"http://127.0.0.1:{port}")
            await r.get_private("/v5/position/list", {"category": "linear"})
            assert fake.calls["pos"] == 2 and fake.stamps[0] != fake.stamps[1]     # re-signed with a new time
            assert -2000 < r.time_offset_ms < 0                                       # aims slightly behind Bybit
            t0 = time.monotonic()
            await r.klines("ETHUSDT", "15", limit=10)
            assert fake.calls["kline"] == 2 and time.monotonic() - t0 >= 0.2         # waited for the reset
            t0 = time.monotonic()
            for _ in range(5):
                await r.get_public("/v5/market/time")
            from server import bybit as BYM
            assert time.monotonic() - t0 >= 4 * BYM.PACE_S * 0.95                    # paced, not a burst
        await runner.cleanup()
    asyncio.run(go())


def test_new_download_adopts_the_old_data(tmp_path, monkeypatch):
    """Downloads\\TRAP-Discipline (3)\\trap-discipline\\data -> the shared folder, once."""
    downloads = tmp_path / "Downloads"
    old = downloads / "TRAP-Discipline (3)" / "trap-discipline" / "data"
    older = downloads / "TRAP-Discipline (2)" / "trap-discipline" / "data"
    new_root = downloads / "TRAP-Discipline (4)" / "trap-discipline"
    for d in (old, older, new_root / "server"):
        d.mkdir(parents=True)
    (older / "trap.db").write_text("older")
    (old / "trap.db").write_text("newest")
    (old / "devices.db").write_text("phones")
    (old / "trap.log").write_text("x")
    os.utime(older / "trap.db", (1, 1))
    monkeypatch.delenv("TRAP_DATA_DIR", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "AppData" / "Local"))
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]
    from server import config
    import server.__main__ as M
    assert config.DATA_DIR == tmp_path / "AppData" / "Local" / "TRAP Discipline" / "data"
    monkeypatch.setattr(config, "ROOT", new_root)
    monkeypatch.setattr(config, "LEGACY_DATA_DIR", new_root / "data")
    src = M.adopt_old_data()
    assert src and "(3)" in src
    assert (config.DATA_DIR / "trap.db").read_text() == "newest"
    assert (config.DATA_DIR / "devices.db").exists() and not (config.DATA_DIR / "trap.log").exists()
    assert (old / "trap.db").exists()                  # the old copy is left alone
    assert M.adopt_old_data() is None                  # only the first time
