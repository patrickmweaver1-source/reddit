"""Market data engine: keeps candles, open interest, funding, CVD and
liquidations fresh for the watchlist and derives the analysis snapshot."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable

from . import analysis as A
from .db import DB, now_ms

log = logging.getLogger("trap.market")

INTERVALS = {"15": 15 * 60_000, "60": 60 * 60_000, "240": 240 * 60_000, "D": 86_400_000, "W": 7 * 86_400_000}


class SymbolData:
    def __init__(self, symbol: str):
        self.symbol = symbol
        self.inst: dict = {}
        self.c: dict[str, list[dict]] = {k: [] for k in INTERVALS}
        self.live15: dict | None = None
        self.oi15: list[dict] = []
        self.oi1h: list[dict] = []
        self.funding: list[dict] = []
        self.ratio: list[dict] = []
        self.ticker: dict = {}
        self.cvd: dict[int, list[float]] = {}  # bucket -> [buy, sell]
        self.cvd_dropped: float = 0.0          # net delta of buckets trimmed from `cvd`
        self.last: dict[str, float] = {}
        self.errors: list[str] = []
        self.states: dict[str, str] = {}
        self.snapshot: dict = {}
        self.liqs: list[dict] | None = None    # last LIQ_WINDOW_MS of liquidations, in memory (loaded once)


LIQ_WINDOW_MS = 3 * 86_400_000       # what the levels and the heatmap look at
LIQ_KEEP_MS = 7 * 86_400_000         # what the database keeps
LIQ_MAX_IN_MEMORY = 50_000           # per symbol, a hard ceiling whatever the market does (about 15 MB)


class MarketEngine:
    def __init__(self, db: DB, source: Any, get_settings: Callable[[], dict], notify: Callable[..., Any]):
        self.db = db
        self._liq_pending: list[tuple] = []
        self._liq_pruned_at = 0.0
        self.src = source            # BybitREST or DemoSource (same method names)
        self.get_settings = get_settings
        self.notify = notify         # async callback(kind, payload)
        self.data: dict[str, SymbolData] = {}
        self._task: asyncio.Task | None = None
        self.ws = None

    # ------------------------------------------------------------------
    def watchlist(self) -> list[str]:
        return self.get_settings()["watchlist"]

    def sd(self, symbol: str) -> SymbolData:
        if symbol not in self.data:
            self.data[symbol] = SymbolData(symbol)
        return self.data[symbol]

    def start(self) -> None:
        if not self._task:
            self._task = asyncio.create_task(self._loop(), name="market-loop")

    async def stop(self) -> None:
        self.flush_liquidations()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._task = None

    async def _loop(self) -> None:
        async def one(sym: str) -> None:
            try:
                await self.refresh(sym)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning("refresh %s failed: %s", sym, exc)
                self.sd(sym).errors = [str(exc)[:200]]
        while True:
            # every coin at once: one slow coin no longer holds the others' data back
            await asyncio.gather(*(one(sym) for sym in list(self.watchlist())))
            try:
                self.flush_liquidations()
            except Exception as exc:  # noqa: BLE001
                log.warning("saving liquidations failed: %s", exc)
            await asyncio.sleep(20)

    # ------------------------------------------------------------------
    def _due(self, s: SymbolData, key: str, every: float) -> bool:
        return time.time() - s.last.get(key, 0) >= every

    async def refresh(self, sym: str, force: bool = False) -> dict:
        """One refresh per coin at a time: the market loop, a page and an AI scan asking at the
        same moment share it instead of each downloading the same data. A caller that gives up
        (page closed) does not cancel it for the others."""
        inflight = self.__dict__.setdefault("_inflight", {})
        t = inflight.get(sym)
        if t is None or t.done():
            t = asyncio.ensure_future(self._refresh(sym, force))
            t.add_done_callback(lambda f: f.cancelled() or f.exception())    # never "exception was never retrieved"
            inflight[sym] = t
        return await asyncio.shield(t)

    async def _refresh(self, sym: str, force: bool = False) -> dict:
        # Market data is what every page and scan waits on: it always goes ahead of background
        # downloads (journal backfill, auto-tune history), whoever started this refresh.
        from .bybit import INTERACTIVE
        INTERACTIVE.set(True)
        s = self.sd(sym)
        errs: list[str] = []

        async def guard(key: str, every: float, coro_fn):
            if force or self._due(s, key, every):
                try:
                    await coro_fn()
                    s.last[key] = time.time()
                except Exception as exc:  # noqa: BLE001
                    errs.append(f"{key}: {exc}"[:180])

        async def inst():
            s.inst = await self.src.instrument(sym) or {}

        async def k15():
            rows = await self.src.klines(sym, "15", limit=1000 if not s.c["15"] else 50)
            self._merge(s, "15", rows)

        async def k60():
            self._merge(s, "60", await self.src.klines(sym, "60", limit=500 if not s.c["60"] else 30))

        async def k240():
            self._merge(s, "240", await self.src.klines(sym, "240", limit=300 if not s.c["240"] else 20))

        async def kD():
            self._merge(s, "D", await self.src.klines(sym, "D", limit=90))

        async def kW():
            self._merge(s, "W", await self.src.klines(sym, "W", limit=30))

        async def oi():
            rows = await self.src.open_interest(sym, "15min", limit=200, pages=1 if s.oi15 else 4)
            merged = {p["t"]: p for p in s.oi15}
            merged.update({p["t"]: p for p in rows})
            s.oi15 = sorted(merged.values(), key=lambda x: x["t"])[-1200:]

        async def fund():
            s.funding = await self.src.funding_history(sym, pages=3)

        async def ratio():
            s.ratio = await self.src.account_ratio(sym, "1h", 100)

        async def tick():
            t = await self.src.tickers(sym)
            if t:
                s.ticker = {**s.ticker, **t[0]}

        async def cvd_seed():
            if s.cvd:
                return
            rows = await self.src.recent_trades(sym, 1000)
            for r in rows:
                self.add_trade(sym, int(r["time"]), r["side"], float(r["size"]))

        # independent downloads, all at once (a new coin's first load was 11 round trips in a row)
        await asyncio.gather(
            guard("inst", 3600, inst), guard("tick", 15, tick), guard("k15", 55, k15), guard("k60", 300, k60),
            guard("k240", 900, k240), guard("kD", 1800, kD), guard("kW", 3600, kW), guard("oi", 240, oi),
            guard("fund", 3600, fund), guard("ratio", 900, ratio), guard("cvd", 3600, cvd_seed))
        s.errors = errs
        snap = self.compute(sym)
        await self._state_alerts(sym, snap)
        return snap

    @staticmethod
    def _merge(s: SymbolData, iv: str, rows: list[dict]) -> None:
        if not rows:
            return
        now = now_ms()
        step = INTERVALS[iv]
        merged = {k["t"]: k for k in s.c[iv]}
        for k in rows:
            merged[k["t"]] = k
        allrows = sorted(merged.values(), key=lambda x: x["t"])
        closed = [k for k in allrows if k["t"] + step <= now] if iv not in ("D", "W") else allrows
        if iv == "15":
            live = [k for k in allrows if k["t"] + step > now]
            s.live15 = live[-1] if live else s.live15
        s.c[iv] = closed[-1500:]

    # ---- live feed hooks (WebSocket or demo ticker) --------------------
    def on_ticker(self, sym: str, data: dict) -> None:
        s = self.sd(sym)
        s.ticker = {**s.ticker, **{k: v for k, v in data.items() if v not in (None, "")}}

    def on_kline(self, sym: str, k: dict) -> None:
        s = self.sd(sym)
        row = {"t": int(k["start"]), "o": float(k["open"]), "h": float(k["high"]), "l": float(k["low"]),
               "c": float(k["close"]), "v": float(k["volume"]), "q": float(k.get("turnover", 0))}
        if k.get("confirm"):
            self._merge(s, "15", [row])
            s.live15 = None
        else:
            s.live15 = row

    def add_trade(self, sym: str, ts: int, side: str, size: float) -> None:
        s = self.sd(sym)
        b = ts - ts % INTERVALS["15"]
        cell = s.cvd.setdefault(b, [0.0, 0.0])
        if side == "Buy":
            cell[0] += size
        else:
            cell[1] += size
        if len(s.cvd) > 400:
            for old in sorted(s.cvd)[:-400]:
                buy, sell = s.cvd.pop(old, (0.0, 0.0))
                s.cvd_dropped += buy - sell     # keeps the running total anchored at app start

    def add_liquidation(self, sym: str, ts: int, side: str, size: float, price: float) -> None:
        # Kept in memory and written to disk in batches. Writing each print on its own (one disk
        # flush apiece, thousands an hour in a busy market) and re-reading three days of them on
        # every update made the app slower the longer it ran.
        self._liq_pending.append((sym, ts, side, size, price))
        s = self.sd(sym)
        if s.liqs is not None:
            s.liqs.append({"ts": ts, "side": side, "size": size, "price": price})
        if len(self._liq_pending) >= 2000:
            self.flush_liquidations()

    def flush_liquidations(self) -> None:
        """Write buffered liquidations in one transaction; once an hour drop ones older than a week."""
        rows, self._liq_pending = self._liq_pending, []
        now = time.time()
        prune = now - self._liq_pruned_at > 3600
        if not rows and not prune:
            return
        with self.db.lock:
            c = self.db.conn
            c.execute("BEGIN")
            try:
                if rows:
                    c.executemany("INSERT INTO liquidations(symbol,ts,side,size,price) VALUES(?,?,?,?,?)", rows)
                if prune:
                    c.execute("DELETE FROM liquidations WHERE ts<?", (now_ms() - LIQ_KEEP_MS,))
                c.execute("COMMIT")
            except Exception:
                c.execute("ROLLBACK")
                raise
        if prune:
            self._liq_pruned_at = now

    def _recent_liqs(self, sym: str) -> list[dict]:
        s = self.sd(sym)
        since = now_ms() - LIQ_WINDOW_MS
        if s.liqs is None:
            self.flush_liquidations()        # so the one-time load below sees every print so far
            s.liqs = self.db.query("SELECT ts, side, size, price FROM liquidations WHERE symbol=? AND ts>=? ORDER BY ts", (sym, since))
        liqs = s.liqs
        if liqs and (liqs[0]["ts"] < since or len(liqs) > LIQ_MAX_IN_MEMORY):
            i = 0
            while i < len(liqs) and liqs[i]["ts"] < since:
                i += 1
            i = max(i, len(liqs) - LIQ_MAX_IN_MEMORY)
            del liqs[:i]
        return liqs

    # ------------------------------------------------------------------
    def settings_for(self, sym: str) -> tuple[dict, bool]:
        st = self.get_settings()
        return st["thresholds"], sym in st["thin_assets"]

    def compute(self, sym: str) -> dict:
        s = self.sd(sym)
        th, thin = self.settings_for(sym)
        c15, c1h, c4h, cD, cW = s.c["15"], s.c["60"], s.c["240"], s.c["D"], s.c["W"]
        tk = s.ticker
        price = float(tk.get("lastPrice") or 0) or (s.live15 or (c15[-1] if c15 else {})).get("c", 0)
        atr15 = A.atr(c15, 14) if len(c15) > 15 else None
        liqs = self._recent_liqs(sym)
        levels = A.detect_levels(c1h, c4h, cD, cW, price, atr15 or 0, [x["price"] for x in liqs]) if atr15 else []
        floor = th["pen_floor_atr_thin"] if thin else th["pen_floor_atr"]
        for lv in levels:
            lv.update(A.level_state(lv["price"], c15, atr15 or 0, floor_atr=floor, abandon_atr=th["pen_abandon_atr"],
                                    max_candles=th["window_max_candles"], oi15=s.oi15))
            lv["key"] = f"{sym}:{lv['price']:.8g}"
        reg = A.regime_4h(c4h)
        rng = A.range_context(levels, price, atr15 or 0) if atr15 else {}
        # candidates: rank by state, then C1, then regime alignment
        def rank(lv):
            aligned = 1 if (lv.get("direction") in reg["permitted"]) else 0
            return (A.STATE_RANK.get(lv["state"], 0), lv["c1"], aligned, -abs(lv.get("dist_atr") or 0))
        cands = [lv for lv in levels if A.STATE_RANK.get(lv["state"], 0) >= 3]
        cands.sort(key=rank, reverse=True)
        top = cands[0] if cands else None

        # funding
        rate = float(tk.get("fundingRate") or 0) if tk.get("fundingRate") not in (None, "") else (s.funding[-1]["rate"] if s.funding else None)
        hist = [f["rate"] for f in s.funding[-270:]]
        f_pct = A.percentile_rank(hist, rate) if (rate is not None and hist) else None
        interval_h = float(tk.get("fundingIntervalHour") or 0) or ((float(s.inst.get("fundingInterval") or 480)) / 60)
        rate8 = rate * (8 / interval_h) * 100 if rate is not None and interval_h else None  # % per 8h equivalent

        # OI
        oi_now = float(tk.get("openInterest") or 0) or (s.oi15[-1]["oi"] if s.oi15 else None)
        def oi_chg(ms):
            if not s.oi15 or not oi_now:
                return None
            ref = A.series_value_at(s.oi15, s.oi15[-1]["t"] - ms, "oi")
            return A.pct_change(ref, oi_now)
        summ = A.summarize_symbol(c15, s.oi15, 4) if c15 else {}
        rv = A.rvol(c15) if c15 else None
        mech = A.classify_mechanism(summ.get("price_chg_pct"), rv, summ.get("oi_chg_pct"), f_pct, summ.get("range_pct"),
                                    broke_then_failed=bool(top and top["state"] == "TRIGGERED" and (top.get("oi_break_pct") or 0) > 0))

        # gates for the top candidate (stop estimate = trap extreme +/- a few ticks)
        tick = float((s.inst.get("priceFilter") or {}).get("tickSize") or 0) or (price * 1e-5 if price else 0)
        gate = None
        stop_est = None
        if top and top.get("extreme") and top.get("trigger") and top.get("direction"):
            buf = 3 * tick
            stop_est = top["extreme"] - buf if top["direction"] == "Long" else top["extreme"] + buf
            entry_ref = top["trigger"]
            stop_dist = abs(entry_ref - stop_est)
            slip = th["slippage_pct_thin"] if thin else th["slippage_pct_major"]
            fee = self.get_settings().get("taker_fee_pct") or th["taker_fee_pct"]
            gate = A.gates(rng.get("height"), stop_dist, price, atr15, fee, slip, thin, th)
            gate["stop_est"] = stop_est
            gate["entry_ref"] = entry_ref

        # CVD (cumulative over last 96 buckets)
        buckets = sorted(s.cvd.items())[-96:]
        cum = 0.0
        cvd = []
        for b, (buy, sell) in buckets:
            cum += buy - sell
            cvd.append({"t": b, "delta": buy - sell, "cvd": cum})

        candles = [*c15[-400:]] + ([s.live15] if s.live15 else [])
        liq_heatmap = A.liquidation_heatmap(liqs, price, atr15) if price else None
        liquidity = A.liquidity_state(c15, thin, s.ticker)
        snap = {
            "symbol": sym, "thin": thin, "updated_at": now_ms(), "errors": s.errors,
            "price": price, "mark": float(tk.get("markPrice") or 0) or None,
            "change24h": float(tk.get("price24hPcnt") or 0) * 100 if tk.get("price24hPcnt") not in (None, "") else None,
            "turnover24h": float(tk.get("turnover24h") or 0) or None,
            "tick": tick,
            "qty_step": float((s.inst.get("lotSizeFilter") or {}).get("qtyStep") or 0) or None,
            "min_qty": float((s.inst.get("lotSizeFilter") or {}).get("minOrderQty") or 0) or None,
            "max_leverage": float((s.inst.get("leverageFilter") or {}).get("maxLeverage") or 0) or None,
            "atr15": atr15, "atr_pct": (atr15 / price * 100) if (atr15 and price) else None,
            "rvol": rv, "rvol_label": A.rvol_label(rv),
            "funding": {"rate_pct": rate * 100 if rate is not None else None, "rate_8h_pct": rate8,
                        "next": int(tk.get("nextFundingTime") or 0) or None, "pctile": f_pct, "interval_h": interval_h,
                        "stretched": (rate8 is not None and abs(rate8) >= th["funding_stretched_pct"]),
                        "baseline_pct": th["funding_baseline_pct"]},
            "oi": {"value": oi_now, "chg_1h": oi_chg(3_600_000), "chg_4h": oi_chg(4 * 3_600_000), "chg_24h": oi_chg(86_400_000)},
            "regime": reg, "range": rng, "levels": levels[:14], "top": top, "liq_heatmap": liq_heatmap,
            "liquidity": liquidity,
            "candidates": cands[:3], "gates": gate, "mechanism": mech, "summary": summ,
            "ratio": s.ratio[-48:],
            "series": {
                "candles": candles,
                "oi": s.oi15[-400:],
                "funding": s.funding[-120:],
                "cvd": cvd,
                "liqs": liqs[-300:],
            },
        }
        s.snapshot = snap
        return snap

    async def _state_alerts(self, sym: str, snap: dict) -> None:
        s = self.sd(sym)
        for lv in snap.get("levels", []):
            prev = s.states.get(lv["key"])
            cur = lv["state"]
            s.states[lv["key"]] = cur
            if prev is None or prev == cur:
                continue
            if cur in ("RECRUITING", "WATCH", "TRIGGERED"):
                await self.notify("level_state", {"symbol": sym, "level": lv, "prev": prev})
            elif cur == "APPROACHING" and A.STATE_RANK.get(prev, 0) < A.STATE_RANK["APPROACHING"]:
                # only on the way in (DORMANT -> APPROACHING), never when a
                # tested level decays back; the core decides whether to surface it
                await self.notify("level_state", {"symbol": sym, "level": lv, "prev": prev})

    def overview(self) -> list[dict]:
        out = []
        for sym in self.watchlist():
            sn = self.sd(sym).snapshot
            if not sn:
                out.append({"symbol": sym, "loading": True})
                continue
            out.append({k: sn.get(k) for k in ("symbol", "price", "change24h", "atr_pct", "rvol", "rvol_label", "funding",
                                                "oi", "regime", "range", "top", "mechanism", "thin", "errors", "updated_at")}
                       | {"spark": [k["c"] for k in sn["series"]["candles"][-96:]],
                          "levels": [{k: lv.get(k) for k in ("price", "state", "setup", "direction", "c1", "side")} for lv in sn["levels"][:8]]})
        return out
