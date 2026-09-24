"""Cross-coin co-movement: does one watchlist coin tend to move with (or
against) another, and does it lag behind?

Pure market-data statistics -- no trade history involved, so nothing here
needs the AI-packet privacy filtering that server/learning.py's trader
profile gets. Uses only the 15-minute candles already held in memory by
server/market.py (SymbolData.c["15"]); makes no extra Bybit calls.

Same house rule as the rest of the app (liquidation heatmap, edge profile,
weekly review): never present a number as a measured pattern unless there
is enough evidence behind it. Scanning many lags across many coin pairs is
a multiple-comparisons problem -- checking 25 lags on each of up to 28
pairs (an 8-coin watchlist) is 700 tests, and picking whichever one looks
best by chance will "find" fake patterns unless the bar for significance
is set high enough to survive that many tries, and unless each result is
also backed by a real minimum amount of data.
"""
from __future__ import annotations

import json
import math
from collections import Counter
from datetime import datetime, timezone

from .db import now_ms

CANDLE_MS = 15 * 60_000
MAX_LAG_CANDLES = 12               # +/- 3 hours
MIN_SAMPLES = 200                  # aligned 15m candle pairs (~50 hours); below this, say nothing
Z_THRESHOLD = 4.0                  # Fisher-z score; conservative enough to survive ~700 tests
                                    # on an 8-coin watchlist (roughly a Bonferroni-corrected p < .001)

# Lead-lag beyond common-market movement. Two crypto coins nearly always move
# together (shared market beta), so a raw corr(BTC_t, ALT_t+lag) will look
# "predictive" even when nothing leads anything - it is just measuring that
# they co-move. To find a REAL lead-lag we fit, for a candidate leader L and
# follower F at lag k:  F_t = a + b0*L_t + b1*L_{t-k} + e, and ask whether the
# lagged term b1 adds out-of-sample predictive power ON TOP of the
# contemporaneous term b0. It is judged by walk-forward validation (fit on the
# past, test on the next block, roll forward), never one global in-sample fit,
# so a relationship has to keep working through time to be reported.
WALK_FOLDS = 5                     # rolling out-of-sample blocks
MIN_INCR_R2 = 0.01                 # min out-of-sample variance the lag term must add beyond contemporaneous
CONTEMP_R = 0.5                    # |contemporaneous correlation| worth reporting on its own

SNAPSHOT_KEY = "cov_snapshot_last_day"
SNAPSHOT_KEEP = 120                 # ~4 months of daily snapshots; bounds table growth
MIN_CHECKS_FOR_TREND = 5            # daily snapshots needed before calling a track record established


def returns(candles: list[dict]) -> dict[int, float]:
    """{candle open time (ms): close-to-close % return}. Needs the candle's
    own close and the prior candle's close, so the first candle in the list
    contributes no return."""
    out: dict[int, float] = {}
    prev_c = None
    for row in candles:
        c = row.get("c")
        t = row.get("t")
        if c is None or t is None:
            continue
        if prev_c is not None and prev_c != 0:
            out[int(t)] = (c - prev_c) / prev_c
        prev_c = c
    return out


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 3:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 0 or syy <= 0:
        return None
    return sxy / math.sqrt(sxx * syy)


def _fisher_z(r: float, n: int) -> float | None:
    """Fisher z-transform significance score: how many standard errors r is
    from zero, correcting for the fact that r's own sampling distribution
    isn't normal. Larger |z| = less likely to be chance."""
    if n < 4:
        return None
    r = max(-0.999999, min(0.999999, r))  # clamp: atanh is undefined at +/-1, which
                                           # floating-point rounding can otherwise hit
    return math.atanh(r) * math.sqrt(n - 3)


def _aligned(ra: dict[int, float], rb: dict[int, float], lag_candles: int) -> tuple[list[float], list[float]]:
    """Pairs (a's return at t, b's return at t + lag). lag_candles > 0 means
    b's move is being compared to a's move from `lag_candles` earlier -- i.e.
    testing whether b follows a."""
    shift = lag_candles * CANDLE_MS
    xs: list[float] = []
    ys: list[float] = []
    for t, ra_v in ra.items():
        rb_v = rb.get(t + shift)
        if rb_v is not None:
            xs.append(ra_v)
            ys.append(rb_v)
    return xs, ys


