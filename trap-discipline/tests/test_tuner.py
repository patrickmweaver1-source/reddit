"""Auto-tuner: replay fidelity to the live detector, trade simulation, scoring,
statistical safety, and the approve / undo cycle with its guards."""
import asyncio
import json
import random
import sys

import pytest

from server import analysis as A
from server import tuner as TU

BASE = {"pen_floor_atr": 0.25, "pen_floor_atr_thin": 0.40, "pen_abandon_atr": 1.0, "window_max_candles": 4}
OPT = {"pen_floor_atr": 0.40, "pen_floor_atr_thin": 0.40, "pen_abandon_atr": 0.9, "window_max_candles": 4}


def walk(n, seed, vol=0.004):
    rng = random.Random(seed)
    p = 3000.0
    t0 = 1_700_000_000_000 // TU.M15 * TU.M15
    c = []
    for i in range(n):
        o = p
        p *= 1 + rng.gauss(0, vol)
        c.append({"t": t0 + i * TU.M15, "o": o, "h": max(o, p) * (1 + abs(rng.gauss(0, vol / 2))),
                  "l": min(o, p) * (1 - abs(rng.gauss(0, vol / 2))), "c": p, "v": 1})
    return c


def gen(n_days, per_day, seed, edge, day_sd=0.25, thin=False):
    """Synthetic replayed trades with correlated days."""
    rng = random.Random(seed)
    out = []
    for d in range(n_days):
        shock = rng.gauss(0, day_sd)
        for j in range(per_day):
            pen = rng.uniform(0.05, 1.8)
            cnd = rng.randint(1, 6)
            kind = "sweep" if rng.random() < 0.1 else "close"
            p = min(0.95, max(0.02, (edge(pen, cnd, kind) + 1) / 3 + shock / 3))
            out.append(TU.Event("X", thin, kind, pen, 1 if kind == "sweep" else cnd, 2.0 if rng.random() < p else -1.0,
                                d * TU.D1 + j * TU.M15, "Long"))
    return out


def NULL(pen, c, k):
    return 0.0


def PLANTED(pen, c, k):
    return 0.45 if (k == "sweep" and pen >= 0.40) or (k == "close" and (c > 4 or 0.40 <= pen < 0.90)) else -0.30


def run(ev, cur=None, journal=None):
    tr, te = TU.split_events(ev)
    return TU.search(tr, te, dict(cur or BASE), journal)


