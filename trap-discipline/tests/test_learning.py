"""Learning: the report card on the app's own calls, the edge profile from the
journal, lessons, the weekly review, and personal blocks (stricter only)."""
import asyncio
import json
import sys
from datetime import datetime, timezone

import pytest

Q = 15 * 60_000
T0 = 1_790_000_000_000 - (1_790_000_000_000 % Q)


@pytest.fixture()
def L(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAP_DATA_DIR", str(tmp_path))
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]
    from server import learning
    return learning


def bars(path, start=T0):
    """path: list of (open, high, low, close) for consecutive 15m candles starting at `start`."""
    return [{"t": start + i * Q, "o": o, "h": h, "l": lo, "c": c, "v": 1} for i, (o, h, lo, c) in enumerate(path)]


# ---------------------------------------------------------------- simulate
def test_simulate_target_stop_timeout_and_same_candle(L):
    # Long from 100, stop 99 (1R = 1): target 102
    up = bars([(100, 100.5, 99.5, 100.2), (100.2, 102.3, 100.1, 102.0)])
    assert L.simulate(up, "Long", 100, 99, T0, needs_fill=False) == {"outcome": "target", "r": 2.0}
    down = bars([(100, 100.2, 98.9, 99.0)])
    assert L.simulate(down, "Long", 100, 99, T0, needs_fill=False)["outcome"] == "stop"
    both = bars([(100, 102.5, 98.5, 101)])                     # one candle touches both: assume the worse
    assert L.simulate(both, "Long", 100, 99, T0, needs_fill=False)["r"] == -1.0
    flat = bars([(100, 100.4, 99.6, 100.3)] * 40)              # 10 hours of chop: exit at the 8-hour mark
    out = L.simulate(flat, "Long", 100, 99, T0, needs_fill=False, cost_pct=0.1)   # 0.1% of 100 over a 1.0 stop = 0.1R
    assert out["outcome"] == "timeout" and out["r"] == pytest.approx(0.3 - 0.1)
    short = bars([(100, 100.2, 97.9, 98)])
    assert L.simulate(short, "Short", 100, 101, T0, needs_fill=False)["outcome"] == "target"


def test_simulate_needs_a_close_through_the_trigger(L):
    # WATCH call: trigger 100 not reclaimed yet; wick above but close below does NOT fill
    wick_only = bars([(99, 100.5, 99.2, 99.5)] * 9)
    assert L.simulate(wick_only, "Long", 100, 99, T0, needs_fill=True)["outcome"] == "no_fill"
    # fills at the CLOSE of the reclaim candle (100.1), so the +2R target is measured from there
    fills_then_wins = bars([(99.5, 100.3, 99.2, 100.1), (100.1, 101.8, 100, 101.7), (101.7, 102.5, 101.6, 102.4)])
    out = L.simulate(fills_then_wins, "Long", 100, 99, T0, needs_fill=True)
    assert out["outcome"] == "target"
    assert L.simulate(fills_then_wins[:2], "Long", 100, 99, T0, needs_fill=True)["outcome"] == "pending"  # 101.8 < 102.3
    # a wick through the stop before the reclaim voids the idea
    broke_first = bars([(99.5, 99.8, 98.7, 99.4), (99.4, 100.6, 99.3, 100.5), (100.5, 103, 100.4, 102.9)])
    assert L.simulate(broke_first, "Long", 100, 99, T0, needs_fill=True)["outcome"] == "invalidated"
    assert L.simulate([], "Long", 100, 100, T0, needs_fill=False)["outcome"] == "void"


def test_simulate_never_uses_candles_from_before_the_call_or_guesses_over_gaps(L):
    # call made 10 minutes into a candle that had already spiked to the target: that spike doesn't count
    t_call = T0 + 10 * 60_000
    path = bars([(100, 102.5, 99.9, 100.1)] + [(100.1, 100.4, 99.8, 100.2)] * 3)
    assert L.simulate(path, "Long", 100.1, 99, t_call, needs_fill=False)["outcome"] == "pending"
    # a hole in the candles is reported, not skipped over
    holey = bars([(100, 100.2, 99.8, 100)] * 3) + bars([(100, 100.2, 98, 99)], start=T0 + 10 * Q)
    assert L.simulate(holey, "Long", 100, 99, T0, needs_fill=False)["outcome"] == "gap"
    # missing candles at the start are a gap too
    late = bars([(100, 100.2, 99.8, 100)] * 3, start=T0 + 2 * Q)
    assert L.simulate(late, "Long", 100, 99, T0, needs_fill=False)["outcome"] == "gap"


