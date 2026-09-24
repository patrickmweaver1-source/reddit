"""Learning: the app checks its own calls and learns your patterns.

Four parts, all computed on this laptop:

1. Report card. Every AI scan and every checklist verdict is written to the
   `calls` ledger with the entry, stop and direction the app worked out. After
   the fact, the app replays the 15-minute candles that followed and scores
   the call the playbook way (the same as the auto-tuner): +2R target, -1R
   stop, or the mark after 8 hours, net of fees and slippage. Calls that
   needed a reclaim that never came count as "never triggered". So the app
   learns whether "TRADEABLE NOW" really was, and whether "NO TRADE" saved
   you money.

2. Edge profile. Your closed trades, grouped by setup, coin, session, grade,
   side, trend alignment and rule breaks. A group is only called a leak or an
   edge when there's enough evidence: at least MIN_WARN trades, an average
   pulled toward zero for small samples, and a result that stays on the same
   side of zero after allowing for noise.

3. Lessons. When the checklist or AI scan looks at a setup that matches a
   leak or an edge, it says so plainly.

4. Weekly review, with proposals. A proposal can only make the rules
   STRICTER (block a pattern that keeps losing). Nothing applies until you
   approve it, and any block can be removed.

Option B (Pat's choice, 2026-09-23): the AI scan also receives a short text
summary of these patterns, in R multiples and counts only. It never gets
balances, sizes, dollar amounts, prices you traded at, dates, or a trade list.
"""
from __future__ import annotations

import json
import logging
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from .config import SETUP_NAMES
from .db import now_ms

log = logging.getLogger("trap.learning")

Q15 = 15 * 60_000
HOLD_MS = 8 * 60 * 60_000          # same exit clock as the auto-tuner
FILL_MS = 2 * 60 * 60_000          # a WATCH/NO TRADE call has 2 hours to trigger
TARGET_R = 2.0
MIN_WARN = 8                       # trades before a pattern is even an observation
MIN_CANDIDATE = 12                 # trades before a pattern can be promoted to a candidate
MIN_PROPOSE = 12                   # trades before the review proposes a block
SHRINK_K = 10                      # small samples are pulled toward zero by n / (n + K)
LEAK_R = -0.15
EDGE_R = 0.15
FDR_Q = 0.10                       # Benjamini-Hochberg false-discovery-rate target across buckets tested
CAND_Z = 1.96                      # candidate needs a ~95% CI (avg +/- z*se) that clears zero

# Three tiers of evidence, weakest to strongest, so the app never calls a
# handful of trades a proven edge:
#   observation - enough trades to notice (>= MIN_WARN), shrunk past the leak/
#                 edge line, and avg +/- 1 SE on one side of zero. Descriptive
#                 only: an early signal, fine for temporary caution.
#   candidate   - an observation that ALSO has a materially larger sample
#                 (>= MIN_CANDIDATE), a ~95% CI clear of zero, and survives a
#                 Benjamini-Hochberg correction across every bucket tested this
#                 pass (so it isn't just the best of many lucky draws).
#   validated   - a candidate that was frozen when first seen and then held up
#                 on trades set aside AFTER discovery (the Prospective Edge
#                 Registry). Only this tier should drive a lasting rule block.
TIER_OBSERVATION, TIER_CANDIDATE, TIER_VALIDATED = "observation", "candidate", "validated"
TIER_RANK = {None: 0, TIER_OBSERVATION: 1, TIER_CANDIDATE: 2, TIER_VALIDATED: 3}

POSITIVE_CALLS = ("TRADEABLE NOW", "GO")
SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}$")
SESSIONS = (("Asia", 0, 8), ("Europe", 8, 13), ("US", 13, 21), ("Late US", 21, 24))


# ---------------------------------------------------------------- scoring one call
def cost_pct(fee_pct: float, slip_pct: float) -> float:
    """Round-trip fees plus slippage, in percent of price."""
    return 2 * fee_pct + 2 * slip_pct


def cost_r(entry: float, stop: float, fee_pct: float, slip_pct: float) -> float:
    """The same cost in R for a given entry and stop."""
    risk = abs(entry - stop)
    if not risk or not entry:
        return 0.0
    return cost_pct(fee_pct, slip_pct) / 100 * entry / risk


def contiguous(bars: list[dict]) -> bool:
    return all(b["t"] - a["t"] == Q15 for a, b in zip(bars, bars[1:]))


def simulate(candles: list[dict], direction: str, entry: float, stop: float, t0: int, *,
             needs_fill: bool, cost_pct: float = 0.0, target_r: float = TARGET_R, need_until: int | None = None) -> dict:
    """Play one call forward on 15m candles (``t`` is each candle's OPEN time).

    Honest by construction:
    - only candles that OPEN at or after the call are used (nothing from before it);
    - an already-triggered call enters at ``entry`` (the price when the call was made);
    - a call waiting for a reclaim fills only on a candle CLOSE through ``entry``, at that
      close, and a wick through the stop before the fill voids it ("invalidated");
    - the fill candle can't hit the stop or target (the entry happens at its close);
    - a candle that touches both stop and target counts as the stop;
    - a gap in the candles returns "gap" instead of guessing.
    ``cost_pct`` is round-trip fees plus slippage in percent of price.
    Returns {"outcome": target|stop|timeout|no_fill|invalidated|gap|pending|void, "r": float|None}."""
    if not entry or not stop or entry == stop or direction not in ("Long", "Short"):
        return {"outcome": "void", "r": None}
    long = direction == "Long"
    first = t0 - t0 % Q15 + (Q15 if t0 % Q15 else 0)         # first candle that opens at/after the call
    bars = sorted((c for c in candles if c["t"] >= first), key=lambda c: c["t"])
    if bars and bars[0]["t"] != first:
        return {"outcome": "gap", "r": None}
    if not contiguous(bars):
        return {"outcome": "gap", "r": None}
    fill_px = None if needs_fill else entry
    filled_at = None if needs_fill else first
    risk = abs(entry - stop)
    target = None
    for c in bars:
        close_t = c["t"] + Q15
        if fill_px is None:
            if close_t - t0 > FILL_MS:
                return {"outcome": "no_fill", "r": None}
            if (long and c["l"] <= stop) or (not long and c["h"] >= stop):
                return {"outcome": "invalidated", "r": None}     # the level broke before it was reclaimed
            if (long and c["c"] >= entry) or (not long and c["c"] <= entry):
                fill_px, filled_at = c["c"], close_t
                risk = abs(fill_px - stop)
                if not risk or (long and fill_px <= stop) or (not long and fill_px >= stop):
                    return {"outcome": "void", "r": None}
            continue
        if target is None:
            target = fill_px + target_r * risk if long else fill_px - target_r * risk
        cost = (cost_pct / 100) * fill_px / risk
        hit_stop = c["l"] <= stop if long else c["h"] >= stop
        hit_tgt = c["h"] >= target if long else c["l"] <= target
        if hit_stop:
            return {"outcome": "stop", "r": round(-1.0 - cost, 3)}
        if hit_tgt:
            return {"outcome": "target", "r": round(target_r - cost, 3)}
        if close_t - filled_at >= HOLD_MS:
            mark = (c["c"] - fill_px) / risk if long else (fill_px - c["c"]) / risk
            return {"outcome": "timeout", "r": round(mark - cost, 3)}
    if fill_px is None and bars and bars[-1]["t"] + Q15 - t0 > FILL_MS:
        return {"outcome": "no_fill", "r": None}
    if need_until and (not bars or bars[-1]["t"] + Q15 < need_until):
        return {"outcome": "gap" if bars else "pending", "r": None}
    return {"outcome": "pending", "r": None}