def best_lag(ra: dict[int, float], rb: dict[int, float]) -> dict | None:
    """Scans lags from -MAX_LAG_CANDLES to +MAX_LAG_CANDLES and returns the
    one with the strongest correlation, but only if it has enough aligned
    samples and clears the significance bar. None means: nothing here is
    solid enough to report, not that there is no relationship."""
    best = None
    for lag in range(-MAX_LAG_CANDLES, MAX_LAG_CANDLES + 1):
        xs, ys = _aligned(ra, rb, lag)
        n = len(xs)
        if n < MIN_SAMPLES:
            continue
        r = _pearson(xs, ys)
        if r is None:
            continue
        z = _fisher_z(r, n)
        if z is None:
            continue
        if best is None or abs(r) > abs(best["r"]):
            best = {"lag": lag, "r": r, "n": n, "z": z}
    if best is None or abs(best["z"]) < Z_THRESHOLD:
        return None
    return best


def _solve(a: list[list[float]], b: list[float]) -> list[float] | None:
    """Gaussian elimination for a small symmetric normal-equations system
    (X'X) x = X'y. Returns None if singular."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[piv][col]) < 1e-12:
            return None
        m[col], m[piv] = m[piv], m[col]
        for r in range(n):
            if r == col:
                continue
            f = m[r][col] / m[col][col]
            for c in range(col, n + 1):
                m[r][c] -= f * m[col][c]
    return [m[i][n] / m[i][i] for i in range(n)]


def _ols(rows: list[list[float]], y: list[float]) -> list[float] | None:
    """Ordinary least squares. rows are feature vectors (intercept included as a
    leading 1.0). Returns coefficients, or None if the system is singular."""
    k = len(rows[0])
    xtx = [[0.0] * k for _ in range(k)]
    xty = [0.0] * k
    for row, yi in zip(rows, y):
        for i in range(k):
            xty[i] += row[i] * yi
            for j in range(k):
                xtx[i][j] += row[i] * row[j]
    return _solve(xtx, xty)


def _predict(row: list[float], coef: list[float]) -> float:
    return sum(a * b for a, b in zip(row, coef))


def _design(leader: dict[int, float], follower: dict[int, float], lag: int) -> tuple[list[list[float]], list[float]]:
    """Aligned rows [1, L_t, L_{t-k}] and targets F_t over every timestamp where
    all three exist."""
    shift = lag * CANDLE_MS
    X, y = [], []
    for t, f in follower.items():
        lt = leader.get(t)
        lk = leader.get(t - shift)
        if lt is not None and lk is not None:
            X.append([1.0, lt, lk])
            y.append(f)
    return X, y


def incremental_leadlag(leader: dict[int, float], follower: dict[int, float], lag: int) -> dict | None:
    """Walk-forward test of whether leader's move `lag` candles ago helps predict
    follower's move now, BEYOND the leader's contemporaneous move. Returns the
    out-of-sample variance the lag term adds (incr_r2) and how many folds it
    helped in, or None if there isn't enough aligned data."""
    X, y = _design(leader, follower, lag)
    n = len(X)
    if n < MIN_SAMPLES:
        return None
    fold = n // WALK_FOLDS
    if fold < 30:
        return None
    sse0 = sse1 = tot = 0.0
    improved = 0
    ybar_all = sum(y) / n
    for i in range(1, WALK_FOLDS):
        tr_hi = i * fold
        te_lo, te_hi = tr_hi, (i + 1) * fold if i < WALK_FOLDS - 1 else n
        Xtr, ytr = X[:tr_hi], y[:tr_hi]
        Xte, yte = X[te_lo:te_hi], y[te_lo:te_hi]
        if len(Xte) < 10:
            continue
        c1 = _ols(Xtr, ytr)                                   # full: const + L_t + L_{t-k}
        c0 = _ols([[r[0], r[1]] for r in Xtr], ytr)          # contemporaneous only: const + L_t
        if c1 is None or c0 is None:
            continue
        e1 = sum((yi - _predict(r, c1)) ** 2 for r, yi in zip(Xte, yte))
        e0 = sum((yi - _predict([r[0], r[1]], c0)) ** 2 for r, yi in zip(Xte, yte))
        sse1 += e1
        sse0 += e0
        tot += sum((yi - ybar_all) ** 2 for yi in yte)
        if e1 < e0:
            improved += 1
    if sse0 <= 0 or tot <= 0:
        return None
    incr_r2 = (sse0 - sse1) / tot          # extra out-of-sample variance explained by the lag term
    return {"lag": lag, "incr_r2": round(incr_r2, 4), "folds_improved": improved, "folds": WALK_FOLDS - 1, "n": n}


