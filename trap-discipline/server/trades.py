"""Turn raw Bybit executions into round-trip trades, and compute journal metrics.

A trade opens when the position leaves zero and closes when it returns to zero.
Same-direction fills after the first order are add-on legs. A fill that flips
the position closes the trade and opens a new one with the remainder.
"""
from __future__ import annotations

from datetime import datetime, timezone

EPS = 1e-12
FILL_TYPES = {"Trade", "AdlTrade", "BustTrade", "BlockTrade", "Settle", "Delivery", "MovePosition"}


def _new(symbol: str, direction: str, ex: dict) -> dict:
    return {"symbol": symbol, "direction": direction, "opened_at": ex["exec_time"], "closed_at": None,
            "legs": [], "exec_ids": [], "fees": 0.0, "funding": 0.0, "gross_pnl": 0.0,
            "pos": 0.0, "avg": 0.0, "max_qty": 0.0, "exit_qty": 0.0, "exit_value": 0.0,
            "liquidated": False}


def _leg(tr: dict, kind: str, ex: dict, qty: float, fee: float) -> None:
    legs = tr["legs"]
    if legs and legs[-1]["order_id"] == ex.get("order_id") and legs[-1]["kind"] == kind:
        lg = legs[-1]
        lg["value"] += ex["price"] * qty
        lg["qty"] += qty
        lg["price"] = lg["value"] / lg["qty"]
        lg["fee"] += fee
        lg["t_last"] = ex["exec_time"]
    else:
        n_entries = sum(1 for g in legs if g["kind"] == "entry")
        name = ("Initial" if n_entries == 0 else f"Add-on {n_entries}") if kind == "entry" else "Exit"
        legs.append({"kind": kind, "name": name, "order_id": ex.get("order_id"), "price": ex["price"],
                     "qty": qty, "value": ex["price"] * qty, "fee": fee, "t": ex["exec_time"],
                     "t_last": ex["exec_time"], "order_type": ex.get("order_type"),
                     "stop_order_type": ex.get("stop_order_type")})


def reconstruct(executions: list[dict], open_positions: dict[str, float] | None = None) -> list[dict]:
    """executions: dicts with exec_id, order_id, symbol, side, price, qty, fee,
    exec_type, exec_time. Returns trades (closed and at most one open per symbol)."""
    by_sym: dict[str, list[dict]] = {}
    for e in executions:
        by_sym.setdefault(e["symbol"], []).append(e)
    out: list[dict] = []
    for sym, rows in by_sym.items():
        rows.sort(key=lambda e: (e["exec_time"], e.get("exec_id", "")))
        tr: dict | None = None
        for ex in rows:
            et = ex.get("exec_type") or "Trade"
            if et == "Funding":
                if tr is not None:
                    tr["funding"] += float(ex.get("fee") or 0)
                    tr["exec_ids"].append(ex["exec_id"])
                continue
            if et not in FILL_TYPES:
                continue
            q = float(ex["qty"])
            if q <= 0:
                continue
            sgn = 1 if ex["side"] == "Buy" else -1
            fee_total = float(ex.get("fee") or 0)
            # A closing fill with no open trade in the window belongs to a position
            # opened before the backfill started. Skip it rather than inventing a
            # phantom opposite-direction trade.
            if tr is None and float(ex.get("closed_size") or 0) > 0:
                continue
            remaining = q
            while remaining > EPS:
                if tr is None:
                    tr = _new(sym, "Long" if sgn > 0 else "Short", ex)
                dir_sgn = 1 if tr["direction"] == "Long" else -1
                share = remaining / q
                if sgn == dir_sgn:
                    new_pos = tr["pos"] + remaining
                    tr["avg"] = (tr["avg"] * tr["pos"] + ex["price"] * remaining) / new_pos
                    tr["pos"] = new_pos
                    tr["max_qty"] = max(tr["max_qty"], new_pos)
                    _leg(tr, "entry", ex, remaining, fee_total * share)
                    tr["fees"] += fee_total * share
                    tr["exec_ids"].append(ex["exec_id"])
                    remaining = 0
                else:
                    closing = min(remaining, tr["pos"])
                    frac = closing / q
                    tr["gross_pnl"] += (ex["price"] - tr["avg"]) * closing * dir_sgn
                    tr["exit_qty"] += closing
                    tr["exit_value"] += ex["price"] * closing
                    tr["pos"] -= closing
                    _leg(tr, "exit", ex, closing, fee_total * frac)
                    tr["fees"] += fee_total * frac
                    if ex["exec_id"] not in tr["exec_ids"]:
                        tr["exec_ids"].append(ex["exec_id"])
                    if et in ("BustTrade",) or ex.get("create_type") == "CreateByLiq":
                        tr["liquidated"] = True
                    remaining -= closing
                    if tr["pos"] <= EPS * max(1.0, tr["max_qty"]):
                        tr["pos"] = 0.0
                        tr["closed_at"] = ex["exec_time"]
                        out.append(_finish(tr))
                        tr = None
                        if remaining > EPS:
                            fee_total_rem = fee_total * (remaining / q)
                            ex = dict(ex, fee=fee_total_rem)
                            q = remaining
                            fee_total = fee_total_rem
        if tr is not None:
            out.append(_finish(tr))
    out.sort(key=lambda t: t["opened_at"])
    return out


