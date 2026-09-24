"""Market Monitor chart data: timeframe/lookback limits, paging back through
Bybit's 1000-bar kline pages, alignment of OI/CVD/funding onto the candle
grid, and the small 'since' top-up used by the 15 second refresh."""
import asyncio
import sys

import pytest

MIN = 60_000


@pytest.fixture()
def CH(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAP_DATA_DIR", str(tmp_path))
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]
    from server import chart
    return chart


def test_limits(CH):
    assert CH.allowed("15", "3M") and not CH.allowed("15", "6M")        # 17,472 bars is over the cap
    assert CH.allowed("5", "1M") and not CH.allowed("5", "3M")
    assert CH.allowed("W", "2Y") and not CH.allowed("W", "1W")          # a single weekly bar is pointless
    assert not CH.allowed("7", "1D") and not CH.allowed("15", "5Y")
    v = CH.options()["valid"]
    assert "3M" in v["15"] and "1Y" in v["60"] and "2Y" in v["D"]


def test_oi_interval_choice(CH):
    assert CH.oi_interval_for(15 * MIN, 3 * 1440 * MIN)[0] == "15min"
    assert CH.oi_interval_for(15 * MIN, 91 * 1440 * MIN)[0] == "1h"     # keeps the OI fetch small
    assert CH.oi_interval_for(7 * 1440 * MIN, 730 * 1440 * MIN)[0] == "1d"


def test_alignment(CH):
    grid = [0, 15 * MIN, 30 * MIN, 45 * MIN]
    oi = [{"t": 5 * MIN, "oi": 1.0}, {"t": 29 * MIN, "oi": 2.0}]
    assert CH.step_align(oi, "oi", grid, 15 * MIN) == [1.0, 2.0, 2.0, 2.0]
    assert CH.bucket_sum([(0, 1.0), (14 * MIN, 2.0), (45 * MIN, 5.0), (-MIN, 9.0)], grid, 15 * MIN) == [3.0, None, None, 5.0]
    wk = 7 * 1440 * MIN
    weeks = [4 * 1440 * MIN + i * wk for i in range(3)]                  # Monday-anchored like Bybit
    assert CH.bucket_sum([(weeks[1] + 3 * 1440 * MIN, 0.5)], weeks, wk) == [None, 0.5, None]


class FakeSrc:
    """Bybit-like: newest-first pages of at most `limit`, honoring `end`."""
    def __init__(self, n, bar):
        self.rows = [{"t": i * bar, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 1, "q": 1} for i in range(n)]
        self.calls = []

    async def klines(self, sym, interval, limit=200, end=None, **_):
        self.calls.append((limit, end))
        rows = [r for r in self.rows if end is None or r["t"] <= end]
        return [dict(r) for r in rows[-limit:]]

    async def open_interest(self, sym, interval="15min", limit=200, pages=1):
        return [{"t": r["t"], "oi": 100.0} for r in self.rows[-limit * pages:]]

    async def funding_history(self, sym, pages=3):
        return []


class FakeApp:
    def __init__(self, src):
        self.source = src
        self.market = None


def test_pages_back_and_top_up(CH):
    bar = 15 * MIN
    src = FakeSrc(2500, bar)
    cd = CH.ChartData(FakeApp(src))

    async def go():
        d = await cd.get("ETHUSDT", "15", "3M")          # needs 8736 bars, only 2500 exist
        assert len(d["candles"]) == 2500 and not d["complete"]
        ts = [k["t"] for k in d["candles"]]
        assert ts == sorted(ts) and len(set(ts)) == len(ts)
        assert len(src.calls) == 3                        # 1000 + 1000 + 500, then stops
        assert len(d["oi"]) == len(d["cvd"]) == len(d["funding"]) == len(d["candles"])
        # a new bar prints; the refresh returns only bars at/after `since`
        src.rows.append({"t": 2500 * bar, "o": 1, "h": 3, "l": 1, "c": 2, "v": 1, "q": 1})
        cd.cache[("ETHUSDT", "15")]["fetched"] -= 60
        tail = await cd.get("ETHUSDT", "15", "3M", since=2499 * bar)
        assert [k["t"] for k in tail["candles"]] == [2499 * bar, 2500 * bar] and tail["partial"]
        full = await cd.get("ETHUSDT", "15", "3M")
        assert len(full["candles"]) == 2501
    asyncio.run(go())


def test_demo_every_timeframe(CH, tmp_path):
    from server.core import TrapApp

    async def go():
        a = TrapApp(demo=True)
        await a.startup()
        try:
            for tf in ("5", "15", "30", "60", "240", "D", "W"):
                lb = CH.options()["valid"][tf][0]
                d = await a.chart.get("ETHUSDT", tf, lb)
                assert d["candles"], tf
                ts = [k["t"] for k in d["candles"]]
                assert ts == sorted(ts) and len(set(ts)) == len(ts), tf
                assert all(k["l"] <= min(k["o"], k["c"]) and k["h"] >= max(k["o"], k["c"]) for k in d["candles"]), tf
        finally:
            await a.shutdown()
    asyncio.run(go())


def test_gap_reload_and_cvd_origin(CH):
    bar = 15 * MIN
    src = FakeSrc(1200, bar)

    class M:     # stand-in market with 15m CVD buckets, some already trimmed
        def __init__(self):
            self.data = {"ETHUSDT": 1}
            self.s = type("S", (), {})()
            self.s.cvd = {t * bar: [2.0, 1.0] for t in range(1100, 1200)}
            self.s.cvd_dropped = 50.0

        def sd(self, sym):
            return self.s

    app = FakeApp(src)
    app.market = M()
    cd = CH.ChartData(app)

    async def go():
        d = await cd.get("ETHUSDT", "15", "1W")          # 672 bars: 528..1199
        v_before = d["cvd"][-1]
        assert v_before == 50.0 + 100 * 1.0
        # the window slides one bar: the same bar keeps the same running total
        src.rows.append({"t": 1200 * bar, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 1, "q": 1})
        cd.cache[("ETHUSDT", "15")]["fetched"] -= 60
        d2 = await cd.get("ETHUSDT", "15", "1W")
        assert d2["cvd"][-2] == v_before
        # 300 new bars while nobody looked: the top-up page can't bridge that, so it reloads (no hole)
        for i in range(1201, 1501):
            src.rows.append({"t": i * bar, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 1, "q": 1})
        cd.cache[("ETHUSDT", "15")]["fetched"] -= 60
        d3 = await cd.get("ETHUSDT", "15", "1W")
        ts = [k["t"] for k in d3["candles"]]
        assert all(b - a == bar for a, b in zip(ts, ts[1:])) and ts[-1] == 1500 * bar
    asyncio.run(go())