# ---------------------------------------------------------------- recording calls
def record(db, *, source: str, ref: str | None, symbol: str, verdict: str, direction: str | None,
           setup: str | None, grade: str | None, entry: float | None, stop: float | None,
           needs_fill: bool, at: int | None = None) -> int:
    ok_geo = bool(entry and stop and entry > 0 and stop > 0 and entry != stop and direction in ("Long", "Short")
                  and ((direction == "Long" and stop < entry) or (direction == "Short" and stop > entry)))
    risk = abs(entry - stop) if ok_geo else None
    target = (entry + TARGET_R * risk if direction == "Long" else entry - TARGET_R * risk) if ok_geo else None
    cur = db.execute(
        "INSERT INTO calls(at,source,ref,symbol,verdict,direction,setup,grade,entry,stop,target,needs_fill,status) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (at or now_ms(), source, ref, symbol.upper(), verdict, direction, setup, grade,
         entry if ok_geo else None, stop if ok_geo else None, target, 1 if needs_fill else 0,
         "open" if ok_geo else "void"))
    return int(cur.lastrowid)


def _duplicate(db, sym: str, direction: str | None, entry: float | None) -> bool:
    """Scanning the same coin again within the fill window isn't new evidence."""
    if not entry:
        return False
    row = db.one("SELECT id FROM calls WHERE source='ai' AND status='open' AND symbol=? AND direction IS ? "
                 "AND at>? AND ABS(entry-?)<=?", (sym.upper(), direction, now_ms() - FILL_MS, entry, abs(entry) * 0.001))
    return bool(row)


def record_ai(db, sym: str, res: dict, snap: dict) -> int | None:
    g = res.get("gates") or {}
    cand = res.get("candidate") or {}
    verdict = res.get("verdict") or "NO SETUP"
    direction = res.get("direction") or (cand.get("direction") if cand.get("direction") in ("Long", "Short") else None)
    triggered = bool(res.get("c4_closed"))
    # already triggered: you'd enter at the market price now, not at the old trigger
    entry = _f(snap.get("price")) if triggered else _f(g.get("entry"))
    if _duplicate(db, sym, direction, entry):
        return None
    return record(db, source="ai", ref=f"ai:{sym}:{now_ms()}", symbol=sym, verdict=verdict,
                  direction=direction, setup=res.get("setup") or (cand.get("setup") if cand.get("setup") not in (None, "None") else None),
                  grade=res.get("grade"), entry=entry, stop=_f(g.get("stop")), needs_fill=not triggered)


def record_checklist(db, plan_id: int, b: dict, verdict: str, grade: str | None) -> int:
    sz = b.get("sizing") or {}
    return record(db, source="checklist", ref=f"plan:{plan_id}", symbol=(b.get("symbol") or "?"), verdict=verdict,
                  direction=b.get("direction"), setup=b.get("setup"), grade=grade,
                  entry=_f(sz.get("entry")), stop=_f(sz.get("stop")), needs_fill=not b.get("c4_closed"))


def _f(v) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


async def _candles(app, sym: str, t0: int, t1: int) -> list[dict]:
    rows = await app.candles_between(sym, t0, t1)
    first = t0 - t0 % Q15
    usable = [c for c in rows if c["t"] >= first]
    if usable and contiguous(sorted(usable, key=lambda c: c["t"])) and usable[-1]["t"] + Q15 >= t1:
        return rows
    # the live buffer can have holes (a sleeping laptop): ask the exchange directly
    if app.source is None:
        return rows
    try:
        fresh = await app.source.klines(sym, "15", limit=1000, start=first, end=t1)
        return [c for c in fresh if first <= c["t"] <= t1]
    except Exception as exc:  # noqa: BLE001
        log.info("learning candles %s: %s", sym, exc)
        return rows


async def resolve_open(app, limit: int = 12) -> int:
    """Score calls whose 10-hour window has passed. Returns how many were settled.
    A call that still can't be scored 48 hours after it was due is set aside, so
    it can never hold up the calls behind it."""
    th = app.th()
    fee = app.settings().get("taker_fee_pct") or th["taker_fee_pct"]
    thin = set(app.settings().get("thin_assets") or [])
    span = FILL_MS + HOLD_MS + 2 * Q15
    now = now_ms()
    done = 0
    for c in app.db.query("SELECT * FROM calls WHERE status='open' AND at<? ORDER BY at LIMIT ?", (now - span, limit)):
        stale = now - (c["at"] + span) > 48 * 3_600_000
        candles = await _candles(app, c["symbol"], c["at"], c["at"] + span)
        slip = th["slippage_pct_thin"] if c["symbol"] in thin else th["slippage_pct_major"]
        out = simulate(candles, c["direction"], c["entry"], c["stop"], c["at"], needs_fill=bool(c["needs_fill"]),
                       cost_pct=cost_pct(fee, slip), need_until=c["at"] + span) if candles else {"outcome": "no_data", "r": None}
        if out["outcome"] in ("pending", "gap", "no_data"):
            if stale:
                app.db.execute("UPDATE calls SET status='void', outcome=?, resolved_at=? WHERE id=?", (out["outcome"], now, c["id"]))
                done += 1
            continue
        status = "done" if out["outcome"] in ("target", "stop", "timeout", "no_fill", "invalidated") else "void"
        app.db.execute("UPDATE calls SET status=?, outcome=?, outcome_r=?, resolved_at=? WHERE id=?",
                       (status, out["outcome"], out["r"], now, c["id"]))
        done += 1
    return done


