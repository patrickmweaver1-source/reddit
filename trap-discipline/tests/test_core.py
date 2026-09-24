import asyncio
import math

import aiohttp
import pytest

from server import analysis as A
from server import rules as R
from server import sizing as S
from server import stats as ST
from server import trades as T
from server.bybit import BybitREST, BybitWS, ReadOnlyViolation, evaluate_key_info, sign


# ---------------------------------------------------------------- read-only guarantees
def test_rest_rejects_non_allowlisted_paths():
    async def go():
        async with aiohttp.ClientSession() as s:
            c = BybitREST(s, "k", "s", base="http://127.0.0.1:9")
            for path in ("/v5/order/create", "/v5/order/cancel", "/v5/position/set-leverage",
                         "/v5/asset/withdraw/create", "/v5/position/trading-stop"):
                with pytest.raises(ReadOnlyViolation):
                    await c.get_private(path, {})
    asyncio.run(go())


def test_rest_has_no_write_methods():
    for name in dir(BybitREST):
        assert not name.lower().startswith(("post", "put", "delete", "place", "cancel", "amend", "create_order"))


def test_ws_rejects_order_ops():
    async def go():
        ws = BybitWS(None, "wss://x", [], None)
        ws._ws = object()
        with pytest.raises(ReadOnlyViolation):
            await ws._send({"op": "order.create", "args": []})
    asyncio.run(go())


# ---- RELEASE BLOCKER: nothing in the app may reach a money-moving endpoint ----
# Bybit's write surface. If any of these strings appears in an allowlist or
# anywhere in the server source, a code path could move money. This test must
# stay green for every release (see the read-only architecture note).
_MUTATING_PATHS = (
    "/v5/order/create", "/v5/order/amend", "/v5/order/cancel", "/v5/order/cancel-all",
    "/v5/order/create-batch", "/v5/order/amend-batch", "/v5/order/cancel-batch",
    "/v5/position/set-leverage", "/v5/position/switch-isolated", "/v5/position/set-tpsl-mode",
    "/v5/position/set-risk-limit", "/v5/position/trading-stop", "/v5/position/set-auto-add-margin",
    "/v5/position/add-margin", "/v5/asset/withdraw/create", "/v5/asset/withdraw/cancel",
    "/v5/asset/transfer/inter-transfer", "/v5/asset/transfer/universal-transfer",
    "/v5/account/set-margin-mode", "/v5/account/set-collateral-switch",
)


def test_no_mutating_endpoint_is_allowlisted():
    from server.bybit import PUBLIC_GET, PRIVATE_GET
    allow = PUBLIC_GET | PRIVATE_GET
    # every allowlisted path is a read path, and none is a known mutating one
    for p in allow:
        assert p not in _MUTATING_PATHS
        assert not any(seg in p for seg in ("create", "cancel", "amend", "withdraw",
                                            "transfer", "set-", "trading-stop", "add-margin"))


def test_rest_rejects_every_known_mutating_path():
    async def go():
        async with aiohttp.ClientSession() as s:
            c = BybitREST(s, "k", "s", base="http://127.0.0.1:9")
            for path in _MUTATING_PATHS:
                with pytest.raises(ReadOnlyViolation):
                    await c.get_private(path, {})
                with pytest.raises(ReadOnlyViolation):
                    await c.get_public(path, {})
    asyncio.run(go())


def test_server_source_contains_no_mutating_bybit_path():
    """Scan every shipped server module: no money-moving Bybit path may appear
    anywhere in the code, not even in a string, so a future edit can't quietly
    introduce one. The read-only allowlist is the only door and this proves no
    one built a second one."""
    import pathlib
    srcdir = pathlib.Path(__file__).resolve().parent.parent / "server"
    offenders = []
    for f in srcdir.glob("*.py"):
        text = f.read_text()
        for bad in _MUTATING_PATHS:
            if bad in text:
                offenders.append(f"{f.name}: {bad}")
    assert not offenders, "mutating Bybit path found in source: " + "; ".join(offenders)