# ---------------------------------------------------------------- fidelity to the live detector
def _live_keys(c, cfg):
    """An INDEPENDENT re-implementation of what MarketEngine.compute does after
    each 15m close (shares no code with the replay's level pipeline): group
    candles its own way, keep closed 1h/4h and forming daily/weekly exactly as
    MarketEngine._merge does, the same history limits, then the live detector
    with REAL thresholds."""
    import datetime as dt
    HOUR, DAY = 3_600_000, 86_400_000

    def bucket_start(t, iv):
        if iv == "60":
            return t - t % HOUR
        if iv == "240":
            return t - t % (4 * HOUR)
        if iv == "D":
            return t - t % DAY
        d = dt.datetime.fromtimestamp(t / 1000, dt.timezone.utc)
        monday = (d - dt.timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        return int(monday.timestamp() * 1000)

    step = {"60": HOUR, "240": 4 * HOUR, "D": DAY, "W": 7 * DAY}
    keys = set()
    for i in range(TU.WARMUP, len(c) - 1):
        seen = c[:i + 1]
        now = c[i]["t"] + TU.M15
        frames = {}
        for iv in ("60", "240", "D", "W"):
            rows = {}
            for k in seen:
                b = bucket_start(k["t"], iv)
                r = rows.get(b)
                if r is None:
                    rows[b] = {"t": b, "o": k["o"], "h": k["h"], "l": k["l"], "c": k["c"]}
                else:
                    r["h"] = max(r["h"], k["h"]); r["l"] = min(r["l"], k["l"]); r["c"] = k["c"]
            allrows = sorted(rows.values(), key=lambda x: x["t"])
            closed = [k for k in allrows if k["t"] + step[iv] <= now] if iv not in ("D", "W") else allrows
            frames[iv] = closed[-1500:]
        c15 = seen[-1500:]
        atr15 = A.atr(c15, 14)
        levels = A.detect_levels(frames["60"], frames["240"], frames["D"], frames["W"], c[i]["c"], atr15)
        for lv in levels:
            st = A.level_state(lv["price"], c15, atr15, floor_atr=cfg["pen_floor_atr"], abandon_atr=cfg["pen_abandon_atr"],
                               max_candles=cfg["window_max_candles"], lookback=TU.LOOKBACK)
            if st["state"] == "TRIGGERED":
                keys.add((c[i]["t"], st["direction"]))
    return keys


@pytest.mark.parametrize("cfg", [BASE, {**BASE, "pen_floor_atr": 0.40, "pen_abandon_atr": 0.8, "window_max_candles": 2},
                                 {**BASE, "pen_floor_atr": 0.15, "pen_abandon_atr": 1.6, "window_max_candles": 7}])
def test_replay_acceptance_matches_the_live_detector(cfg):
    c = walk(1100, 7)
    ev = TU.find_events(c, "X", False, 0.0, 1e9)             # zero cost, no gate: keep every trigger with 8h of future
    replay = {(e.t, e.side) for e in ev if TU.accepted(e, cfg)}
    horizon_end = c[len(c) - 1 - TU.HORIZON]["t"]
    live = {k for k in _live_keys(c, cfg) if k[0] < horizon_end}
    assert replay <= live, sorted(replay - live)[:5]           # never counts a trade the live detector wouldn't take
    assert len(replay) >= 0.95 * len(live), (len(replay), len(live))   # misses almost none (two levels on one candle)


def test_aggregation_matches_bybit_alignment():
    import datetime as dt
    c = walk(2000, 3)
    wk, _ = TU._agg(c, TU.W1, TU.MONDAY_OFFSET)
    for k in wk:
        assert dt.datetime.fromtimestamp(k["t"] / 1000, dt.timezone.utc).weekday() == 0     # weeks start Monday UTC
    d1, _ = TU._agg(c, TU.D1)
    assert all(k["t"] % TU.D1 == 0 for k in d1)


def test_live_inputs_match_the_live_engine():
    c = walk(400, 4)
    c1h, c4h, cD, cW = TU.live_inputs(c, 205, {})
    now = c[205]["t"] + TU.M15
    assert all(k["t"] + TU.H1 <= now for k in c1h) and all(k["t"] + TU.H4 <= now for k in c4h)   # closed only
    assert cD[-1]["c"] == c[205]["c"] and cW[-1]["c"] == c[205]["c"]                              # forming day/week included


# ---------------------------------------------------------------- trade simulation
def _flat(n=60, px=100.0):
    return [{"t": i * TU.M15, "o": px, "h": px + 0.1, "l": px - 0.1, "c": px} for i in range(n)]


def test_simulation_target_stop_costs_and_gate():
    c = _flat()
    c[11] = {**c[11], "h": 104.0}
    r = TU._simulate(c, 10, "Long", 99.0, 1.0, 0.0, 100.0)
    stop = 99.0 - TU.STOP_BUFFER_ATR
    assert r == pytest.approx(TU.TARGET_R)
    r_cost = TU._simulate(c, 10, "Long", 99.0, 1.0, 0.15, 100.0)
    assert r - r_cost == pytest.approx(0.0015 * 100.0 / (100.0 - stop))
    assert TU._simulate(c, 10, "Long", 99.0, 1.0, 0.15, 0.1) == "gated"
    c2 = _flat()
    c2[12] = {**c2[12], "l": 98.0, "h": 104.0}
    assert TU._simulate(c2, 10, "Long", 99.0, 1.0, 0.0, 100.0) == -1.0      # stop and target in one candle


def test_simulation_never_judges_a_cut_short_trade():
    assert TU._simulate(_flat(40), 20, "Long", 99.0, 1.0, 0.0, 100.0) is None


def test_replay_is_unbiased_on_a_random_walk():
    rs = []
    for seed in range(3):
        rs += [e.r for e in TU.find_events(walk(6000, seed), "X", False, 0.0, 1e9)]
    m = sum(rs) / len(rs)
    se = (sum((x - m) ** 2 for x in rs) / (len(rs) - 1)) ** 0.5 / len(rs) ** 0.5
    assert abs(m) < 3 * se, (m, se)


def test_gaps_split_the_series():
    c = walk(500, 2)
    del c[250:260]
    segs = TU.segments(c)
    assert len(segs) == 2 and all(b["t"] - a["t"] == TU.M15 for s in segs for a, b in zip(s, s[1:]))


# ---------------------------------------------------------------- acceptance and scoring
def _ev(pen, c=2, kind="close", thin=False, r=1.0):
    return TU.Event("X", thin, kind, pen, c, r, 0, "Long")


def test_accepted_follows_live_rules():
    assert not TU.accepted(_ev(0.2), BASE)                     # below the floor
    assert TU.accepted(_ev(0.3), BASE)
    assert not TU.accepted(_ev(1.0), BASE)                     # at the abandon line: ran
    assert TU.accepted(_ev(1.5, c=5), BASE)                    # late reclaim: Failed retest, no depth gate
    assert TU.accepted(_ev(0.3, 1, "sweep"), BASE)
    assert TU.accepted(_ev(2.5, 1, "sweep"), BASE)             # sweeps have no abandon line live
    assert not TU.accepted(_ev(0.3, thin=True), BASE)          # thin floor is 0.40


def test_table_matches_brute_force():
    rng = random.Random(3)
    ev = [TU.Event("X", False, rng.choice(["close", "close", "sweep"]), rng.uniform(0, 3.5), rng.randint(1, 48),
                   rng.choice([-1.0, 2.0, 0.3]), 0, "Long") for _ in range(800)]
    t = TU.Table(ev)
    for _ in range(300):
        cfg = {"pen_floor_atr": rng.choice(TU.FLOORS), "pen_floor_atr_thin": 0.4,
               "pen_abandon_atr": rng.choice(TU.ABANDONS), "window_max_candles": rng.choice(TU.WINDOWS)}
        sel = [e.r for e in ev if TU.accepted(e, cfg)]
        n, s = t.query(cfg["pen_floor_atr"], cfg["pen_abandon_atr"], cfg["window_max_candles"])
        assert n == len(sel) and s == pytest.approx(sum(sel))


# ---------------------------------------------------------------- statistical safety
def test_recovers_a_planted_edge_in_bounded_steps():
    cur = dict(BASE)
    for step in range(8):
        r = run(gen(120, 10, 700 + step, PLANTED), cur)
        if not r["proposal"]:
            continue
        for k, v in r["proposal"]["changes"].items():
            assert abs(v["to"] - v["from"]) <= TU.MAX_STEP[k] + 1e-9
            lo, hi = TU.BOUNDS[k]
            assert lo - 1e-9 <= v["to"] <= hi + 1e-9
            cur[k] = v["to"]
        assert cur["pen_abandon_atr"] - max(cur["pen_floor_atr"], cur["pen_floor_atr_thin"]) >= TU.MIN_GAP - 1e-9
    assert 0.35 <= cur["pen_floor_atr"] <= 0.45, cur          # planted floor 0.40
    assert 0.8 <= cur["pen_abandon_atr"] <= 1.0, cur          # planted abandon 0.90


def test_noise_rarely_moves_anything():
    made = sum(1 for s in range(60) if run(gen(120, 10, 10_000 + s, NULL))["proposal"])
    assert made <= 6, made                                     # measured ~4% over 120 trials


def test_correct_boundaries_are_left_alone():
    moved = sum(1 for s in range(60) if run(gen(120, 10, 30_000 + s, PLANTED), OPT)["proposal"])
    assert moved <= 6, moved


def test_no_free_riders():
    """A world where ONLY the floor can matter: every trade is shallower than
    any possible abandon line and reclaims inside every possible window.
    Nothing but the floor may change."""
    def floor_world(seed):
        rng = random.Random(seed)
        out = []
        for d in range(150):
            shock = rng.gauss(0, 0.25)
            for j in range(10):
                pen = rng.uniform(0.05, 0.58)
                p = min(0.95, max(0.02, ((0.45 if pen >= 0.40 else -0.30) + 1) / 3 + shock / 3))
                out.append(TU.Event("X", False, "close", pen, rng.randint(1, 2), 2.0 if rng.random() < p else -1.0,
                                    d * TU.D1 + j * TU.M15, "Long"))
        return out
    made = 0
    for s in range(12):
        r = run(floor_world(500 + s))
        if r["proposal"]:
            made += 1
            assert set(r["proposal"]["changes"]) == {"pen_floor_atr"}, r["proposal"]["changes"]
    assert made >= 3                                           # and it does find the floor


def test_thin_floor_needs_its_own_evidence():
    ev = gen(150, 10, 44, PLANTED) + gen(150, 1, 45, NULL, thin=True)[:20]
    r = run(ev)
    if r["proposal"]:
        assert "pen_floor_atr_thin" not in r["proposal"]["changes"]


def test_holds_on_small_samples():
    assert run(gen(10, 3, 1, PLANTED))["proposal"] is None


def test_journal_vetoes_a_change_that_cuts_your_winners():
    ev = None
    r = None
    for seed in range(71, 91):                                 # find a sample that proposes
        ev = gen(150, 10, seed, PLANTED)
        r = run(ev)
        if r["proposal"]:
            break
    assert r["proposal"], r.get("reason")
    new = r["proposal"]["new"]
    grid = [round(0.01 * j, 2) for j in range(5, 200)]
    cut_pens = [p for p in grid if TU.accepted(_ev(p), BASE) and not TU.accepted(_ev(p), new)]
    filler = [TU.Event("X", False, "close", 0.6, 2, -0.2, i * TU.D1, "Long") for i in range(40)
              if TU.accepted(_ev(0.6), BASE) and TU.accepted(_ev(0.6), new)]
    winners = [TU.Event("X", False, "close", cut_pens[i % len(cut_pens)], 2, 1.5, i * TU.D1, "Long") for i in range(10)]
    r2 = run(ev, journal=winners + filler)
    assert r2["proposal"] is None and "Blocked by your own trades" in r2["reason"]
    r3 = run(ev, journal=filler)                               # nothing of yours in the cut region: no veto
    assert r3["proposal"] is not None


# ---------------------------------------------------------------- approve / undo cycle
@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAP_DATA_DIR", str(tmp_path))
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]
    from server.core import TrapApp
    from server import tuner as T2
    a = TrapApp(demo=True)
    from server.demo import DemoSource
    a.source = DemoSource()
    pushes = []

    async def fake_push(title, body, **kw):
        pushes.append({"title": title, "body": body, **kw})
        return {"sent": 1, "failed": 0, "removed": 0}
    a.push_notify = fake_push

    def strong(pen, c, k):
        return 0.6 if (k == "sweep" and pen >= 0.40) or (k == "close" and (c > 4 or 0.40 <= pen < 0.90)) else -0.40
    pool = gen(200, 14, 900, strong)

    def fake_find(c, sym, thin, cost, gate=10.0, counts=None):
        return [] if thin else [T2.Event(sym, thin, e.kind, e.pen, e.candles, e.r, e.t, e.side) for e in pool]
    monkeypatch.setattr(T2, "find_events", fake_find)
    monkeypatch.setattr(T2, "segments", lambda c: [c])
    monkeypatch.setattr(T2, "USE_PROCESSES", False)          # worker processes can't see test patches
    a._pushes = pushes
    yield a
    a.db.close()
    a.shared.close()