# ---------------------------------------------------------------- report card
def _stat(rs: list[float]) -> dict:
    n = len(rs)
    if not n:
        return {"n": 0, "avg_r": None, "win_rate": None, "shrunk": 0.0, "se": None}
    avg = sum(rs) / n
    var = sum((x - avg) ** 2 for x in rs) / (n - 1) if n > 1 else 1.0
    se = math.sqrt(max(var, 0.25) / n)            # floor: a handful of identical results isn't certainty
    return {"n": n, "avg_r": round(avg, 3), "win_rate": round(sum(1 for x in rs if x > 0) / n, 3),
            "shrunk": round(avg * n / (n + SHRINK_K), 3), "se": round(se, 3)}


def _two_sided_p(avg: float | None, se: float | None) -> float:
    """Rough two-sided p that the true average is zero, from a normal
    approximation with the SE floor above. Deliberately not shown as a number:
    used only to order and threshold buckets for the multiplicity correction,
    where the small-sample roughness is acceptable and conservative."""
    if not se or avg is None:
        return 1.0
    z = abs(avg) / se
    return math.erfc(z / math.sqrt(2))            # 2*(1 - Phi(z))


def benjamini_hochberg(pairs: list[tuple[Any, float]], q: float = FDR_Q) -> set:
    """Keys whose p-values survive a Benjamini-Hochberg FDR correction at level
    q across the whole batch. m is the number of hypotheses tested this pass,
    so testing more buckets makes any single one harder to call real - which is
    the whole point after searching many overlapping dimensions."""
    m = len(pairs)
    if not m:
        return set()
    ordered = sorted(pairs, key=lambda kp: kp[1])
    cutoff = 0
    for i, (_key, p) in enumerate(ordered, start=1):
        if p <= (i / m) * q:
            cutoff = i
    return {ordered[i][0] for i in range(cutoff)}


def scorecard(db) -> dict:
    rows = db.query("SELECT source, verdict, outcome, outcome_r FROM calls WHERE status='done'")
    groups: dict[tuple, list] = defaultdict(list)
    for r in rows:
        groups[(r["source"], r["verdict"])].append(r)
    out = []
    for (src, verdict), rs in sorted(groups.items()):
        filled = [r for r in rs if r["outcome_r"] is not None]
        st = _stat([r["outcome_r"] for r in filled])
        out.append({"source": src, "verdict": verdict, "calls": len(rs),
                    "never_triggered": sum(1 for r in rs if r["outcome"] in ("no_fill", "invalidated")),
                    "target_rate": round(sum(1 for r in filled if r["outcome"] == "target") / len(filled), 3) if filled else None,
                    **st})
    pending = (db.one("SELECT COUNT(*) AS n FROM calls WHERE status='open'") or {}).get("n", 0)
    return {"rows": out, "pending": pending, "lines": scorecard_lines(out)}


def _label_src(src: str) -> str:
    return "AI scan" if src == "ai" else "Checklist"


def scorecard_lines(rows: list[dict]) -> list[str]:
    lines = []
    for r in rows:
        if r["n"] < 3:
            continue
        base = (f"{_label_src(r['source'])} said {r['verdict']}: {r['n']} would-be trades averaged {r['avg_r']:+.2f}R "
                f"({round(100 * (r['target_rate'] or 0))}% reached the +2R target)")
        sure = r["n"] >= MIN_WARN
        if r["verdict"] in POSITIVE_CALLS:
            if not sure:
                tail = ". Too few to judge yet."
            elif r["avg_r"] - r["se"] > 0:
                tail = ". Its green lights are paying."
            elif r["avg_r"] + r["se"] < 0:
                tail = ". Its green lights are not paying; weigh them less."
            else:
                tail = ". Mixed so far."
        else:
            tail = ". Standing aside was right." if sure and r["avg_r"] + r["se"] < 0 else ". Too few or too mixed to judge."
        lines.append(base + tail)
    return lines


def caution_lines(rows: list[dict]) -> list[str]:
    """For the AI scan: only results that argue for MORE caution, with enough evidence."""
    out = []
    for r in rows:
        if r["verdict"] in POSITIVE_CALLS and r["n"] >= MIN_WARN and r["avg_r"] + r["se"] < 0:
            out.append(f"When the {_label_src(r['source']).lower()} said {r['verdict']}, {r['n']} would-be trades "
                       f"averaged {r['avg_r']:+.2f}R. Be stricter than usual.")
    return out


# ---------------------------------------------------------------- edge profile
def session_of(hour: int | None) -> str | None:
    if hour is None:
        return None
    for name, a, b in SESSIONS:
        if a <= hour < b:
            return name
    return None


def _hour(t: dict) -> int | None:
    if t.get("opened_at"):
        return datetime.fromtimestamp(t["opened_at"] / 1000, tz=timezone.utc).hour
    if t.get("time_utc"):
        try:
            return int(str(t["time_utc"])[:2])
        except ValueError:
            return None
    return None


def trend_of(direction: str | None, regime: str | None) -> str | None:
    if not regime or direction not in ("Long", "Short"):
        return None
    if regime not in ("uptrend", "downtrend"):
        return "range"
    aligned = (regime == "uptrend") == (direction == "Long")
    return "with trend" if aligned else "against trend"


