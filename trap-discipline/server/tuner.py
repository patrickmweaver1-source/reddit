"""Auto-tuner: proposes updates to the zone boundaries from evidence.

What it tunes (the numbers the live trap detector, checklist and diagram use):
  pen_floor_atr        minimum penetration for a Spring/Upthrust/Sweep (majors)
  pen_floor_atr_thin   the same floor for thin/memecoin assets
  pen_abandon_atr      depth at which a close-through counts as "ran" (dead)
  window_max_candles   closes beyond (counting the break candle) before a late
                       reclaim stops being a Spring/Upthrust and becomes a
                       Failed retest

How it learns - by running the LIVE detector over history
  Months of 15-minute Bybit candles per watchlist symbol. At every historical
  15-minute close it rebuilds the same higher-timeframe levels the Market
  Monitor uses (analysis.detect_levels on closed 1h / 4h and daily / weekly
  candles, exactly as the live engine holds them) and asks the same state machine
  (analysis.level_state) whether a level just TRIGGERED. Each trigger is then
  traded the playbook way: enter on the trigger close, stop a hair beyond the
  trap's extreme, exit at +2R, -1R or after 8 hours, net of fees and
  slippage. Trades your rule 8 cost gate would refuse are not counted.
  Because the replay records each trigger's penetration and candle count
  exactly as level_state measures them live, a tuned 0.35 means the same
  0.35 on your screen.

How it decides
  Every combination on a grid is scored by expectancy per trade on the older
  70% of history, shrunk toward zero for small samples and smoothed with its
  grid neighbours. One bounded step toward the best region is then tested on
  the newest 30%, which the search never saw:
    - each changed value must help on its own (no free riders),
    - the combined step must beat the current boundaries by more than the
      noise, measured by resampling whole trading days (trades on the same
      day, and across coins, move together, so they are not independent).
  A value with too little evidence behind it is left alone.

Your journal
  Once 30 of your trades carry the orange calibration fields, they act as a
  check: a proposal that would cut away a region where YOUR trades made money
  is blocked. (Your trades only cover the boundaries you actually traded, so
  they can confirm or veto a change, but cannot, on their own, point to
  territory you never traded.)

Nothing is applied without the owner's approval, never during an open
position, and every change can be undone.
"""
from __future__ import annotations

import asyncio
import bisect
import concurrent.futures
import hashlib
import hmac
import json
import logging
import math
import os
import random
import secrets
from dataclasses import dataclass
from typing import Any

from . import analysis as A
from .db import now_ms

log = logging.getLogger("trap.tuner")

M15 = 15 * 60_000
H1, H4, D1, W1 = 4 * M15, 16 * M15, 96 * M15, 672 * M15
MONDAY_OFFSET = 4 * D1                 # 1970-01-01 was a Thursday; weeks start Monday UTC
HISTORY_DAYS = 120
SCAN_EVERY_MS = 8 * 3_600_000          # three scans a day
RETRY_AFTER_FAIL_MS = 30 * 60_000
DISMISS_QUIET_MS = 7 * 86_400_000      # don't re-propose a change you dismissed for a week

TUNED = ("pen_floor_atr", "pen_floor_atr_thin", "pen_abandon_atr", "window_max_candles")
LABELS = {"pen_floor_atr": "Penetration floor", "pen_floor_atr_thin": "Penetration floor (thin assets)",
          "pen_abandon_atr": "Abandon line", "window_max_candles": "Reclaim window"}
BOUNDS = {"pen_floor_atr": (0.10, 0.60), "pen_floor_atr_thin": (0.15, 0.80),
          "pen_abandon_atr": (0.60, 2.00), "window_max_candles": (2, 8)}
MAX_STEP = {"pen_floor_atr": 0.10, "pen_floor_atr_thin": 0.10, "pen_abandon_atr": 0.20, "window_max_candles": 1}
MIN_GAP = 0.30                          # abandon line always at least 0.3 ATR above either floor

BIN = 0.05                              # penetration resolution (ATR)
NBINS = 60                              # 0 to 3.0 ATR
LOOKBACK = 48                           # level_state's live lookback (12 hours)
MAXC = LOOKBACK                         # candle-count columns
HORIZON = 32                            # 8 hours of 15m candles
TARGET_R = 2.0
STOP_BUFFER_ATR = 0.05
WARMUP = 200                            # candles before ATR/levels are trusted

MIN_EVENTS = 40                         # accepted trades needed before any proposal
SHRINK_K = 25.0                         # prior strength for expectancy
MIN_GAIN_R = 0.03                       # required improvement in expectancy (R per trade)
HOLDOUT_Z = 1.645                       # one-sided 5% on day-clustered bootstrap noise
BOOT = 400                              # bootstrap resamples
JOURNAL_MIN = 30                        # calibrated journal trades before the journal check applies
JOURNAL_VETO_N = 8                      # excluded journal trades needed to veto
USE_PROCESSES = True                    # replay in worker processes so the live engine never slows down

FLOORS = [round(0.10 + 0.05 * i, 2) for i in range(15)]      # 0.10 .. 0.80
ABANDONS = [round(0.60 + 0.10 * i, 2) for i in range(15)]    # 0.60 .. 2.00
WINDOWS = list(range(2, 9))                                   # 2 .. 8


@dataclass
class Event:
    symbol: str
    thin: bool
    kind: str         # "close" (Spring/Upthrust/Failed retest path) or "sweep"
    pen: float        # penetration in ATR, as level_state measures it live
    candles: int      # closes beyond incl. the break candle (1 for a sweep)
    r: float          # simulated result in R, net of costs
    t: int            # trigger candle open time (ms)
    side: str         # Long / Short

    @property
    def day(self) -> int:
        return self.t // D1


def accepted(e: Event, cfg: dict) -> bool:
    """Would the LIVE detector trigger this trade under these boundaries?"""
    floor = cfg["pen_floor_atr_thin"] if e.thin else cfg["pen_floor_atr"]
    if e.kind == "sweep":
        return e.pen >= floor
    if e.candles > cfg["window_max_candles"]:
        return True                      # a late reclaim is a Failed retest: no depth gate live
    return floor <= e.pen < cfg["pen_abandon_atr"]


