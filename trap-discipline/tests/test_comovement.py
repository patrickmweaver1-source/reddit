"""Cross-coin co-movement: return-series correlation across lags, with the
sample-size and significance gating that keeps it from reporting spurious
"patterns" out of many lag/pair comparisons, plus the daily snapshots that
let the app say whether a relationship has actually held up over time."""
import random
import sys

import pytest

from server import comovement as COV


def _closes_from_returns(start: float, step_returns: list[float]) -> list[float]:
    closes = [start]
    for r in step_returns:
        closes.append(closes[-1] * (1 + r))
    return closes


def _candles(closes: list[float]) -> list[dict]:
    return [{"t": i * COV.CANDLE_MS, "c": c} for i, c in enumerate(closes)]


def _pair_with_lag(lag: int, n: int, *, opposite: bool = False, seed: int = 42):
    """Builds two synthetic 15m candle series where b's return exactly
    mirrors a's return from `lag` candles earlier (or its negative, if
    opposite), so the true relationship is known and can be checked."""
    rng = random.Random(seed)
    true_r = [0.0] + [rng.uniform(-0.004, 0.004) for _ in range(n)]  # index 0 unused
    a_closes = _closes_from_returns(100.0, true_r[1:])

    b_step = []
    for i in range(1, n + 1):
        src = i - lag
        if 1 <= src <= n:
            b_step.append(-true_r[src] if opposite else true_r[src])
        else:
            b_step.append(rng.uniform(-0.004, 0.004))
    b_closes = _closes_from_returns(50.0, b_step)
    return _candles(a_closes), _candles(b_closes)


# ---------------------------------------------------------------- returns()
def test_returns_skips_first_candle_and_computes_pct_change():
    candles = [{"t": 0, "c": 100.0}, {"t": COV.CANDLE_MS, "c": 105.0}, {"t": 2 * COV.CANDLE_MS, "c": 100.0}]
    r = COV.returns(candles)
    assert 0 not in r
    assert r[COV.CANDLE_MS] == 0.05
    assert round(r[2 * COV.CANDLE_MS], 6) == round((100.0 - 105.0) / 105.0, 6)


def test_returns_ignores_rows_missing_close_or_time():
    candles = [{"t": 0, "c": 100.0}, {"c": 110.0}, {"t": COV.CANDLE_MS, "c": 110.0}]
    r = COV.returns(candles)
    assert list(r.values()) == [0.10]


# ---------------------------------------------------------------- best_lag()
def test_best_lag_finds_the_true_positive_lag():
    n = COV.MIN_SAMPLES + COV.MAX_LAG_CANDLES * 2 + 20
    a, b = _pair_with_lag(lag=3, n=n)
    res = COV.best_lag(COV.returns(a), COV.returns(b))
    assert res is not None
    assert res["lag"] == 3
    assert res["r"] > 0.99          # near-perfect by construction
    assert res["n"] >= COV.MIN_SAMPLES


def test_best_lag_finds_negative_lag_and_opposite_direction():
    n = COV.MIN_SAMPLES + COV.MAX_LAG_CANDLES * 2 + 20
    a, b = _pair_with_lag(lag=-4, n=n, opposite=True, seed=7)
    res = COV.best_lag(COV.returns(a), COV.returns(b))
    assert res is not None
    assert res["lag"] == -4
    assert res["r"] < -0.99


def test_best_lag_none_with_too_few_candles():
    a, b = _pair_with_lag(lag=0, n=50, seed=1)   # well under MIN_SAMPLES
    assert COV.best_lag(COV.returns(a), COV.returns(b)) is None


def test_best_lag_none_for_independent_noise():
    rng = random.Random(99)
    n = COV.MIN_SAMPLES + COV.MAX_LAG_CANDLES * 2 + 20
    a_closes = _closes_from_returns(100.0, [rng.uniform(-0.004, 0.004) for _ in range(n)])
    b_closes = _closes_from_returns(200.0, [rng.uniform(-0.004, 0.004) for _ in range(n)])
    res = COV.best_lag(COV.returns(_candles(a_closes)), COV.returns(_candles(b_closes)))
    assert res is None