def features(t: dict) -> dict:
    ctx = t.get("context") or {}
    if isinstance(ctx, str):
        try:
            ctx = json.loads(ctx)
        except ValueError:
            ctx = {}
    viol = t.get("violations") or []
    if isinstance(viol, str):
        try:
            viol = json.loads(viol)
        except ValueError:
            viol = []
    if not isinstance(ctx, dict):
        ctx = {}
    if not isinstance(viol, list):
        viol = []
    majors = sorted({v.get("code") for v in viol if isinstance(v, dict) and v.get("severity") == "major"
                     and v.get("code") in BREAK_TEXT})
    # Only known values become labels: journal free text never reaches a label (or the AI scan).
    setup = _canon(t.get("setup"), SETUP_NAMES)
    direction = _canon(t.get("direction"), ("Long", "Short"))
    sym = str(t.get("symbol") or "").strip().upper()
    sym = sym if SYMBOL_RE.match(sym) else None
    grade = _canon(t.get("grade"), ("A", "B", "C", "D"))
    return {"setup": setup, "symbol": sym, "direction": direction, "session": session_of(_hour(t)), "grade": grade,
            "trend": trend_of(direction, ctx.get("regime") if isinstance(ctx.get("regime"), str) else None), "breaks": majors}


def _canon(v, allowed) -> str | None:
    if not isinstance(v, str):
        return None
    for a in allowed:
        if v.strip().lower() == a.lower():
            return a
    return None


DIM_LABEL = {"setup": "{v} setups", "symbol": "{v} trades", "direction": "{v}s", "session": "{v} session trades",
             "grade": "grade {v} setups", "trend": "{v}", "break": "trades where you {v}",
             "setup+symbol": "{v}"}
TREND_TEXT = {"with trend": "trades with the 4h trend", "against trend": "trades against the 4h trend",
              "range": "trades in a ranging market"}
BREAK_TEXT = {"no_stop": "no stop on the exchange", "stop_widened": "moved the stop away",
              "over_risk": "risked more than 1%", "liq_buffer": "liquidation too close", "no_go_taken": "took a NO TRADE",
              "gate_fail": "took a failed gate", "middle_third": "entered in the middle third",
              "added_to_loser": "added to a loser", "no_expansion_hold": "held without expansion", "liquidated": "got liquidated"}


def edge_profile(trades: list[dict], validated_keys: set | None = None) -> dict:
    """Group closed trades many ways and classify each group by how much
    evidence stands behind it (observation / candidate / validated). The tier,
    not just the average, decides how strongly the app talks about a pattern.
    validated_keys: (dim, value) tuples the Prospective Edge Registry has
    confirmed on set-aside trades; those buckets earn the top tier."""
    validated_keys = validated_keys or set()
    rows = [t for t in trades if t.get("taken", 1) and t.get("status") == "closed" and t.get("r") is not None]
    groups: dict[tuple, list[float]] = defaultdict(list)
    for t in rows:
        f = features(t)
        r = float(t["r"])
        for dim in ("setup", "symbol", "direction", "session", "grade", "trend"):
            if f[dim]:
                groups[(dim, f[dim])].append(r)
        if f["setup"] and f["symbol"]:
            groups[("setup+symbol", f"{f['setup']} on {f['symbol']}")].append(r)
        for code in f["breaks"]:
            groups[("break", code)].append(r)

    buckets = []
    for (dim, val), rs in groups.items():
        st = _stat(rs)
        shown = BREAK_TEXT.get(val, val.replace("_", " ")) if dim == "break" else TREND_TEXT.get(val, val) if dim == "trend" else val
        label = DIM_LABEL[dim].format(v=shown)
        kind = None
        if st["n"] >= MIN_WARN:
            if st["shrunk"] <= LEAK_R and st["avg_r"] + st["se"] < 0:
                kind = "leak"
            elif st["shrunk"] >= EDGE_R and st["avg_r"] - st["se"] > 0:
                kind = "edge"
        buckets.append({"dim": dim, "value": val, "label": label, "kind": kind, "tier": None, **st})

    # multiplicity: correct across every bucket that reached the observation bar
    tested = [b for b in buckets if b["n"] >= MIN_WARN]
    fdr_survivors = benjamini_hochberg([((b["dim"], b["value"]), _two_sided_p(b["avg_r"], b["se"])) for b in tested])

    n_candidate = n_validated = 0
    for b in buckets:
        if b["kind"] is None:
            continue
        key = (b["dim"], b["value"])
        b["tier"] = TIER_OBSERVATION
        ci_clears_zero = (b["avg_r"] - CAND_Z * b["se"] > 0) if b["kind"] == "edge" else (b["avg_r"] + CAND_Z * b["se"] < 0)
        if b["n"] >= MIN_CANDIDATE and ci_clears_zero and key in fdr_survivors:
            b["tier"] = TIER_CANDIDATE
            n_candidate += 1
            if key in validated_keys:
                b["tier"] = TIER_VALIDATED
                n_validated += 1

    buckets.sort(key=lambda b: (-TIER_RANK[b["tier"]], b["shrunk"]))
    overall = _stat([float(t["r"]) for t in rows])
    return {"overall": overall, "trades": len(rows), "buckets": buckets,
            "leaks": [b for b in buckets if b["kind"] == "leak"],
            "edges": sorted([b for b in buckets if b["kind"] == "edge"], key=lambda b: -b["shrunk"]),
            "min_warn": MIN_WARN, "min_candidate": MIN_CANDIDATE,
            "counts": {"tested": len(tested), "observations": sum(1 for b in buckets if b["kind"]),
                       "candidates": n_candidate, "validated": n_validated, "fdr_q": FDR_Q}}


def describe(b: dict) -> str:
    return (f"Your {b['label']}: {b['n']} taken, average {b['avg_r']:+.2f}R, "
            f"{round(100 * b['win_rate'])}% winners")


# ---------------------------------------------------------------- Prospective Edge Registry
# The honest test for whether a pattern is real: freeze it when first seen at
# the candidate tier, then judge it ONLY on trades that happen afterwards, which
# it could not have been fitted to. This is the single strongest guard against
# mining a pattern out of past data (the multiple-comparisons problem).
RESERVE_N = MIN_CANDIDATE           # qualifying trades to set aside before judging a frozen pattern
CONFIRM_EDGE_R = 0.10               # a reserved edge must still average at least this
CONFIRM_LEAK_R = -0.10              # a reserved leak must still average at most this


def _bucket_key(b: dict) -> tuple:
    return (b["dim"], b["value"])