# ---------------------------------------------------------------- replay
def _agg(c: list[dict], ms: int, offset: int = 0) -> tuple[list[dict], list[int]]:
    """15m -> larger candles aligned like Bybit's (UTC; weeks start Monday).
    Returns (candles, index of the first 15m candle in each)."""
    out: list[dict] = []
    first: list[int] = []
    for i, k in enumerate(c):
        start = (k["t"] - offset) // ms * ms + offset
        if out and out[-1]["t"] == start:
            o = out[-1]
            o["h"] = max(o["h"], k["h"])
            o["l"] = min(o["l"], k["l"])
            o["c"] = k["c"]
        else:
            out.append({"t": start, "o": k["o"], "h": k["h"], "l": k["l"], "c": k["c"]})
            first.append(i)
    return out, first


def _upto(agg: list[dict], first: list[int], c: list[dict], i: int) -> list[dict]:
    """Higher-timeframe candles as the live app would have seen them at the
    close of 15m candle i: completed ones plus the current forming one."""
    n = bisect.bisect_right(first, i)          # candles that have started by i
    if n == 0:
        return []
    done = agg[:n - 1]
    j0 = first[n - 1]
    seg = c[j0:i + 1]
    forming = {"t": agg[n - 1]["t"], "o": seg[0]["o"], "h": max(k["h"] for k in seg),
               "l": min(k["l"] for k in seg), "c": seg[-1]["c"]}
    return done + [forming]


def _closed(agg: list[dict], starts: list[int], ms: int, now: int) -> list[dict]:
    """Candles fully closed by `now` - how the live engine keeps 1h and 4h."""
    return agg[:bisect.bisect_right(starts, now - ms)]


def live_inputs(c: list[dict], i: int, cache: dict) -> tuple:
    """detect_levels inputs exactly as MarketEngine.compute has them just after
    15m candle i closes: closed 1h/4h candles, daily/weekly including the
    forming one, the same history lengths, price = that close."""
    if "a1h" not in cache:
        for key, ms, off in (("a1h", H1, 0), ("a4h", H4, 0), ("aD", D1, 0), ("aW", W1, MONDAY_OFFSET)):
            agg, first = _agg(c, ms, off)
            cache[key] = (agg, first, [k["t"] for k in agg])
    now = c[i]["t"] + M15
    a1h, _, s1h = cache["a1h"]
    a4h, _, s4h = cache["a4h"]
    aD, fD, _ = cache["aD"]
    aW, fW, _ = cache["aW"]
    return (_closed(a1h, s1h, H1, now)[-500:], _closed(a4h, s4h, H4, now)[-300:],
            _upto(aD, fD, c, i)[-90:], _upto(aW, fW, c, i)[-30:])


def find_events(c: list[dict], symbol: str, thin: bool, cost_pct: float, cost_gate_pct: float = 10.0,
                counts: dict | None = None) -> list[Event]:
    """Run the live level detector and state machine over contiguous 15m
    candles `c`, rebuilding levels at every close exactly as the live engine
    does, and simulate every trigger."""
    n = len(c)
    if n < WARMUP + LOOKBACK:
        return []
    atr = A.atr_series(c, 14)
    cache: dict = {}
    loose = {"floor_atr": 0.0, "abandon_atr": 1e9, "max_candles": 10 ** 6, "lookback": LOOKBACK}
    best: dict[tuple[int, str], tuple[int, dict, float]] = {}
    gated = 0
    for i in range(WARMUP, n - 1):
        a = atr[i]
        if not a:
            continue
        c1h, c4h, cD, cW = live_inputs(c, i, cache)
        levels = A.detect_levels(c1h, c4h, cD, cW, c[i]["c"], a)
        win = c[i - LOOKBACK + 1:i + 1]
        lo_c = min(k["c"] for k in win)
        hi_c = max(k["c"] for k in win)
        last = c[i]
        for lv in levels:
            p = lv["price"]
            if not (lo_c < p < hi_c or last["l"] < p < last["h"]):
                continue                        # no close-through and no wick through: cannot trigger
            st = A.level_state(p, win, a, **loose)
            if st["state"] != "TRIGGERED":
                continue
            key = (i, st["direction"])
            if key not in best or lv["strength"] > best[key][2]:
                best[key] = (i, st, lv["strength"])
    out: list[Event] = []
    for (i, side), (_, st, _s) in best.items():
        sim = _simulate(c, i, side, st["extreme"], atr[i], cost_pct, cost_gate_pct)
        if sim == "gated":
            gated += 1
            continue
        if sim is None:
            continue
        kind = "sweep" if st["setup"] == "Sweep" else "close"
        out.append(Event(symbol, thin, kind, float(st["pen_atr"]), int(st["candles_since_break"] or 1), sim, c[i]["t"], side))
    if counts is not None:
        counts["gated"] = counts.get("gated", 0) + gated
        counts["passed"] = counts.get("passed", 0) + len(out)
    return sorted(out, key=lambda e: e.t)


def _simulate(c, i, side, extreme, a, cost_pct, cost_gate_pct):
    """Trade a trigger at the close of candle i. Returns R, "gated", or None."""
    n = len(c)
    if i + HORIZON >= n:
        return None                             # not enough future yet: never judge a cut-short trade
    entry = c[i]["c"]
    if side == "Long":
        stop = extreme - STOP_BUFFER_ATR * a
        risk = entry - stop
    else:
        stop = extreme + STOP_BUFFER_ATR * a
        risk = stop - entry
    if not risk or risk <= 0:
        return None
    cost_r = (cost_pct / 100.0) * entry / risk
    if cost_r * 100.0 > cost_gate_pct:
        return "gated"                          # rule 8 would refuse this trade
    target = entry + TARGET_R * risk if side == "Long" else entry - TARGET_R * risk
    for q in range(i + 1, i + HORIZON + 1):
        k = c[q]
        if (k["l"] <= stop) if side == "Long" else (k["h"] >= stop):
            return -1.0 - cost_r                # stop and target in one candle counts as the stop
        if (k["h"] >= target) if side == "Long" else (k["l"] <= target):
            return TARGET_R - cost_r
    move = (c[i + HORIZON]["c"] - entry) if side == "Long" else (entry - c[i + HORIZON]["c"])
    return max(-1.0, min(TARGET_R, move / risk)) - cost_r