def test_key_evaluation():
    good = evaluate_key_info({"readOnly": 1, "permissions": {"ContractTrade": ["Order", "Position"], "Wallet": []}})
    assert good["ok"]
    rw = evaluate_key_info({"readOnly": 0, "permissions": {}})
    assert not rw["ok"] and rw["problems"]
    wd = evaluate_key_info({"readOnly": 1, "permissions": {"Wallet": ["Withdraw"]}})
    assert not wd["ok"]


def test_signature_matches_documented_scheme():
    # HMAC_SHA256(secret, timestamp + key + recv_window + queryString), lowercase hex
    import hashlib, hmac
    payload = "1658385579423" + "XXXXXXXXXX" + "5000" + "category=linear&symbol=ETHUSDT"
    assert sign("secret", payload) == hmac.new(b"secret", payload.encode(), hashlib.sha256).hexdigest()


# ---------------------------------------------------------------- sizing
def test_sizing_initial_and_addons_keep_risk_at_1r():
    p = S.plan_position(equity=50_000, risk_pct=1, direction="Long", entry=100, stop=99, qty_step=0.01,
                        taker_fee_pct=0.0, slip_pct=0.0)
    assert p["ok"]
    assert math.isclose(p["qty"], 500)
    assert math.isclose(p["required_leverage"], 1.0)
    a1, a2 = p["ladder"]
    assert math.isclose(a1["trigger"], 101) and math.isclose(a1["qty"], 250)
    # stop for 750 units at avg 100.333 so loss == 500
    assert math.isclose(a1["move_stop_to"], 100 - 1 / 3, rel_tol=1e-6)
    assert abs(a1["worst_case_usd"] + 500) < 1e-6
    assert math.isclose(a2["move_stop_to"], 100.25, rel_tol=1e-6)
    assert a1["viable"] and a2["viable"]


def test_sizing_short_and_errors():
    p = S.plan_position(equity=10_000, risk_pct=1, direction="Short", entry=10, stop=10.2)
    assert p["ok"] and math.isclose(p["qty"], 500)
    bad = S.plan_position(equity=10_000, risk_pct=1, direction="Long", entry=10, stop=10.2)
    assert not bad["ok"]


def test_sizing_never_loosens_stop():
    p = S.plan_position(equity=50_000, risk_pct=1, direction="Long", entry=100, stop=99, add1_r=0.2, add1_frac=2.0,
                        taker_fee_pct=0, slip_pct=0)
    a1 = p["ladder"][0]
    assert a1["move_stop_to"] >= 99


# ---------------------------------------------------------------- trades
def ex(i, side, price, qty, t, fee=0.0, oid=None, et="Trade"):
    return {"exec_id": str(i), "order_id": oid or str(i), "symbol": "ETHUSDT", "side": side, "price": price,
            "qty": qty, "fee": fee, "exec_type": et, "exec_time": t}


def test_reconstruct_round_trip_with_addons_and_partial_exits():
    rows = [ex(1, "Buy", 100, 1, 1, 0.1, "a"), ex(2, "Buy", 100, 1, 2, 0.1, "a"),  # initial 2 via one order
            ex(3, "Buy", 102, 1, 3, 0.1, "b"),                                     # add-on
            ex(4, "Sell", 105, 2, 4, 0.2, "c"), ex(5, "Sell", 104, 1, 5, 0.1, "d")]
    out = T.reconstruct(rows)
    assert len(out) == 1
    t = out[0]
    assert t["status"] == "closed" and t["direction"] == "Long"
    assert t["entry"] == 100 and t["initial_qty"] == 2 and t["qty"] == 3
    avg = (200 + 102) / 3
    assert math.isclose(t["gross_pnl"], (105 - avg) * 2 + (104 - avg) * 1)
    assert math.isclose(t["fees"], 0.6)
    names = [g["name"] for g in t["legs"]]
    assert names == ["Initial", "Add-on 1", "Exit", "Exit"]


