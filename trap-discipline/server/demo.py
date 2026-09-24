"""Demo mode: a synthetic market and a sample journal so the whole app can be
explored (and tested) with no exchange connection. Everything produced here is
clearly labeled DEMO in the UI and lives in a separate database file."""
from __future__ import annotations

import asyncio
import math
import random
import time
from typing import Any

from .db import DB, now_ms

M15 = 15 * 60_000
BASE = {"ETHUSDT": (3000.0, 0.0022, 0.01, 0.001), "TRUMPUSDT": (9.0, 0.0045, 0.001, 0.1),
        "FARTCOINUSDT": (0.90, 0.006, 0.0001, 1.0)}


def _params(sym: str):
    return BASE.get(sym, (100.0, 0.003, 0.01, 0.01))


class DemoSource:
    """Same method names as BybitREST's market wrappers."""

    def __init__(self, seed: int = 7):
        self.seed = seed
        self._c15: dict[str, list[dict]] = {}
        self._oi: dict[str, list[dict]] = {}
        self._live: dict[str, dict] = {}

    # ---- generation -----------------------------------------------------
    def _gen(self, sym: str) -> None:
        if sym in self._c15:
            return
        p0, vol, tick, step = _params(sym)
        rng = random.Random(hash((sym, self.seed)) & 0xFFFFFFFF)
        n = 2200
        now = now_ms()
        start = (now - now % M15) - n * M15
        price = p0
        out = []
        oi = 1_000_000 / p0 * 50
        ois = []
        # phases: trend, range, trend, final range with a spring at the end
        range_lo = range_hi = None
        for i in range(n):
            t = start + i * M15
            phase = (i // 300) % 4
            if i > n - 260:
                # final range between fixed bounds with repeated touches
                if range_lo is None:
                    range_lo, range_hi = price * 0.975, price * 1.02
                mid = (range_lo + range_hi) / 2
                drift = (mid - price) / mid * 0.02
                if (i // 40) % 2 == 0:
                    drift += 0.0008 * (1 if price < range_hi else -2)
                else:
                    drift -= 0.0008 * (1 if price > range_lo else -2)
            else:
                drift = {0: 0.00025, 1: 0.0, 2: -0.0002, 3: 0.0}[phase]
            r = rng.gauss(drift, vol)
            o = price
            c = max(tick, o * (1 + r))
            if range_lo is not None and i < n - 4:
                c = min(max(c, range_lo * 1.001), range_hi * 0.999)
            hi = max(o, c) * (1 + abs(rng.gauss(0, vol * 0.6)))
            lo = min(o, c) * (1 - abs(rng.gauss(0, vol * 0.6)))
            if range_lo is not None and i < n - 4:
                lo = max(lo, range_lo * 0.998)
                hi = min(hi, range_hi * 1.002)
            v = abs(rng.gauss(1, 0.35)) * 1_000_000 / p0 * (1.5 if abs(r) > vol * 1.5 else 1)
            oi *= 1 + rng.gauss(0.0001 if phase in (1, 3) else -0.00005, 0.002)
            out.append({"t": t, "o": o, "h": hi, "l": lo, "c": c, "v": v, "q": v * c})
            ois.append({"t": t, "oi": oi})
            price = c
        # engineer a spring ending on the LAST closed candle: break below range_lo,
        # stall, then a decisive reclaim close (so the state machine sees TRIGGERED).
        if range_lo:
            a = sum(k["h"] - k["l"] for k in out[-60:]) / 60
            seq = [(-0.60, 1.4, 1.025), (-0.45, 0.6, 1.04), (0.35, 1.6, 0.985)]
            for j, (pen, rng_mult, oi_mult) in enumerate(seq):
                k = out[-3 + j]
                o = out[-4 + j]["c"]
                c = range_lo + pen * a
                hi = max(o, c) + 0.15 * a
                lo = min(o, c) - 0.25 * a * rng_mult
                k.update({"o": o, "c": c, "h": hi, "l": lo, "v": k["v"] * (2.4 if j != 1 else 0.9)})
                ois[-3 + j]["oi"] = ois[-4 + j]["oi"] * oi_mult
        self._c15[sym] = out
        self._oi[sym] = ois

    def _agg(self, rows: list[dict], ms: int) -> list[dict]:
        out: dict[int, dict] = {}
        for k in rows:
            b = k["t"] - (k["t"] % ms)
            if b not in out:
                out[b] = dict(k, t=b)
            else:
                a = out[b]
                a["h"] = max(a["h"], k["h"])
                a["l"] = min(a["l"], k["l"])
                a["c"] = k["c"]
                a["v"] += k["v"]
                a["q"] += k["q"]
        return [out[b] for b in sorted(out)]

    # ---- REST-like API ---------------------------------------------------
    async def instrument(self, sym: str) -> dict:
        p0, vol, tick, step = _params(sym)
        return {"symbol": sym, "priceFilter": {"tickSize": str(tick)}, "lotSizeFilter": {"qtyStep": str(step), "minOrderQty": str(step)},
                "leverageFilter": {"maxLeverage": "50"}, "fundingInterval": 480}

    async def klines(self, sym: str, interval: str, limit: int = 200, **_: Any) -> list[dict]:
        self._gen(sym)
        base = self._c15[sym] + ([self._live[sym]] if sym in self._live else [])
        if interval == "5":
            rows = self._split5(base)
        else:
            ms = {"15": M15, "30": 2 * M15, "60": 4 * M15, "240": 16 * M15, "D": 96 * M15, "W": 672 * M15}[interval]
            rows = base if interval == "15" else self._agg(base, ms)
        return [dict(r) for r in rows[-limit:]]

    @staticmethod
    def _split5(rows: list[dict]) -> list[dict]:
        """Demo only: three deterministic 5 minute bars inside each 15 minute bar
        (open -> one extreme -> the other extreme -> close)."""
        out = []
        for k in rows:
            up = k["c"] >= k["o"]
            path = [k["o"], k["l"] if up else k["h"], k["h"] if up else k["l"], k["c"]]
            for i in range(3):
                a, b = path[i], path[i + 1]
                out.append({"t": k["t"] + i * M15 // 3, "o": a, "c": b, "h": max(a, b), "l": min(a, b),
                            "v": k["v"] / 3, "q": k["q"] / 3})
        return out

    async def open_interest(self, sym: str, interval: str = "15min", limit: int = 200, pages: int = 1) -> list[dict]:
        self._gen(sym)
        return [dict(r) for r in self._oi[sym][-limit * pages:]]

    async def funding_history(self, sym: str, pages: int = 3) -> list[dict]:
        rng = random.Random(hash((sym, "f")) & 0xFFFFFFFF)
        now = now_ms()
        t0 = now - now % (8 * 3_600_000)
        out = []
        for i in range(200 * pages):
            out.append({"t": t0 - i * 8 * 3_600_000, "rate": rng.gauss(0.0001, 0.00012)})
        return sorted(out, key=lambda x: x["t"])

    async def tickers(self, sym: str | None = None) -> list[dict]:
        self._gen(sym)
        last = (self._live.get(sym) or self._c15[sym][-1])
        now = now_ms()
        nf = now - now % (8 * 3_600_000) + 8 * 3_600_000
        first = self._c15[sym][-96]["c"]
        return [{"symbol": sym, "lastPrice": str(last["c"]), "markPrice": str(last["c"]), "fundingRate": "0.00034" if sym != "ETHUSDT" else "0.0001",
                 "nextFundingTime": str(nf), "openInterest": str(self._oi[sym][-1]["oi"]), "price24hPcnt": str((last["c"] - first) / first),
                 "turnover24h": str(sum(k["q"] for k in self._c15[sym][-96:])), "fundingIntervalHour": "8"}]

    async def account_ratio(self, sym: str, period: str = "1h", limit: int = 100) -> list[dict]:
        rng = random.Random(hash((sym, "r")) & 0xFFFFFFFF)
        now = now_ms() - now_ms() % 3_600_000
        out = []
        b = 0.55
        for i in range(limit):
            b = min(0.8, max(0.2, b + rng.gauss(0, 0.01)))
            out.append({"t": now - (limit - i) * 3_600_000, "buy": b, "sell": 1 - b})
        return out

    async def recent_trades(self, sym: str, limit: int = 1000) -> list[dict]:
        self._gen(sym)
        rng = random.Random(hash((sym, "t")) & 0xFFFFFFFF)
        out = []
        now = now_ms()
        for k in self._c15[sym][-24:]:
            bias = 0.55 if k["c"] > k["o"] else 0.45
            for j in range(30):
                out.append({"time": str(k["t"] + j * 30_000), "side": "Buy" if rng.random() < bias else "Sell",
                            "size": str(k["v"] / 30 * rng.uniform(0.5, 1.5)), "price": str(k["c"])})
        return [o for o in out if int(o["time"]) <= now][-limit:]

    # ---- live ticking -----------------------------------------------------
    async def run_live(self, engine: Any, symbols: list[str]) -> None:
        rng = random.Random(99)
        while True:
            now = now_ms()
            for sym in symbols:
                self._gen(sym)
                p0, vol, tick, step = _params(sym)
                last_closed = self._c15[sym][-1]
                bstart = now - now % M15
                if bstart >= last_closed["t"] + 2 * M15:
                    # roll forward the closed series
                    lv = self._live.pop(sym, None)
                    if lv:
                        self._c15[sym].append(lv)
                        self._oi[sym].append({"t": lv["t"], "oi": self._oi[sym][-1]["oi"] * (1 + rng.gauss(0, 0.002))})
                lv = self._live.get(sym)
                if not lv or lv["t"] != bstart:
                    c0 = self._c15[sym][-1]["c"]
                    lv = {"t": bstart, "o": c0, "h": c0, "l": c0, "c": c0, "v": 0.0, "q": 0.0}
                    self._live[sym] = lv
                c = lv["c"] * (1 + rng.gauss(0, vol / 8))
                lv["c"] = c
                lv["h"] = max(lv["h"], c)
                lv["l"] = min(lv["l"], c)
                size = abs(rng.gauss(1, 0.5)) * 3000 / p0
                lv["v"] += size
                lv["q"] += size * c
                engine.on_ticker(sym, {"lastPrice": str(c), "markPrice": str(c)})
                engine.on_kline(sym, {"start": lv["t"], "open": lv["o"], "high": lv["h"], "low": lv["l"], "close": lv["c"],
                                      "volume": lv["v"], "turnover": lv["q"], "confirm": False})
                engine.add_trade(sym, now, "Buy" if rng.random() < 0.5 else "Sell", size)
                if rng.random() < 0.03:
                    engine.add_liquidation(sym, now, "Buy" if rng.random() < 0.5 else "Sell", size * 5, c * (1 + rng.gauss(0, 0.004)))
            await asyncio.sleep(2)


SAMPLE_NOTES = [
    "Reclaimed the 4h swing low, OI dropped on the reclaim.",
    "Clean upthrust at the range high. Funding stretched positive.",
    "Sweep of prior day low. Liquidations printed on the long side.",
    "Took it early on the wick. Should have waited for the close.",
    "No expansion by candle four, scratched at breakeven.",
    "Failed retest of broken support. Textbook.",
    "Moved the stop. Don't.",
    "Middle third. Knew it. Took it anyway.",
]


def _demo_context(rng: random.Random, sym: str, direction: str, setup: str,
                  entry: float, stop_dist: float, t: int,
                  pen_atr: float, candles: int, oi_conf: str) -> dict:
    """A plausible entry-time market snapshot for a seeded demo trade."""
    atr = stop_dist * rng.uniform(0.9, 1.6)
    mechs = [("Absorption then reversal", "absorb"), ("Stop run, no follow-through", "stop_run"),
             ("Fresh shorts trapped", "trap_short" if direction == "Long" else "trap_long"),
             ("Longs flushed out", "flush")]
    mech, mcode = rng.choice(mechs)
    lvl_state = rng.choice(["TRIGGERED", "TESTED", "RECRUITING", "WATCH"])
    return {
        "captured_at": t,
        "price": round(entry, 6),
        "atr15": round(atr, 6),
        "atr_pct": round(atr / entry * 100, 3),
        "rvol": round(rng.uniform(0.9, 3.4), 2),
        "rvol_label": rng.choice(["Normal", "Elevated", "High"]),
        "funding_8h_pct": round(rng.uniform(-0.03, 0.06), 4),
        "funding_pctile": rng.randint(8, 96),
        "oi_chg_1h": round(rng.uniform(-3.5, 4.0), 2),
        "mechanism": mech, "mechanism_code": mcode,
        "regime": rng.choice(["Range", "Trend up", "Trend down"]),
        "third": rng.choice(["lower", "upper"]) if direction == "Long" else rng.choice(["upper", "lower"]),
        "level": {"price": round(entry - stop_dist * (1 if direction == "Long" else -1) * 0.6, 6),
                  "state": lvl_state, "setup": setup},
        "suggest": {"pen_atr": pen_atr, "candles_to_reclaim": candles, "oi_confirmed": oi_conf},
    }


def seed_journal(db: DB, starting_equity: float = 50_000.0) -> None:
    """Populate the demo database with a realistic month of journal rows."""
    from . import game as G
    from . import rules as Rr
    from .trades import compute_metrics, utc_parts
    if db.get("demo_seeded"):
        return
    rng = random.Random(42)
    now = now_ms()
    t = now - 28 * 86_400_000
    syms = ["ETHUSDT", "TRUMPUSDT", "FARTCOINUSDT"]
    setups = ["Spring", "Upthrust", "Sweep", "Failed retest"]
    equity = starting_equity
    day_seen = set()
    for i in range(34):
        t += int(rng.uniform(8, 22) * 3_600_000)
        if t > now - 3_600_000:
            break
        sym = rng.choice(syms)
        p0 = _params(sym)[0] * rng.uniform(0.9, 1.1)
        grade = rng.choices("ABCD", weights=[3, 5, 3, 1])[0]
        setup = rng.choice(setups)
        direction = "Long" if setup in ("Spring",) or (setup != "Upthrust" and rng.random() < 0.5) else "Short"
        day = Rr.utc_day(t)
        if day not in day_seen:
            day_seen.add(day)
            db.execute("INSERT OR IGNORE INTO checkins(day, ts) VALUES(?,?)", (day, t - 600_000))
            G.award(db, "checkin", f"checkin:{day}", ts=t - 600_000)
        date, tm = utc_parts(t)
        if rng.random() < 0.18:
            db.insert_trade({"symbol": sym, "direction": direction, "taken": 0, "status": "skipped", "source": "demo",
                             "date": date, "time_utc": tm, "setup": setup, "grade": rng.choice("CD"),
                             "note": rng.choice(["Range gate failed (4.1x ATR).", "Cost gate: 14% of risk.", "OI flat on the break.", "Thin hours."]),
                             "created_at": t, "reviewed_at": t + 60_000})
            G.award(db, "skip_logged", f"skip:demo:{i}", ts=t)
            continue
        d = p0 * rng.uniform(0.004, 0.012)
        entry = p0
        stop = entry - d if direction == "Long" else entry + d
        risk = equity * 0.01
        qty = round(risk / d, 3)
        edge = {"A": 0.9, "B": 0.35, "C": -0.1, "D": -0.5}[grade]
        r_mult = rng.gauss(edge, 1.2)
        r_mult = max(-1.15, min(r_mult, 4.5))
        followed = "Yes" if rng.random() < 0.78 else "No"
        if followed == "No":
            r_mult = min(r_mult, rng.gauss(-0.6, 0.6))
        exit_ = entry + r_mult * d if direction == "Long" else entry - r_mult * d
        lev = rng.choice([2, 3, 3, 5, 5, 10, 20])
        held = int(rng.uniform(20, 180) * 60_000)
        row = {"symbol": sym, "direction": direction, "taken": 1, "status": "closed", "source": "demo",
               "opened_at": t, "closed_at": t + held, "date": date, "time_utc": tm, "entry": entry, "stop": stop,
               "exit": exit_, "qty": qty, "initial_qty": qty, "leverage": lev, "setup": setup, "grade": grade,
               "followed_plan": followed, "pen_atr": round(rng.uniform(0.15, 1.1), 2), "candles_to_reclaim": rng.randint(1, 6),
               "oi_confirmed": "Yes" if rng.random() < 0.6 else "No", "note": rng.choice(SAMPLE_NOTES),
               "legs": [{"kind": "entry", "name": "Initial", "price": entry, "qty": qty, "t": t},
                        {"kind": "exit", "name": "Exit", "price": exit_, "qty": qty, "t": t + held}]}
        m = compute_metrics(row, 0.055)
        row.update(m)
        row["fees"] = (entry + exit_) * qty * 0.00055
        if rng.random() < 0.7:
            row["context"] = _demo_context(rng, sym, direction, setup, entry, d, t,
                                           row["pen_atr"], row["candles_to_reclaim"], row["oi_confirmed"])
        viol = []
        if followed == "No":
            viol.append(rng.choice([
                {"rule": 7, "severity": "major", "code": "stop_widened", "text": "Stop moved away from entry."},
                {"rule": 9, "severity": "major", "code": "middle_third", "text": "Entry was in the middle third of the range."},
                {"rule": 5, "severity": "major", "code": "early_entry", "text": "Entered on the wick before the close."},
                {"rule": 6, "severity": "major", "code": "no_expansion_hold", "text": "No expansion by candle 4, held on."},
            ]))
        if m.get("liq_buffer") is not None and m["liq_buffer"] < 3:
            viol.append({"rule": 3, "severity": "minor", "code": "liq_buffer", "text": f"Liquidation only {m['liq_buffer']:.2f} stop widths away."})
        row["violations"] = viol
        row["process_score"] = Rr.process_score(viol, True)
        late = rng.random() < 0.25
        row["reviewed_at"] = t + held + (int(rng.uniform(12, 90) * 60_000) if late else int(rng.uniform(1, 9) * 60_000))
        tid = db.insert_trade(row)
        equity += m.get("net_pnl") or 0
        G.award(db, "journal_complete", f"journal:{tid}", ts=row["reviewed_at"])
        if not late:
            G.award(db, "fresh_log", f"fresh:{tid}", ts=row["reviewed_at"])
        G.award(db, "calibration", f"calib:{tid}", ts=row["reviewed_at"])
        if followed == "Yes":
            G.award(db, "clean_trade", f"clean:{tid}", ts=row["reviewed_at"])
        else:
            G.award(db, "violation_major", f"viol:{tid}", ts=row["reviewed_at"])
        for _ in range(rng.randint(1, 2)):
            G.award(db, "checklist", f"chk:demo:{tid}:{_}", ts=t - 300_000)
    # One recent trade still waiting for review, with the entry snapshot attached,
    # so the auto-prefill of the orange calibration fields is visible in demo mode.
    ue = _params("ETHUSDT")[0]
    ud = ue * 0.006
    ut = now - 40 * 60_000
    udate, utm = utc_parts(ut)
    urow = {"symbol": "ETHUSDT", "direction": "Long", "taken": 1, "status": "closed", "source": "demo",
            "opened_at": ut, "closed_at": ut + 25 * 60_000, "date": udate, "time_utc": utm,
            "entry": ue, "stop": ue - ud, "exit": ue + 1.6 * ud, "qty": round(equity * 0.01 / ud, 3),
            "initial_qty": round(equity * 0.01 / ud, 3), "leverage": 5,
            "note": "", "legs": [{"kind": "entry", "name": "Initial", "price": ue, "qty": round(equity * 0.01 / ud, 3), "t": ut},
                                  {"kind": "exit", "name": "Exit", "price": ue + 1.6 * ud, "qty": round(equity * 0.01 / ud, 3), "t": ut + 25 * 60_000}]}
    um = compute_metrics(urow, 0.055)
    urow.update(um)
    urow["fees"] = (urow["entry"] + urow["exit"]) * urow["qty"] * 0.00055
    urow["context"] = _demo_context(rng, "ETHUSDT", "Long", "Spring", ue, ud, ut, 0.45, 2, "Yes")
    db.insert_trade(urow)

    G.award(db, "quiz_pass", "quiz_pass:voi", note="Volume and OI quiz", ts=now - 5 * 86_400_000)
    samples = [
        (now - 50 * 60_000, "info", None, "TRUMPUSDT 9.12 is recruiting", "Closed 0.46 ATR below a 4h range low. Check OI now; the clock is running.", "market:TRUMPUSDT"),
        (now - 38 * 60_000, "warn", None, "TRUMPUSDT 9.12 TRIGGERED", "Spring candidate, Long. Decisive close back inside: this is the entry candle. Run the checklist now. Score C1-C4, show both gates.", "market:TRUMPUSDT"),
        (now - 3 * 86_400_000, "alert", 7, "ETHUSDT: you moved the stop AWAY from entry", "3,288.4 -> 3,271.0. Rule 7: never widen a stop. Put it back.", None),
        (now - 3 * 86_400_000 + 3_600_000, "warn", 6, "FARTCOINUSDT: candle 4, no expansion", "Best excursion only +0.21R. Rule 6: exit at or near breakeven. Rule, not judgment.", None),
        (now - 2 * 86_400_000, "praise", None, "Badge unlocked: Clean Sheet", "5 trades in a row with the plan followed.", None),
    ]
    for ts, lvl, rule, title, body, ref in samples:
        db.execute("INSERT OR IGNORE INTO coach(ts,level,rule,title,body,ref,key,acked) VALUES(?,?,?,?,?,?,?,?)",
                   (ts, lvl, rule, title, body, ref, f"demo:{title}", 1 if ts < now - 86_400_000 else 0))
    G.check_badges(db)
    db.set("demo_seeded", True)
