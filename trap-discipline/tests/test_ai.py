"""AI analyst (Claude scan): market-only data packet, strict schema, the
server's rule re-check (Claude can be stricter, never looser), key handling,
budget, cooldown, retries and friendly errors. The Claude API is replaced by a
local stand-in server; nothing here touches the network."""
import asyncio
import json
import sys

import pytest
from aiohttp import web


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAP_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("PYTHON_KEYRING_BACKEND", "keyring.backends.fail.Keyring")
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]
    from server import ai as AI
    from server.api import decide_verdict
    return AI, decide_verdict, tmp_path


TH = None


def th():
    from server import config
    return dict(config.DEFAULT_THRESHOLDS)


def snap(state="TRIGGERED", extreme=99.0, trigger=101.0):
    return {"symbol": "ETHUSDT", "price": 101.0, "atr15": 2.0, "tick": 0.01, "thin": False,
            "regime": {"regime": "range", "permitted": ["Long", "Short"]},
            "range": {"high": 130.0, "low": 95.0, "height": 35.0},
            "levels": [{"price": 100.0, "state": state, "trigger": trigger, "extreme": extreme, "sources": ["4h", "range"],
                        "touches": 4, "c1": 2, "direction": "Long", "setup": "Spring"}]}


def model_answer(verdict="TRADEABLE NOW", scores=(2, 2, 1, 2), invalidation=98.97, closed=True):
    comp = lambda k, s, extra=None: {"score": s, "reason": f"{k} evidence", "checks": {**{x: False for x in KEYS[k]}, **(extra or {})}}  # noqa: E731
    out = {"verdict": verdict, "headline": "Spring at 100 triggered.", "breakdown": ["a", "b", "c"],
           "session": {"status": "clear", "reason": ""}, "regime": {"read": "range", "permitted": "both"},
           "levels_in_play": [{"price": 100, "state": "TRIGGERED", "would_be": "Spring", "next": "hold 101"}],
           "candidate": {"level": 100.0, "setup": "Spring", "direction": "Long", "trap_zone_low": 98.0,
                         "trap_zone_high": 99.5, "reclaim_trigger": 100.0},
           "c1": comp("c1", scores[0]), "c2": comp("c2", scores[1]), "c3": comp("c3", scores[2]),
           "c4": {**comp("c4", scores[3], {"closed": closed}), "quality": "engulfing"},
           "disqualifier": None, "plan": {"entry": 101.0, "invalidation": invalidation, "target": 130.0, "deadline": "4 candles"},
           "watch_next": ["x"], "missing_data": [], "confidence": "medium"}
    return out


KEYS = {"c1": ("range", "swing", "prior", "round", "liq", "three", "only15", "weak"),
        "c2": ("closed", "bracket", "body", "range", "oi", "funding", "shallow"),
        "c3": ("contract", "bodies", "wicks", "same", "inside", "ran", "timedout"),
        "c4": ("closed", "far", "oi", "funding", "liqs")}
CLEAR = {"status": "clear", "reasons": [], "losses_today": 0}


# ---------------------------------------------------------------- rule re-check
def test_rules_agree_keeps_tradeable(env):
    AI, decide, _ = env
    r = AI.enforce(AI.normalize(model_answer()), snap(), th(), CLEAR, 0.055, decide)
    assert r["verdict"] == "TRADEABLE NOW" and r["rules_check"]["verdict"] == "GO"
    assert r["grade"] == "A" and r["total"] == 7
    assert r["gates"]["range_ok"] is True and r["gates"]["cost_ok"] is True
    assert any("Cost" in ln for ln in r["gates"]["lines"])            # the server's own arithmetic


def test_no_reclaim_close_downgrades_to_watch(env):
    AI, decide, _ = env
    r = AI.enforce(AI.normalize(model_answer()), snap("WATCH"), th(), CLEAR, 0.055, decide)
    assert r["verdict"] == "WATCH" and r["ai_verdict"] == "TRADEABLE NOW"
    assert any("CLOSE back inside" in x for x in r["overrides"])


