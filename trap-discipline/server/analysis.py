"""Pure market analytics: indicators, levels, the trap state machine, regime,
gates, and the price/volume/OI mechanism classifier.

Everything here is a deterministic function of candles and series so it can be
unit-tested without network access. Candle dict keys: t (ms open time), o, h,
l, c, v (base-coin volume). Lists are oldest -> newest and contain CLOSED
candles only unless stated otherwise.

Automated classification is decision support, not a signal. The UI labels it
"auto-classified - confirm on the chart".
"""
from __future__ import annotations

import math
from statistics import median
from typing import Iterable

from .db import now_ms

MS_15M = 15 * 60 * 1000
MS_1H = 60 * 60 * 1000
MS_DAY = 24 * MS_1H

STATES = [
    "DORMANT", "APPROACHING", "TESTED", "RECRUITING", "WATCH", "TRIGGERED",
    "DEAD_RAN", "DEAD_TIMED_OUT", "DEAD_SHALLOW",
]
STATE_RANK = {"TRIGGERED": 6, "WATCH": 5, "RECRUITING": 4, "TESTED": 3, "APPROACHING": 2,
              "DORMANT": 0, "DEAD_RAN": -1, "DEAD_TIMED_OUT": -1, "DEAD_SHALLOW": -1}


# --------------------------------------------------------------------------
# Indicators
# --------------------------------------------------------------------------
def true_ranges(c: list[dict]) -> list[float]:
    out = []
    for i, k in enumerate(c):
        if i == 0:
            out.append(k["h"] - k["l"])
        else:
            pc = c[i - 1]["c"]
            out.append(max(k["h"] - k["l"], abs(k["h"] - pc), abs(k["l"] - pc)))
    return out


def atr_series(c: list[dict], n: int = 14) -> list[float | None]:
    """Wilder ATR. None until n candles are available."""
    tr = true_ranges(c)
    out: list[float | None] = [None] * len(c)
    if len(c) < n:
        return out
    a = sum(tr[:n]) / n
    out[n - 1] = a
    for i in range(n, len(c)):
        a = (a * (n - 1) + tr[i]) / n
        out[i] = a
    return out


def atr(c: list[dict], n: int = 14) -> float | None:
    s = atr_series(c, n)
    return s[-1] if s else None