def test_reconstruct_flip_splits_trades():
    rows = [ex(1, "Sell", 50, 2, 1), ex(2, "Buy", 48, 3, 2)]
    out = T.reconstruct(rows)
    assert len(out) == 2
    assert out[0]["direction"] == "Short" and out[0]["status"] == "closed"
    assert math.isclose(out[0]["gross_pnl"], 4)
    assert out[1]["direction"] == "Long" and out[1]["status"] == "open" and math.isclose(out[1]["open_qty"], 1)


def test_funding_attaches_to_open_trade():
    rows = [ex(1, "Buy", 10, 5, 1), ex(2, "Sell", 0, 0.0001, 2, 0.3, et="Funding"), ex(3, "Sell", 11, 5, 3)]
    t = T.reconstruct(rows)[0]
    assert math.isclose(t["funding"], 0.3) and math.isclose(t["net_pnl"], 5 - 0.3)


def test_metrics_match_workbook_formulas():
    # workbook example row: 95240 entry, 94810 stop, 96100 exit, 1.16 qty, 3x, taker 0.055
    t = {"taken": 1, "direction": "Long", "entry": 95240, "stop": 94810, "exit": 96100, "qty": 1.16, "leverage": 3}
    m = T.compute_metrics(t, 0.055)
    assert math.isclose(m["risk_usd"], 430 * 1.16)
    net = 860 * 1.16 - (95240 + 96100) * 1.16 * 0.00055
    assert math.isclose(m["net_pnl"], net)
    assert math.isclose(m["r"], net / (430 * 1.16))
    stop_pct = 430 / 95240 * 100
    assert math.isclose(m["liq_buffer"], ((100 / 3) - 1) / stop_pct)


# ---------------------------------------------------------------- rules
TH = {"risk_pct": 1.0, "liq_buffer_min": 3.0, "no_expansion_candles": 4, "daily_loss_limit": 3, "log_within_minutes": 10,
      "thin_hours_start_utc": 3, "thin_hours_end_utc": 7, "risk_tolerance_pct": 10}


def test_rules_flag_widened_stop_and_over_risk_and_late_log():
    t = {"taken": 1, "status": "closed", "source": "bybit", "direction": "Long", "entry": 100, "stop": 99, "initial_qty": 1000,
         "opened_at": 12 * 3_600_000, "closed_at": 13 * 3_600_000, "risk_usd": 1000, "liq_buffer": 5, "legs": []}
    v = R.evaluate_trade(t, th=TH, equity_at_entry=50_000, stop_history=[(1, 99.0), (2, 98.0)], plan=None,
                         prior_losses_today=0, logged_at=13 * 3_600_000 + 30 * 60_000)
    codes = {x["code"] for x in v}
    assert {"stop_widened", "over_risk", "late_log", "no_checklist"} <= codes
    assert R.followed_plan(v) == "No"


def test_rules_clean_trade():
    t = {"taken": 1, "status": "closed", "source": "manual", "direction": "Short", "entry": 100, "stop": 101, "initial_qty": 400,
         "opened_at": 12 * 3_600_000, "closed_at": 13 * 3_600_000, "risk_usd": 400, "liq_buffer": 8, "legs": []}
    v = R.evaluate_trade(t, th=TH, equity_at_entry=50_000, stop_history=[], plan=None, prior_losses_today=0,
                         logged_at=13 * 3_600_000 + 60_000)
    assert v == [] and R.followed_plan(v) == "Yes" and R.process_score(v, True) == 100


def test_no_daily_loss_limit_and_averaging_down():
    t = {"taken": 1, "status": "closed", "source": "manual", "direction": "Long", "entry": 100, "stop": 99, "initial_qty": 100,
         "opened_at": 12 * 3_600_000, "closed_at": 13 * 3_600_000, "risk_usd": 100,
         "legs": [{"kind": "entry", "name": "Initial", "price": 100}, {"kind": "entry", "name": "Add-on 1", "price": 99.5}]}
    v = R.evaluate_trade(t, th=TH, equity_at_entry=50_000, stop_history=[], plan=None, prior_losses_today=3, logged_at=None)
    codes = {x["code"] for x in v}
    assert "added_to_loser" in codes and "loss_limit" not in codes   # the daily loss limit was removed