def test_cost_gate_failure_downgrades(env):
    AI, decide, _ = env
    # a wick only 0.1 below the trigger: the app's stop (3 ticks beyond it) is too tight for costs
    r = AI.enforce(AI.normalize(model_answer()), snap(extreme=100.9), th(), CLEAR, 0.055, decide)
    assert r["gates"]["cost_ok"] is False and r["verdict"] != "TRADEABLE NOW"
    assert any("Cost gate failed" in x for x in r["overrides"])


def test_c2_zero_and_dead_level_block(env):
    AI, decide, _ = env
    r = AI.enforce(AI.normalize(model_answer(scores=(2, 0, 2, 2))), snap(), th(), CLEAR, 0.055, decide)
    assert r["verdict"] != "TRADEABLE NOW"
    r = AI.enforce(AI.normalize(model_answer()), snap("DEAD_RAN"), th(), CLEAR, 0.055, decide)
    assert r["verdict"] == "NO SETUP" and "flag, not trap" in r["disqualifier"]


def test_model_cannot_flip_direction_or_invent_entry_and_stop(env):
    AI, decide, _ = env
    a = model_answer()
    a["candidate"]["direction"] = "Short"
    r = AI.enforce(AI.normalize(a), snap(), th(), CLEAR, 0.055, decide)
    assert r["verdict"] != "TRADEABLE NOW" and "points Long" in r["disqualifier"]
    # a made-up entry cannot move the trade out of the middle third; a made-up stop cannot pass the cost gate
    a = model_answer(invalidation=60.0)
    a["plan"]["entry"] = 96.0
    r = AI.enforce(AI.normalize(a), snap(trigger=112.5), th(), CLEAR, 0.055, decide)
    assert r["gates"]["entry"] == 112.5 and r["gates"]["third"] == "middle" and r["gates"]["stop"] == pytest.approx(98.97)
    assert r["verdict"] != "TRADEABLE NOW"


def test_missing_direction_still_counter_trend_and_bad_levels(env):
    AI, decide, _ = env
    s = snap()
    s["regime"] = {"regime": "downtrend", "permitted": ["Short"]}
    a = model_answer()
    a["candidate"]["direction"] = "None"
    r = AI.enforce(AI.normalize(a), s, th(), CLEAR, 0.055, decide)
    assert r["counter_trend"] and r["verdict"] != "TRADEABLE NOW"
    for bad in (-5, "NaN", "inf", 0, True):
        a = model_answer()
        a["candidate"]["level"] = bad
        r = AI.enforce(AI.normalize(a), snap(), th(), CLEAR, 0.055, decide)
        assert r["verdict"] != "TRADEABLE NOW", bad


def test_normalize_survives_any_shape(env):
    AI, _, _ = env
    for junk in ([], "x", None, 5, {"breakdown": "abc", "levels_in_play": [{"state": {"html": "<b>x</b>"}}], "session": {"reason": {"html": 1}}}):
        r = AI.normalize(junk)
        assert r["verdict"] == "NO SETUP"
        for x in r["levels_in_play"]:
            assert all(isinstance(v, (str, float, type(None))) for v in x.values())
        assert isinstance(r["session"]["reason"], str) and r["breakdown"] in ([], )


def test_counter_trend_blocked(env):
    AI, decide, _ = env
    s = snap()
    s["regime"] = {"regime": "downtrend", "permitted": ["Short"]}
    r = AI.enforce(AI.normalize(model_answer()), s, th(), CLEAR, 0.055, decide)
    assert r["counter_trend"] and r["verdict"] != "TRADEABLE NOW"


def test_claude_may_be_stricter_than_rules(env):
    AI, decide, _ = env
    r = AI.enforce(AI.normalize(model_answer(verdict="NO SETUP")), snap(), th(), CLEAR, 0.055, decide)
    assert r["verdict"] == "NO SETUP" and r["rules_check"]["verdict"] == "GO"