def best_leadlag(leader: dict[int, float], follower: dict[int, float]) -> dict | None:
    """The lag (>=1) at which leader most helps predict follower out of sample,
    if any clears the bar and helped in a majority of walk-forward folds."""
    best = None
    for lag in range(1, MAX_LAG_CANDLES + 1):
        res = incremental_leadlag(leader, follower, lag)
        if res is None:
            continue
        if res["incr_r2"] < MIN_INCR_R2 or res["folds_improved"] * 2 < res["folds"]:
            continue
        if best is None or res["incr_r2"] > best["incr_r2"]:
            best = res
    return best


def _contemporaneous(ra: dict[int, float], rb: dict[int, float]) -> tuple[float | None, int]:
    xs, ys = _aligned(ra, rb, 0)
    return _pearson(xs, ys), len(xs)


def _sentence(a: str, b: str, contemp_r: float | None, lead: dict | None) -> str:
    same = (contemp_r or 0) > 0
    move = "the same direction" if same else "the opposite direction"
    if lead:
        leader, follower = lead["leader"], lead["follower"]
        n = lead["lag"]
        hrs = f"{n * 15 / 60:g}h"
        base = (f"{follower} tends to follow {leader} by about {n} x 15-minute candle{'s' if n != 1 else ''} (~{hrs}), "
                f"beyond just moving with it")
        if contemp_r is not None and abs(contemp_r) >= CONTEMP_R:
            base += f" (they also move in {move} at the same time, correlation {round(contemp_r, 2)})."
        else:
            base += "."
        return base
    return (f"{a} and {b} move in {move} at the same time (correlation {round(contemp_r, 2)}), "
            f"but no reliable lead or lag beyond that: neither leads the other out of sample.")


def analyze(watchlist_candles: dict[str, list[dict]]) -> dict:
    """watchlist_candles: {symbol: 15m candle list, as stored in
    MarketEngine.sd(symbol).c["15"]}. For each pair, report the contemporaneous
    co-movement AND, separately, any genuine lead-lag that adds out-of-sample
    predictive power beyond that co-movement (walk-forward validated). Strongest
    first."""
    rmap = {sym: returns(candles) for sym, candles in watchlist_candles.items()}
    syms = sorted(rmap)
    pairs = []
    for i in range(len(syms)):
        for j in range(i + 1, len(syms)):
            a, b = syms[i], syms[j]
            contemp_r, n = _contemporaneous(rmap[a], rmap[b])
            if contemp_r is None or n < MIN_SAMPLES:
                continue
            # test both directions for a real lead-lag beyond common movement
            ab = best_leadlag(rmap[a], rmap[b])          # a leads b
            ba = best_leadlag(rmap[b], rmap[a])          # b leads a
            lead = None
            cand = [(ab, a, b), (ba, b, a)]
            best = max((c for c in cand if c[0]), key=lambda c: c[0]["incr_r2"], default=None)
            if best:
                r0, leader, follower = best
                lead = {"leader": leader, "follower": follower, "lag": r0["lag"],
                        "incr_r2": r0["incr_r2"], "folds_improved": r0["folds_improved"], "folds": r0["folds"]}
            strong_contemp = abs(contemp_r) >= CONTEMP_R
            if not lead and not strong_contemp:
                continue                                  # nothing worth reporting for this pair
            pairs.append({
                "a": a, "b": b, "r": round(contemp_r, 3), "n": n,
                "direction": "same" if contemp_r > 0 else "opposite",
                "lag_candles": lead["lag"] if lead else 0,
                "lead_lag": lead,
                "text": _sentence(a, b, contemp_r, lead),
            })
    # lead-lag findings first (they are rarer and more actionable), then by co-movement strength
    pairs.sort(key=lambda p: (p["lead_lag"] is None, -(p["lead_lag"]["incr_r2"] if p["lead_lag"] else 0), -abs(p["r"])))
    return {
        "pairs": pairs,
        "min_samples": MIN_SAMPLES,
        "max_lag_candles": MAX_LAG_CANDLES,
        "contemp_r": CONTEMP_R,
        "min_incr_r2": MIN_INCR_R2,
        "walk_folds": WALK_FOLDS,
        "symbols_checked": syms,
    }