def register_candidates(db, profile: dict, now: int | None = None) -> int:
    """Freeze any candidate-or-better bucket not already tracked. The discovery
    snapshot is written once and never changed, so the hypothesis being tested
    can't drift. Returns how many new hypotheses were registered."""
    now = now or now_ms()
    have = {(r["dim"], r["value"]) for r in db.query("SELECT dim, value FROM edge_registry")}
    added = 0
    for b in profile["buckets"]:
        if TIER_RANK.get(b.get("tier"), 0) < TIER_RANK[TIER_CANDIDATE] or not b["kind"]:
            continue
        if _bucket_key(b) in have:
            continue
        db.execute("INSERT OR IGNORE INTO edge_registry(dim,value,label,kind,discovered_at,discovery_n,discovery_avg_r,reserve_n,status) "
                   "VALUES(?,?,?,?,?,?,?,?,'watching')",
                   (b["dim"], b["value"], b["label"], b["kind"], now, b["n"], b["avg_r"], RESERVE_N))
        added += 1
    return added


def _qualifying_after(trades: list[dict], dim: str, value: str, after: int) -> list[float]:
    """R of every closed trade matching this bucket that closed after `after` -
    the out-of-sample trades reserved to confirm the hypothesis."""
    out = []
    for t in trades:
        if not (t.get("taken", 1) and t.get("status") == "closed" and t.get("r") is not None):
            continue
        when = t.get("closed_at") or t.get("opened_at") or 0
        if when <= after:
            continue
        if context_matches({"dim": dim, "value": value}, features(t)):
            out.append(float(t["r"]))
    return out


def update_registry(db, trades: list[dict], now: int | None = None) -> None:
    """Advance every watching hypothesis: once enough reserved trades exist,
    judge the pattern on those out-of-sample trades alone and mark it confirmed
    or failed. Confirmation never reuses the discovery trades."""
    now = now or now_ms()
    for r in db.query("SELECT * FROM edge_registry WHERE status='watching'"):
        rs = _qualifying_after(trades, r["dim"], r["value"], r["discovered_at"])
        if len(rs) < r["reserve_n"]:
            continue
        avg = sum(rs) / len(rs)
        st = _stat(rs)
        if r["kind"] == "edge":
            ok = st["avg_r"] - st["se"] > 0 and avg >= CONFIRM_EDGE_R
        else:
            ok = st["avg_r"] + st["se"] < 0 and avg <= CONFIRM_LEAK_R
        db.execute("UPDATE edge_registry SET status=?, confirmed_at=?, confirm_n=?, confirm_avg_r=? WHERE id=?",
                   ("confirmed" if ok else "failed", now, len(rs), round(avg, 3), r["id"]))


def validated_keys(db) -> set:
    """(dim, value) tuples the registry has confirmed on set-aside trades."""
    return {(r["dim"], r["value"]) for r in db.query("SELECT dim, value FROM edge_registry WHERE status='confirmed'")}


def registry_view(db, trades: list[dict]) -> dict:
    """Rows for the Learning page, each with how far its confirmation has got."""
    rows = []
    for r in db.query("SELECT * FROM edge_registry ORDER BY discovered_at DESC"):
        reserved = _qualifying_after(trades, r["dim"], r["value"], r["discovered_at"]) if r["status"] == "watching" else None
        rows.append({**r, "reserved_so_far": len(reserved) if reserved is not None else r["confirm_n"]})
    return {"rows": rows, "reserve_n": RESERVE_N}


def tier_phrase(b: dict) -> str:
    """One honest clause about how much evidence stands behind a bucket, tier
    by tier. Deliberately avoids 'this is where you make money' for anything
    short of a prospectively confirmed pattern."""
    tier = b.get("tier")
    if b["kind"] == "leak":
        if tier == TIER_VALIDATED:
            return "This has kept costing you on trades set aside after it was first spotted."
        if tier == TIER_CANDIDATE:
            return "This looks like a real leak: it held up after allowing for luck and the many patterns checked."
        return "An early signal this has been costing you. Not confirmed yet; worth caution."
    # edge
    if tier == TIER_VALIDATED:
        return "Confirmed: it held up on trades set aside after it was first spotted."
    if tier == TIER_CANDIDATE:
        return "A candidate edge: it survived a correction for the many patterns checked, but is not prospectively confirmed."
    return "An early signal, from too few trades to trust. Not yet where you can say you make money."


# ---------------------------------------------------------------- lessons for a setup in front of you
def context_matches(b: dict, ctx: dict) -> bool:
    dim, val = b["dim"], b["value"]
    if dim == "setup+symbol":
        return bool(ctx.get("setup") and ctx.get("symbol")) and val == f"{ctx['setup']} on {ctx['symbol']}"
    if dim == "break":
        return False                     # rule breaks are about what you do after entry
    return ctx.get(dim) is not None and ctx.get(dim) == val


def lessons_for(profile: dict, ctx: dict) -> list[dict]:
    """Leaks and edges that match the setup being looked at."""
    ctx = dict(ctx)
    if ctx.get("hour") is not None and not ctx.get("session"):
        ctx["session"] = session_of(ctx["hour"])
    out = []
    for b in profile["leaks"] + profile["edges"]:
        if context_matches(b, ctx):
            out.append({"kind": b["kind"], "tier": b.get("tier"), "text": describe(b) + ". " + tier_phrase(b),
                        "dim": b["dim"], "value": b["value"]})
    return out


# ---------------------------------------------------------------- personal blocks (stricter only)
BLOCKABLE = ("setup", "symbol", "session", "trend", "setup+symbol", "direction", "grade")


def restrictions(db) -> list[dict]:
    rows = db.get("learn_restrictions") or []
    return [r for r in rows if isinstance(r, dict) and r.get("active") and r.get("dim") and r.get("value") is not None]


def restriction_hits(db, ctx: dict) -> list[str]:
    ctx = dict(ctx)
    if ctx.get("hour") is not None and not ctx.get("session"):
        ctx["session"] = session_of(ctx["hour"])
    return [f"Personal block you approved: no {r.get('label') or r['value']} ({r.get('reason') or 'from your review'})."
            for r in restrictions(db) if context_matches({"dim": r["dim"], "value": r["value"]}, ctx)]