def test_session_status_thin_hours_no_longer_stands_down_and_no_loss_stop():
    # Thin liquidity hours were removed as a stand-down/caution trigger at Pat's
    # request (they used to force "stand_down" at 4 AM UTC; now they're clear).
    four_am = 4 * 3_600_000
    st = R.session_status(four_am, TH, [])
    assert st["status"] == "clear" and not st["reasons"]
    losers = [{"taken": 1, "status": "closed", "closed_at": four_am - i, "net_pnl": -1} for i in range(3)]
    noon = 12 * 3_600_000
    losers = [{"taken": 1, "status": "closed", "closed_at": noon - i, "net_pnl": -1} for i in range(5)]
    st = R.session_status(noon, TH, losers)
    assert st["status"] == "clear" and st["losses_today"] == 5 and not st["reasons"]


# ---------------------------------------------------------------- analysis
def mk(closes, start=0, spread=0.5, vol=100):
    out = []
    prev = closes[0]
    for i, c in enumerate(closes):
        o = prev
        out.append({"t": start + i * A.MS_15M, "o": o, "h": max(o, c) + spread, "l": min(o, c) - spread, "c": c, "v": vol})
        prev = c
    return out


def test_state_machine_spring_triggered():
    base = [101.0] * 20
    seq = base + [100.6, 99.4, 99.3, 100.4]  # close through 100, stall, reclaim
    c = mk(seq)
    st = A.level_state(100.0, c, 2.0, floor_atr=0.25, abandon_atr=1.0)
    assert st["state"] == "TRIGGERED" and st["setup"] == "Spring" and st["direction"] == "Long"
    assert math.isclose(st["pen_atr"], 0.35)  # deepest beyond-close (99.3), not just the break candle


def test_state_machine_shallow_ran_timeout():
    c = mk([101.0] * 20 + [99.8])
    assert A.level_state(100.0, c, 2.0)["state"] == "DEAD_SHALLOW"
    c = mk([101.0] * 20 + [99.0, 97.0])
    assert A.level_state(100.0, c, 2.0)["state"] == "DEAD_RAN"
    c = mk([101.0] * 20 + [99.3, 99.2, 99.25, 99.3, 99.2])
    assert A.level_state(100.0, c, 2.0)["state"] == "DEAD_TIMED_OUT"


def test_state_machine_window_boundary_is_consistent():
    # window 4 = at most 4 closes beyond, counting the break candle
    c = mk([101.0] * 20 + [99.3, 99.2, 99.25, 99.3, 100.4])          # 4 beyond, then reclaim
    st = A.level_state(100.0, c, 2.0, max_candles=4)
    assert st["state"] == "TRIGGERED" and st["setup"] == "Spring" and st["candles_since_break"] == 4
    c = mk([101.0] * 20 + [99.3, 99.2, 99.25, 99.3, 99.2])           # 5 beyond, no reclaim yet
    assert A.level_state(100.0, c, 2.0, max_candles=4)["state"] == "DEAD_TIMED_OUT"
    c = mk([101.0] * 20 + [99.3, 99.2, 99.25, 99.3, 99.2, 100.4])    # ...then the reclaim is a retest, never a Spring
    st = A.level_state(100.0, c, 2.0, max_candles=4)
    assert st["state"] == "TRIGGERED" and st["setup"] == "Failed retest"


def test_state_machine_recruiting_and_approaching():
    c = mk([101.0] * 20 + [99.3])
    assert A.level_state(100.0, c, 2.0)["state"] in ("RECRUITING", "WATCH")
    c = mk([101.5] * 20, spread=0.1)
    assert A.level_state(100.0, c, 2.0)["state"] == "APPROACHING"
    c = mk([110.0] * 20, spread=0.1)
    assert A.level_state(100.0, c, 2.0)["state"] == "DORMANT"