# ---------------------------------------------------------------- analyze()
def test_analyze_finds_a_walk_forward_leadlag_beyond_co_movement():
    n = COV.MIN_SAMPLES + COV.MAX_LAG_CANDLES * 2 + 60
    a, b = _pair_with_lag(lag=2, n=n, seed=5)            # b follows a by 2 candles
    out = COV.analyze({"AAAUSDT": a, "BBBUSDT": b})
    assert out["symbols_checked"] == ["AAAUSDT", "BBBUSDT"]
    assert len(out["pairs"]) == 1
    p = out["pairs"][0]
    ll = p["lead_lag"]
    assert ll and ll["leader"] == "AAAUSDT" and ll["follower"] == "BBBUSDT" and ll["lag"] == 2
    assert ll["incr_r2"] >= COV.MIN_INCR_R2 and ll["folds_improved"] * 2 >= ll["folds"]
    assert "follow" in p["text"] and "AAAUSDT" in p["text"] and "BBBUSDT" in p["text"]


def test_analyze_reports_strong_contemporaneous_without_a_false_leadlag():
    n = COV.MIN_SAMPLES + COV.MAX_LAG_CANDLES * 2 + 60
    a, b = _pair_with_lag(lag=0, n=n, seed=11)           # move together, same time
    out = COV.analyze({"AAAUSDT": a, "BBBUSDT": b})
    assert len(out["pairs"]) == 1
    p = out["pairs"][0]
    assert abs(p["r"]) >= COV.CONTEMP_R
    assert p["lead_lag"] is None                          # no spurious lead-lag invented from co-movement
    assert "no reliable lead or lag" in p["text"]


def test_analyze_skips_unrelated_noise():
    n = COV.MIN_SAMPLES + COV.MAX_LAG_CANDLES * 2 + 60
    a, b = _pair_with_lag(lag=0, n=n, seed=11)
    rng = random.Random(21)
    c_closes = _closes_from_returns(300.0, [rng.uniform(-0.004, 0.004) for _ in range(n)])
    out = COV.analyze({"AAAUSDT": a, "BBBUSDT": b, "CCCUSDT": _candles(c_closes)})
    assert out["pairs"] and out["pairs"][0]["a"] == "AAAUSDT" and out["pairs"][0]["b"] == "BBBUSDT"
    assert all("CCCUSDT" not in (p["a"], p["b"]) for p in out["pairs"])


def test_analyze_empty_watchlist_or_single_symbol():
    out = COV.analyze({})
    assert out["pairs"] == [] and out["symbols_checked"] == []
    assert out["min_samples"] == COV.MIN_SAMPLES and out["walk_folds"] == COV.WALK_FOLDS
    a, _ = _pair_with_lag(lag=0, n=50)
    assert COV.analyze({"AAAUSDT": a})["pairs"] == []


# ---------------------------------------------------------------- daily snapshots / stability
@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAP_DATA_DIR", str(tmp_path))
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]
    from server.db import DB
    d = DB(tmp_path / "trap.db")
    yield d
    d.close()


def test_due_for_snapshot_once_per_day(db):
    assert COV.due_for_snapshot(db, now=1_000_000_000_000) is True
    COV.save_snapshot(db, {"pairs": []}, now=1_000_000_000_000)
    assert COV.due_for_snapshot(db, now=1_000_000_000_000 + 3_600_000) is False   # same UTC day
    assert COV.due_for_snapshot(db, now=1_000_000_000_000 + 90_000_000_000) is True  # next day


def test_recent_snapshots_round_trip_and_cap(db, monkeypatch):
    monkeypatch.setattr(COV, "SNAPSHOT_KEEP", 3)
    for i in range(5):
        COV.save_snapshot(db, {"pairs": [{"a": "AAA", "b": "BBB"}], "day_marker": i}, now=1_000_000_000_000 + i * 90_000_000_000)
    rows = COV.recent_snapshots(db)
    assert len(rows) == 3
    assert [r["day_marker"] for r in rows] == [4, 3, 2]   # newest first, oldest trimmed