def proposals_from(profile: dict, existing: list[dict]) -> list[dict]:
    """Propose a lasting block only for a leak that has cleared the candidate
    bar (multiplicity-corrected, CI clear of zero, larger sample) or better -
    not merely a bad patch of a dozen trades. A prospectively validated leak is
    the strongest case and is called out as such."""
    have = {(r["dim"], r["value"]) for r in existing if r.get("active") or r.get("dismissed_at")}
    out = []
    for b in profile["leaks"]:
        if b["dim"] not in BLOCKABLE or (b["dim"], b["value"]) in have:
            continue
        if TIER_RANK.get(b.get("tier"), 0) < TIER_RANK[TIER_CANDIDATE]:
            continue                                 # observation-only leaks stay as caution, never a block
        confirmed = b.get("tier") == TIER_VALIDATED
        out.append({"dim": b["dim"], "value": b["value"], "label": b["label"], "tier": b.get("tier"),
                    "reason": f"{b['n']} taken, average {b['avg_r']:+.2f}R"
                              + (", confirmed on trades set aside after it was spotted" if confirmed
                                 else ", survives a correction for the many patterns checked")})
    return out[:3]


# ---------------------------------------------------------------- weekly review
def week_key(ts: int) -> str:
    d = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def weekly_review(db, trades: list[dict], now: int | None = None) -> dict:
    now = now or now_ms()
    # advance and grow the registry first, so this review reflects the latest
    # out-of-sample confirmations and freezes any new candidates.
    update_registry(db, trades, now)
    profile = edge_profile(trades, validated_keys(db))
    register_candidates(db, profile, now)
    profile = edge_profile(trades, validated_keys(db))
    card = scorecard(db)
    since = now - 7 * 86_400_000
    week = [t for t in trades if t.get("taken", 1) and t.get("status") == "closed" and t.get("r") is not None
            and (t.get("closed_at") or t.get("opened_at") or 0) >= since]
    wk = _stat([float(t["r"]) for t in week])
    broke = sum(1 for t in week if features(t)["breaks"])
    worked = [describe(b) for b in profile["edges"][:2]]
    leaking = [describe(b) for b in profile["leaks"][:3]]
    existing = db.get("learn_restrictions") or []
    props = proposals_from(profile, existing)
    if profile["leaks"]:
        top = profile["leaks"][0]
        proposed = any((p["dim"], p["value"]) == (top["dim"], top["value"]) for p in props)
        change = f"Skip {top['label']} until the numbers turn" + (", or approve the block proposed on the Learning page." if proposed else ".")
    elif broke:
        change = f"{broke} of this week's trades broke a major rule. Fix that before anything else."
    elif profile["trades"] < MIN_WARN:
        change = f"Keep logging. Patterns show up after about {MIN_WARN} trades in a group; you have {profile['trades']} closed so far."
    else:
        change = "No clear leak yet. Keep taking only A and B setups and let the sample grow."
    return {"week": week_key(now), "created_at": now,
            "this_week": {"trades": wk["n"], "avg_r": wk["avg_r"], "win_rate": wk["win_rate"], "rule_breaks": broke},
            "overall": profile["overall"], "what_worked": worked, "leaking": leaking,
            "report_card": card["lines"], "one_change": change, "proposals": props}


def save_review(db, review: dict) -> dict:
    db.set(f"learn_review:{review['week']}", review)
    db.set("learn_review_last", review["week"])
    # queue proposals (dedupe by pattern)
    existing = db.get("learn_restrictions") or []
    seen = {(r["dim"], r["value"]) for r in existing}
    nid = max([r["id"] for r in existing] or [0]) + 1
    for p in review["proposals"]:
        if (p["dim"], p["value"]) in seen:
            continue
        existing.append({"id": nid, **p, "active": False, "proposed_at": review["created_at"], "approved_at": None,
                         "dismissed_at": None})
        nid += 1
    db.set("learn_restrictions", existing)
    return review


def latest_review(db) -> dict | None:
    wk = db.get("learn_review_last")
    return db.get(f"learn_review:{wk}") if wk else None


def set_restriction(db, rid: int, action: str) -> dict:
    rows = db.get("learn_restrictions") or []
    hit = next((r for r in rows if r["id"] == rid), None)
    if not hit:
        raise KeyError(rid)
    ts = now_ms()
    if action == "approve":
        hit.update(active=True, approved_at=ts, dismissed_at=None)
    elif action in ("dismiss", "remove"):
        hit.update(active=False, dismissed_at=ts)
    else:
        raise ValueError(action)
    db.set("learn_restrictions", rows)
    return hit


# ---------------------------------------------------------------- signal ablation
ABLATE_MIN_SIDE = 5           # trades needed with and without a signal to judge it


def _plan_signals(db, t: dict) -> dict | None:
    """Reconstruct the checklist signals that were present when a trade was
    taken, from its linked plan. Returns a flag per signal, or None if the trade
    did not come from a checklist plan."""
    if not t.get("plan_id"):
        return None
    p = db.one("SELECT checklist FROM plans WHERE id=?", (t["plan_id"],))
    if not p or not p.get("checklist"):
        return None
    try:
        b = json.loads(p["checklist"])
    except (TypeError, ValueError):
        return None
    sc = b.get("scores") or {}
    ch = b.get("checks") or {}
    def cc(group, key):
        return bool((ch.get(group) or {}).get(key))
    return {
        "C1 obvious level": (sc.get("c1") or 0) >= 1,
        "C2 recruitment": (sc.get("c2") or 0) >= 2,
        "C3 stall": (sc.get("c3") or 0) >= 1,
        "C4 reclaim quality": (sc.get("c4") or 0) >= 2,
        "OI confirmation": cc("c2", "oi") or cc("c4", "oi"),
        "Funding stretched": cc("c2", "funding"),
        "Liquidations vs trapped side": cc("c4", "liqs"),
    }