def _scan(a, manual=True):
    async def go():
        res = await a.tuner.scan(manual=manual)
        if a._bg:
            await asyncio.gather(*list(a._bg), return_exceptions=True)
        return res
    return asyncio.run(go())


def _open_review(a):
    """Open a monthly review for the current UTC month so rulebook changes are
    allowed (rule 11). Returns nothing; the tuner reads a.review_open()."""
    from datetime import datetime, timezone
    from server.db import now_ms
    a.db.execute("INSERT INTO reviews(month, started_at) VALUES(?,?)",
                 (datetime.now(timezone.utc).strftime("%Y-%m"), now_ms()))


def test_scan_proposes_and_signs_buttons_to_the_exact_change(app):
    res = _scan(app)
    assert res["ok"] and res["proposal"], res
    p = app.tuner.open_proposal()
    assert any("proposed" in c["title"] for c in app.coach.recent(5))
    push = app._pushes[-1]
    assert push["title"].startswith("DEMO · ")
    sig = push["extra"]["act"]["apply"].split("sig=")[1]
    assert app.tuner.verify("demo", p["id"], "apply", sig)
    assert not app.tuner.verify("demo", p["id"], "dismiss", sig)
    assert not app.tuner.verify("live", p["id"], "apply", sig)
    assert not app.tuner.verify("demo", p["id"] + 1, "apply", sig)
    changed = {k: {"from": v["from"], "to": v["to"] + 0.05} for k, v in p["changes"].items()}
    app.db.execute("UPDATE tune_proposals SET changes=? WHERE id=?", (json.dumps(changed), p["id"]))
    assert not app.tuner.verify("demo", p["id"], "apply", sig)    # a button only does what it described