# ---------------------------------------------------------------- tracking over time
# analyze() only ever looks at whatever candles are in memory right now (up to
# ~15.6 days, the cap MarketEngine keeps per symbol), so on its own it can only
# ever say what the last couple of weeks show. To say whether a relationship
# has actually been reliable rather than a short-lived coincidence, the app
# saves one snapshot of analyze()'s result per day and compares them over time.

def _day(now: int | None = None) -> str:
    return datetime.fromtimestamp((now or now_ms()) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def due_for_snapshot(db, now: int | None = None) -> bool:
    """At most one snapshot per UTC day, regardless of how often this is checked."""
    return db.get(SNAPSHOT_KEY) != _day(now)


def save_snapshot(db, result: dict, now: int | None = None) -> None:
    now = now or now_ms()
    day = _day(now)
    db.execute("INSERT INTO comovement_snapshots(ts, day, data) VALUES(?,?,?)", (now, day, json.dumps(result)))
    db.set(SNAPSHOT_KEY, day)
    db.execute("DELETE FROM comovement_snapshots WHERE id NOT IN "
               "(SELECT id FROM comovement_snapshots ORDER BY ts DESC LIMIT ?)", (SNAPSHOT_KEEP,))


def recent_snapshots(db, limit: int = SNAPSHOT_KEEP) -> list[dict]:
    rows = db.query("SELECT ts, day, data FROM comovement_snapshots ORDER BY ts DESC LIMIT ?", (limit,))
    out = []
    for row in rows:
        d = json.loads(row["data"])
        d["ts"] = row["ts"]
        d["day"] = row["day"]
        out.append(d)
    return out


def stability(snapshots: list[dict]) -> dict:
    """For every pair that showed up in at least one daily snapshot: how many
    of the snapshots checked it, in how many of those it actually cleared the
    significance bar that day, and -- among the days it did -- how often the
    direction and the lag agreed with each other. A pair that only shows up
    once or twice, or whose lag/direction keeps flipping, is not a reliable
    pattern yet, whatever any single day's number looks like."""
    checks = len(snapshots)
    hits: dict[tuple[str, str], list[dict]] = {}
    for snap in snapshots:
        for p in snap.get("pairs") or []:
            hits.setdefault((p["a"], p["b"]), []).append(p)
    out = []
    for (a, b), rows in hits.items():
        n = len(rows)
        dirs = Counter(r["direction"] for r in rows)
        common_dir, dir_n = dirs.most_common(1)[0]
        lags = Counter(r["lag_candles"] for r in rows)
        common_lag, lag_n = lags.most_common(1)[0]
        out.append({
            "a": a, "b": b, "checks": checks, "hits": n,
            "hit_rate": round(n / checks, 2) if checks else 0.0,
            "direction": common_dir, "direction_agreement": round(dir_n / n, 2),
            "lag_candles": common_lag, "lag_agreement": round(lag_n / n, 2),
            "avg_r": round(sum(r["r"] for r in rows) / n, 3),
            "established": checks >= MIN_CHECKS_FOR_TREND and n >= MIN_CHECKS_FOR_TREND,
        })
    out.sort(key=lambda x: (-x["hit_rate"], -abs(x["avg_r"])))
    return {"checks": checks, "min_checks_for_trend": MIN_CHECKS_FOR_TREND, "pairs": out}