def test_free_text_never_becomes_a_label(L):
    rows = [trade(-1, setup="Spring $50k acct entry 64210", symbol="my btc <b>x</b>", grade="A+") for _ in range(10)]
    p = L.edge_profile(rows)
    dump = json.dumps(p)
    assert "50k" not in dump and "64210" not in dump and "<b>" not in dump and "A+" not in dump


def test_cost_in_r(L):
    # 0.055% fee and 0.02% slip each side at price 100 with a 1.0 stop = 0.15R
    assert L.cost_r(100, 99, 0.055, 0.02) == pytest.approx(0.15)


# ---------------------------------------------------------------- edge profile
def trade(r, **kw):
    t = {"taken": 1, "status": "closed", "r": r, "symbol": "ETHUSDT", "direction": "Long", "setup": "Spring",
         "grade": "A", "opened_at": int(datetime(2026, 9, 1, 15, tzinfo=timezone.utc).timestamp() * 1000),
         "context": {"regime": "uptrend"}, "violations": []}
    t.update(kw)
    return t


def test_profile_needs_evidence_before_calling_a_leak(L):
    few = [trade(-1, setup="Upthrust", direction="Short") for _ in range(5)]
    p = L.edge_profile(few)
    assert not p["leaks"]                                   # 5 losses is not a pattern yet
    many = [trade(-1 if i % 4 else 1.5, setup="Upthrust", direction="Short", symbol="FARTCOINUSDT") for i in range(12)]
    good = [trade(2 if i % 3 else -1) for i in range(12)]
    p = L.edge_profile(many + good)
    leaks = {(b["dim"], b["value"]) for b in p["leaks"]}
    edges = {(b["dim"], b["value"]) for b in p["edges"]}
    assert ("setup", "Upthrust") in leaks and ("setup+symbol", "Upthrust on FARTCOINUSDT") in leaks
    assert ("trend", "against trend") in leaks               # shorts in an uptrend
    assert ("setup", "Spring") in edges
    assert "Upthrust setups: 12 taken" in L.describe(next(b for b in p["leaks"] if b["dim"] == "setup"))


def test_skipped_open_and_unscored_trades_are_ignored(L):
    rows = [trade(-1, taken=0), trade(-1, status="open"), trade(None)] * 5
    assert L.edge_profile(rows)["trades"] == 0


def test_rule_breaks_are_tracked(L):
    v = [{"code": "stop_widened", "severity": "major", "text": "x"}]
    p = L.edge_profile([trade(-1.4, violations=json.dumps(v)) for _ in range(9)] + [trade(1) for _ in range(9)])
    b = next(b for b in p["buckets"] if b["dim"] == "break")
    assert b["kind"] == "leak" and "moved the stop away" in b["label"]


def test_lessons_match_the_setup_in_front_of_you(L):
    rows = [trade(-1, setup="Upthrust", direction="Short", symbol="FARTCOINUSDT") for _ in range(10)] + \
           [trade(1.8) for _ in range(10)]
    p = L.edge_profile(rows)
    ls = L.lessons_for(p, {"symbol": "FARTCOINUSDT", "setup": "Upthrust", "direction": "Short", "trend": "against trend"})
    assert any(x["kind"] == "leak" and "Upthrust" in x["text"] for x in ls)
    assert not any(x["kind"] == "leak" for x in L.lessons_for(p, {"symbol": "ETHUSDT", "setup": "Spring", "direction": "Long"}))


# ---------------------------------------------------------------- evidence tiers (multiple-testing honesty)
def test_small_sample_leak_is_observation_not_candidate(L):
    # 8 mixed-but-negative trades: enough to notice, not enough to promote
    rows = [trade(-1 if i % 4 else 1.2, setup="Upthrust", direction="Short") for i in range(8)] + \
           [trade(0.2) for _ in range(8)]
    p = L.edge_profile(rows)
    up = next((b for b in p["buckets"] if b["dim"] == "setup" and b["value"] == "Upthrust"), None)
    if up and up["kind"] == "leak":
        assert up["tier"] == L.TIER_OBSERVATION       # never candidate below MIN_CANDIDATE
    # an observation-only leak must not produce a block proposal
    assert not L.proposals_from(p, [])