def replay_symbol(segs: list[list[dict]], sym: str, thin: bool, cost: float, gate: float) -> tuple[list[Event], dict]:
    """One symbol's full replay (all contiguous segments). Top-level so it can
    run in a worker process."""
    cnt: dict = {}
    evs: list[Event] = []
    for seg in segs:
        evs += find_events(seg, sym, thin, cost, gate, cnt)
    return evs, cnt


def segments(c: list[dict]) -> list[list[dict]]:
    """Split at any missing 15m candle so a gap is never replayed as if continuous."""
    out, cur = [], []
    for k in c:
        if cur and k["t"] - cur[-1]["t"] != M15:
            out.append(cur)
            cur = []
        cur.append(k)
    if cur:
        out.append(cur)
    return out


# ---------------------------------------------------------------- scoring
class Table:
    """Prefix sums so any boundary setting is scored in constant time, with
    exactly the live acceptance rule (see `accepted`)."""

    def __init__(self, events: list[Event]):
        W = MAXC + 1
        NB = NBINS + 2
        cnt = [[0] * (W + 1) for _ in range(NB)]
        tot = [[0.0] * (W + 1) for _ in range(NB)]
        scnt = [0] * NB
        stot = [0.0] * NB
        for e in events:
            b = min(NBINS, max(0, int(e.pen / BIN + 1e-9)))
            if e.kind == "sweep":
                scnt[b] += 1
                stot[b] += e.r
            else:
                cc = min(W, max(1, e.candles))
                cnt[b][cc] += 1
                tot[b][cc] += e.r
        self.PC = [[0] * (W + 1) for _ in range(NB + 1)]
        self.PS = [[0.0] * (W + 1) for _ in range(NB + 1)]
        for b in range(NB):
            rc, rs = 0, 0.0
            for w in range(W + 1):
                rc += cnt[b][w]
                rs += tot[b][w]
                self.PC[b + 1][w] = self.PC[b][w] + rc
                self.PS[b + 1][w] = self.PS[b][w] + rs
        self.SC = [0] * (NB + 1)
        self.SS = [0.0] * (NB + 1)
        for b in range(NB):
            self.SC[b + 1] = self.SC[b] + scnt[b]
            self.SS[b + 1] = self.SS[b] + stot[b]
        self.NB, self.W = NB, W
        self.n = len(events)

    def query(self, floor: float, abandon: float, window: int) -> tuple[int, float]:
        lo = int(round(floor / BIN))
        hi = min(NBINS + 1, int(round(abandon / BIN)))
        w = min(self.W, int(window))
        n = s = 0.0
        if hi > lo:                                             # in-window closes inside the box
            n += self.PC[hi][w] - self.PC[lo][w]
            s += self.PS[hi][w] - self.PS[lo][w]
        n += self.PC[self.NB][self.W] - self.PC[self.NB][w]     # late reclaims: Failed retests, all depths
        s += self.PS[self.NB][self.W] - self.PS[self.NB][w]
        n += self.SC[self.NB] - self.SC[lo]                     # sweeps at or past the floor
        s += self.SS[self.NB] - self.SS[lo]
        return int(n), s


def _snap(v: float, grid: list) -> Any:
    return min(grid, key=lambda g: abs(g - v))


def _score(tm: Table, tt: Table, cfg: dict) -> tuple[float, int]:
    n1, s1 = tm.query(cfg["pen_floor_atr"], cfg["pen_abandon_atr"], cfg["window_max_candles"])
    n2, s2 = tt.query(cfg["pen_floor_atr_thin"], cfg["pen_abandon_atr"], cfg["window_max_candles"])
    n = n1 + n2
    return ((s1 + s2) / (n + SHRINK_K) if n else 0.0), n


def stats(events: list[Event], cfg: dict) -> dict:
    rs = [e.r for e in events if accepted(e, cfg)]
    return {"trades": len(rs), "avg_r": round(sum(rs) / len(rs), 3) if rs else None}