def test_normalize_clamps_garbage(env):
    AI, _, _ = env
    r = AI.normalize({"verdict": "BUY BUY BUY", "c1": {"score": 9, "checks": {"range": 1, "evil": True}},
                      "candidate": {"setup": "Head and shoulders", "direction": "Up", "level": "abc"}})
    assert r["verdict"] == "NO SETUP" and r["c1"]["score"] == 2 and r["c2"]["score"] == 0
    assert set(r["c1"]["checks"]) == set(KEYS["c1"]) and r["c1"]["checks"]["range"] is True
    assert r["candidate"]["setup"] == "None" and r["candidate"]["direction"] == "None" and r["candidate"]["level"] is None


def test_schema_is_strict_everywhere(env):
    AI, _, _ = env

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "object":
                assert node.get("additionalProperties") is False
                assert set(node["required"]) == set(node["properties"])
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
    walk(AI.SCHEMA)
    for k, keys in KEYS.items():
        assert tuple(AI.SCHEMA["properties"][k]["properties"]["checks"]["properties"]) == keys


def test_prompt_uses_live_rulebook(env):
    AI, _, _ = env
    t = th()
    t["pen_floor_atr"] = 0.3
    t["window_max_candles"] = 5
    p = AI.system_prompt(t)
    assert "floor (0.3 ATR" in p and "candle 1 to 5" in p and "—" not in p


def test_data_class_matrix_strips_by_provider():
    from server import ai_backups as BK
    pk = {"symbol": "ETHUSDT", "candles_15m_closed": {}, "rulebook": {"x": 1}, "trader_profile": {"leaks": []}}
    # openai (paid, aggregate_r_counts): keeps everything the app ever sends
    a = BK.strip_packet_for(dict(pk), "openai")
    assert "trader_profile" in a and "rulebook" in a
    # gemini (free, rulebook max): loses the aggregate pattern summary, keeps rulebook + market
    g = BK.strip_packet_for(dict(pk), "gemini")
    assert "trader_profile" not in g and "rulebook" in g and "symbol" in g
    # primary is at least as trusted as any backup
    assert BK.CLASS_RANK[BK.max_class("claude")] >= BK.CLASS_RANK[BK.max_class("gemini")]
    # nobody is ever allowed credentials, position size or balance
    pol = BK.data_policy()
    for row in pol["rows"]:
        if row["cls"] in ("credentials", "position_size", "account_balance"):
            assert not any(row["allow"].values())


def test_market_session_strips_loss_information(env):
    AI, _, _ = env
    s = {"status": "caution", "losses_today": 2, "reasons": [
        {"rule": 10, "level": "info", "text": "2 losses today. 1 more and you are done."},
        {"rule": None, "level": "caution", "text": "ETHUSDT funding settles in 20 min."}]}
    s["reasons"].append({"rule": None, "level": "caution", "text": "FARTCOINUSDT funding settles in 5 min."})
    m = AI.market_session(s, "ETHUSDT")
    assert m == {"status": "caution", "flags": ["ETHUSDT funding settles in 20 min."]}   # other symbols stay private
    assert "loss" not in json.dumps(m)


def test_cost_from_usage(env):
    AI, _, _ = env
    assert AI.cost_usd("claude-opus-5-5", {"input_tokens": 10_000, "output_tokens": 5_000}) == pytest.approx(0.14)
    assert AI.cost_usd("claude-sonnet-5", {"input_tokens": 1_000_000, "output_tokens": 0}) == pytest.approx(2.0)


def test_key_shape_and_storage_never_in_db(env):
    AI, _, tmp = env
    assert not AI.looks_like_key("hello") and not AI.looks_like_key("sk-ant-short")
    k = "sk-ant-api03-" + "x" * 60
    assert AI.looks_like_key(k)
    assert AI.key_save(k) == "local-file"
    f = tmp / ".anthropic_key.json"
    assert oct(f.stat().st_mode & 0o777) == "0o600"
    assert AI.key_load() == k and k not in AI.key_mask(k)
    AI.key_clear()
    assert AI.key_load() is None and not f.exists()