def ema(values: list[float], n: int) -> list[float]:
    if not values:
        return []
    k = 2 / (n + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def pivots(c: list[dict], left: int = 2, right: int = 2) -> tuple[list[tuple[int, float]], list[tuple[int, float]]]:
    """Fractal swing highs and lows. Returns (highs, lows) as (index, price)."""
    highs, lows = [], []
    for i in range(left, len(c) - right):
        h = c[i]["h"]
        lo = c[i]["l"]
        if all(h > c[j]["h"] for j in range(i - left, i)) and all(h >= c[j]["h"] for j in range(i + 1, i + right + 1)):
            highs.append((i, h))
        if all(lo < c[j]["l"] for j in range(i - left, i)) and all(lo <= c[j]["l"] for j in range(i + 1, i + right + 1)):
            lows.append((i, lo))
    return highs, lows


def rvol(c: list[dict], lookback_days: int = 20) -> float | None:
    """Relative volume of the last closed candle vs the median volume of the
    same time-of-day candle over prior days (guide section 4A)."""
    if len(c) < 10:
        return None
    last = c[-1]
    tod = last["t"] % MS_DAY
    same = [k["v"] for k in c[:-1] if k["t"] % MS_DAY == tod][-lookback_days:]
    if len(same) < 3:
        same = [k["v"] for k in c[-97:-1]]
    base = median(same) if same else 0
    return last["v"] / base if base > 0 else None


def rvol_label(r: float | None) -> str:
    if r is None:
        return "unknown"
    if r < 0.7:
        return "Unusually quiet"
    if r < 1.3:
        return "Ordinary"
    if r < 2.0:
        return "Active"
    if r < 3.0:
        return "Exceptional"
    return "Climactic"


def pct_change(a: float | None, b: float | None) -> float | None:
    if a in (None, 0) or b is None:
        return None
    return (b - a) / a * 100


def series_value_at(series: list[dict], t: int, key: str) -> float | None:
    """Last value at or before t."""
    val = None
    for p in series:
        if p["t"] <= t:
            val = p[key]
        else:
            break
    return val


def percentile_rank(values: list[float], x: float) -> float | None:
    if not values:
        return None
    below = sum(1 for v in values if v < x)
    equal = sum(1 for v in values if v == x)
    return (below + 0.5 * equal) / len(values) * 100


def nice_step(price: float, target_pct: float = 2.0) -> float:
    raw = price * target_pct / 100
    if raw <= 0:
        return 1.0
    mag = 10 ** math.floor(math.log10(raw))
    for m in (1, 2, 2.5, 5, 10):
        if m * mag >= raw:
            return m * mag
    return 10 * mag


# --------------------------------------------------------------------------
# Levels (C1)
# --------------------------------------------------------------------------
SOURCE_WEIGHT = {"range": 6, "4h": 5, "1d": 4, "1w": 4, "1h": 3, "round": 2, "wide": 2}


def _touches(c1h: list[dict], level: float, tol: float) -> int:
    """Distinct rejection touches on the 1h chart: the candle's extreme reaches
    the level (within tol) and the candle closes back on the other side.
    Touches closer than 6 candles apart count once."""
    count = 0
    last_i = -100
    for i, k in enumerate(c1h):
        hit_hi = abs(k["h"] - level) <= tol and k["c"] < level
        hit_lo = abs(k["l"] - level) <= tol and k["c"] > level
        if hit_hi or hit_lo:
            if i - last_i >= 6:
                count += 1
            last_i = i
    return count


def detect_levels(c1h: list[dict], c4h: list[dict], cD: list[dict], cW: list[dict],
                  price: float, atr15: float, liq_prices: Iterable[float] = ()) -> list[dict]:
    """Candidate higher-timeframe levels. 15m-only levels are never produced (C1)."""
    if not price or not atr15:
        return []
    raw: list[tuple[float, str]] = []
    if len(c4h) >= 7:
        hs, ls = pivots(c4h[-180:], 2, 2)
        raw += [(p, "4h") for _, p in hs] + [(p, "4h") for _, p in ls]
    if len(c1h) >= 9:
        hs, ls = pivots(c1h[-168:], 3, 3)
        raw += [(p, "1h") for _, p in hs] + [(p, "1h") for _, p in ls]
    if len(cD) >= 2:
        d = cD[-2]  # prior completed UTC day
        raw += [(d["h"], "1d"), (d["l"], "1d"), (d["c"], "1d")]
    if len(cW) >= 2:
        w = cW[-2]
        raw += [(w["h"], "1w"), (w["l"], "1w")]
    step = nice_step(price, 2.0)
    base = math.floor(price / step) * step
    for m in (-1, 0, 1, 2):
        raw.append((round(base + m * step, 10), "round"))
    if len(c1h) >= 20:
        a1 = atr(c1h, 14) or 0
        for k in c1h[-72:]:
            if a1 and (k["h"] - k["l"]) >= 2 * a1:
                raw += [(k["h"], "wide"), (k["l"], "wide")]

    tol = max(0.5 * atr15, price * 0.0008)
    # keep only levels within a working band of price (8 ATR15 or 12%)
    band = max(8 * atr15, price * 0.12)
    raw = [(p, s) for p, s in raw if abs(p - price) <= band and p > 0]
    raw.sort()
    clusters: list[dict] = []
    for p, s in raw:
        if clusters and abs(p - clusters[-1]["_last"]) <= tol:
            cl = clusters[-1]
            cl["_prices"].append(p)
            cl["sources"].add(s)
            cl["_last"] = p
        else:
            clusters.append({"_prices": [p], "sources": {s}, "_last": p})

    liq_prices = list(liq_prices)
    out = []
    for cl in clusters:
        srcs = cl["sources"]
        # anchor to the strongest source's price rather than the mean
        lvl = median(cl["_prices"])
        touches = _touches(c1h[-336:], lvl, max(0.35 * atr15, price * 0.0005)) if c1h else 0
        if touches >= 3:
            srcs = srcs | {"range"}
        liq_near = sum(1 for lp in liq_prices if abs(lp - lvl) <= tol * 2)
        htf = bool(srcs & {"4h", "1d", "1w", "range"})
        if "4h" in srcs and touches >= 3 and liq_near >= 3:
            c1 = 2
        elif htf or "1h" in srcs:
            c1 = 1
        else:
            c1 = 0  # a bare round number or wide-candle mark is not structure on its own
        strength = max(SOURCE_WEIGHT.get(s, 1) for s in srcs) + min(touches, 5) + (2 if liq_near >= 3 else 0)
        out.append({
            "price": lvl,
            "sources": sorted(srcs, key=lambda s: -SOURCE_WEIGHT.get(s, 1)),
            "touches": touches,
            "liq_near": liq_near,
            "c1": c1,
            "strength": strength,
            "side": "resistance" if lvl > price else "support",
            "dist_atr": (lvl - price) / atr15,
        })
    out.sort(key=lambda x: abs(x["price"] - price))
    return out


def liquidity_state(candles: list[dict], thin: bool, ticker: dict | None = None,
                    recent: int = 8, base: int = 96) -> dict:
    """Classify the coin's CURRENT tradeability against its OWN recent norm, not
    a fixed thin/not-thin label. The core measure is realized impact - how far
    price moved per unit of dollar volume in each 15m candle (|return| / turnover).
    When impact rises and volume falls, the same order pushes price further:
    liquidity has degraded. Top-of-book spread is folded in only when the feed
    provides it (it does not on every install), never assumed.

    Returns a state (normal / degraded / severely_thin / unknown) and the raw
    ratios behind it. This is an input/gate, never an instruction to trade
    differently on its own."""
    rows = [c for c in candles if c.get("q") and c.get("c") and c.get("o")]
    if len(rows) < max(20, base // 3):
        return {"state": "unknown", "impact_ratio": None, "vol_ratio": None, "spread_bps": None,
                "note": "Not enough recent candles with volume to judge liquidity yet."}
    def impact(c):
        ret = abs(c["c"] - c["o"]) / c["o"] if c["o"] else 0.0
        return ret / c["q"] if c["q"] else 0.0
    imp = [impact(c) for c in rows]
    turn = [c["q"] for c in rows]
    base_imp = median(imp[-base:]) or 1e-12
    base_turn = median(turn[-base:]) or 1e-12
    rec_imp = median(imp[-recent:])
    rec_turn = median(turn[-recent:])
    impact_ratio = round(rec_imp / base_imp, 2)
    vol_ratio = round(rec_turn / base_turn, 2)
    spread_bps = None
    if ticker:
        try:
            bid = float(ticker.get("bid1Price") or 0)
            ask = float(ticker.get("ask1Price") or 0)
            if bid > 0 and ask > 0:
                spread_bps = round((ask - bid) / ((ask + bid) / 2) * 10_000, 1)
        except (TypeError, ValueError):
            spread_bps = None
    wide = 30.0 if thin else 12.0                # bps: a wide top-of-book spread for this asset class
    if impact_ratio >= 2.5 or vol_ratio <= 0.35 or (spread_bps is not None and spread_bps >= wide * 2):
        state = "severely_thin"
    elif impact_ratio >= 1.6 or vol_ratio <= 0.55 or (spread_bps is not None and spread_bps >= wide):
        state = "degraded"
    else:
        state = "normal"
    note = {
        "normal": "Trading conditions are near this coin's own recent norm.",
        "degraded": "Thinner than usual: price is moving more per unit of volume, so expect worse fills and wider stops.",
        "severely_thin": "Much thinner than usual: the cost gate and slippage assumptions may understate real cost right now.",
        "unknown": "Not enough data.",
    }[state]
    return {"state": state, "impact_ratio": impact_ratio, "vol_ratio": vol_ratio,
            "spread_bps": spread_bps, "note": note}


LIQ_HALF_LIFE_MS = 6 * 60 * 60_000     # a liquidation's weight halves every 6 hours


def liquidation_heatmap(liqs: list[dict], price: float, atr15: float | None, *,
                        n_buckets: int = 26, band_atr: float = 6.0, now: int | None = None) -> dict | None:
    """Bucket ACTUAL recorded liquidations (server/market.py's live allLiquidation stream,
    the same source detect_levels' liq_near uses) by price, around current price.

    This is an OBSERVED MAP of executed liquidation prints, not a model of where future
    liquidations would trigger - Bybit's public API does not expose live positions or their
    leverage, so there is no honest way to compute that, and it only covers the time the app
    was actually running and watching this coin. Rows outside the band are dropped from the
    grid but counted in `outside`, so the total never silently understates what was recorded.

    Each print is also weighted by recency (half-life LIQ_HALF_LIFE_MS) so a wall of old
    liquidations does not outshine what is happening now; `decayed` carries that weighting
    while `total` stays the raw executed size."""
    if not price or not liqs:
        return None
    now = now or now_ms()
    band = max(band_atr * atr15, price * 0.10) if atr15 else price * 0.10
    lo, hi = price - band, price + band
    width = (hi - lo) / n_buckets
    if width <= 0:
        return None
    rows = [{"lo": lo + i * width, "hi": lo + (i + 1) * width, "long_liq": 0.0, "short_liq": 0.0,
             "decayed": 0.0, "n": 0} for i in range(n_buckets)]
    outside = 0
    since_ts = None
    for x in liqs:
        p = x.get("price")
        if p is None:
            continue
        since_ts = x["ts"] if since_ts is None else min(since_ts, x["ts"])
        if p < lo or p >= hi:
            outside += 1
            continue
        idx = min(n_buckets - 1, max(0, int((p - lo) / width)))
        row = rows[idx]
        row["n"] += 1
        size = x.get("size") or 0
        w = 0.5 ** (max(0, now - x["ts"]) / LIQ_HALF_LIFE_MS)
        row["decayed"] += size * w
        if x.get("side") == "Buy":     # a long was liquidated
            row["long_liq"] += size
        else:                          # a short was liquidated
            row["short_liq"] += size
    for r in rows:
        r["total"] = r["long_liq"] + r["short_liq"]
    # size percentile: rank each non-empty bucket against the others so a bar's
    # height reads as "how big for this coin lately", not a raw quantity whose
    # scale means nothing on its own.
    filled = sorted(r["total"] for r in rows if r["total"] > 0)
    for r in rows:
        if r["total"] > 0 and filled:
            below = sum(1 for v in filled if v < r["total"])
            r["pctile"] = round(below / len(filled), 3)
        else:
            r["pctile"] = None
    peak = max((r["total"] for r in rows), default=0)
    decayed_peak = max((r["decayed"] for r in rows), default=0)
    n_in_band = sum(r["n"] for r in rows)
    grand = sum(r["total"] for r in rows)
    tops = sorted((r["total"] for r in rows), reverse=True)
    # ATR-normalized concentration: how tightly the liquidations cluster. Share
    # of executed size in the single busiest price band and the busiest 3 bands.
    concentration = round(tops[0] / grand, 3) if grand else 0.0
    concentration3 = round(sum(tops[:3]) / grand, 3) if grand else 0.0
    return {"rows": rows, "lo": lo, "hi": hi, "peak": peak, "decayed_peak": decayed_peak,
            "since_ts": since_ts, "n": n_in_band, "outside": outside,
            "band_atr": round(band / atr15, 1) if atr15 else None,
            "bucket_atr": round(width / atr15, 2) if atr15 else None,
            "coverage_hours": round((now - since_ts) / 3_600_000, 1) if since_ts else 0.0,
            "half_life_hours": LIQ_HALF_LIFE_MS / 3_600_000,
            "concentration": concentration, "concentration3": concentration3}


# --------------------------------------------------------------------------
# Trap state machine (C2-C4 on closed 15m candles)
# --------------------------------------------------------------------------
def _is_stall(c: list[dict], atr15: float) -> bool:
    if len(c) < 2:
        return False
    a, b = c[-2], c[-1]
    rng_b = b["h"] - b["l"]
    body_a = abs(a["c"] - a["o"])
    body_b = abs(b["c"] - b["o"])
    wick_both = (b["h"] - max(b["o"], b["c"])) > 0.2 * rng_b and (min(b["o"], b["c"]) - b["l"]) > 0.2 * rng_b if rng_b else False
    inside = b["h"] <= a["h"] and b["l"] >= a["l"]
    return (rng_b < atr15 and body_b <= body_a) or wick_both or inside


def level_state(level: float, c15: list[dict], atr15: float, *, floor_atr: float = 0.25,
                abandon_atr: float = 1.0, max_candles: int = 4, lookback: int = 48,
                oi15: list[dict] | None = None) -> dict:
    """Assign one state from the table in the checklist to a level."""
    res = {"state": "DORMANT", "setup": None, "direction": None, "pen_atr": None,
           "candles_since_break": None, "trigger": None, "extreme": None,
           "oi_break_pct": None, "oi_reclaim_pct": None, "note": ""}
    if not c15 or not atr15:
        return res
    price = c15[-1]["c"]
    win = c15[-lookback:]
    n = len(win)

    def oi_pct(t0: int, t1: int) -> float | None:
        if not oi15:
            return None
        return pct_change(series_value_at(oi15, t0, "oi"), series_value_at(oi15, t1, "oi"))

    # Close-through crossings in the window. The side price started on is
    # "inside", so crossings alternate break, reclaim, break, reclaim...
    crossings = []
    for i in range(1, n):
        prev_c, cur_c = win[i - 1]["c"], win[i]["c"]
        if prev_c >= level > cur_c:
            crossings.append((i, "down"))
        elif prev_c <= level < cur_c:
            crossings.append((i, "up"))
    brk = None
    if crossings:
        ki = len(crossings) - 1 if (len(crossings) - 1) % 2 == 0 else len(crossings) - 2
        brk = crossings[ki]

    if brk:
        i, d = brk
        bc = win[i]
        pen = abs(bc["c"] - level) / atr15
        after = win[i + 1:]
        # the level side that price came from is "inside"
        back_inside = None
        for j, k in enumerate(after):
            if (d == "down" and k["c"] > level) or (d == "up" and k["c"] < level):
                back_inside = j
                break
        extreme_seg = win[i:i + 1 + (back_inside if back_inside is not None else len(after))]
        extreme = min(k["l"] for k in extreme_seg) if d == "down" else max(k["h"] for k in extreme_seg)
        max_close = max(abs(k["c"] - level) for k in extreme_seg if ((k["c"] < level) if d == "down" else (k["c"] > level))) / atr15
        pen = max(pen, max_close)  # a break can deepen after the break candle; judge recruitment by the deepest CLOSE
        res.update({"pen_atr": round(pen, 3), "extreme": extreme,
                    "direction": "Long" if d == "down" else "Short",
                    "setup": "Spring" if d == "down" else "Upthrust",
                    "oi_break_pct": oi_pct(win[i - 1]["t"], bc["t"])})
        candles_beyond = back_inside if back_inside is not None else len(after)
        res["candles_since_break"] = candles_beyond + 1

        # The window counts every close beyond, including the break candle
        # (the same count the journal's "candles to reclaim" field records).
        # A reclaim after more than max_candles closes beyond is a Failed
        # retest: the break held, then the retest closed back through.
        if back_inside is not None and candles_beyond + 1 > max_candles:
            k = after[back_inside]
            res.update({"state": "TRIGGERED" if back_inside == len(after) - 1 else "DEAD_TIMED_OUT",
                        "setup": "Failed retest",
                        "direction": "Long" if d == "down" else "Short",
                        "trigger": k["c"], "note": "Broken level held, then the retest closed back through."})
            if res["state"] != "TRIGGERED":
                res["note"] = "Retest reclaim happened earlier; window passed."
            return res
        if pen < floor_atr:
            res.update({"state": "DEAD_SHALLOW", "note": f"Penetration {pen:.2f} ATR is below the {floor_atr} floor: nobody recruited."})
            if back_inside is None:
                return res
        if max_close >= abandon_atr:
            res.update({"state": "DEAD_RAN", "note": f"Closed {max_close:.2f} ATR beyond: flag, not trap."})
            return res
        if back_inside is not None:
            k = after[back_inside]
            if res["state"] == "DEAD_SHALLOW":
                return res
            fresh = back_inside == len(after) - 1
            res.update({"state": "TRIGGERED" if fresh else "DORMANT",
                        "trigger": k["c"],
                        "oi_reclaim_pct": oi_pct(after[back_inside - 1]["t"] if back_inside else bc["t"], k["t"]),
                        "note": "Decisive close back inside: this is the entry candle." if fresh else "Reclaim happened earlier; trade window has passed."})
            return res
        if candles_beyond >= max_candles:
            res.update({"state": "DEAD_TIMED_OUT", "note": f"{candles_beyond} candles beyond with no reclaim: the break is real."})
            return res
        stall = _is_stall(win[i:], atr15)
        res.update({"state": "WATCH" if stall and candles_beyond >= 1 else "RECRUITING",
                    "trigger": level,
                    "note": ("Stall signature forming. Reclaim trigger: a close back "
                             + ("above " if d == "down" else "below ") + f"{level:g}.") if stall else
                            "Closed beyond inside the bracket. Check OI now; the clock is running."})
        return res

    # no close-through: wick tests and sweeps
    last4 = win[-4:]
    for k in reversed(last4):
        wick_below = k["l"] < level < k["c"] and k["o"] > level
        wick_above = k["h"] > level > k["c"] and k["o"] < level
        if wick_below or wick_above:
            pen = (level - k["l"]) / atr15 if wick_below else (k["h"] - level) / atr15
            fresh = k is win[-1]
            if pen >= floor_atr and fresh:
                res.update({"state": "TRIGGERED", "setup": "Sweep",
                            "direction": "Long" if wick_below else "Short",
                            "pen_atr": round(pen, 3), "extreme": k["l"] if wick_below else k["h"],
                            "trigger": k["c"], "candles_since_break": 1,
                            "note": "Single-candle sweep through the level closed back inside. Confirm OI dropped."})
            else:
                res.update({"state": "TESTED", "pen_atr": round(pen, 3),
                            "note": "Wick only, no close beyond. Not a break."})
            return res
    if abs(price - level) <= atr15:
        res.update({"state": "APPROACHING", "note": "Within 1 ATR. Put an alert on it."})
    return res


# --------------------------------------------------------------------------
# Regime, range context, gates
# --------------------------------------------------------------------------
def regime_4h(c4h: list[dict]) -> dict:
    if len(c4h) < 20:
        return {"regime": "unknown", "permitted": ["Long", "Short"], "detail": "Not enough 4h history."}
    hs, ls = pivots(c4h[-120:], 2, 2)
    closes = [k["c"] for k in c4h]
    e = ema(closes, 50)
    slope = (e[-1] - e[-7]) / e[-7] * 100 if len(e) > 7 and e[-7] else 0
    hh = len(hs) >= 2 and hs[-1][1] > hs[-2][1]
    hl = len(ls) >= 2 and ls[-1][1] > ls[-2][1]
    lh = len(hs) >= 2 and hs[-1][1] < hs[-2][1]
    ll = len(ls) >= 2 and ls[-1][1] < ls[-2][1]
    if hh and hl and slope > 0:
        return {"regime": "uptrend", "permitted": ["Long"], "detail": f"Higher high and higher low, 50 EMA rising {slope:.2f}% over 24h."}
    if lh and ll and slope < 0:
        return {"regime": "downtrend", "permitted": ["Short"], "detail": f"Lower high and lower low, 50 EMA falling {slope:.2f}% over 24h."}
    return {"regime": "range", "permitted": ["Long", "Short"], "detail": f"Mixed swing structure, 50 EMA slope {slope:.2f}% over 24h."}


def range_context(levels: list[dict], price: float, atr15: float) -> dict:
    """Nearest qualified (C1 >= 1) level on each side forms the working range."""
    q = [lv for lv in levels if lv["c1"] >= 1]
    above = sorted([lv for lv in q if lv["price"] > price], key=lambda x: x["price"])
    below = sorted([lv for lv in q if lv["price"] < price], key=lambda x: -x["price"])
    # a range boundary is the nearest level with 3+ rejection touches;
    # failing that, the nearest higher-timeframe level
    def pick(lst):
        for lv in lst:
            if "range" in lv["sources"]:
                return lv
        for lv in lst:
            if set(lv["sources"]) & {"4h", "1d", "1w"}:
                return lv
        return lst[0] if lst else None
    hi, lo = pick(above), pick(below)
    if not hi or not lo:
        return {"high": hi["price"] if hi else None, "low": lo["price"] if lo else None, "height": None,
                "height_atr": None, "position": None, "third": None}
    height = hi["price"] - lo["price"]
    pos = (price - lo["price"]) / height if height else None
    third = None if pos is None else ("lower" if pos < 1 / 3 else "upper" if pos > 2 / 3 else "middle")
    return {"high": hi["price"], "low": lo["price"], "height": height,
            "height_atr": height / atr15 if atr15 else None, "position": pos, "third": third}


def gates(range_height: float | None, stop_dist: float | None, price: float, atr15: float | None,
          taker_fee_pct: float, slip_pct: float, thin: bool, th: dict) -> dict:
    """Both gates with the arithmetic spelled out (never assert, show the math)."""
    out = {"range": None, "cost": None, "pass": False, "lines": []}
    if range_height and atr15:
        ratio_atr = range_height / atr15
        ok = ratio_atr >= th["range_atr_min"]
        line = f"Range {range_height:.6g} / ATR {atr15:.6g} = {ratio_atr:.2f}x (need >= {th['range_atr_min']:g}x)"
        ratio_stop = None
        if stop_dist:
            ratio_stop = range_height / stop_dist
            ok = ok and ratio_stop >= th["range_stop_min"]
            line += f"; range / stop {stop_dist:.6g} = {ratio_stop:.2f}x (need >= {th['range_stop_min']:g}x)"
        pct = range_height / price * 100 if price else 0
        if thin:
            ok = ok and pct >= th["thin_range_pct_min"]
            line += f"; width {pct:.2f}% of price (thin asset, need >= {th['thin_range_pct_min']:g}%)"
        out["range"] = {"ok": ok, "ratio_atr": ratio_atr, "ratio_stop": ratio_stop, "pct": pct}
        out["lines"].append(("PASS " if ok else "FAIL ") + line)
    if stop_dist and price:
        rt_pct = 2 * taker_fee_pct + 2 * slip_pct
        cost = price * rt_pct / 100
        share = cost / stop_dist * 100
        ok = share < th["cost_pct_of_risk_max"]
        out["cost"] = {"ok": ok, "round_trip_pct": rt_pct, "cost": cost, "share_pct": share}
        out["lines"].append(("PASS " if ok else "FAIL ") +
                            f"Cost: (2 x {taker_fee_pct:g}% fee + 2 x {slip_pct:g}% slippage) = {rt_pct:.3f}% of price = {cost:.6g}; "
                            f"{cost:.6g} / stop {stop_dist:.6g} = {share:.1f}% of risk (need < {th['cost_pct_of_risk_max']:g}%)")
    out["pass"] = bool(out["range"] and out["range"]["ok"] and out["cost"] and out["cost"]["ok"])
    return out


# --------------------------------------------------------------------------
# Price / volume / OI mechanism (the study guide's matrix)
# --------------------------------------------------------------------------
def classify_mechanism(price_chg_pct: float | None, rv: float | None, oi_chg_pct: float | None,
                       funding_pctile: float | None = None, range_pct: float | None = None,
                       broke_then_failed: bool = False) -> dict:
    """Name the mechanism per the guide's decision process. Thresholds are
    illustrative (the guide says percentiles beat universal thresholds)."""
    if price_chg_pct is None or oi_chg_pct is None:
        return {"name": "Indeterminate", "code": "none", "reading": "Not enough data.", "caution": ""}
    up = price_chg_pct > 0.3
    down = price_chg_pct < -0.3
    flat = not up and not down
    oi_up = oi_chg_pct > 1.0
    oi_dn = oi_chg_pct < -1.0
    vol_hi = (rv or 0) >= 1.3
    vol_lo = rv is not None and rv < 1.0
    crowd = ""
    if funding_pctile is not None:
        if funding_pctile >= 90:
            crowd = " Funding is in its top decile: longs are paying up (crowded)."
        elif funding_pctile <= 10:
            crowd = " Funding is in its bottom decile: shorts are paying up (crowded)."
    if broke_then_failed and oi_up:
        return {"name": "Failed breakout, trapped exposure", "code": "trap",
                "reading": "New exposure entered on the break and price rejected that entry area." + crowd,
                "caution": "The high-value event is the rejection, not the OI rise."}
    if flat and oi_up and vol_hi:
        return {"name": "Absorption / stalemate", "code": "absorb",
                "reading": "High effort, little result: a decision point." + crowd,
                "caution": "Does not reveal which side wins. Wait for acceptance or rejection."}
    if flat and oi_up:
        return {"name": "Leveraged coil", "code": "coil",
                "reading": "Leverage building without resolution. Predicts instability, not direction." + crowd,
                "caution": "Mark both boundaries; wait for a completed candle outside."}
    if up and oi_up:
        return {"name": "New-position advance", "code": "newlong",
                "reading": "New exposure entering during the advance." + crowd,
                "caution": "New shorts also exist; continuation needs acceptance above the level."}
    if up and oi_dn:
        return {"name": "Short covering", "code": "squeeze",
                "reading": "Exposure being removed on the rally: shorts closing." + crowd,
                "caution": "Much of the forced-buying fuel may already be spent. Don't chase."}
    if down and oi_up:
        return {"name": "New-position decline", "code": "newshort",
                "reading": "New exposure entering during the decline." + crowd,
                "caution": "Could include trapped longs as well as new shorts."}
    if down and oi_dn:
        return {"name": "Long liquidation", "code": "flush",
                "reading": "Exposure destroyed on the decline: longs closing or liquidated." + crowd,
                "caution": "An OI collapse proves leverage left, not that price bottomed. Wait for a reclaim."}
    if flat and oi_dn:
        return {"name": "Quiet deleveraging", "code": "delever",
                "reading": "Participation fading." + crowd, "caution": "Tends to produce low-quality signals."}
    return {"name": "Churn", "code": "churn", "reading": "Volume without meaningful net exposure change." + crowd,
            "caution": "No mechanism to trade."}


def creation_ratio(d_oi: float | None, volume: float | None) -> float | None:
    if d_oi is None or not volume:
        return None
    return d_oi / volume


def summarize_symbol(c15: list[dict], oi15: list[dict], horizon: int = 4) -> dict:
    """Price, volume and OI change over the last `horizon` closed 15m candles."""
    if len(c15) < horizon + 1:
        return {}
    a, b = c15[-horizon - 1], c15[-1]
    p = pct_change(a["c"], b["c"])
    vol = sum(k["v"] for k in c15[-horizon:])
    oi_a = series_value_at(oi15, a["t"], "oi") if oi15 else None
    oi_b = series_value_at(oi15, b["t"], "oi") if oi15 else None
    d_oi = (oi_b - oi_a) if (oi_a is not None and oi_b is not None) else None
    hi = max(k["h"] for k in c15[-horizon:])
    lo = min(k["l"] for k in c15[-horizon:])
    return {"price_chg_pct": p, "oi_chg_pct": pct_change(oi_a, oi_b), "d_oi": d_oi, "volume": vol,
            "creation_ratio": creation_ratio(d_oi, vol), "range_pct": (hi - lo) / b["c"] * 100 if b["c"] else None}