def search(train: list[Event], test: list[Event], current: dict, journal: list[Event] | None = None) -> dict:
    """Find the best region on `train`, take one bounded step toward it, and
    keep it only if each part of the step, and the whole step, hold up on
    `test` beyond day-clustered noise (and the journal doesn't contradict it)."""
    cur = {k: current[k] for k in TUNED}
    tm = Table([e for e in train if not e.thin])
    tt = Table([e for e in train if e.thin])
    res: dict = {"current": cur, "proposal": None, "events": len(train) + len(test)}
    # a value with too little evidence behind it stays where it is
    free_major = tm.n >= MIN_EVENTS
    free_thin = tt.n >= MIN_EVENTS
    fgrid = list(enumerate(FLOORS)) if free_major else [(FLOORS.index(_snap(cur["pen_floor_atr"], FLOORS)), cur["pen_floor_atr"])]
    tgrid = list(enumerate(FLOORS)) if free_thin else [(FLOORS.index(_snap(cur["pen_floor_atr_thin"], FLOORS)), cur["pen_floor_atr_thin"])]
    raw = {}
    for fi, f in fgrid:
        for ti, ft in tgrid:
            for ai, a in enumerate(ABANDONS):
                if a - max(f, ft) < MIN_GAP - 1e-9:
                    continue
                for wi, w in enumerate(WINDOWS):
                    raw[(fi, ti, ai, wi)] = _score(tm, tt, {"pen_floor_atr": f, "pen_floor_atr_thin": ft,
                                                           "pen_abandon_atr": a, "window_max_candles": w})

    def smooth(key):
        vals = []
        fi, ti, ai, wi = key
        for d0 in (-1, 0, 1):
            for d1 in (-1, 0, 1):
                for d2 in (-1, 0, 1):
                    for d3 in (-1, 0, 1):
                        nb = raw.get((fi + d0, ti + d1, ai + d2, wi + d3))
                        if nb is not None and nb[1] >= MIN_EVENTS // 2:
                            vals.append(nb[0])
        return sum(vals) / len(vals) if vals else None

    sm = {k: smooth(k) for k, v in raw.items() if v[1] >= MIN_EVENTS}
    sm = {k: v for k, v in sm.items() if v is not None}
    # how many boundary settings this search looked at, so the evidence can say
    # plainly how many combinations were tried before one was picked (the same
    # multiple-comparisons honesty the journal now applies).
    res["trials"] = {"combinations_scored": len(raw), "with_enough_evidence": len(sm)}
    if not sm:
        res["reason"] = f"Not enough replayed trades yet (need {MIN_EVENTS} inside some boundary setting on the older history)."
        return res
    cur_key = (FLOORS.index(_snap(cur["pen_floor_atr"], FLOORS)), FLOORS.index(_snap(cur["pen_floor_atr_thin"], FLOORS)),
               ABANDONS.index(_snap(cur["pen_abandon_atr"], ABANDONS)), WINDOWS.index(_snap(cur["window_max_candles"], WINDOWS)))
    cur_s = smooth(cur_key)
    if cur_s is None:
        cur_s = _score(tm, tt, cur)[0]
    best_key = max(sm, key=sm.get)
    best = {"pen_floor_atr": FLOORS[best_key[0]], "pen_floor_atr_thin": FLOORS[best_key[1]],
            "pen_abandon_atr": ABANDONS[best_key[2]], "window_max_candles": WINDOWS[best_key[3]]}
    res["best"] = best
    if sm[best_key] - cur_s < MIN_GAIN_R:
        res["reason"] = "Your current boundaries are within noise of the best the evidence supports. No change needed."
        return res

    step = dict(cur)
    for k in TUNED:
        if (k == "pen_floor_atr" and not free_major) or (k == "pen_floor_atr_thin" and not free_thin):
            continue
        lo, hi = BOUNDS[k]
        d = max(-MAX_STEP[k], min(MAX_STEP[k], best[k] - cur[k]))
        v = min(hi, max(lo, cur[k] + d))
        step[k] = int(round(v)) if k == "window_max_candles" else round(round(v / BIN) * BIN, 2)
    if step["pen_abandon_atr"] - max(step["pen_floor_atr"], step["pen_floor_atr_thin"]) < MIN_GAP - 1e-9:
        step["pen_abandon_atr"] = round(max(step["pen_floor_atr"], step["pen_floor_atr_thin"]) + MIN_GAP, 2)
    changed = [k for k in TUNED if abs(step[k] - cur[k]) > 1e-9]
    if not changed:
        res["reason"] = "No change needed."
        return res

    # no free riders: each changed value must help on its own, on unseen data, by a real margin
    solo = {k: holdout_gain(test, cur, {**cur, k: step[k]}) for k in changed}
    keep = [k for k in changed if solo[k] is not None and solo[k] >= MIN_GAIN_R]
    res["solo"] = {k: (round(v, 3) if v is not None else None) for k, v in solo.items()}
    if not keep:
        res["reason"] = "A change looked better on older history, but no part of it held up on the most recent data. Holding."
        return res
    new = {**cur, **{k: step[k] for k in keep}}
    if new["pen_abandon_atr"] - max(new["pen_floor_atr"], new["pen_floor_atr_thin"]) < MIN_GAP - 1e-9:
        res["reason"] = "The part of the change that held up would squeeze the trap zone below 0.3 ATR. Holding."
        return res
    tr_gain = _score(tm, tt, new)[0] - _score(tm, tt, cur)[0]
    chk = holdout_check(test, cur, new)
    res["holdout"] = chk
    if tr_gain < MIN_GAIN_R / 2 or not chk["passed"]:
        res["reason"] = (f"A change looked better on older history but did not clear the noise on the most recent "
                         f"{chk['n_new']} replayed trades it was tested on. Holding.")
        return res
    if journal is not None and len(journal) >= JOURNAL_MIN:
        jc = journal_check(journal, cur, new)
        res["journal"] = jc
        if jc["vetoed"]:
            res["reason"] = (f"Blocked by your own trades: {jc['n_excluded']} of your journaled trades fall in the region this "
                             f"change would cut, and they averaged {jc['avg_r_excluded']:+.2f}R. Holding.")
            return res
    res["proposal"] = {"changes": {k: {"from": cur[k], "to": new[k]} for k in keep}, "new": new,
                       "gain_r": chk["gain_r"]}
    return res


def holdout_gain(test: list[Event], cur: dict, new: dict) -> float | None:
    a = [e.r for e in test if accepted(e, cur)]
    b = [e.r for e in test if accepted(e, new)]
    if len(a) < 2 or len(b) < MIN_EVENTS // 2:
        return None
    return sum(b) / len(b) - sum(a) / len(a)


def holdout_check(test: list[Event], cur: dict, new: dict) -> dict:
    """Out-of-sample test with day-clustered bootstrap: whole trading days are
    resampled together, because trades on the same day (and across coins)
    are correlated. Deterministic for a given dataset."""
    gain = holdout_gain(test, cur, new)
    a = [e for e in test if accepted(e, cur)]
    b = [e for e in test if accepted(e, new)]
    out = {"passed": False, "n_cur": len(a), "n_new": len(b), "gain_r": None, "se": None,
           "avg_r_cur": round(sum(e.r for e in a) / len(a), 3) if a else None,
           "avg_r_new": round(sum(e.r for e in b) / len(b), 3) if b else None}
    if gain is None:
        return out
    days: dict[int, list[Event]] = {}
    for e in test:
        days.setdefault(e.day, []).append(e)
    keys = sorted(days)
    rng = random.Random(len(test) * 1_000_003 + int(abs(gain) * 1e6))
    gains = []
    for _ in range(BOOT):
        sa = na = sb = nb = 0
        for _k in range(len(keys)):
            for e in days[keys[rng.randrange(len(keys))]]:
                if accepted(e, cur):
                    sa += e.r
                    na += 1
                if accepted(e, new):
                    sb += e.r
                    nb += 1
        if na and nb:
            gains.append(sb / nb - sa / na)
    if len(gains) < BOOT // 2:
        return out
    m = sum(gains) / len(gains)
    se = math.sqrt(sum((g - m) ** 2 for g in gains) / (len(gains) - 1))
    out.update({"gain_r": round(gain, 3), "se": round(se, 3), "days": len(keys),
                "passed": bool(gain >= MIN_GAIN_R and gain > HOLDOUT_Z * se)})
    return out