def test_gates_arithmetic():
    th = {"range_atr_min": 6, "range_stop_min": 4, "thin_range_pct_min": 2, "cost_pct_of_risk_max": 10}
    g = A.gates(12.0, 2.0, 100.0, 1.5, 0.055, 0.02, False, th)
    assert g["range"]["ok"] and math.isclose(g["range"]["ratio_atr"], 8.0)
    assert math.isclose(g["cost"]["share_pct"], 100 * 0.15 / 100 / 2 * 100)
    assert g["pass"]
    g2 = A.gates(5.0, 2.0, 100.0, 1.5, 0.055, 0.02, False, th)
    assert not g2["pass"]


def test_mechanism_matrix():
    assert A.classify_mechanism(1.0, 2.0, 3.0)["code"] == "newlong"
    assert A.classify_mechanism(1.0, 2.0, -3.0)["code"] == "squeeze"
    assert A.classify_mechanism(-1.0, 2.0, -3.0)["code"] == "flush"
    assert A.classify_mechanism(0.0, 0.8, 3.0)["code"] == "coil"
    assert A.classify_mechanism(0.0, 2.5, 3.0)["code"] == "absorb"


def test_liquidation_heatmap_empty():
    assert A.liquidation_heatmap([], 100.0, 2.0) is None
    assert A.liquidation_heatmap([{"ts": 1, "side": "Buy", "size": 1, "price": 100.0}], 0, 2.0) is None


def test_liquidation_heatmap_bucketing_and_sides():
    price, atr = 100.0, 1.0
    liqs = [
        {"ts": 10, "side": "Buy", "size": 5.0, "price": 100.2},   # long liquidated, in-band
        {"ts": 20, "side": "Sell", "size": 3.0, "price": 100.2},  # short liquidated, same bucket
        {"ts": 5, "side": "Buy", "size": 2.0, "price": 100.3},    # earliest ts
        {"ts": 30, "side": "Sell", "size": 1.0, "price": 100.0 + 999},  # far outside the band
    ]
    hm = A.liquidation_heatmap(liqs, price, atr, n_buckets=26, band_atr=6.0, now=30)
    assert hm is not None
    assert hm["n"] == 3
    assert hm["outside"] == 1
    assert hm["since_ts"] == 5
    total_long = sum(r["long_liq"] for r in hm["rows"])
    total_short = sum(r["short_liq"] for r in hm["rows"])
    assert math.isclose(total_long, 7.0)
    assert math.isclose(total_short, 3.0)
    # the nearby-priced events (100.2, 100.3, 100.2) all land in the same narrow bucket
    matching = [r for r in hm["rows"] if r["long_liq"] > 0 and r["short_liq"] > 0]
    assert len(matching) == 1
    assert math.isclose(matching[0]["total"], 10.0)
    assert hm["peak"] == max(r["total"] for r in hm["rows"])
    # observed-map enrichments: recency decay, percentile, ATR-normalization, coverage
    assert hm["band_atr"] == 10.0 and hm["bucket_atr"] is not None   # 10%-of-price floor widened 6 ATR to 10
    assert hm["coverage_hours"] is not None
    assert 0 < hm["concentration"] <= 1 and hm["concentration3"] >= hm["concentration"]
    assert matching[0]["decayed"] > 0 and matching[0]["pctile"] is not None


def test_liquidation_heatmap_recency_decay_favors_recent_prints():
    # two equal-size prints, one now and one a half-life ago, in different bands
    now = 10_000_000_000
    hl = A.LIQ_HALF_LIFE_MS
    liqs = [{"ts": now, "side": "Buy", "size": 4.0, "price": 101.0},
            {"ts": now - hl, "side": "Buy", "size": 4.0, "price": 99.0}]
    hm = A.liquidation_heatmap(liqs, 100.0, 1.0, now=now)
    recent = next(r for r in hm["rows"] if r["lo"] <= 101.0 < r["hi"])
    old = next(r for r in hm["rows"] if r["lo"] <= 99.0 < r["hi"])
    assert recent["total"] == old["total"]              # raw size equal
    assert recent["decayed"] > old["decayed"] * 1.8     # but recent weighs ~2x