# ---------------------------------------------------------------- full scan against a stand-in Claude
class FakeClaude:
    def __init__(self):
        self.requests = []
        self.mode = "ok"
        self.verdict = "WATCH"

    async def messages(self, request):
        body = await request.json()
        self.requests.append({"headers": dict(request.headers), "body": body})
        if self.mode == "401":
            return web.json_response({"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}}, status=401)
        if self.mode == "credits":
            return web.json_response({"type": "error", "error": {"type": "invalid_request_error",
                                      "message": "Your credit balance is too low to access the Anthropic API."}}, status=400)
        if self.mode == "no-effort" and "effort" in (body.get("output_config") or {}):
            return web.json_response({"type": "error", "error": {"type": "invalid_request_error",
                                      "message": "output_config.effort: Extra inputs are not permitted"}}, status=400)
        if self.mode == "garbage":
            return web.json_response({"id": "m", "type": "message", "model": body["model"], "stop_reason": "end_turn",
                                      "content": [{"type": "text", "text": "I think it looks bullish!"}],
                                      "usage": {"input_tokens": 1000, "output_tokens": 1000}})
        if self.mode == "404":
            return web.json_response({"type": "error", "error": {"type": "not_found_error", "message": "model: claude-opus-5-5"}}, status=404)
        if self.mode == "spend":
            return web.json_response({"type": "error", "error": {"type": "invalid_request_error",
                                      "message": "You have reached your specified workspace API usage limits."}}, status=400)
        ans = model_answer(verdict=self.verdict)
        if not body.get("stream"):
            return web.json_response({"id": "msg_1", "type": "message", "role": "assistant", "model": body["model"],
                                      "stop_reason": "end_turn",
                                      "content": [{"type": "thinking", "thinking": "...", "signature": "s"},
                                                  {"type": "text", "text": json.dumps(ans)}],
                                      "usage": {"input_tokens": 9000, "output_tokens": 4000}})
        resp = web.StreamResponse(headers={"Content-Type": "text/event-stream; charset=utf-8"})
        await resp.prepare(request)

        async def ev(name, data):
            await resp.write(f"event: {name}\ndata: {json.dumps(data)}\n\n".encode())
        n = len(self.requests)
        await ev("message_start", {"type": "message_start", "message": {"id": "msg_1", "type": "message", "role": "assistant",
                 "model": body["model"], "content": [], "stop_reason": None, "usage": {"input_tokens": 9000, "output_tokens": 1}}})
        if self.mode == "overloaded" and n == 1:
            await ev("error", {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}})
            return resp
        await ev("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": ""}})
        await ev("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "hmm"}})
        await ev("ping", {"type": "ping"})
        await ev("content_block_stop", {"type": "content_block_stop", "index": 0})
        await ev("content_block_start", {"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}})
        txt = json.dumps(ans)
        half = len(txt) // 2
        await ev("content_block_delta", {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": txt[:half]}})
        if self.mode == "drop" and n == 1:
            return resp                                            # connection ends mid-answer
        await ev("content_block_delta", {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": txt[half:]}})
        await ev("content_block_stop", {"type": "content_block_stop", "index": 1})
        await ev("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 4000}})
        await ev("message_stop", {"type": "message_stop"})
        return resp

    async def models(self, request):
        ok = request.headers.get("x-api-key", "").endswith("good")
        return web.json_response({"data": []} if ok else {"type": "error"}, status=200 if ok else 401)


async def _with_app(AI, fn, mode="ok"):
    from server.core import TrapApp
    fake = FakeClaude()
    fake.mode = mode
    srv = web.Application()
    srv.router.add_post("/v1/messages", fake.messages)
    srv.router.add_get("/v1/models", fake.models)
    runner = web.AppRunner(srv)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    AI.API_BASE = f"http://127.0.0.1:{port}"
    AI.RETRY_WAITS = (0.05, 0.05)
    a = TrapApp(demo=True)
    await a.startup()
    try:
        sym = a.settings()["watchlist"][0]
        for _ in range(100):
            if a.market.sd(sym).snapshot and a.market.sd(sym).snapshot.get("atr15"):
                break
            await asyncio.sleep(0.1)
        await fn(a, sym, fake)
    finally:
        await a.shutdown()
        await runner.cleanup()


async def _wait(a, sym):
    for _ in range(200):
        if sym not in a.ai.running:
            return
        await asyncio.sleep(0.05)
    raise AssertionError("scan never finished")


def test_full_scan_sends_market_data_only(env):
    AI, _, _ = env
    AI.key_save("sk-ant-api03-" + "k" * 40)

    async def go(a, sym, fake):
        a.ai.start(sym)
        await _wait(a, sym)
        st = a.ai.status(sym)
        assert st["error"] is None, st["error"]
        rec = st["last"]
        assert rec["result"]["verdict"] == "WATCH" and rec["cost_usd"] == pytest.approx(0.116)
        assert a.ai.spent() == pytest.approx(0.116)
        req = fake.requests[0]
        assert req["headers"]["x-api-key"].startswith("sk-ant-") and req["headers"]["anthropic-version"] == "2023-06-01"
        assert req["body"]["model"] == "claude-opus-5-5"
        assert req["body"]["output_config"]["format"]["type"] == "json_schema"
        assert req["body"]["output_config"]["effort"] == "medium"                  # default scan depth "fast"
        assert req["body"]["thinking"] == {"type": "adaptive", "display": "summarized"}   # progress streams while it thinks
        assert req["body"]["system"][0]["cache_control"] == {"type": "ephemeral"}
        user = req["body"]["messages"][0]["content"]
        packet = json.loads(user.split("MARKET PACKET (JSON):\n", 1)[1])
        assert packet["symbol"] == sym and packet["candles_15m_closed"]["rows"]
        # option B: a pattern summary rides along, in R and counts only
        prof = packet.pop("trader_profile")
        assert set(prof) == {"note", "evidence_note", "closed_trade_count", "overall_avg_r", "leaks",
                             "matching_this_setup", "app_call_record", "personal_blocks"}
        assert "make money" not in json.dumps(prof)             # caution only: nothing that argues for a looser call
        pdump = json.dumps(prof).lower()
        import re
        for secret_word in ("$", "balance", "equity", "qty", "size", "pnl", "wallet", "sk-ant", "stop at", "entry at"):
            assert secret_word not in pdump, secret_word
        assert not re.search(r"\busd\b|\bdollars?\b", pdump)
        for t in a.db.trades():            # no traded prices or dates
            for v in (t.get("entry"), t.get("exit"), t.get("stop")):
                if v:
                    assert f"{v:g}" not in pdump
            if t.get("date"):
                assert t["date"] not in pdump
        dump = json.dumps(packet).lower()
        for secret_word in ("wallet", "equity", "open_positions", "\"positions\"", "losses", "api_key", "secret", "journal", "pnl", "\"trades\"", "sk-ant"):
            assert secret_word not in dump, secret_word
        # the forming candle is never presented as closed
        assert all(r[0] != (packet["candle_15m_forming"] or [None])[0] for r in packet["candles_15m_closed"]["rows"])
    asyncio.run(_with_app(AI, go))


def test_retry_without_effort_and_friendly_errors(env):
    AI, _, _ = env
    AI.key_save("sk-ant-api03-" + "k" * 40)

    async def go(a, sym, fake):
        a.ai.start(sym)
        await _wait(a, sym)
        assert a.ai.status(sym)["error"] is None
        assert "effort" in fake.requests[0]["body"]["output_config"]
        assert "effort" not in fake.requests[1]["body"]["output_config"]
        assert fake.requests[1]["body"]["output_config"]["format"]["type"] == "json_schema"
    asyncio.run(_with_app(AI, go, mode="no-effort"))

    async def go401(a, sym, fake):
        before = a.ai.spent()
        a.ai.start(sym)
        await _wait(a, sym)
        assert "rejected the API key" in a.ai.status(sym)["error"]["message"]
        assert a.ai.spent() == before          # failed calls cost nothing
    asyncio.run(_with_app(AI, go401, mode="401"))

    async def gocredits(a, sym, fake):
        a.ai.start(sym)
        await _wait(a, sym)
        assert "out of credits" in a.ai.status(sym)["error"]["message"]
    asyncio.run(_with_app(AI, gocredits, mode="credits"))


def test_guards_budget_cooldown_no_key_and_recovering(env):
    AI, _, _ = env

    async def go(a, sym, fake):
        with pytest.raises(AI.AIError, match="Connect Claude"):
            a.ai.start(sym)
        AI.key_save("sk-ant-api03-" + "k" * 40)
        a.shared.set("ai_budget_usd", 0.05)
        a.shared.set(f"ai_spend:{a.ai._month()}", 0.05)
        with pytest.raises(AI.AIError, match="budget"):
            a.ai.start(sym)
        a.shared.set("ai_budget_usd", 20)
        a.ai.start(sym)
        await _wait(a, sym)
        with pytest.raises(AI.AIError, match="seconds between scans"):
            a.ai.start(sym)
        # trading to recover: stop entirely, answered locally, nothing sent
        n = len(fake.requests)
        a.ai._last_start = 0
        st = a.ai.start(sym, recovering=True)
        assert st["last"]["result"]["verdict"] == "STAND DOWN" and st["last"]["local"]
        assert len(fake.requests) == n
    asyncio.run(_with_app(AI, go))


def test_key_validation(env):
    AI, _, _ = env

    async def go(a, sym, fake):
        await AI.validate_key(a.http, "sk-ant-api03-" + "x" * 30 + "good")
        with pytest.raises(AI.AIError, match="rejected"):
            await AI.validate_key(a.http, "sk-ant-api03-" + "x" * 30 + "bad")
    asyncio.run(_with_app(AI, go))


def test_unreadable_answer_is_still_billed_and_zero_budget_blocks(env):
    AI, _, _ = env
    AI.key_save("sk-ant-api03-" + "k" * 40)

    async def go(a, sym, fake):
        a.ai.start(sym)
        await _wait(a, sym)
        assert "not readable" in a.ai.status(sym)["error"]["message"]
        assert a.ai.spent() == pytest.approx(0.048)          # asked once more; Anthropic bills both, so the budget counts both
        a.shared.set("ai_budget_usd", 0)
        a.ai._last_start = 0
        assert a.ai.budget() == 0
        with pytest.raises(AI.AIError, match="budget"):
            a.ai.start(sym)
    asyncio.run(_with_app(AI, go, mode="garbage"))


def test_watch_on_a_disqualified_level_becomes_no_setup(env):
    AI, decide, _ = env
    r = AI.enforce(AI.normalize(model_answer(verdict="WATCH")), snap("DEAD_SHALLOW"), th(), CLEAR, 0.055, decide)
    assert r["verdict"] == "NO SETUP" and r["ai_verdict"] == "WATCH" and "nobody recruited" in r["overrides"][0]
    r = AI.enforce(AI.normalize(model_answer(verdict="WATCH")), snap("RECRUITING"), th(), CLEAR, 0.055, decide)
    assert r["verdict"] == "WATCH" and not r["overrides"]


def test_streaming_survives_drops_and_overload_and_explains_errors(env):
    """Pat's scans ran over a VPN: long silent requests get cut. Answers now
    stream, a dropped stream or an overload is retried, and every other error
    says what Claude actually reported."""
    AI, _, _ = env
    AI.key_save("sk-ant-api03-" + "k" * 40)

    async def go_drop(a, sym, fake):
        a.ai.start(sym)
        await _wait(a, sym)
        st = a.ai.status(sym)
        assert st["error"] is None and st["last"]["result"]["verdict"] == "WATCH"
        assert len(fake.requests) == 2 and fake.requests[0]["body"]["stream"] is True
        # the dropped first try (9000 in, 1 out) plus the full answer are both counted
        assert a.ai.spent() == pytest.approx(0.116 + 0.03602, abs=1e-4)
    asyncio.run(_with_app(AI, go_drop, mode="drop"))

    async def go_over(a, sym, fake):
        a.ai.start(sym)
        await _wait(a, sym)
        assert a.ai.status(sym)["error"] is None and len(fake.requests) == 2
    asyncio.run(_with_app(AI, go_over, mode="overloaded"))

    async def go_404(a, sym, fake):
        a.ai.start(sym)
        await _wait(a, sym)
        m = a.ai.status(sym)["error"]["message"]
        assert "can't use this model" in m and "Claude said" in m and len(fake.requests) == 1
    asyncio.run(_with_app(AI, go_404, mode="404"))

    async def go_spend(a, sym, fake):
        a.ai.start(sym)
        await _wait(a, sym)
        m = a.ai.status(sym)["error"]["message"]
        assert "usage limits" in m and "(400)" in m or "spend limit" in m
    asyncio.run(_with_app(AI, go_spend, mode="spend"))


def test_enum_capitalization_is_forgiven(env):
    AI, _, _ = env
    a = model_answer(verdict="Tradeable Now")
    a["candidate"]["direction"] = "long"
    a["confidence"] = "High"
    r = AI.normalize(a)
    assert r["verdict"] == "TRADEABLE NOW" and r["candidate"]["direction"] == "Long" and r["confidence"] == "high"


def test_backups_step_in_when_claude_cannot(env):
    """Claude out of credits -> ChatGPT answers; ChatGPT out of quota too ->
    Gemini answers with market data only. Same rule re-check either way."""
    AI, _, _ = env
    from server import ai_backups as BK
    AI.key_save("sk-ant-api03-" + "k" * 40)
    BK.key_save("openai", "sk-" + "o" * 40)
    BK.key_save("gemini", "g" * 39)
    seen = {"openai": [], "gemini": []}
    mode = {"openai": "ok"}

    async def openai(request):
        body = await request.json()
        seen["openai"].append(body)
        if mode["openai"] == "quota":
            return web.json_response({"error": {"code": "insufficient_quota"}}, status=429)
        return web.json_response({"model": body["model"], "choices": [{"finish_reason": "stop", "message": {
            "content": json.dumps(model_answer(verdict="WATCH"))}}], "usage": {"prompt_tokens": 10_000, "completion_tokens": 2_000}})

    async def gemini(request):
        body = await request.json()
        seen["gemini"].append(body)
        return web.json_response({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(model_answer(verdict="Tradeable now"))}]}}],
                                  "usageMetadata": {"promptTokenCount": 9000, "candidatesTokenCount": 1500}})

    async def go(a, sym, fake):
        srv = web.Application()
        srv.router.add_post("/v1/chat/completions", openai)
        srv.router.add_post(r"/v1beta/models/{m}:generateContent", gemini)
        runner = web.AppRunner(srv)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        BK.OPENAI_BASE = BK.GEMINI_BASE = f"http://127.0.0.1:{port}"
        try:
            a.ai.start(sym)
            await _wait(a, sym)
            st = a.ai.status(sym)
            assert st["error"] is None, st["error"]
            res = st["last"]["result"]
            assert st["last"]["provider"] == "openai" and res["backup"]["provider"] == "openai" and "credits" in " ".join(res["backup"]["why"])
            assert "trader_profile" in seen["openai"][0]["messages"][1]["content"]
            assert st["last"]["cost_usd"] == pytest.approx(0.002)          # 10k in * $0.10/M + 2k out * $0.50/M
            mode["openai"] = "quota"
            a.ai._last_start = 0
            a.ai.start(sym)
            await _wait(a, sym)
            st = a.ai.status(sym)
            assert st["error"] is None and st["last"]["provider"] == "gemini"
            text = seen["gemini"][0]["contents"][0]["parts"][0]["text"]
            assert "trader_profile" not in text and "MARKET PACKET" in text     # free tier: market data only
            assert st["last"]["result"]["ai_verdict"] == "TRADEABLE NOW"         # capitalization forgiven, then re-checked
        finally:
            await runner.cleanup()
    asyncio.run(_with_app(AI, go, mode="credits"))