def journal_check(journal: list[Event], cur: dict, new: dict) -> dict:
    """Your trades can veto a change that cuts away a region where you made money."""
    excluded = [e.r for e in journal if accepted(e, cur) and not accepted(e, new)]
    avg = sum(excluded) / len(excluded) if excluded else None
    return {"trades": len(journal), "n_excluded": len(excluded), "avg_r_excluded": round(avg, 3) if avg is not None else None,
            "vetoed": bool(len(excluded) >= JOURNAL_VETO_N and avg is not None and avg > 0)}


def depth_buckets(events: list[Event], window: int = 4) -> list[dict]:
    """Average replayed R by close-through depth, 0.1 ATR buckets, for the
    trades the floor and abandon line govern (Springs/Upthrusts reclaimed
    inside the window; sweeps and Failed retests are left out)."""
    events = [e for e in events if e.kind == "close" and e.candles <= window]
    rows = []
    for i in range(15):
        lo, hi = round(i * 0.1, 1), round((i + 1) * 0.1, 1)
        rs = [e.r for e in events if lo <= e.pen < hi]
        rows.append({"label": f"{lo:.1f}-{hi:.1f}", "n": len(rs), "avg_r": round(sum(rs) / len(rs), 3) if rs else 0.0})
    rs = [e.r for e in events if e.pen >= 1.5]
    rows.append({"label": "1.5+", "n": len(rs), "avg_r": round(sum(rs) / len(rs), 3) if rs else 0.0})
    return rows


def split_events(events: list[Event], frac: float = 0.7) -> tuple[list[Event], list[Event]]:
    """Chronological split on whole days: older part searches, newer part confirms."""
    days = sorted({e.day for e in events})
    if not days:
        return [], []
    cut_day = days[min(len(days) - 1, int(len(days) * frac))]
    return [e for e in events if e.day < cut_day], [e for e in events if e.day >= cut_day]


def journal_events(trades: list[dict], thin_set: set) -> list[Event]:
    out = []
    for t in trades:
        if t.get("pen_atr") is None or t.get("candles_to_reclaim") is None or t.get("r") is None:
            continue
        kind = "sweep" if t.get("setup") == "Sweep" else "close"
        out.append(Event(t["symbol"], t["symbol"] in thin_set, kind, float(t["pen_atr"]), int(t["candles_to_reclaim"]),
                         float(t["r"]), int(t.get("opened_at") or 0), t.get("direction") or "Long"))
    return out


# ---------------------------------------------------------------- app glue
SCHEMA = """
CREATE TABLE IF NOT EXISTS hist15 (
  symbol TEXT NOT NULL, t INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL,
  PRIMARY KEY(symbol, t)
);
CREATE TABLE IF NOT EXISTS tune_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  status TEXT NOT NULL,            -- open / applied / dismissed / superseded / reverted
  changes TEXT NOT NULL,           -- {key: {from, to}}
  evidence TEXT NOT NULL,
  acted_at INTEGER,
  rule_version INTEGER
);
"""