def test_no_leak_language_claims_proven_money(L):
    rows = [trade(1.5) for _ in range(12)] + [trade(-1, setup="Upthrust", direction="Short") for _ in range(12)]
    p = L.edge_profile(rows)
    for b in p["edges"]:
        phrase = L.tier_phrase(b)
        if b["tier"] != L.TIER_VALIDATED:
            assert "where you make money" not in phrase or "Not yet" in phrase


def test_benjamini_hochberg_controls_multiplicity():
    # one clearly-significant p among many nulls survives; pure nulls do not
    pairs = [("real", 0.001)] + [(f"n{i}", 0.6) for i in range(19)]
    survivors = L.__dict__  # noqa
    from server import learning as LM
    keep = LM.benjamini_hochberg(pairs, q=0.10)
    assert keep == {"real"}
    assert LM.benjamini_hochberg([(f"n{i}", 0.5) for i in range(20)], q=0.10) == set()


def test_profile_reports_multiplicity_counts(L):
    rows = [trade(1.5) for _ in range(12)] + [trade(-1, setup="Upthrust", direction="Short") for _ in range(12)]
    c = L.edge_profile(rows)["counts"]
    assert set(c) == {"tested", "observations", "candidates", "validated", "fdr_q"}
    assert c["tested"] >= c["observations"] >= c["candidates"] >= c["validated"]


def test_signal_ablation_measures_lift_from_checklist_plans(L, tmp_path):
    from server.db import DB
    db = DB(tmp_path / "abl.db")
    def plan_with(oi, r, grade="A"):
        chk = {"scores": {"c1": 2, "c2": 2, "c3": 2, "c4": 2}, "checks": {"c2": {"oi": oi, "funding": True}, "c4": {"liqs": True}}}
        pid = db.execute("INSERT INTO plans(created_at,symbol,verdict,status,checklist) VALUES(?,?,?,?,?)",
                         (1, "ETHUSDT", "GO", "matched", json.dumps(chk))).lastrowid
        return {"symbol": "ETHUSDT", "taken": 1, "status": "closed", "r": r, "grade": grade, "plan_id": pid, "direction": "Long"}
    # OI-confirmed trades win, OI-absent trades lose -> OI shows positive lift
    trades = [plan_with(True, 1.5) for _ in range(6)] + [plan_with(False, -1.0) for _ in range(6)]
    ab = L.signal_ablation(db, trades)
    oi = next((s for s in ab["signals"] if s["name"] == "OI confirmation"), None)
    assert oi is not None and oi["lift"] > 0 and oi["with_n"] == 6 and oi["without_n"] == 6
    db.close()


def test_signal_ablation_needs_enough_checklist_trades(L, tmp_path):
    from server.db import DB
    db = DB(tmp_path / "abl2.db")
    assert L.signal_ablation(db, [trade(1)])["signals"] == []     # manual trades, no plan_id
    db.close()


def test_regime_stability_flags_a_pattern_that_flips_by_regime(L):
    # Upthrust-short: loses in ranging markets, wins in trending -> a split that flips sign
    ranging = [trade(-1.5, setup="Upthrust", direction="Short", context={"regime": "range", "atr_pct": 1.0}) for _ in range(8)]
    trending = [trade(1.5, setup="Upthrust", direction="Short", context={"regime": "downtrend", "atr_pct": 1.0}) for _ in range(8)]
    splits = L.regime_stability(ranging + trending, "setup", "Upthrust", set())
    tr = next((s for s in splits if s["name"] == "Trend vs range"), None)
    assert tr is not None and tr["held"] is False        # sign flips across the split
    assert tr["a_avg"] > 0 and tr["b_avg"] < 0           # trending wins, ranging loses


def test_regime_stability_needs_enough_on_each_side(L):
    ts = [trade(-1, setup="Upthrust", direction="Short", context={"regime": "range"}) for _ in range(4)]
    assert L.regime_stability(ts, "setup", "Upthrust", set()) == []