def signal_ablation(db, trades: list[dict]) -> dict:
    """For each checklist signal, two questions (ChatGPT's framing): does its
    presence go with better outcomes at all, and does it still help once the
    strong setups (A/B grade) are already in hand? A signal that looks good
    alone but adds nothing on top of the others is redundant. Uses only trades
    that came from a checklist plan and have a recorded R; read-only."""
    rows = []
    for t in trades:
        if not (t.get("taken", 1) and t.get("status") == "closed" and t.get("r") is not None):
            continue
        sig = _plan_signals(db, t)
        if sig is None:
            continue
        rows.append((sig, float(t["r"]), (t.get("grade") in ("A", "B"))))
    if len(rows) < ABLATE_MIN_SIDE * 2:
        return {"n": len(rows), "signals": [],
                "note": f"Needs more checklist-logged trades (have {len(rows)}). This reads only trades taken from a saved checklist."}

    def _avg(xs):
        return round(sum(xs) / len(xs), 3) if xs else None

    names = list(rows[0][0].keys())
    out = []
    for name in names:
        with_r = [r for sig, r, _ in rows if sig.get(name)]
        without_r = [r for sig, r, _ in rows if not sig.get(name)]
        if len(with_r) < ABLATE_MIN_SIDE or len(without_r) < ABLATE_MIN_SIDE:
            continue
        lift = _avg(with_r) - _avg(without_r)
        # conditional: among already-strong (A/B) trades, does the signal still separate outcomes?
        ab = [(sig, r) for sig, r, good in rows if good]
        cond = None
        cw = [r for sig, r in ab if sig.get(name)]
        cwo = [r for sig, r in ab if not sig.get(name)]
        if len(cw) >= ABLATE_MIN_SIDE and len(cwo) >= ABLATE_MIN_SIDE:
            cond = {"with_n": len(cw), "with_avg": _avg(cw), "without_n": len(cwo), "without_avg": _avg(cwo),
                    "lift": round(_avg(cw) - _avg(cwo), 3)}
        redundant = cond is not None and abs(cond["lift"]) < 0.1 and abs(lift) >= 0.1
        out.append({"name": name, "with_n": len(with_r), "with_avg": _avg(with_r),
                    "without_n": len(without_r), "without_avg": _avg(without_r), "lift": round(lift, 3),
                    "conditional": cond, "redundant": redundant})
    out.sort(key=lambda s: -abs(s["lift"]))
    return {"n": len(rows), "signals": out,
            "note": "Lift is the average R with the signal minus without it. The conditional column asks whether it still "
                    "helps once you already have an A or B setup; a signal that helps alone but not there is doing little "
                    "extra work. This is descriptive, not a rule change."}


# ---------------------------------------------------------------- regime-stability matrix
STAB_MIN_SIDE = 5              # trades needed on each side of a split to read it


def _bucket_trades(trades: list[dict], dim: str, value: str) -> list[dict]:
    out = []
    for t in trades:
        if not (t.get("taken", 1) and t.get("status") == "closed" and t.get("r") is not None):
            continue
        if context_matches({"dim": dim, "value": value}, features(t)):
            out.append(t)
    return out


def _split_stat(ts_a: list[dict], ts_b: list[dict], a_label: str, b_label: str, overall_avg: float) -> dict | None:
    ra = [float(t["r"]) for t in ts_a]
    rb = [float(t["r"]) for t in ts_b]
    if len(ra) < STAB_MIN_SIDE or len(rb) < STAB_MIN_SIDE:
        return None
    aa, ab = sum(ra) / len(ra), sum(rb) / len(rb)
    same = (aa > 0) == (overall_avg > 0) and (ab > 0) == (overall_avg > 0)
    return {"a_label": a_label, "a_n": len(ra), "a_avg": round(aa, 3),
            "b_label": b_label, "b_n": len(rb), "b_avg": round(ab, 3), "held": bool(same)}