def test_apply_and_undo_are_blocked_during_an_open_trade(app):
    _scan(app)
    _open_review(app)                       # rule 11: apply only writes during a review
    p = app.tuner.open_proposal()
    tid = app.db.insert_trade({"symbol": "ETHUSDT", "status": "open", "source": "manual", "taken": 1})
    assert not asyncio.run(app.tuner.apply(p["id"]))["ok"]
    app.db.update_trade(tid, {"status": "closed"})
    assert asyncio.run(app.tuner.apply(p["id"]))["ok"]
    for k, v in p["changes"].items():
        assert app.th()[k] == v["to"]
    app.db.update_trade(tid, {"status": "open"})
    r = asyncio.run(app.tuner.revert(p["id"]))
    assert not r["ok"] and "open position" in r["error"]


def test_apply_queues_when_no_review_is_open(app):
    _scan(app)
    p = app.tuner.open_proposal()
    before = {k: app.th()[k] for k in TU.TUNED}
    r = asyncio.run(app.tuner.apply(p["id"]))
    assert r["ok"] and r.get("queued")                      # approved but not applied
    assert {k: app.th()[k] for k in TU.TUNED} == before      # rulebook untouched (rule 11)
    assert app.db.one("SELECT status FROM tune_proposals WHERE id=?", (p["id"],))["status"] == "queued"
    assert [q["id"] for q in app.tuner.queued()] == [p["id"]]