def test_execution_quality_measures_fill_drag(L, tmp_path):
    from server.db import DB
    db = DB(tmp_path / "exec.db")
    th = {"slippage_pct_major": 0.02, "slippage_pct_thin": 0.06}
    # a Long meant to enter at 100.0, actually filled at 100.10, stop at 99.0 (1R = 1.0)
    tr = [{"symbol": "ETHUSDT", "taken": 1, "status": "closed", "direction": "Long",
           "entry": 100.10, "stop": 99.0, "r": 1.0, "context": {"price": 100.0}}]
    q = L.execution_quality(db, tr, th, set())
    assert q["n"] == 1
    assert q["median_drag_bps"] == 10.0                 # 0.10/100 = 10 bps adverse
    assert q["median_drag_r"] == 0.091                  # 0.10 / 1.10 (fill-to-stop) = 0.091R
    assert q["modeled_bps"]["major"] == 2.0             # gate assumes 2 bps/side; realized ran higher
    # a favorable fill (Short sold higher than intended) shows negative drag
    tr2 = [{"symbol": "ETHUSDT", "taken": 1, "status": "closed", "direction": "Short",
            "entry": 100.05, "stop": 101.0, "r": 1.0, "context": {"price": 100.0}}]
    assert L.execution_quality(db, tr2, th, set())["median_drag_bps"] < 0
    db.close()


def test_registry_freezes_candidate_and_confirms_out_of_sample(L, tmp_path):
    from server.db import DB
    db = DB(tmp_path / "reg.db")
    T0 = 1_790_000_000_000
    # discovery window: 20 winning Springs + 20 clear Upthrust-short losses -> Upthrust is a candidate leak
    disc = [trade(2.0, opened_at=T0, closed_at=T0) for _ in range(20)] + \
           [trade(-1, setup="Upthrust", direction="Short", opened_at=T0, closed_at=T0) for _ in range(20)]
    prof = L.edge_profile(disc, L.validated_keys(db))
    n = L.register_candidates(db, prof, now=T0 + 1)
    assert n >= 1
    reg = {(r["dim"], r["value"]): r for r in db.query("SELECT * FROM edge_registry")}
    assert ("setup", "Upthrust") in reg and reg[("setup", "Upthrust")]["status"] == "watching"
    # not enough reserved trades yet -> still watching, not yet validated
    L.update_registry(db, disc, now=T0 + 2)
    assert ("setup", "Upthrust") not in L.validated_keys(db)
    # now add RESERVE_N qualifying trades that closed AFTER discovery, still losing
    later = [trade(-1, setup="Upthrust", direction="Short", opened_at=T0 + 100, closed_at=T0 + 100) for _ in range(L.RESERVE_N)]
    L.update_registry(db, disc + later, now=T0 + 200)
    assert ("setup", "Upthrust") in L.validated_keys(db)
    db.close()


def test_registry_marks_a_hypothesis_failed_when_reserved_trades_disagree(L, tmp_path):
    from server.db import DB
    db = DB(tmp_path / "reg2.db")
    T0 = 1_790_000_000_000
    disc = [trade(2.0, opened_at=T0, closed_at=T0) for _ in range(20)] + \
           [trade(-1, setup="Upthrust", direction="Short", opened_at=T0, closed_at=T0) for _ in range(20)]
    L.register_candidates(db, L.edge_profile(disc, set()), now=T0 + 1)
    # reserved trades now WIN, contradicting the frozen 'leak' hypothesis
    later = [trade(2.0, setup="Upthrust", direction="Short", opened_at=T0 + 100, closed_at=T0 + 100) for _ in range(L.RESERVE_N)]
    L.update_registry(db, disc + later, now=T0 + 200)
    r = db.one("SELECT status FROM edge_registry WHERE dim='setup' AND value='Upthrust'")
    assert r and r["status"] == "failed"
    assert ("setup", "Upthrust") not in L.validated_keys(db)
    db.close()


