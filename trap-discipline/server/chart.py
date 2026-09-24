"""Market Monitor chart data for any timeframe and lookback.

The trap engine itself always runs on 15 minute closes; this module only
feeds the chart. It pulls candles, open interest and funding for the chosen
timeframe from the same read-only source (Bybit public GET endpoints, or the
demo generator), aggregates the live CVD buckets onto the same bars, and
caches per (symbol, timeframe) so the 15 second refresh only asks Bybit for
the newest page.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from .db import now_ms

log = logging.getLogger("trap.chart")

MIN = 60_000
# timeframe -> bar length (ms); Bybit kline interval codes
TF_MS = {"5": 5 * MIN, "15": 15 * MIN, "30": 30 * MIN, "60": 60 * MIN, "240": 240 * MIN,
         "D": 1440 * MIN, "W": 7 * 1440 * MIN}
# Bybit open-interest intervalTime values, finest first
OI_INTERVALS = [("5min", 5 * MIN), ("15min", 15 * MIN), ("30min", 30 * MIN), ("1h", 60 * MIN),
                ("4h", 240 * MIN), ("1d", 1440 * MIN)]
LOOKBACK_DAYS = {"1D": 1, "3D": 3, "1W": 7, "2W": 14, "1M": 30, "3M": 91, "6M": 182, "1Y": 365, "2Y": 730}
MAX_BARS = 10_000
MAX_OI_POINTS = 3_000
KLINE_PAGE = 1000


def bars_for(tf: str, lookback: str) -> int:
    return int(LOOKBACK_DAYS[lookback] * 1440 * MIN / TF_MS[tf])


def allowed(tf: str, lookback: str) -> bool:
    return tf in TF_MS and lookback in LOOKBACK_DAYS and 10 <= bars_for(tf, lookback) <= MAX_BARS


def options() -> dict:
    return {"timeframes": list(TF_MS), "lookbacks": list(LOOKBACK_DAYS),
            "valid": {tf: [lb for lb in LOOKBACK_DAYS if allowed(tf, lb)] for tf in TF_MS}}


def oi_interval_for(tf_ms: int, span_ms: int) -> tuple[str, int]:
    """Finest OI interval that is not finer than the bars and keeps the fetch small."""
    for name, ms in OI_INTERVALS:
        if ms >= min(tf_ms, 1440 * MIN) and span_ms / ms <= MAX_OI_POINTS:
            return name, ms
    return OI_INTERVALS[-1]


def step_align(points: list[dict], key: str, grid: list[int], bar_ms: int) -> list[float | None]:
    """Latest reading inside each bar (the last point at or before the bar's end)."""
    out: list[float | None] = []
    j = -1
    pts = sorted(points, key=lambda p: p["t"])
    for t in grid:
        end = t + bar_ms - 1
        while j + 1 < len(pts) and pts[j + 1]["t"] <= end:
            j += 1
        out.append(pts[j][key] if j >= 0 and pts[j]["t"] >= t - 7 * bar_ms else None)
    return out


def bucket_sum(points: list[tuple[int, float]], grid: list[int], bar_ms: int) -> list[float | None]:
    """Sum of values whose timestamp falls inside each bar (None where empty)."""
    idx = {t: i for i, t in enumerate(grid)}
    out: list[float | None] = [None] * len(grid)
    if not grid:
        return out
    start = grid[0]
    for ts, v in points:
        if ts < start:
            continue
        b = ts - (ts - start) % bar_ms if bar_ms < 7 * 1440 * MIN else None
        i = idx.get(b) if b is not None else None
        if i is None:   # weekly bars (or gaps): find the bar by search
            i = _find_bar(grid, ts, bar_ms)
        if i is not None:
            out[i] = (out[i] or 0.0) + v
    return out


def _find_bar(grid: list[int], ts: int, bar_ms: int) -> int | None:
    lo, hi = 0, len(grid) - 1
    ans = None
    while lo <= hi:
        mid = (lo + hi) // 2
        if grid[mid] <= ts:
            ans = mid
            lo = mid + 1
        else:
            hi = mid - 1
    if ans is not None and ts < grid[ans] + bar_ms:
        return ans
    return None


class ChartData:
    def __init__(self, app):
        self.app = app
        self.cache: dict[tuple[str, str], dict] = {}
        self.locks: dict[tuple[str, str], asyncio.Lock] = {}

    def _src(self):
        return self.app.source

    async def _klines_back(self, sym: str, tf: str, need: int) -> list[dict]:
        """Page backwards from now until `need` bars (or no older data)."""
        src = self._src()
        rows: dict[int, dict] = {}
        end = None
        while len(rows) < need:
            want = min(KLINE_PAGE, need - len(rows) + 1)
            page = await src.klines(sym, tf, limit=want, end=end)
            if not page:
                break
            oldest = page[0]["t"]
            new = [k for k in page if k["t"] not in rows]
            for k in page:
                rows[k["t"]] = k
            if not new or (end is not None and oldest >= end) or len(page) < want:
                break   # a short page means there is no older history
            end = oldest - 1
        out = [rows[t] for t in sorted(rows)]
        return out[-need:]

    async def _oi(self, sym: str, tf_ms: int, span_ms: int) -> list[dict]:
        name, ms = oi_interval_for(tf_ms, span_ms)
        pages = max(1, min(15, -(-int(span_ms / ms) // 200)))
        try:
            return await self._src().open_interest(sym, interval=name, limit=200, pages=pages)
        except Exception as exc:  # noqa: BLE001
            log.info("chart OI %s: %s", sym, exc)
            return []

    async def _funding(self, sym: str, span_ms: int) -> list[dict]:
        pages = max(1, min(10, -(-int(span_ms / (8 * 3_600_000)) // 200)))
        try:
            return await self._src().funding_history(sym, pages=pages)
        except Exception as exc:  # noqa: BLE001
            log.info("chart funding %s: %s", sym, exc)
            return []

    def _cvd_points(self, sym: str) -> tuple[list[tuple[int, float]], float]:
        """15m CVD buckets plus the net delta of buckets already trimmed, so the
        running total always starts from the same point (app start)."""
        m = self.app.market
        if not m or sym not in m.data:
            return [], 0.0
        sd = m.sd(sym)
        return [(b, buy - sell) for b, (buy, sell) in sorted(sd.cvd.items())], getattr(sd, "cvd_dropped", 0.0)

    def _assemble(self, sym: str, tf: str, candles: list[dict], oi: list[dict], funding: list[dict]) -> dict:
        bar = TF_MS[tf]
        grid = [k["t"] for k in candles]
        oi_vals = step_align(oi, "oi", grid, bar)
        pts, base = self._cvd_points(sym)
        cvd: list[float | None] = []
        if bar >= 15 * MIN and grid:     # CVD is recorded in 15m buckets: meaningless below that
            cvd_d = bucket_sum(pts, grid, bar)
            cum = base + sum(d for ts, d in pts if ts < grid[0])   # fixed origin: no jump as the window slides
            seen = False
            for d in cvd_d:
                if d is not None:
                    cum += d
                    seen = True
                cvd.append(cum if seen else None)
        else:
            cvd = [None] * len(grid)
        fund = bucket_sum([(f["t"], f["rate"]) for f in funding], grid, bar)
        return {"symbol": sym, "tf": tf, "bar_ms": bar, "updated_at": now_ms(),
                "candles": [{"t": k["t"], "o": k["o"], "h": k["h"], "l": k["l"], "c": k["c"], "v": k.get("v", 0)} for k in candles],
                "oi": oi_vals, "cvd": cvd, "funding": fund}

    async def _full(self, sym: str, tf: str, need: int) -> dict:
        bar = TF_MS[tf]
        candles = await self._klines_back(sym, tf, need)
        span = (candles[-1]["t"] - candles[0]["t"] + bar) if candles else need * bar
        oi, funding = await asyncio.gather(self._oi(sym, bar, span), self._funding(sym, span))
        now = time.monotonic()
        return {"candles": candles, "oi": oi, "funding": funding, "fetched": now, "funding_at": now,
                "exhausted": len(candles) < need}

    async def get(self, sym: str, tf: str, lookback: str, since: int | None = None) -> dict:
        """Full series (first load or new lookback), or only bars at/after
        `since` (the 15 second refresh), with the newest page re-fetched."""
        key = (sym, tf)
        lock = self.locks.setdefault(key, asyncio.Lock())
        need = bars_for(tf, lookback)
        bar = TF_MS[tf]
        async with lock:
            c = self.cache.get(key)
            now = time.monotonic()
            if c is None or (len(c["candles"]) < need and not c.get("exhausted")):
                c = self.cache[key] = await self._full(sym, tf, need)
            elif now - c["fetched"] > 10:
                # top up: newest candles (the forming bar changes every tick) and the latest OI
                tail = await self._src().klines(sym, tf, limit=min(200, max(3, need)))
                last = c["candles"][-1]["t"] if c["candles"] else None
                if tail and last is not None and tail[0]["t"] > last + bar:
                    # the cache fell further behind than one page (laptop slept, timeframe unused): reload
                    c = self.cache[key] = await self._full(sym, tf, need)
                else:
                    byt = {k["t"]: k for k in c["candles"]}
                    for k in tail:
                        byt[k["t"]] = k
                    c["candles"] = [byt[t] for t in sorted(byt)][-max(need, len(c["candles"])):]
                    try:
                        name, _ = oi_interval_for(bar, len(c["candles"]) * bar)
                        new_oi = await self._src().open_interest(sym, interval=name, limit=200, pages=1)
                        byo = {p["t"]: p for p in c["oi"]}
                        for p in new_oi:
                            byo[p["t"]] = p
                        first = c["candles"][0]["t"] - 7 * bar if c["candles"] else 0
                        c["oi"] = [byo[t] for t in sorted(byo) if t >= first]
                    except Exception as exc:  # noqa: BLE001
                        log.info("chart OI top-up %s: %s", sym, exc)
                    if now - c.get("funding_at", 0) > 300:     # new settlements every 1 to 8 hours
                        try:
                            new_f = await self._src().funding_history(sym, pages=1)
                            byf = {f["t"]: f for f in c["funding"]}
                            for f in new_f:
                                byf[f["t"]] = f
                            c["funding"] = [byf[t] for t in sorted(byf)]
                        except Exception as exc:  # noqa: BLE001
                            log.info("chart funding top-up %s: %s", sym, exc)
                        c["funding_at"] = now
                    c["fetched"] = now
            candles = c["candles"][-need:]
            out = self._assemble(sym, tf, candles, c["oi"], c["funding"])
        out["lookback"] = lookback
        out["need"] = need
        out["complete"] = len(candles) >= need
        if since is not None:
            keep = [i for i, k in enumerate(out["candles"]) if k["t"] >= since]
            i0 = keep[0] if keep else len(out["candles"])
            for f in ("candles", "oi", "cvd", "funding"):
                out[f] = out[f][i0:]
            out["partial"] = True
        return out

    def drop(self, sym: str | None = None) -> None:
        for k in [k for k in self.cache if sym is None or k[0] == sym]:
            self.cache.pop(k, None)