def test_opening_a_review_applies_queued_changes(app):
    _scan(app)
    p = app.tuner.open_proposal()
    asyncio.run(app.tuner.apply(p["id"]))                    # queues it (no review open)
    _open_review(app)                                        # review_start opens the review, then...
    res = asyncio.run(app.tuner.apply_queued())              # ...calls this
    assert res["applied"] == [p["id"]]
    for k, v in p["changes"].items():
        assert app.th()[k] == v["to"]
    assert app.db.one("SELECT status FROM tune_proposals WHERE id=?", (p["id"],))["status"] == "applied"


def test_live_mode_without_a_synced_account_blocks_changes(app):
    app.demo = False
    app.account = None
    assert "Connect your read-only Bybit key" in app.tuner.position_block()

    class Acct:
        status = "backfilling"
        positions: dict = {}
    app.account = Acct()
    assert "backfilling" in app.tuner.position_block()
    Acct.status = "live"
    assert app.tuner.position_block() is None
    Acct.positions = {"ETHUSDT": {"size": 1}}
    assert "open position" in app.tuner.position_block()
    app.demo = True
    app.account = None


def test_undo_restores_exactly_and_only_once(app):
    _scan(app)
    _open_review(app)
    p = app.tuner.open_proposal()
    orig = {k: app.th()[k] for k in TU.TUNED}
    asyncio.run(app.tuner.apply(p["id"]))
    assert asyncio.run(app.tuner.revert(p["id"]))["ok"]
    assert {k: app.th()[k] for k in TU.TUNED} == orig
    assert asyncio.run(app.tuner.revert(p["id"]))["ok"] is False


