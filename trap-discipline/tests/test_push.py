"""Setup/entry alerts and Web Push: dedupe, which states push, demo labeling,
dead-subscription pruning, endpoint validation, key-file permissions, and
graceful degradation when the push library is missing."""
import asyncio
import os
import stat
import sys

import pytest

pytest.importorskip("pywebpush")


@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAP_DATA_DIR", str(tmp_path))
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]
    from server.core import TrapApp
    a = TrapApp(demo=True)
    sent = []

    async def fake_broadcast(vapid, subs, payload):
        sent.append(payload)
        return [(s, True, None, 201) for s in subs]

    from server import webpush as WP
    monkeypatch.setattr(WP, "broadcast", fake_broadcast)
    a.shared.push_sub_add("https://fcm.googleapis.com/fcm/send/abc", "p", "k", "Phone")
    a._sent = sent
    yield a
    a.db.close()
    a.shared.close()


def lvl(state, key="ETHUSDT:3000"):
    return {"symbol": "ETHUSDT", "prev": "DORMANT",
            "level": {"key": key, "price": 3000.0, "state": state, "setup": "Spring", "direction": "Long", "note": ""}}


async def settle(a):
    await asyncio.sleep(0)
    if a._bg:
        await asyncio.gather(*list(a._bg), return_exceptions=True)


def run(a, *events):
    async def go():
        for e in events:
            await a._market_event("level_state", e)
        await settle(a)
    asyncio.run(go())


def test_forming_and_entry_both_push(app):
    run(app, lvl("RECRUITING"), lvl("TRIGGERED"))
    titles = [p["title"] for p in app._sent]
    assert len(titles) == 2
    assert "recruiting" in titles[0] and "TRIGGERED" in titles[1]
    assert all(p["url"] == "/#/markets/ETHUSDT" for p in app._sent)
    assert app._sent[0]["tag"] == app._sent[1]["tag"]  # entry replaces the forming alert on the device


def test_demo_alerts_are_labeled(app):
    run(app, lvl("TRIGGERED"))
    assert app._sent[0]["title"].startswith("DEMO · ")


def test_repeat_inside_window_does_not_rebuzz(app):
    # a level flapping RECRUITING -> WATCH -> RECRUITING inside one 15m window
    run(app, lvl("RECRUITING"), lvl("WATCH"), lvl("RECRUITING"))
    assert len(app._sent) == 1


def test_watch_is_in_app_only(app):
    run(app, lvl("WATCH"))
    assert app._sent == []
    assert app.coach.recent(5)[0]["title"].endswith("is on WATCH")


def test_approaching_is_opt_in(app):
    run(app, lvl("APPROACHING", key="a1"))
    assert app._sent == [] and not any("approaching" in c["title"] for c in app.coach.recent(5))
    app.set_setting("push_states", ["APPROACHING", "RECRUITING", "TRIGGERED"])
    run(app, lvl("APPROACHING", key="a2"))
    assert len(app._sent) == 1 and "approaching" in app._sent[0]["title"]


def test_empty_state_list_is_honored(app):
    app.set_setting("push_states", [])
    assert app.settings()["push_states"] == []
    run(app, lvl("TRIGGERED"))
    assert app._sent == []
    assert app.coach.recent(1)[0]["title"].endswith("TRIGGERED")  # in-app alert still fires


def test_devices_survive_mode_switch(tmp_path, monkeypatch, app):
    from server.core import TrapApp
    live = TrapApp(demo=False)
    assert [s["label"] for s in live.shared.push_subs()] == ["Phone"]
    live.db.close(); live.shared.close()


def test_gone_subscription_is_pruned(app, monkeypatch):
    from server import webpush as WP

    async def gone(vapid, subs, payload):
        return [(s, False, "410 Gone", 410) for s in subs]
    monkeypatch.setattr(WP, "broadcast", gone)
    asyncio.run(app.push_notify("t", "b"))
    assert app.shared.push_subs() == []


def test_failed_send_is_recorded_not_pruned(app, monkeypatch):
    from server import webpush as WP

    async def flaky(vapid, subs, payload):
        return [(s, False, "timeout", None) for s in subs]
    monkeypatch.setattr(WP, "broadcast", flaky)
    asyncio.run(app.push_notify("t", "b"))
    subs = app.shared.push_subs()
    assert len(subs) == 1 and subs[0]["last_error"] == "timeout"


def test_vapid_key_file_is_owner_only(app, tmp_path):
    p = tmp_path / "vapid_private.pem"
    assert p.exists()
    if os.name == "posix":
        assert stat.S_IMODE(p.stat().st_mode) == 0o600
    from server import webpush as WP
    k = WP.public_key_b64(app.vapid)
    assert len(k) == 87 and "=" not in k  # 65-byte uncompressed P-256 point, base64url


def test_same_key_reused_across_restarts(app, tmp_path):
    from server import webpush as WP
    first = WP.public_key_b64(app.vapid)
    again = WP.load_or_create_vapid(tmp_path / "vapid_private.pem")
    assert WP.public_key_b64(again) == first  # enrolled devices keep working after a restart


def test_endpoint_validation_blocks_non_relays(app):
    from server.api import _valid_sub
    good = {"endpoint": "https://fcm.googleapis.com/fcm/send/x", "keys": {"p256dh": "a", "auth": "b"}}
    assert _valid_sub(good) is None
    for ep in ("https://web.push.apple.com/abc", "https://updates.push.services.mozilla.com/wpush/v2/x",
               "https://wns2-par02p.notify.windows.com/w/?token=x"):
        assert _valid_sub({**good, "endpoint": ep}) is None, ep
    for ep in ("http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://192.168.1.4/x", "https://172.16.0.1/x",
               "https://evil.com/fcm.googleapis.com", "https://fcm.googleapis.com.evil.com/x", "https://notfcm.googleapis.com.io/x"):
        assert _valid_sub({**good, "endpoint": ep}) is not None, ep
    assert _valid_sub({"endpoint": good["endpoint"], "keys": {}}) is not None


def test_tailnet_host_pattern():
    from server.api import TAILNET_RE
    assert TAILNET_RE.match("pats-laptop.tail1a2b3.ts.net")
    for bad in ("evil.com", "ts.net", "a.ts.net.evil.com", "x.ts.net/evil", "127.0.0.1", "-bad.tail1.ts.net"):
        assert not TAILNET_RE.match(bad), bad


def test_app_runs_without_push_library(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAP_DATA_DIR", str(tmp_path))
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]
    import builtins
    real = builtins.__import__

    def no_push(name, *a, **k):
        if name in ("pywebpush", "py_vapid"):
            raise ImportError("simulated missing package")
        return real(name, *a, **k)
    monkeypatch.setattr(builtins, "__import__", no_push)
    from server.core import TrapApp
    a = TrapApp(demo=True)
    assert a.vapid is None
    asyncio.run(a.push_notify("t", "b"))   # no-op, no crash
    a.db.close(); a.shared.close()
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]