def test_stability_tracks_direction_and_lag_agreement():
    snaps = [
        {"pairs": [{"a": "AAA", "b": "BBB", "direction": "same", "lag_candles": 2, "r": 0.5}]},
        {"pairs": [{"a": "AAA", "b": "BBB", "direction": "same", "lag_candles": 2, "r": 0.6}]},
        {"pairs": [{"a": "AAA", "b": "BBB", "direction": "same", "lag_candles": 3, "r": 0.4}]},   # lag disagrees once
        {"pairs": []},   # a day it didn't clear the bar
    ]
    out = COV.stability(snaps)
    assert out["checks"] == 4
    p = out["pairs"][0]
    assert p["a"] == "AAA" and p["b"] == "BBB"
    assert p["hits"] == 3
    assert p["hit_rate"] == 0.75
    assert p["direction"] == "same" and p["direction_agreement"] == 1.0
    assert p["lag_candles"] == 2 and round(p["lag_agreement"], 2) == round(2 / 3, 2)


def test_stability_established_only_after_min_checks(monkeypatch):
    monkeypatch.setattr(COV, "MIN_CHECKS_FOR_TREND", 3)
    few = [{"pairs": [{"a": "AAA", "b": "BBB", "direction": "same", "lag_candles": 0, "r": 0.5}]}] * 2
    out_few = COV.stability(few)
    assert out_few["pairs"][0]["established"] is False

    enough = few + [{"pairs": [{"a": "AAA", "b": "BBB", "direction": "same", "lag_candles": 0, "r": 0.5}]}]
    out_enough = COV.stability(enough)
    assert out_enough["pairs"][0]["established"] is True


def test_stability_empty_history():
    out = COV.stability([])
    assert out == {"checks": 0, "min_checks_for_trend": COV.MIN_CHECKS_FOR_TREND, "pairs": []}


# ---------------------------------------------------------------- wired into the app's daily tick
def test_exposure_warning_flags_a_correlated_open_position(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAP_DATA_DIR", str(tmp_path))
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]
    from server.core import TrapApp
    app = TrapApp(demo=True)
    try:
        monkeypatch.setattr(app, "co_movement", lambda: {"pairs": [
            {"a": "ETHUSDT", "b": "SOLUSDT", "r": 0.84, "lag_candles": 0, "direction": "same"}]})
        assert app.exposure_for("SOLUSDT", "Long") == []          # no open position yet
        app.db.insert_trade({"symbol": "ETHUSDT", "status": "open", "source": "manual", "taken": 1, "direction": "Long"})
        same = app.exposure_for("SOLUSDT", "Long")
        assert len(same) == 1 and same[0]["concentrated"] is True   # long+long on +corr = one bet
        off = app.exposure_for("SOLUSDT", "Short")
        assert off[0]["concentrated"] is False                      # long/short on +corr = a hedge
    finally:
        app.db.close()
        app.shared.close()


def test_learning_tick_saves_one_snapshot_a_day(tmp_path, monkeypatch):
    import asyncio
    monkeypatch.setenv("TRAP_DATA_DIR", str(tmp_path))
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]
    from server.core import TrapApp
    app = TrapApp(demo=True)
    try:
        assert COV.due_for_snapshot(app.db) is True
        asyncio.run(app._learning_tick())
        assert COV.due_for_snapshot(app.db) is False
        rows = COV.recent_snapshots(app.db)
        assert len(rows) == 1
        assert "pairs" in rows[0]

        app.__dict__.pop("_learn_last", None)   # bypass the 10-minute in-process throttle
        asyncio.run(app._learning_tick())
        assert len(COV.recent_snapshots(app.db)) == 1   # still just the one for today
    finally:
        app.db.close()
        app.shared.close()