def test_validated_keys_lift_a_candidate_to_validated(L):
    # a strong, consistent leak that should reach candidate, then validated when confirmed
    rows = [trade(2.0) for _ in range(20)] + [trade(-1, setup="Upthrust", direction="Short") for _ in range(20)]
    p0 = L.edge_profile(rows)
    up = next((b for b in p0["buckets"] if b["dim"] == "setup" and b["value"] == "Upthrust"), None)
    if up and up["tier"] == L.TIER_CANDIDATE:
        p1 = L.edge_profile(rows, validated_keys={("setup", "Upthrust")})
        up1 = next(b for b in p1["buckets"] if b["dim"] == "setup" and b["value"] == "Upthrust")
        assert up1["tier"] == L.TIER_VALIDATED


# ---------------------------------------------------------------- app + API
def run_app(fn):
    from server.core import TrapApp

    async def go():
        a = TrapApp(demo=True)
        await a.startup()
        try:
            await fn(a)
        finally:
            await a.shutdown()
    asyncio.run(go())


def test_report_card_scores_calls_from_candles(L):
    async def go(a):
        cid = L.record(a.db, source="ai", ref="x", symbol="ETHUSDT", verdict="TRADEABLE NOW", direction="Long",
                       setup="Spring", grade="A", entry=100, stop=99, needs_fill=False, at=T0)
        bad = L.record(a.db, source="checklist", ref="y", symbol="ETHUSDT", verdict="NO TRADE", direction="Long",
                       setup="Spring", grade="C", entry=100, stop=101, needs_fill=False, at=T0)   # stop on the wrong side
        assert a.db.one("SELECT status FROM calls WHERE id=?", (bad,))["status"] == "void"
        path = [(100, 100.4, 99.6, 100.2)] * 3 + [(100.2, 102.5, 100.1, 102.3)] + [(102, 102.2, 101.8, 102)] * 40

        async def fake(sym, t0, t1):
            return bars(path)
        a.candles_between = fake
        assert await L.resolve_open(a) == 1
        row = a.db.one("SELECT * FROM calls WHERE id=?", (cid,))
        assert row["outcome"] == "target" and row["outcome_r"] < 2.0          # net of costs
        card = L.scorecard(a.db)
        assert card["rows"][0]["verdict"] == "TRADEABLE NOW" and card["rows"][0]["n"] == 1
    run_app(go)


def test_review_proposals_and_blocks_are_stricter_only(L):
    async def go(a):
        from server.api import decide_verdict
        for t in a.db.trades():
            a.db.delete_trade(t["id"])
        for i in range(14):
            a.db.insert_trade({**trade(-1 if i % 5 else 0.5, setup="Upthrust", direction="Short", symbol="FARTCOINUSDT"),
                               "source": "manual", "context": json.dumps({"regime": "range"}), "violations": "[]"})
        for i in range(14):
            a.db.insert_trade({**trade(2 if i % 3 else -1), "source": "manual",
                               "context": json.dumps({"regime": "uptrend"}), "violations": "[]"})
        rev = L.save_review(a.db, L.weekly_review(a.db, a.db.trades()))
        assert rev["proposals"] and rev["leaking"] and "Skip" in rev["one_change"] and "approve" in rev["one_change"]
        page = L.page(a.db, a.db.trades())
        prop = next(p for p in page["proposals"] if p["value"] == "Upthrust")
        assert not page["restrictions"]                                    # nothing applies until approved
        ctx = {"symbol": "FARTCOINUSDT", "setup": "Upthrust", "direction": "Short"}
        assert L.restriction_hits(a.db, ctx) == []
        L.set_restriction(a.db, prop["id"], "approve")
        hits = L.restriction_hits(a.db, ctx)
        assert hits and "Upthrust" in hits[0]
        # a GO checklist becomes NO TRADE when a personal block matches
        body = {"scores": {"c1": 2, "c2": 2, "c3": 2, "c4": 2}, "c4_closed": True,
                "gates": {"range_ok": True, "cost_ok": True}, "third": "lower", "personal_blocks": hits}
        v, reasons, _ = decide_verdict(body, {"status": "clear", "reasons": []}, a.th())
        assert v == "NO TRADE" and any("Personal block" in r for r in reasons)
        # re-running the review never re-proposes an approved or dismissed pattern
        again = L.weekly_review(a.db, a.db.trades())
        assert all(p["value"] != "Upthrust" for p in again["proposals"])
        L.set_restriction(a.db, prop["id"], "remove")
        assert L.restriction_hits(a.db, ctx) == []
    run_app(go)