def regime_stability(trades: list[dict], dim: str, value: str, thin_set: set,
                     discovered_at: int | None = None) -> list[dict]:
    """Does a pattern hold up across market conditions, or only in the one it was
    found in? Splits the pattern's own trades by volatility, trend vs range,
    majors vs thin, earlier vs later, and (if it was registered) discovery vs
    the set-aside trades after it. A pattern that flips sign across a split is
    fragile, whatever its overall average says."""
    ts = _bucket_trades(trades, dim, value)
    if len(ts) < STAB_MIN_SIDE * 2:
        return []
    overall = sum(float(t["r"]) for t in ts) / len(ts)

    def ctx(t, key):
        c = t.get("context") or {}
        return c.get(key) if isinstance(c, dict) else None

    splits = []
    # volatility: high vs low ATR% at entry (split at this pattern's own median)
    with_vol = [t for t in ts if ctx(t, "atr_pct") is not None]
    if len(with_vol) >= STAB_MIN_SIDE * 2:
        vals = sorted(ctx(t, "atr_pct") for t in with_vol)
        mid = vals[len(vals) // 2]
        s = _split_stat([t for t in with_vol if ctx(t, "atr_pct") >= mid],
                        [t for t in with_vol if ctx(t, "atr_pct") < mid], "high volatility", "low volatility", overall)
        if s:
            splits.append({"name": "Volatility", **s})
    # trend vs range
    s = _split_stat([t for t in ts if ctx(t, "regime") in ("uptrend", "downtrend")],
                    [t for t in ts if ctx(t, "regime") == "range"], "trending", "ranging", overall)
    if s:
        splits.append({"name": "Trend vs range", **s})
    # majors vs thin
    s = _split_stat([t for t in ts if t["symbol"] not in thin_set],
                    [t for t in ts if t["symbol"] in thin_set], "majors", "thin", overall)
    if s:
        splits.append({"name": "Majors vs thin", **s})
    # earlier vs later half (chronological)
    order = sorted(ts, key=lambda t: t.get("closed_at") or t.get("opened_at") or 0)
    half = len(order) // 2
    s = _split_stat(order[:half], order[half:], "earlier half", "later half", overall)
    if s:
        splits.append({"name": "Earlier vs later", **s})
    # discovery vs prospective (only if the pattern was registered)
    if discovered_at:
        s = _split_stat([t for t in ts if (t.get("closed_at") or t.get("opened_at") or 0) <= discovered_at],
                        [t for t in ts if (t.get("closed_at") or t.get("opened_at") or 0) > discovered_at],
                        "at discovery", "set aside after", overall)
        if s:
            splits.append({"name": "Prospective", **s})
    return splits


def stability_matrix(db, trades: list[dict], profile: dict, thin_set: set) -> list[dict]:
    """A regime-stability read for every pattern that has reached candidate tier
    or better - the only ones worth asking 'does this generalize?' about."""
    disc = {(r["dim"], r["value"]): r["discovered_at"] for r in db.query("SELECT dim, value, discovered_at FROM edge_registry")}
    out = []
    for b in profile["buckets"]:
        if TIER_RANK.get(b.get("tier"), 0) < TIER_RANK[TIER_CANDIDATE]:
            continue
        splits = regime_stability(trades, b["dim"], b["value"], thin_set, disc.get((b["dim"], b["value"])))
        if splits:
            out.append({"label": b["label"], "dim": b["dim"], "value": b["value"], "kind": b["kind"],
                        "tier": b["tier"], "splits": splits})
    return out


# ---------------------------------------------------------------- execution quality (read-only)
def _intended_entry(db, t: dict) -> float | None:
    """What price the trade was MEANT to fill at: the checklist plan's entry if
    the trade came from a plan, else the market price captured when the trade's
    context was attached. Read-only; never a Bybit call."""
    if t.get("plan_id"):
        p = db.one("SELECT entry FROM plans WHERE id=?", (t["plan_id"],))
        if p and p.get("entry"):
            return float(p["entry"])
    ctx = t.get("context") or {}
    if isinstance(ctx, dict) and ctx.get("price"):
        return float(ctx["price"])
    return None


def execution_quality(db, trades: list[dict], th: dict, thin_set: set) -> dict:
    """How far actual fills landed from where the trade was meant to enter, in
    basis points and in R, and how that compares to the slippage the cost gate
    assumes. Bybit is read-only here: this only reads fills already recorded,
    it never sends anything. Positive drag = the fill was adverse."""
    per = []
    for t in trades:
        if not (t.get("taken", 1) and t.get("entry") and t.get("stop") and t.get("direction")):
            continue
        intended = _intended_entry(db, t)
        if not intended:
            continue
        actual = float(t["entry"])
        stop_dist = abs(actual - float(t["stop"]))
        if stop_dist <= 0:
            continue
        # adverse if you paid up on a long or sold lower on a short
        adverse = (actual - intended) if t["direction"] == "Long" else (intended - actual)
        drag_bps = adverse / intended * 10_000
        drag_r = adverse / stop_dist
        per.append({"symbol": t["symbol"], "drag_bps": round(drag_bps, 1), "drag_r": round(drag_r, 3),
                    "thin": t["symbol"] in thin_set})
    if not per:
        return {"n": 0, "note": "No trades yet with both a recorded fill and an intended entry (from a checklist plan or the market snapshot captured at entry)."}
    def med(xs):
        xs = sorted(xs)
        n = len(xs)
        return (xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2)
    bps = [p["drag_bps"] for p in per]
    rr = [p["drag_r"] for p in per]
    # what the cost gate assumes per side, in bps (slippage_pct is a percent)
    modeled_major = th.get("slippage_pct_major", 0.02) * 100
    modeled_thin = th.get("slippage_pct_thin", 0.06) * 100
    thin_bps = [p["drag_bps"] for p in per if p["thin"]]
    major_bps = [p["drag_bps"] for p in per if not p["thin"]]
    return {
        "n": len(per), "median_drag_bps": round(med(bps), 1), "median_drag_r": round(med(rr), 3),
        "worst_drag_r": round(max(rr), 3),
        "modeled_bps": {"major": round(modeled_major, 1), "thin": round(modeled_thin, 1)},
        "realized_bps": {"major": round(med(major_bps), 1) if major_bps else None,
                         "thin": round(med(thin_bps), 1) if thin_bps else None},
        "worst": sorted(per, key=lambda p: -p["drag_r"])[:5],
        "note": "Drag is your fill versus where the trade was meant to enter. Positive means the fill was worse. "
                "Compare realized to modeled: if realized runs above what the cost gate assumes, widen the slippage assumption at your monthly review.",
    }


# ---------------------------------------------------------------- what the AI scan receives (option B)
def ai_summary(db, trades: list[dict], ctx: dict) -> dict:
    """Short, text-only pattern summary for the AI scan. R multiples and counts
    only: no balances, sizes, dollars, entry prices, dates or trade list."""
    profile = edge_profile(trades, validated_keys(db))
    card = scorecard(db)
    return {
        "note": "Where this trader's own record with the strategy says to be careful (from their journal). "
                "Use it only to be MORE cautious; never to loosen a rule or to justify a trade.",
        "evidence_note": "Each leak below is tagged by strength: 'early signal' is descriptive only and NOT proven; "
                         "'candidate' survived a correction for the many patterns checked; 'validated' also held up on "
                         "trades set aside after it was spotted. Weight a leak by its tag; never treat an early signal as fact.",
        "closed_trade_count": profile["trades"],
        "overall_avg_r": profile["overall"]["avg_r"],
        "leaks": [f"[{b.get('tier') or 'early signal'}] {describe(b)}" for b in profile["leaks"][:5]],
        "matching_this_setup": [x["text"] for x in lessons_for(profile, ctx) if x["kind"] == "leak"][:4],
        "app_call_record": caution_lines(card["rows"])[:3],
        "personal_blocks": [f"no {r.get('label') or r['value']}" for r in restrictions(db)],
    }


def page(db, trades: list[dict], th: dict | None = None, thin_set: set | None = None) -> dict:
    profile = edge_profile(trades, validated_keys(db))
    rows = db.get("learn_restrictions") or []
    return {"profile": profile, "scorecard": scorecard(db), "review": latest_review(db),
            "registry": registry_view(db, trades),
            "execution": execution_quality(db, trades, th or {}, thin_set or set()),
            "stability": stability_matrix(db, trades, profile, thin_set or set()),
            "ablation": signal_ablation(db, trades),
            "proposals": [r for r in rows if not r["active"] and not r.get("dismissed_at")],
            "restrictions": [r for r in rows if r["active"]],
            "recent_calls": db.query("SELECT id, at, source, symbol, verdict, direction, setup, grade, status, outcome, outcome_r "
                                     "FROM calls ORDER BY at DESC LIMIT 25"),
            "thresholds": {"min_warn": MIN_WARN, "min_propose": MIN_PROPOSE, "target_r": TARGET_R, "hold_hours": HOLD_MS // 3_600_000}}


def due_for_review(db, now: int | None = None) -> bool:
    """The automatic review runs once each Sunday (UTC). Running one by hand
    during the week doesn't cancel it."""
    now = now or now_ms()
    d = datetime.fromtimestamp(now / 1000, tz=timezone.utc)
    if d.weekday() != 6:
        return False
    return db.get("learn_review_auto_last") != week_key(now)


def mark_auto_review(db, review: dict) -> None:
    db.set("learn_review_auto_last", review["week"])

