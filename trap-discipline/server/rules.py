"""The rules engine: session eligibility and per-trade rule checks.

Violations carry the rule number so the coach and dashboard can cite the
playbook line that was broken.
"""
from __future__ import annotations

from datetime import datetime, timezone

MAJOR, MINOR, NOTE = "major", "minor", "note"


def utc_day(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def in_thin_hours(ms: int, th: dict) -> bool:
    h = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).hour
    return th["thin_hours_start_utc"] <= h < th["thin_hours_end_utc"]


def losses_on_day(trades: list[dict], day: str, before_ms: int | None = None) -> int:
    n = 0
    for t in trades:
        if not t.get("taken", 1) or t.get("status") != "closed" or not t.get("closed_at"):
            continue
        if utc_day(t["closed_at"]) != day:
            continue
        if before_ms is not None and t["closed_at"] > before_ms:
            continue
        if (t.get("net_pnl") or 0) < 0:
            n += 1
    return n


def session_status(now_ms: int, th: dict, trades: list[dict], *, next_funding_ms: dict[str, int] | None = None,
                   macro_today: bool = False, open_positions: int = 0) -> dict:
    """Clear / caution / stand down, with reasons (checklist SESSION ELIGIBILITY)."""
    reasons: list[dict] = []
    day = utc_day(now_ms)
    losses = losses_on_day(trades, day)     # shown for information; there is no daily loss limit
    status = "clear"
    # Thin liquidity hours (in_thin_hours) are no longer a stand-down / caution
    # trigger here, at Pat's request. Diagnostics still breaks out thin-hours
    # performance (see stats.diagnostics) so he can see for himself whether
    # the window is actually costing him, without the app pre-judging it.
    if macro_today:
        if status == "clear":
            status = "caution"
        reasons.append({"rule": None, "level": "caution", "text": "Macro event today (you flagged it). Stand down or drop the grade one letter."})
    for sym, nf in (next_funding_ms or {}).items():
        if nf and 0 <= nf - now_ms <= 60 * 60 * 1000:
            mins = int((nf - now_ms) / 60000)
            if status == "clear":
                status = "caution"
            reasons.append({"rule": None, "level": "caution", "text": f"{sym} funding settles in {mins} min. Drop the grade one letter or wait."})
    return {"status": status, "losses_today": losses, "reasons": reasons, "day": day,
            "open_positions": open_positions}