def test_ai_enforce_respects_personal_blocks(L):
    from tests.test_ai import model_answer, snap, CLEAR, th
    from server import ai as AI
    from server.api import decide_verdict
    s = snap()
    s["symbol"] = "ETHUSDT"
    free = AI.enforce(AI.normalize(model_answer()), s, th(), CLEAR, 0.055, decide_verdict, lambda c: [])
    assert free["verdict"] == "TRADEABLE NOW" and free["setup"] == "Spring" and free["direction"] == "Long"
    blocked = AI.enforce(AI.normalize(model_answer()), s, th(), CLEAR, 0.055, decide_verdict,
                         lambda c: ["Personal block you approved: no Spring setups (x)."] if c["setup"] == "Spring" else [])
    assert blocked["verdict"] != "TRADEABLE NOW" and any("Personal block" in o for o in blocked["overrides"])


def test_review_is_due_on_sunday_once_even_after_a_manual_run(L):
    async def go(a):
        wednesday = int(datetime(2026, 9, 23, 18, tzinfo=timezone.utc).timestamp() * 1000)
        sunday = int(datetime(2026, 9, 27, 18, tzinfo=timezone.utc).timestamp() * 1000)
        monday = int(datetime(2026, 9, 28, 18, tzinfo=timezone.utc).timestamp() * 1000)
        L.save_review(a.db, L.weekly_review(a.db, a.db.trades(), now=wednesday))     # "Run the review now"
        assert L.due_for_review(a.db, sunday) and not L.due_for_review(a.db, monday)
        rev = L.save_review(a.db, L.weekly_review(a.db, a.db.trades(), now=sunday))
        L.mark_auto_review(a.db, rev)
        assert not L.due_for_review(a.db, sunday)
    run_app(go)


def test_stuck_calls_are_set_aside_and_bad_entries_never_block(L):
    async def go(a):
        old = L.now_ms() - 3 * 86_400_000
        for _ in range(15):
            L.record(a.db, source="ai", ref="x", symbol="ETHUSDT", verdict="WATCH", direction="Long", setup="Spring",
                     grade="B", entry=100, stop=99, needs_fill=True, at=old)

        async def none(sym, t0, t1):
            return []
        a.candles_between = none
        a.source = None
        await L.resolve_open(a)
        await L.resolve_open(a)
        assert a.db.one("SELECT COUNT(*) AS n FROM calls WHERE status='open'")["n"] == 0
        # a malformed stored block can't crash the checklist path
        a.db.set("learn_restrictions", [{"id": 1, "active": True}, "junk", {"id": 2, "active": True, "dim": "setup", "value": "Spring"}])
        assert len(L.restriction_hits(a.db, {"setup": "Spring"})) == 1
    run_app(go)


def test_checklist_api_canonicalizes_and_applies_blocks(L):
    import aiohttp
    from aiohttp import web
    from server import api as API

    async def go(a):
        a.db.set("learn_restrictions", [{"id": 1, "active": True, "dim": "direction", "value": "Long", "label": "Longs", "reason": "test"}])
        app = web.Application(middlewares=[API.security])
        app["holder"] = {"app": a}
        app["port"] = 0
        API.build_routes(app)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        API.ALLOWED_HOSTS = {f"127.0.0.1:{port}"}
        body = {"symbol": a.settings()["watchlist"][0].lower(), "direction": "long", "setup": "spring ",
                "scores": {"c1": 2, "c2": 2, "c3": 2, "c4": 2}, "c4_closed": True, "third": "lower",
                "gates": {"range_ok": True, "cost_ok": True}, "personal_blocks": [],
                "sizing": {"entry": 100, "stop": 99}}
        try:
            async with aiohttp.ClientSession() as s:
                async with s.post(f"http://127.0.0.1:{port}/api/checklist", json=body,
                                  headers={"X-Trap-Token": API.TOKEN, "Host": f"127.0.0.1:{port}"}) as r:
                    d = (await r.json())["data"]
            assert d["verdict"] == "NO TRADE" and any("Personal block" in x for x in d["reasons"])
            assert a.db.one("SELECT COUNT(*) AS n FROM calls WHERE source='checklist'")["n"] == 1
        finally:
            await runner.cleanup()
    run_app(go)