# ---------------------------------------------------------------- dynamic liquidity state
def _cndl(o, c, q, t=0):
    return {"t": t, "o": o, "h": max(o, c), "l": min(o, c), "c": c, "v": q, "q": q}


def test_liquidity_state_normal_vs_degraded():
    # baseline: 96 calm candles, tiny moves on healthy volume
    base = [_cndl(100.0, 100.05, 1_000_000, i) for i in range(96)]
    # recent 8 unchanged -> normal
    normal = A.liquidity_state(base + [_cndl(100.0, 100.05, 1_000_000, 100 + i) for i in range(8)], thin=False)
    assert normal["state"] == "normal" and normal["impact_ratio"] is not None
    # recent 8: same size moves but volume collapses and price swings more -> impact rises
    degraded = A.liquidity_state(base + [_cndl(100.0, 101.5, 120_000, 200 + i) for i in range(8)], thin=False)
    assert degraded["state"] in ("degraded", "severely_thin")
    assert degraded["impact_ratio"] > normal["impact_ratio"]


def test_liquidity_state_unknown_without_enough_candles():
    assert A.liquidity_state([_cndl(100, 100.1, 1000, i) for i in range(5)], thin=False)["state"] == "unknown"


def test_liquidity_state_reads_spread_when_present():
    base = [_cndl(100.0, 100.05, 1_000_000, i) for i in range(96)]
    wide = A.liquidity_state(base, thin=False, ticker={"bid1Price": "100.0", "ask1Price": "100.5"})
    assert wide["spread_bps"] is not None and wide["spread_bps"] > 40
    assert wide["state"] in ("degraded", "severely_thin")


# ---------------------------------------------------------------- stats
def test_kpis_profit_factor_and_adherence():
    trades = [{"taken": 1, "status": "closed", "r": 2.0, "net_pnl": 200, "followed_plan": "Yes", "grade": "A", "setup": "Spring"},
              {"taken": 1, "status": "closed", "r": -1.0, "net_pnl": -100, "followed_plan": "No", "grade": "C", "setup": "Sweep"},
              {"taken": 0, "status": "skipped"}]
    k = ST.kpis(trades, 1000)
    assert math.isclose(k["expectancy_r"], 0.5) and math.isclose(k["profit_factor"], 2.0)
    assert k["skipped"] == 1 and math.isclose(k["rule_adherence"], 0.5) and k["to_30"] == 28


# ---------------------------------------------------------------- regression tests from the independent reviews
def test_sizing_zero_qty_returns_error_not_crash():
    p = S.plan_position(equity=100, risk_pct=1, direction="Long", entry=100, stop=90, qty_step=1)
    assert not p["ok"] and "cannot be sized" in p["errors"][0]


def test_sizing_addon_never_viable_past_1r():
    p = S.plan_position(equity=10_000, risk_pct=1, direction="Long", entry=100, stop=99.9)
    for leg in p["ladder"]:
        assert not leg["viable"] or leg["worst_case_r"] >= -1.0000001


def test_sizing_target_sign_follows_direction():
    p = S.plan_position(equity=10_000, risk_pct=1, direction="Long", entry=100, stop=99, target=95,
                        taker_fee_pct=0, slip_pct=0)
    assert p["target_r"] == -5.0 and any("LOSING side" in w for w in p["warnings"])


def test_reconstruct_skips_orphan_closing_fill():
    rows = [dict(ex(1, "Sell", 105, 2, 1), closed_size=2), ex(2, "Buy", 100, 3, 2)]
    out = T.reconstruct(rows)
    assert len(out) == 1 and out[0]["direction"] == "Long" and out[0]["status"] == "open"


