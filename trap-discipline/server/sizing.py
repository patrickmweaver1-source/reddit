"""Position planner: initial entry sized from the stop, plus two add-ons.

Order of operations is fixed by the playbook and never reversed:
  invalidation -> stop distance -> size -> cost check -> target and deadline.

Add-on protocol (Pat's v1 addition, rule 13): add only after the trade has
expanded, at +1R and +2R by default. Before each add the protective stop for
the WHOLE position is moved so the worst-case loss (including fees) never
exceeds the original 1R. A stop is never moved away from entry (rule 7), so if
the risk-neutral stop would be looser than the current one, the current one is
kept.
"""
from __future__ import annotations

import math


def round_step(x: float, step: float, mode: str = "down") -> float:
    if not step:
        return x
    n = x / step
    n = math.floor(n + 1e-9) if mode == "down" else math.ceil(n - 1e-9) if mode == "up" else round(n)
    # keep float noise out of the display
    decimals = max(0, -int(math.floor(math.log10(step)))) if step < 1 else 0
    return round(n * step, decimals + 2)


def plan_position(*, equity: float, risk_pct: float, direction: str, entry: float, stop: float,
                  qty_step: float = 0.0, min_qty: float = 0.0, tick: float = 0.0,
                  taker_fee_pct: float = 0.055, maker_fee_pct: float = 0.02, slip_pct: float = 0.02,
                  target: float | None = None, leverage: float | None = None, mmr_pct: float = 0.5,
                  add1_r: float = 1.0, add1_frac: float = 0.5, add2_r: float = 2.0, add2_frac: float = 0.5,
                  cost_max_pct: float = 10.0, liq_buffer_min: float = 3.0) -> dict:
    errors: list[str] = []
    long = direction.lower().startswith("l")
    if equity <= 0:
        errors.append("Equity must be positive.")
    if entry <= 0 or stop <= 0:
        errors.append("Entry and stop must be positive prices.")
    if long and stop >= entry:
        errors.append("For a long, the stop must be below entry.")
    if not long and stop <= entry:
        errors.append("For a short, the stop must be above entry.")
    if errors:
        return {"ok": False, "errors": errors}

    d = abs(entry - stop)
    risk_usd = equity * risk_pct / 100
    fee_rt = entry * (2 * taker_fee_pct + 2 * slip_pct) / 100  # per unit, round trip
    raw_qty = risk_usd / d
    qty = round_step(raw_qty, qty_step, "down") if qty_step else raw_qty
    warnings: list[str] = []
    if qty <= 0:
        return {"ok": False, "errors": [f"At {risk_pct:g}% risk this stop allows only {raw_qty:.6g} units, which rounds below the exchange step {qty_step:g}. The trade cannot be sized."]}
    if min_qty and qty < min_qty:
        warnings.append(f"Size {qty:g} is below the exchange minimum {min_qty:g}. The trade cannot be taken at 1% risk with this stop.")
    actual_risk = qty * d
    notional = qty * entry
    stop_pct = d / entry * 100
    req_lev = risk_pct / stop_pct if stop_pct else None  # playbook: risk% / stop%
    # actual leverage needed to open this notional with all equity as margin
    min_lev_to_open = notional / equity if equity else None
    lev = leverage or max(1.0, math.ceil((min_lev_to_open or 1) * 10) / 10)
    # isolated-margin liquidation estimate: distance ~ entry * (1/L - mmr)
    liq_dist = entry * max(0.0, 1 / lev - mmr_pct / 100)
    liq_price = entry - liq_dist if long else entry + liq_dist
    liq_buffer = liq_dist / d if d else None
    cost_share = fee_rt / d * 100
    sgn = 1 if long else -1
    tgt_r = (sgn * (target - entry) - fee_rt) / d if target else None
    if tgt_r is not None and tgt_r < 0:
        warnings.append("The target sits on the LOSING side of entry for this direction. Check it.")

    if cost_share >= cost_max_pct:
        warnings.append(f"Cost gate fails: round-trip cost is {cost_share:.1f}% of the stop distance (limit {cost_max_pct:g}%).")
    if liq_buffer is not None and liq_buffer < liq_buffer_min:
        warnings.append(f"Liquidation sits only {liq_buffer:.2f} stop widths away (need {liq_buffer_min:g}). Lower the leverage.")
    if leverage and req_lev and leverage > max(req_lev, min_lev_to_open or 0) * 1.5 + 0.5:
        warnings.append(f"Leverage {leverage:g}x is well above what this trade needs (about {max(req_lev, min_lev_to_open or 0):.1f}x). Extra leverage is unused risk (rule 4).")

    legs = [{"name": "Initial", "trigger": entry, "qty": qty, "price": entry}]
    total_q = qty
    avg = entry
    cur_stop = stop
    ladder = []
    for i, (r_mult, frac) in enumerate(((add1_r, add1_frac), (add2_r, add2_frac)), start=1):
        px = entry + sgn * r_mult * d
        if tick:
            px = round_step(px, tick, "nearest")
        aq = round_step(qty * frac, qty_step, "down") if qty_step else qty * frac
        new_q = total_q + aq
        new_avg = (avg * total_q + px * aq) / new_q
        fees_future = new_avg * new_q * (2 * taker_fee_pct + 2 * slip_pct) / 100
        # stop such that loss at stop + fees == original risk
        allowed = max(risk_usd - fees_future, 0)
        neutral = new_avg - sgn * allowed / new_q
        if tick:
            neutral = round_step(neutral, tick, "up" if long else "down")
        # never loosen: long stop can only go up, short stop only down
        new_stop = max(neutral, cur_stop) if long else min(neutral, cur_stop)
        locked_r = sgn * (new_stop - new_avg) * new_q / risk_usd
        worst = sgn * (new_stop - new_avg) * new_q - fees_future
        viable = ((new_stop < px) if long else (new_stop > px)) and aq > 0 and worst >= -risk_usd * (1 + 1e-9)
        ladder.append({
            "name": f"Add-on {i}",
            "trigger_r": r_mult,
            "trigger": px,
            "qty": aq,
            "total_qty": new_q,
            "avg_entry": new_avg,
            "move_stop_to": new_stop,
            "stop_moved_from": cur_stop,
            "worst_case_usd": worst,
            "worst_case_r": worst / risk_usd if risk_usd else None,
            "locked_r": locked_r,
            "viable": viable,
            "note": ("Skip this add: the risk-neutral stop cannot be placed (fees or stop room make total risk exceed 1R)." if not viable else
                     "Move the stop FIRST, then add. Only after candle-four expansion."),
        })
        if viable:
            total_q, avg, cur_stop = new_q, new_avg, new_stop

    return {
        "ok": True,
        "errors": [],
        "warnings": warnings,
        "direction": "Long" if long else "Short",
        "risk_usd": risk_usd,
        "actual_risk_usd": actual_risk,
        "stop_dist": d,
        "stop_pct": stop_pct,
        "raw_qty": raw_qty,
        "qty": qty,
        "notional": notional,
        "required_leverage": req_lev,
        "min_leverage_to_open": min_lev_to_open,
        "leverage_used": lev,
        "liq_price_est": liq_price,
        "liq_buffer": liq_buffer,
        "round_trip_cost_per_unit": fee_rt,
        "round_trip_cost_usd": fee_rt * qty,
        "cost_share_pct": cost_share,
        "target": target,
        "target_r": tgt_r,
        "ladder": ladder,
        "final": {"qty": total_q, "avg_entry": avg, "stop": cur_stop},
        "arithmetic": [
            f"Risk = {equity:,.2f} x {risk_pct:g}% = {risk_usd:,.2f}",
            f"Stop distance = |{entry:g} - {stop:g}| = {d:.6g} ({stop_pct:.3f}% of price)",
            f"Size = {risk_usd:,.2f} / {d:.6g} = {raw_qty:.6g} -> rounded to step {qty_step or 'n/a'} = {qty:g}",
            f"Required leverage (risk% / stop%) = {risk_pct:g} / {stop_pct:.3f} = {req_lev:.2f}x",
            f"Round-trip cost = 2 x {taker_fee_pct:g}% + 2 x {slip_pct:g}% = {2*taker_fee_pct+2*slip_pct:.3f}% -> {cost_share:.1f}% of risk",
        ],
    }
