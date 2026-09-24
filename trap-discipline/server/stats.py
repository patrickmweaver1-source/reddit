"""Dashboard metrics and the Diagnostics tables, mirroring the Trap Journal
workbook formulas, plus a few views the workbook cannot show."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from statistics import mean, median


def _taken_scored(trades: list[dict]) -> list[dict]:
    return [t for t in trades if t.get("taken", 1) and t.get("r") is not None]


def _hour(t: dict) -> int | None:
    if t.get("time_utc"):
        try:
            return int(str(t["time_utc"])[:2])
        except ValueError:
            return None
    if t.get("opened_at"):
        return datetime.fromtimestamp(t["opened_at"] / 1000, tz=timezone.utc).hour
    return None


def bucket(rows: list[dict]) -> dict:
    n = len(rows)
    return {"n": n,
            "avg_r": mean(r["r"] for r in rows) if n else 0.0,
            "net": sum(r.get("net_pnl") or 0 for r in rows),
            "win_rate": (sum(1 for r in rows if r["r"] > 0) / n) if n else 0.0}


def kpis(trades: list[dict], starting_equity: float) -> dict:
    s = _taken_scored(trades)
    taken_all = [t for t in trades if t.get("taken", 1) and t.get("status") != "skipped"]
    n = len(s)
    wins = [t for t in s if t["r"] > 0]
    gross_win = sum(t.get("net_pnl") or 0 for t in s if (t.get("net_pnl") or 0) > 0)
    gross_loss = -sum(t.get("net_pnl") or 0 for t in s if (t.get("net_pnl") or 0) < 0)
    lev = [t["leverage"] for t in taken_all if t.get("leverage")]
    adher = sum(1 for t in s if t.get("followed_plan") == "Yes")
    return {
        "expectancy_r": mean(t["r"] for t in s) if n else 0.0,
        "net_pnl": sum(t.get("net_pnl") or 0 for t in taken_all),
        "win_rate": len(wins) / n if n else 0.0,
        "profit_factor": (gross_win / gross_loss) if gross_loss else None,
        "rule_adherence": adher / n if n else 0.0,
        "trades_taken": n,
        "skipped": sum(1 for t in trades if not t.get("taken", 1)),
        "avg_leverage": mean(lev) if lev else 0.0,
        "liq_buffer_lt3": sum(1 for t in taken_all if t.get("liq_buffer") is not None and 0 < t["liq_buffer"] < 3),
        "to_30": max(0, 30 - n),
        "avg_win_r": mean(t["r"] for t in wins) if wins else 0.0,
        "avg_loss_r": mean(t["r"] for t in s if t["r"] <= 0) if n - len(wins) else 0.0,
        "median_r": median(t["r"] for t in s) if n else 0.0,
        "best_r": max((t["r"] for t in s), default=0.0),
        "worst_r": min((t["r"] for t in s), default=0.0),
        "equity": starting_equity + sum(t.get("net_pnl") or 0 for t in taken_all),
        "fees": sum(t.get("fees") or 0 for t in taken_all),
        "funding": sum(t.get("funding") or 0 for t in taken_all),
    }


def equity_curve(trades: list[dict], starting_equity: float) -> list[dict]:
    s = sorted([t for t in trades if t.get("taken", 1) and t.get("net_pnl") is not None],
               key=lambda t: t.get("closed_at") or t.get("opened_at") or 0)
    eq = starting_equity
    cum_r = 0.0
    peak = eq
    out = [{"i": 0, "t": None, "equity": eq, "cum_r": 0.0, "dd": 0.0}]
    for i, t in enumerate(s, start=1):
        eq += t["net_pnl"]
        cum_r += t.get("r") or 0
        peak = max(peak, eq)
        out.append({"i": i, "t": t.get("closed_at") or t.get("opened_at"), "equity": eq, "cum_r": cum_r,
                    "dd": (eq - peak) / peak * 100 if peak else 0, "id": t.get("id"), "symbol": t.get("symbol"),
                    "r": t.get("r")})
    return out


def diagnostics(trades: list[dict], th: dict) -> dict:
    s = _taken_scored(trades)
    grade = {g: bucket([t for t in s if t.get("grade") == g]) for g in "ABCD"}
    setups = {}
    for name in ("Spring", "Upthrust", "Sweep", "Failed retest"):
        setups[name] = bucket([t for t in s if t.get("setup") == name])
    h0, h1 = th["thin_hours_start_utc"], th["thin_hours_end_utc"]
    thin = [t for t in s if _hour(t) is not None and h0 <= _hour(t) < h1]
    other = [t for t in s if _hour(t) is not None and not (h0 <= _hour(t) < h1)]
    # bucket edges come from the LIVE rulebook, so a monthly-review change
    # re-cuts the diagnostics the moment it is saved
    floor = th.get("pen_floor_atr", 0.25)
    ab = th.get("pen_abandon_atr", 1.0)
    mid = 0.6 if floor < 0.6 < ab else round((floor + ab) / 2, 2)
    pen_rows = [t for t in s if t.get("pen_atr") is not None]
    pen = {
        f"Under {floor:g} ATR": bucket([t for t in pen_rows if t["pen_atr"] < floor]),
        f"{floor:g} to {mid:g}": bucket([t for t in pen_rows if floor <= t["pen_atr"] < mid]),
        f"{mid:g} to {ab:g}": bucket([t for t in pen_rows if mid <= t["pen_atr"] < ab]),
        f"Over {ab:g} ATR": bucket([t for t in pen_rows if t["pen_atr"] >= ab]),
    }
    wmin = int(th.get("window_min_candles", 2))
    wmax = int(th.get("window_max_candles", 4))
    cr = [t for t in s if t.get("candles_to_reclaim") is not None]
    candles = {
        f"1 to {wmin} candles": bucket([t for t in cr if 1 <= t["candles_to_reclaim"] <= wmin]),
        f"{wmin + 1} to {wmax} candles": bucket([t for t in cr if wmin < t["candles_to_reclaim"] <= wmax]),
        f"{wmax + 1} or more": bucket([t for t in cr if t["candles_to_reclaim"] > wmax]),
    }
    oi = {"OI confirmed": bucket([t for t in s if t.get("oi_confirmed") == "Yes"]),
          "Not confirmed": bucket([t for t in s if t.get("oi_confirmed") == "No"])}
    symbols = defaultdict(list)
    for t in s:
        symbols[t["symbol"]].append(t)
    sym = {k: bucket(v) for k, v in sorted(symbols.items())}
    direction = {d: bucket([t for t in s if t.get("direction") == d]) for d in ("Long", "Short")}
    plan = {"Followed plan": bucket([t for t in s if t.get("followed_plan") == "Yes"]),
            "Broke plan": bucket([t for t in s if t.get("followed_plan") == "No"])}
    mech = defaultdict(list)
    for t in s:
        name = (t.get("context") or {}).get("mechanism")
        if name:
            mech[name].append(t)
    mechanism = {k: bucket(v) for k, v in sorted(mech.items(), key=lambda kv: -len(kv[1]))}
    n_ctx = sum(len(v) for v in mech.values())

    # verdicts (only meaningful with enough trades)
    def ladder_verdict():
        vals = [(g, grade[g]) for g in "ABCD" if grade[g]["n"] >= 3]
        if len(vals) < 2:
            return "Need at least 3 trades in two grades."
        avgs = [b["avg_r"] for _, b in vals]
        return "Clean descending ladder: the grade means something." if all(avgs[i] >= avgs[i + 1] for i in range(len(avgs) - 1)) else "Ladder is not descending: the rubric may be measuring nothing."
    verdicts = {
        "grade": ladder_verdict(),
        "setup": "Below 10 trades per setup this is noise." if max((b["n"] for b in setups.values()), default=0) < 10 else "Trade the setups that carry the book; stop the ones that don't.",
        "thin": ("Thin hours are negative: block the window outright." if bucket(thin)["n"] >= 3 and bucket(thin)["avg_r"] < 0 else
                 "Not enough thin-hour trades yet." if bucket(thin)["n"] < 3 else "Thin hours are not costing you (yet)."),
        "pen": "If losers cluster below 0.25, raise the floor. If winners appear above 1.0, widen it.",
        "candles": "If winners cluster at 1 to 3 candles, tighten the window. If they appear at 5 plus, widen it.",
    }
    return {"grade": grade, "setup": setups, "thin": {"Thin hours": bucket(thin), "All other hours": bucket(other)},
            "pen": pen, "candles": candles, "oi": oi, "symbol": sym, "direction": direction, "plan": plan,
            "mechanism": mechanism, "n_with_context": n_ctx, "verdicts": verdicts, "n": len(s),
            "edges": {"pen_floor": floor, "pen_mid": mid, "pen_abandon": ab, "window_min": wmin, "window_max": wmax}}


def r_histogram(trades: list[dict], width: float = 0.5) -> list[dict]:
    s = _taken_scored(trades)
    if not s:
        return []
    lo = min(-3.0, min(t["r"] for t in s))
    hi = max(3.0, max(t["r"] for t in s))
    import math
    start = math.floor(lo / width) * width
    bins = []
    x = start
    while x < hi + 1e-9:
        n = sum(1 for t in s if x <= t["r"] < x + width)
        bins.append({"from": round(x, 3), "to": round(x + width, 3), "n": n})
        x += width
    return bins


def calendar(trades: list[dict]) -> list[dict]:
    days: dict[str, dict] = {}
    for t in trades:
        ts = t.get("closed_at") or t.get("opened_at") or t.get("created_at")
        if not ts:
            continue
        d = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        e = days.setdefault(d, {"day": d, "n": 0, "r": 0.0, "net": 0.0, "skipped": 0, "clean": 0})
        if not t.get("taken", 1):
            e["skipped"] += 1
            continue
        e["n"] += 1
        e["r"] += t.get("r") or 0
        e["net"] += t.get("net_pnl") or 0
        if t.get("followed_plan") == "Yes":
            e["clean"] += 1
    return sorted(days.values(), key=lambda x: x["day"])


def process_outcome_matrix(trades: list[dict]) -> dict:
    s = _taken_scored(trades)
    m = {"good_win": 0, "good_loss": 0, "bad_win": 0, "bad_loss": 0}
    for t in s:
        good = t.get("followed_plan") == "Yes"
        win = t["r"] > 0
        m[("good" if good else "bad") + "_" + ("win" if win else "loss")] += 1
    return m


def violation_counts(trades: list[dict]) -> list[dict]:
    c: dict = defaultdict(lambda: {"n": 0, "r_cost": 0.0})
    for t in trades:
        for v in t.get("violations") or []:
            if v.get("dismissed"):
                continue
            key = (v.get("rule"), v.get("code"))
            c[key]["n"] += 1
            if t.get("r") is not None and t["r"] < 0:
                c[key]["r_cost"] += t["r"]
    out = [{"rule": k[0], "code": k[1], **val} for k, val in c.items()]
    out.sort(key=lambda x: -x["n"])
    return out