def evaluate_trade(t: dict, *, th: dict, equity_at_entry: float | None, stop_history: list[tuple[int, float]],
                   plan: dict | None, prior_losses_today: int, logged_at: int | None,
                   candles_after_entry: list[dict] | None = None) -> list[dict]:
    """Return the list of rule findings for one taken trade."""
    v: list[dict] = []
    if not t.get("taken", 1):
        return v
    long = (t.get("direction") or "Long") == "Long"
    sgn = 1 if long else -1
    entry, stop = t.get("entry"), t.get("stop")
    opened = t.get("opened_at")

    # Rule 2 / protective stop present
    stops = [s for _, s in sorted(stop_history) if s]
    if t.get("source") == "bybit" and not stops and not stop:
        v.append({"rule": 2, "severity": MAJOR, "code": "no_stop", "text": "No protective stop was ever set on the exchange."})
    elif t.get("source") == "bybit" and stop_history and opened:
        first_ts = min(ts for ts, s in stop_history if s) if stops else None
        if first_ts and first_ts - opened > 2 * 60 * 1000:
            v.append({"rule": 2, "severity": MINOR, "code": "late_stop", "text": f"Stop placed {int((first_ts - opened) / 60000)} min after entry."})

    # Rule 7: stop moved away from entry. Only increases in RISK distance count:
    # a stop trailed between breakeven and a prior profit lock is not a widen.
    if len(stops) >= 2 and entry:
        def risk_dist(s: float) -> float:
            return max(0.0, (entry - s) if long else (s - entry))
        worst_loosen = 0.0
        prev = stops[0]
        for s in stops[1:]:
            loosen = risk_dist(s) - risk_dist(prev)
            if loosen > 1e-12:
                worst_loosen = max(worst_loosen, loosen)
            prev = s
        if worst_loosen > 0:
            v.append({"rule": 7, "severity": MAJOR, "code": "stop_widened", "text": f"Stop moved away from entry by {worst_loosen:.6g}."})

    # Rule 1: risk
    risk = t.get("risk_usd")
    if risk and equity_at_entry:
        allowed = equity_at_entry * th["risk_pct"] / 100 * (1 + th.get("risk_tolerance_pct", 10) / 100)
        if risk > allowed:
            v.append({"rule": 1, "severity": MAJOR, "code": "over_risk",
                      "text": f"Risked {risk:,.2f} = {risk / equity_at_entry * 100:.2f}% of equity (limit {th['risk_pct']:g}%)."})

    # Rule 3: liquidation buffer
    lb = t.get("liq_buffer")
    if lb is not None and lb < th["liq_buffer_min"]:
        v.append({"rule": 3, "severity": MAJOR if lb < 1 else MINOR, "code": "liq_buffer",
                  "text": f"Liquidation only {lb:.2f} stop widths away (need {th['liq_buffer_min']:g})."
                          + (" You would be liquidated before the stop fired." if lb < 1 else "")})

    # Rule 4: leverage well above need
    lev = t.get("leverage")
    if lev and entry and stop and equity_at_entry and t.get("initial_qty"):
        need = t["initial_qty"] * entry / equity_at_entry
        if lev > max(need * 1.5, need + 2):
            v.append({"rule": 4, "severity": NOTE, "code": "excess_leverage", "text": f"Leverage {lev:g}x vs about {need:.1f}x needed."})

    # Rules 8 and 9 via the checklist plan
    if plan:
        chk = plan.get("checklist") or {}
        if plan.get("verdict") != "GO":
            v.append({"rule": 8, "severity": MAJOR, "code": "no_go_taken", "text": "Checklist verdict was NO TRADE, but the trade was taken."})
        g = chk.get("gates") or {}
        if g and not g.get("pass", True) and plan.get("verdict") == "GO":
            v.append({"rule": 8, "severity": MAJOR, "code": "gate_fail", "text": "A gate failed on the checklist."})
        if chk.get("third") == "middle":
            v.append({"rule": 9, "severity": MAJOR, "code": "middle_third", "text": "Entry was in the middle third of the range."})
        pe, ps = plan.get("entry"), plan.get("stop")
        if ps and stop and entry:
            planned_d = abs((pe or entry) - ps)
            if abs(stop - ps) > 0.25 * planned_d:
                v.append({"rule": 2, "severity": MINOR, "code": "stop_off_plan", "text": f"Stop {stop:g} differs from the plan's {ps:g}."})
        if plan.get("qty") and t.get("initial_qty") and t["initial_qty"] > plan["qty"] * 1.1:
            v.append({"rule": 1, "severity": MINOR, "code": "size_off_plan", "text": f"Initial size {t['initial_qty']:g} exceeded plan {plan['qty']:g}."})
    elif t.get("source") == "bybit":
        v.append({"rule": None, "severity": NOTE, "code": "no_checklist", "text": "No pre-trade checklist was run for this entry."})

    # Rule 13: add-on protocol
    legs = [g for g in (t.get("legs") or []) if g.get("kind") == "entry"]
    if entry and len(legs) > 1:
        for lg in legs[1:]:
            if sgn * (lg["price"] - entry) <= 0:
                v.append({"rule": 13, "severity": MAJOR, "code": "added_to_loser", "text": f"{lg['name']} at {lg['price']:g} added to a losing position (averaging down)."})
            elif stop and sgn * (lg["price"] - entry) < 0.8 * abs(entry - stop):
                v.append({"rule": 13, "severity": MINOR, "code": "early_add", "text": f"{lg['name']} came before +1R."})

    # Rule 6: no expansion by candle four, then held and lost
    if candles_after_entry and entry and stop and t.get("status") == "closed":
        d = abs(entry - stop)
        n = th["no_expansion_candles"]
        first = candles_after_entry[:n]
        if len(first) >= n:
            mfe = max((k["h"] - entry) if long else (entry - k["l"]) for k in first) / d
            held_past = t.get("closed_at") and t["closed_at"] > first[-1]["t"] + 15 * 60 * 1000
            if mfe < 0.5 and held_past and (t.get("r") or 0) < -0.2:
                v.append({"rule": 6, "severity": MAJOR, "code": "no_expansion_hold",
                          "text": f"No expansion by candle {n} (best +{mfe:.2f}R), held on, closed at {t.get('r') or 0:.2f}R."})

    # Rule 12: log within N minutes
    if t.get("status") == "closed" and t.get("closed_at") and logged_at:
        late = (logged_at - t["closed_at"]) / 60000
        if late > th["log_within_minutes"]:
            v.append({"rule": 12, "severity": MINOR, "code": "late_log", "text": f"Logged {late:.0f} min after the close."})

    if t.get("liquidated"):
        v.append({"rule": 3, "severity": MAJOR, "code": "liquidated", "text": "Position was liquidated."})
    return v


def process_score(violations: list[dict], journal_complete: bool) -> int:
    score = 100
    for x in violations:
        score -= {MAJOR: 25, MINOR: 10, NOTE: 3}.get(x["severity"], 0)
    if not journal_complete:
        score -= 10
    return max(0, min(100, score))


def followed_plan(violations: list[dict]) -> str:
    return "No" if any(x["severity"] == MAJOR for x in violations) else "Yes"