def _finish(tr: dict) -> dict:
    entries = [g for g in tr["legs"] if g["kind"] == "entry"]
    first = entries[0] if entries else None
    exit_px = tr["exit_value"] / tr["exit_qty"] if tr["exit_qty"] else None
    closed = tr["closed_at"] is not None
    net = tr["gross_pnl"] - tr["fees"] - tr["funding"]
    return {
        "symbol": tr["symbol"], "direction": tr["direction"],
        "opened_at": tr["opened_at"], "closed_at": tr["closed_at"],
        "status": "closed" if closed else "open",
        "entry": first["price"] if first else None,
        "avg_entry": tr["avg"],
        "initial_qty": first["qty"] if first else None,
        "qty": tr["max_qty"],
        "exit": exit_px,
        "fees": tr["fees"], "funding": tr["funding"],
        "gross_pnl": tr["gross_pnl"] if closed else None,
        "net_pnl": net if closed else None,
        "legs": [{k: v for k, v in g.items() if k != "value"} for g in tr["legs"]],
        "exec_ids": tr["exec_ids"],
        "liquidated": tr["liquidated"],
        "open_qty": tr["pos"],
    }


def utc_parts(ms: int | None) -> tuple[str | None, str | None]:
    if not ms:
        return None, None
    d = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    return d.strftime("%Y-%m-%d"), d.strftime("%H:%M")


def compute_metrics(t: dict, fee_pct: float | None = None) -> dict:
    """Journal auto columns (Risk $, Net P&L, R, liquidation buffer).

    Mirrors the Trap Journal workbook, with two improvements when exchange data
    exists: actual fees replace the flat fee assumption, and the real
    liquidation price replaces the leverage approximation.
    """
    out: dict = {}
    taken = t.get("taken", 1) in (1, True, "Yes")
    entry, stop, exit_, qty = t.get("entry"), t.get("stop"), t.get("exit"), t.get("qty")
    iq = t.get("initial_qty") or qty
    direction = t.get("direction") or "Long"
    if not taken:
        return {"risk_usd": None, "net_pnl": None, "r": None, "liq_buffer": None}
    if entry and stop and iq:
        out["risk_usd"] = abs(entry - stop) * iq
    else:
        out["risk_usd"] = None
    if t.get("source") == "bybit" and t.get("gross_pnl") is not None:
        out["net_pnl"] = (t.get("gross_pnl") or 0) - (t.get("fees") or 0) - (t.get("funding") or 0)
    elif entry and exit_ and qty:
        gross = (exit_ - entry if direction == "Long" else entry - exit_) * qty
        fp = (fee_pct if fee_pct is not None else 0.055) / 100
        out["net_pnl"] = gross - (entry + exit_) * qty * fp
    else:
        out["net_pnl"] = t.get("net_pnl")
    out["r"] = (out["net_pnl"] / out["risk_usd"]) if (out.get("net_pnl") is not None and out.get("risk_usd")) else None
    liq = t.get("liq_price")
    lev = t.get("leverage")
    if entry and stop and liq:
        out["liq_buffer"] = abs(entry - liq) / abs(entry - stop) if entry != stop else None
    elif entry and stop and lev:
        stop_pct = abs(entry - stop) / entry * 100
        out["liq_buffer"] = ((100 / lev) - 1) / stop_pct if stop_pct else None  # workbook formula
    else:
        out["liq_buffer"] = None
    return out