def test_rule7_trailing_profit_stop_is_not_a_widen():
    t = {"taken": 1, "status": "closed", "source": "bybit", "direction": "Long", "entry": 100, "stop": 95,
         "initial_qty": 1, "opened_at": 12 * 3_600_000, "closed_at": 13 * 3_600_000, "risk_usd": 5, "liq_buffer": 9, "legs": []}
    v = R.evaluate_trade(t, th=TH, equity_at_entry=50_000, stop_history=[(1, 95.0), (2, 110.0), (3, 105.0)],
                         plan=None, prior_losses_today=0, logged_at=13 * 3_600_000 + 60_000)
    assert not any(x["code"] == "stop_widened" for x in v)
    v2 = R.evaluate_trade(t, th=TH, equity_at_entry=50_000, stop_history=[(1, 96.0), (2, 94.0)],
                          plan=None, prior_losses_today=0, logged_at=13 * 3_600_000 + 60_000)
    assert any(x["code"] == "stop_widened" for x in v2)


def test_gradual_spring_uses_deepest_close():
    c = mk([101.0] * 20 + [99.8, 99.0, 100.5])
    st = A.level_state(100.0, c, 2.0, floor_atr=0.25, abandon_atr=1.0)
    assert st["state"] == "TRIGGERED" and math.isclose(st["pen_atr"], 0.5)


def test_bare_round_number_scores_zero_c1():
    flat = mk([100.0] * 200, spread=0.05)
    lv = A.detect_levels(flat, A and mk([100.0] * 60, spread=0.05), mk([100.0] * 10, spread=0.05),
                         mk([100.0] * 5, spread=0.05), 100.0, 0.5)
    assert all(l["c1"] == 0 for l in lv if set(l["sources"]) <= {"round", "wide"})


def test_game_daily_cap_bounded_to_one_day(tmp_path):
    from server.db import DB
    from server import game as G
    db = DB(tmp_path / "x.db")
    day = 1_700_000_000_000
    for i in range(8):
        G.award(db, "skip_logged", f"k{i}", ts=day)
    assert G.award(db, "skip_logged", "same-day", ts=day) == 0
    assert G.award(db, "skip_logged", "prior-day", ts=day - 86_400_000) == 25
    db.close()


def test_night_owl_handles_single_digit_hour(tmp_path):
    from server.db import DB
    from server import game as G
    db = DB(tmp_path / "y.db")
    db.insert_trade({"symbol": "ETHUSDT", "taken": 0, "status": "skipped", "source": "manual",
                     "date": "2026-09-22", "time_utc": "3:15", "reviewed_at": 1})
    new = G.check_badges(db)  # must not raise
    assert any(b["code"] == "night_owl" for b in new)
    db.close()


def test_existing_rulebook_drops_the_loss_limit(tmp_path, monkeypatch):
    """An install created before the change gets a new rulebook version without old rule 10."""
    import json
    import sys
    monkeypatch.setenv("TRAP_DATA_DIR", str(tmp_path))
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]
    from server import config
    from server.core import TrapApp
    a = TrapApp(demo=True)
    old_rules = config.DEFAULT_RULES + [{"n": 10, "title": "Three losses, done", "text": "Three losses in a day: stop for the day."}]
    old_th = dict(config.DEFAULT_THRESHOLDS, daily_loss_limit=3)
    a.db.execute("INSERT INTO rule_versions(ts,rules,thresholds,setups,note) VALUES(?,?,?,?,?)",
                 (1, json.dumps(old_rules), json.dumps(old_th), json.dumps(config.DEFAULT_SETUPS), "old"))
    a.db.close(); a.shared.close()
    b = TrapApp(demo=True)
    rb = b.rulebook()
    assert not any(r["n"] == 10 for r in rb["rules"]) and "daily_loss_limit" not in rb["thresholds"]
    assert "three-losses" in rb["note"]
    n = b.db.one("SELECT COUNT(*) AS n FROM rule_versions")["n"]
    b.db.close(); b.shared.close()
    c = TrapApp(demo=True)          # runs once, not on every start
    assert c.db.one("SELECT COUNT(*) AS n FROM rule_versions")["n"] == n
    c.db.close(); c.shared.close()