def test_undo_refuses_to_squeeze_the_trap_zone(app):
    app.db.execute("INSERT INTO tune_proposals(ts,status,changes,evidence) VALUES(?,?,?,?)",
                   (1, "applied", '{"pen_floor_atr": {"from": 0.45, "to": 0.35}}', "{}"))
    pid = app.db.one("SELECT MAX(id) AS i FROM tune_proposals")["i"]
    asyncio.run(app.tuner._new_version({"pen_floor_atr": 0.35, "pen_abandon_atr": 0.65}, "test setup", allow_outside_review=True))
    r = asyncio.run(app.tuner.revert(pid))
    assert not r["ok"] and "0.3 ATR" in r["error"]


def test_dismissed_change_is_not_reproposed_for_a_week(app):
    _scan(app)
    p = app.tuner.open_proposal()
    asyncio.run(app.tuner.dismiss(p["id"]))
    res = _scan(app)
    assert res["proposal"] is None and "dismissed" in res["reason"]


def test_stale_proposal_is_refused(app):
    _scan(app)
    p = app.tuner.open_proposal()
    k = next(iter(p["changes"]))
    asyncio.run(app.tuner._new_version({k: p["changes"][k]["from"] + 0.05}, "manual monthly review", allow_outside_review=True))
    r = asyncio.run(app.tuner.apply(p["id"]))
    assert not r["ok"] and "changed since" in r["error"]


def test_scheduled_scan_respects_being_switched_off_midway(app):
    app.set_setting("auto_tune", False)
    res = _scan(app, manual=False)
    assert res["proposal"] is None and "switched off" in res["reason"]
    assert app.tuner.open_proposal() is None


def test_auto_tune_defaults_off(app):
    assert app.settings()["auto_tune"] is False
    app.set_setting("auto_tune", True)
    assert app.tuner.enabled()


def test_real_scan_end_to_end_in_worker_processes(tmp_path, monkeypatch):
    """No patches: download (demo) history, replay it with the live detector in
    worker processes, score, and record the result - while the event loop
    stays responsive for live alerts."""
    monkeypatch.setenv("TRAP_DATA_DIR", str(tmp_path))
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]
    from server.core import TrapApp
    from server.demo import DemoSource
    a = TrapApp(demo=True)
    a.source = DemoSource()

    async def go():
        lags = []

        async def heartbeat():
            while True:
                t0 = asyncio.get_running_loop().time()
                await asyncio.sleep(0.05)
                lags.append(asyncio.get_running_loop().time() - t0 - 0.05)
        hb = asyncio.create_task(heartbeat())
        res = await a.tuner.scan(manual=True)
        hb.cancel()
        return res, lags
    res, lags = asyncio.run(go())
    assert res["ok"], res
    last = a.db.get("tune_last_scan")
    ev = a.db.get("tune_last_evidence")
    assert last["ok_at"] and ev["events"] >= 0 and set(ev["per_symbol"]) == set(a.settings()["watchlist"])
    assert max(lags) < 0.5, max(lags)                          # live alerts would not be held up by the scan
    a.db.close()
    a.shared.close()
