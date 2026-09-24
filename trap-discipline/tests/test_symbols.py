"""Typing "XRP" in the watchlist saved "XRP", which Bybit rejects (error 10001
on every market call). Names are now resolved to Bybit's own symbols first."""
import asyncio

import pytest

from server import symbols as SYM
from server.bybit import BybitError

LISTED = {"XRPUSDT": "LinearPerpetual", "1000PEPEUSDT": "LinearPerpetual", "ETHUSDT": "LinearPerpetual",
          "SOLUSDT": "LinearPerpetual", "XRPPERP": "LinearPerpetual"}


class FakeRest:
    def __init__(self, down=False):
        self.calls = []
        self.last_error = None
        self.down = down

    async def instrument(self, sym):
        self.calls.append(sym)
        if self.down:
            raise OSError("network down")
        if sym not in LISTED:
            self.last_error = "10001: params error: symbol invalid"
            raise BybitError(10001, "params error: symbol invalid", "/v5/market/instruments-info")
        return {"symbol": sym, "contractType": LISTED[sym], "status": "Trading"}


def run(c):
    return asyncio.run(c)


@pytest.mark.parametrize("typed,expected", [
    ("XRP", "XRPUSDT"), ("xrp", "XRPUSDT"), ("XRP/USDT", "XRPUSDT"), ("xrp-usdt", "XRPUSDT"),
    ("BYBIT:XRPUSDT.P", "XRPUSDT"), (" XRPUSDT ", "XRPUSDT"), ("PEPE", "1000PEPEUSDT"), ("XRPPERP", "XRPPERP"),
])
def test_resolves_what_people_type(typed, expected):
    r = FakeRest()
    assert run(SYM.resolve(r, typed)) == expected
    assert r.last_error is None                 # probing spellings doesn't show up as a connection error


def test_list_reports_renames_rejects_and_dupes():
    wl, notes, bad = run(SYM.resolve_list(FakeRest(), ["ETHUSDT", "XRP", "xrpusdt", "NOTACOIN", "sol"]))
    assert wl == ["ETHUSDT", "XRPUSDT", "SOLUSDT"] and bad == ["NOTACOIN"]
    assert "XRP is XRPUSDT on Bybit" in notes


def test_demo_needs_no_lookup_and_network_errors_surface():
    wl, _, bad = run(SYM.resolve_list(None, ["xrp", "ETHUSDT"], demo=True))
    assert wl == ["XRPUSDT", "ETHUSDT"] and not bad
    with pytest.raises(OSError):
        run(SYM.resolve_list(FakeRest(down=True), ["XRP"]))


def test_startup_repairs_a_saved_bad_name(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAP_DATA_DIR", str(tmp_path))
    import sys
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]
    from server.core import TrapApp

    async def go():
        a = TrapApp(demo=True)
        a.set_setting("watchlist", ["ETHUSDT", "XRP"])
        a.set_setting("thin_assets", ["xrp"])
        a.rest = FakeRest()
        await a._repair_watchlist()
        assert a.settings()["watchlist"] == ["ETHUSDT", "XRPUSDT"]
        assert a.settings()["thin_assets"] == ["XRPUSDT"]
    run(go())