class AutoTuner:
    def __init__(self, app: Any):
        self.app = app
        self.db = app.db
        with self.db.lock:
            self.db.conn.executescript(SCHEMA)
        self.running = False

    # ---- settings / status ------------------------------------------------
    def enabled(self) -> bool:
        return bool((self.db.get("settings", {}) or {}).get("auto_tune", False))

    def status(self) -> dict:
        last = self.db.get("tune_last_scan") or {}
        nxt = (last.get("ok_at") or 0) + SCAN_EVERY_MS if self.enabled() else None
        return {"enabled": self.enabled(), "running": self.running, "last": last, "next_at": nxt,
                "evidence": self.db.get("tune_last_evidence"),
                "open": self.open_proposal(), "history": self.history(12),
                "queued": self.queued(), "review_open": self.app.review_open() is not None}

    def open_proposal(self) -> dict | None:
        return self._decode(self.db.one("SELECT * FROM tune_proposals WHERE status='open' ORDER BY id DESC LIMIT 1"))

    def history(self, limit: int = 12) -> list[dict]:
        return [self._decode(r) for r in self.db.query("SELECT * FROM tune_proposals ORDER BY id DESC LIMIT ?", (limit,))]

    @staticmethod
    def _decode(row):
        if not row:
            return None
        row = dict(row)
        row["changes"] = json.loads(row["changes"])
        row["evidence"] = json.loads(row["evidence"])
        return row

    # ---- scheduler --------------------------------------------------------
    async def loop(self) -> None:
        await asyncio.sleep(90)                     # let the market engine load first
        while True:
            try:
                if self.enabled() and not self.running and self._due():
                    await self.scan()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning("auto-tune loop: %s", exc)
            await asyncio.sleep(600)

    def _due(self) -> bool:
        last = self.db.get("tune_last_scan") or {}
        now = now_ms()
        if last.get("failed_at") and (last.get("failed_at") or 0) > (last.get("ok_at") or 0) \
                and now - last["failed_at"] < RETRY_AFTER_FAIL_MS:
            return False
        return now - (last.get("ok_at") or 0) >= SCAN_EVERY_MS

    # ---- one scan ---------------------------------------------------------
    async def scan(self, manual: bool = False) -> dict:
        if self.running:
            return {"ok": False, "error": "A scan is already running."}
        self.running = True
        try:
            return await self._scan(manual)
        except Exception as exc:  # noqa: BLE001
            msg = str(exc) or exc.__class__.__name__
            if "403" in msg:
                msg = "Bybit refused the connection (403). Check the VPN."
            last = self.db.get("tune_last_scan") or {}
            last.update({"failed_at": now_ms(), "error": msg})
            self.db.set("tune_last_scan", last)
            log.warning("auto-tune scan failed: %s", msg)
            return {"ok": False, "error": msg}
        finally:
            self.running = False

    async def _scan(self, manual: bool) -> dict:
        a = self.app
        st = a.settings()
        th = a.th()
        th_at_start = {k: th[k] for k in TUNED}
        thin_set = set(st["thin_assets"])
        fee = st.get("taker_fee_pct") or th["taker_fee_pct"]
        events: list[Event] = []
        per_symbol = {}
        span = [None, None]
        jobs = []
        for sym in st["watchlist"]:
            c = await self._history(sym)
            thin = sym in thin_set
            slip = th["slippage_pct_thin"] if thin else th["slippage_pct_major"]
            cost = 2 * fee + 2 * slip
            segs = segments(c)
            jobs.append((sym, thin, cost, segs, len(c)))
            if c:
                span[0] = c[0]["t"] if span[0] is None else min(span[0], c[0]["t"])
                span[1] = c[-1]["t"] if span[1] is None else max(span[1], c[-1]["t"])
        results = await self._replay_all(jobs, th["cost_pct_of_risk_max"])
        for (sym, thin, cost, segs, n), (evs, cnt) in zip(jobs, results):
            events += evs
            per_symbol[sym] = {"candles": n, "events": len(evs), "thin": thin, "gated_out": cnt.get("gated", 0),
                               "cost_pct": round(cost, 3), "gaps": max(0, len(segs) - 1)}

        journal = journal_events(a.db.trades("taken=1 AND status='closed'"), thin_set)
        train, test = split_events(events)
        res = await asyncio.to_thread(search, train, test, th_at_start, journal)
        evidence = {
            "scanned_at": now_ms(), "demo": a.demo, "events": len(events), "per_symbol": per_symbol,
            "from": span[0], "to": span[1], "journal_trades": len(journal), "journal_min": JOURNAL_MIN,
            "journal": res.get("journal"), "train_events": len(train), "test_events": len(test),
            "current_stats": stats(events, th_at_start), "reason": res.get("reason"),
            "trials": res.get("trials"),
            "buckets": depth_buckets(events, th_at_start["window_max_candles"]),
            "window": th_at_start["window_max_candles"],
            "method": "Ran the live level detector and trap state machine over every historical 15-minute close, then traded each "
                      "trigger: enter on the close, stop just beyond the trap's extreme, exit at +2R, -1R or after 8 hours, net "
                      "of fees and slippage. Trades your cost gate would refuse are not counted.",
        }
        summary = {"ok_at": now_ms(), "events": len(events), "journal_trades": len(journal),
                   "gated_out": sum(v["gated_out"] for v in per_symbol.values()),
                   "result": "proposal" if res["proposal"] else "hold", "reason": res.get("reason"), "error": None}
        self.db.set("tune_last_scan", summary)
        self.db.set("tune_last_evidence", evidence)
        if not res["proposal"]:
            return {"ok": True, "proposal": None, "reason": res.get("reason")}

        # the world may have moved while we computed: don't propose on stale ground
        if not manual and not self.enabled():
            return {"ok": True, "proposal": None, "reason": "Auto-tune was switched off during the scan."}
        now_th = a.th()
        if any(abs(now_th[k] - th_at_start[k]) > 1e-9 for k in TUNED):
            return {"ok": True, "proposal": None, "reason": "Your thresholds changed during the scan. The next scan will re-check."}

        prop = res["proposal"]
        changes = prop["changes"]
        evidence.update({"base": th_at_start, "proposed_stats": stats(events, prop["new"]), "gain_r": prop["gain_r"],
                         "holdout": res.get("holdout"), "solo": res.get("solo")})
        cur = self.open_proposal()
        if cur and _same(cur["changes"], changes):
            return {"ok": True, "proposal": cur, "reason": "The same proposal is already waiting for you."}
        cutoff = now_ms() - DISMISS_QUIET_MS
        for d in self.db.query("SELECT changes FROM tune_proposals WHERE status='dismissed' AND acted_at>=?", (cutoff,)):
            if _same(json.loads(d["changes"]), changes):
                return {"ok": True, "proposal": None, "reason": "You dismissed this same change recently. Not re-proposing it this week."}
        self.db.execute("UPDATE tune_proposals SET status='superseded', acted_at=? WHERE status='open'", (now_ms(),))
        pid = self.db.execute("INSERT INTO tune_proposals(ts,status,changes,evidence) VALUES(?,?,?,?)",
                              (now_ms(), "open", json.dumps(changes), json.dumps(evidence, default=str))).lastrowid
        p = self._decode(self.db.one("SELECT * FROM tune_proposals WHERE id=?", (pid,)))
        try:
            await self._announce(p)
        except Exception as exc:  # noqa: BLE001 - a failed notification must not mark the scan failed
            log.warning("auto-tune announce failed: %s", exc)
        return {"ok": True, "proposal": p}

    async def _replay_all(self, jobs: list, gate: float) -> list:
        """Replay every symbol. Worker processes (in parallel, outside this
        process's interpreter lock) so live alerts are never delayed by a
        scan; falls back to a thread if processes aren't available."""
        loop = asyncio.get_running_loop()
        if USE_PROCESSES and jobs:
            try:
                workers = max(1, min(len(jobs), (os.cpu_count() or 2) - 1, 4))
                with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool:
                    futs = [loop.run_in_executor(pool, replay_symbol, segs, sym, thin, cost, gate)
                            for sym, thin, cost, segs, _ in jobs]
                    return list(await asyncio.gather(*futs))
            except (OSError, RuntimeError, concurrent.futures.process.BrokenProcessPool) as exc:
                log.warning("auto-tune: worker processes unavailable (%s); using a thread", exc)
        return [await asyncio.to_thread(replay_symbol, segs, sym, thin, cost, gate) for sym, thin, cost, segs, _ in jobs]

    async def _history(self, sym: str) -> list[dict]:
        """Closed 15m candles for the last HISTORY_DAYS, cached locally, topped
        up incrementally, with any holes re-requested (read-only public data)."""
        a = self.app
        now = now_ms()
        cutoff = now - HISTORY_DAYS * 86_400_000
        cutoff -= cutoff % M15
        if a.demo:
            rows = await a.source.klines(sym, "15", limit=HISTORY_DAYS * 96)
            return [r for r in rows if r["t"] + M15 <= now]
        last = self.db.one("SELECT MAX(t) AS t FROM hist15 WHERE symbol=?", (sym,))
        ranges = [(max(cutoff, ((last or {}).get("t") or 0) + M15), now)]
        # holes left by an earlier empty or failed response
        ts = [r["t"] for r in self.db.query("SELECT t FROM hist15 WHERE symbol=? AND t>=? ORDER BY t", (sym, cutoff))]
        if ts and ts[0] > cutoff:
            ranges.append((cutoff, ts[0] - M15))
        for x, y in zip(ts, ts[1:]):
            if y - x > M15:
                ranges.append((x + M15, y - M15))
        empty = [tuple(x) for x in (self.db.get(f"hist_empty:{sym}") or []) if x[2] > now - 7 * 86_400_000]
        ranges = [r for r in ranges if not any(e0 <= r[0] and r[1] <= e1 for e0, e1, _ in empty)]
        for start, stop in ranges[:12]:
            got_any = False
            r0 = start
            while start + M15 <= min(stop + M15, now):
                end = min(start + 1000 * M15 - 1, stop + M15 - 1, now)
                rows = await a.source.klines(sym, "15", limit=1000, start=start, end=end)
                rows = [r for r in rows if r["t"] + M15 <= now]
                if rows:
                    got_any = True
                    with self.db.lock:
                        self.db.conn.executemany("INSERT OR REPLACE INTO hist15(symbol,t,o,h,l,c) VALUES(?,?,?,?,?,?)",
                                                 [(sym, r["t"], r["o"], r["h"], r["l"], r["c"]) for r in rows])
                start = end + 1
                await asyncio.sleep(0.15)               # stay far below Bybit's rate limit
            if not got_any and stop < now - M15:
                empty.append((r0, stop, now))           # e.g. before the symbol was listed: don't ask again this week
        self.db.set(f"hist_empty:{sym}", [list(x) for x in empty])
        self.db.execute("DELETE FROM hist15 WHERE symbol=? AND t<?", (sym, cutoff - 86_400_000))
        return [dict(r) for r in self.db.query("SELECT t,o,h,l,c FROM hist15 WHERE symbol=? AND t>=? ORDER BY t", (sym, cutoff))]

    # ---- announce / act ---------------------------------------------------
    def describe(self, changes: dict) -> str:
        parts = []
        for k, v in changes.items():
            if k == "window_max_candles":
                parts.append(f"{LABELS[k]} {int(v['from'])} to {int(v['to'])} candles")
            else:
                parts.append(f"{LABELS[k]} {_num(v['from'])} to {_num(v['to'])} ATR")
        return "; ".join(parts)

    async def _announce(self, p: dict) -> None:
        a = self.app
        ev = p["evidence"]
        ho = ev.get("holdout") or {}
        body = (f"{self.describe(p['changes'])}. On recent history it never searched: "
                f"{_fmt_r(ho.get('avg_r_cur'))} per trade now vs {_fmt_r(ho.get('avg_r_new'))} proposed.")
        await a.coach.say("info", "Auto-tune: new zone boundaries proposed", body + " Review it on the Playbook page.",
                          key=f"tune:{p['id']}", ref="playbook")
        mode = "demo" if a.demo else "live"
        acts = {x: f"/tune-act?id={p['id']}&a={x}&m={mode}&sig={self.sign(mode, p['id'], x, p['changes'])}" for x in ("apply", "dismiss")}
        a._spawn(a.push_notify(("DEMO · " if a.demo else "") + "New zone boundaries proposed", body,
                               tag=f"tune:{p['id']}", url="/#/playbook",
                               extra={"actions": [{"action": "apply", "title": "Apply"}, {"action": "dismiss", "title": "Dismiss"}],
                                      "act": acts}))

    def _secret(self) -> str:
        key = self.app.shared.get("action_secret")
        if not key:
            key = secrets.token_hex(32)
            self.app.shared.set("action_secret", key)
        return key

    def sign(self, mode: str, pid: int, action: str, changes: dict) -> str:
        """Binds mode + proposal + action + the exact change, so a button can
        only ever do what its notification described."""
        what = hashlib.sha256(json.dumps(changes, sort_keys=True).encode()).hexdigest()
        return hmac.new(self._secret().encode(), f"{mode}:{pid}:{action}:{what}".encode(), hashlib.sha256).hexdigest()[:40]

    def verify(self, mode: str, pid: int, action: str, sig: str) -> bool:
        p = self._decode(self.db.one("SELECT * FROM tune_proposals WHERE id=?", (pid,)))
        if not p or not sig:
            return False
        return hmac.compare_digest(self.sign(mode, pid, action, p["changes"]), sig)

    def position_block(self) -> str | None:
        """Why boundaries can't change right now, or None. Unknown counts as open."""
        a = self.app
        if a.db.trades("status='open' AND taken=1"):
            return "You have an open position. Boundaries never change mid-trade: do this after it closes."
        if a.demo:
            return None
        acct = a.account
        if acct is None:
            return "Connect your read-only Bybit key first, so the app can confirm you have no open position."
        if acct.status != "live":
            return f"Your account is {acct.status}. Wait until it shows live, so the app can confirm you have no open position."
        if acct.positions:
            return "You have an open position. Boundaries never change mid-trade: do this after it closes."
        return None

    def has_open_position(self) -> bool:
        return self.position_block() is not None

    async def apply(self, pid: int) -> dict:
        p = self._decode(self.db.one("SELECT * FROM tune_proposals WHERE id=?", (pid,)))
        if not p:
            return {"ok": False, "status": 404, "error": "Proposal not found."}
        if p["status"] != "open":
            return {"ok": False, "status": 409, "error": f"This proposal is already {p['status']}."}
        block = self.position_block()
        if block:
            return {"ok": False, "status": 409, "error": block}
        th = self.app.th()
        base = (p["evidence"] or {}).get("base") or {k: v["from"] for k, v in p["changes"].items()}
        # every tuned value must still be what the scan tested against, not just the ones it changes
        if any(abs(th.get(k, base[k]) - base[k]) > 1e-9 for k in base) or \
                any(abs(th.get(k, v["from"]) - v["from"]) > 1e-9 for k, v in p["changes"].items()):
            self.db.execute("UPDATE tune_proposals SET status='superseded', acted_at=? WHERE id=?", (now_ms(), pid))
            return {"ok": False, "status": 409, "error": "Your thresholds changed since this was proposed. The next scan will re-check."}
        result = {**{k: th[k] for k in TUNED}, **{k: v["to"] for k, v in p["changes"].items()}}
        if result["pen_abandon_atr"] - max(result["pen_floor_atr"], result["pen_floor_atr_thin"]) < MIN_GAP - 1e-9:
            return {"ok": False, "status": 409, "error": "Applying this would squeeze the trap zone below 0.3 ATR."}
        # Rule 11: the live rulebook only changes during an open monthly review.
        # Approving outside a review records your approval and queues the change;
        # it takes effect when you open your next monthly review.
        if self.app.review_open() is None:
            self.db.execute("UPDATE tune_proposals SET status='queued', acted_at=? WHERE id=?", (now_ms(), pid))
            return {"ok": True, "queued": True,
                    "message": "Approved and queued. It takes effect when you open your next monthly review (rule 11)."}
        rb = await self._new_version({k: v["to"] for k, v in p["changes"].items()},
                                     f"Auto-tune #{pid} approved: {self.describe(p['changes'])}")
        self.db.execute("UPDATE tune_proposals SET status='applied', acted_at=?, rule_version=? WHERE id=?", (now_ms(), rb["id"], pid))
        return {"ok": True, "rulebook": rb}

    def queued(self) -> list[dict]:
        return [self._decode(r) for r in self.db.query("SELECT * FROM tune_proposals WHERE status='queued' ORDER BY id")]

    async def apply_queued(self) -> dict:
        """Apply every approved-and-queued change, in the order approved. Called
        when a monthly review opens (rule 11): this is the moment queued tuner
        changes are allowed to touch the live rulebook. Each still goes through
        the full apply() re-validation (position block, threshold drift), so a
        queued change that no longer fits is superseded rather than forced in."""
        applied, skipped = [], []
        for p in self.queued():
            # apply() commits because a review is now open; put it back to 'open'
            # so the shared apply path treats it as a fresh, validatable approval.
            self.db.execute("UPDATE tune_proposals SET status='open' WHERE id=?", (p["id"],))
            res = await self.apply(p["id"])
            if res.get("ok") and res.get("rulebook"):
                applied.append(p["id"])
            else:
                skipped.append({"id": p["id"], "error": res.get("error")})
                # apply() may have already set 'superseded'; if it merely failed
                # (e.g. an open position), leave it queued to retry next review.
                if self.db.one("SELECT status FROM tune_proposals WHERE id=?", (p["id"],))["status"] == "open":
                    self.db.execute("UPDATE tune_proposals SET status='queued' WHERE id=?", (p["id"],))
        return {"applied": applied, "skipped": skipped}

    async def dismiss(self, pid: int) -> dict:
        p = self.db.one("SELECT status FROM tune_proposals WHERE id=?", (pid,))
        if not p:
            return {"ok": False, "status": 404, "error": "Proposal not found."}
        if p["status"] != "open":
            return {"ok": False, "status": 409, "error": f"This proposal is already {p['status']}."}
        self.db.execute("UPDATE tune_proposals SET status='dismissed', acted_at=? WHERE id=?", (now_ms(), pid))
        return {"ok": True}

    async def revert(self, pid: int) -> dict:
        p = self._decode(self.db.one("SELECT * FROM tune_proposals WHERE id=?", (pid,)))
        if not p or p["status"] != "applied":
            return {"ok": False, "status": 409, "error": "Only an applied change can be undone."}
        block = self.position_block()
        if block:
            return {"ok": False, "status": 409, "error": block}
        th = self.app.th()
        if any(abs(th.get(k, v["to"]) - v["to"]) > 1e-9 for k, v in p["changes"].items()):
            return {"ok": False, "status": 409, "error": "Those thresholds have changed again since. Undo the later change first."}
        restored = {**{k: th[k] for k in TUNED}, **{k: v["from"] for k, v in p["changes"].items()}}
        if restored["pen_abandon_atr"] - max(restored["pen_floor_atr"], restored["pen_floor_atr_thin"]) < MIN_GAP - 1e-9:
            return {"ok": False, "status": 409, "error": "Undoing this alone would squeeze the trap zone below 0.3 ATR. Undo the later change first."}
        # Undoing a change that was just applied in error is the one sanctioned
        # exception to the review gate (rule 11), so a bad boundary is never
        # forced to stay live until the next month.
        rb = await self._new_version({k: v["from"] for k, v in p["changes"].items()}, f"Undo auto-tune #{pid}",
                                     allow_outside_review=True)
        self.db.execute("UPDATE tune_proposals SET status='reverted', acted_at=? WHERE id=?", (now_ms(), pid))
        return {"ok": True, "rulebook": rb}

    async def _new_version(self, updates: dict, note: str, *, allow_outside_review: bool = False) -> dict:
        """Write a new rulebook version through the app's single authoritative
        commit path, which enforces rule 11 (only during an open monthly
        review). allow_outside_review is used only to undo a change that was
        just applied in error."""
        a = self.app
        rb = a.rulebook()
        th = dict(rb["thresholds"])
        th.update(updates)
        new = a.commit_rule_version(rb["rules"], th, rb["setups"], note, allow_outside_review=allow_outside_review)
        await a.push("rules", {"id": new["id"], "note": new["note"]})
        return new


def _same(a: dict, b: dict) -> bool:
    if set(a) != set(b):
        return False
    return all(abs(a[k]["to"] - b[k]["to"]) < 1e-9 and abs(a[k]["from"] - b[k]["from"]) < 1e-9 for k in a)


def _num(v: float) -> str:
    """1 -> "1.0", 0.25 -> "0.25", 0.3 -> "0.3"."""
    return f"{v:.1f}" if float(v).is_integer() else f"{v:g}"


def _fmt_r(v) -> str:
    if v is None:
        return "n/a"
    return f"{v:+.2f}R"
