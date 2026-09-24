"""Twilio SMS alerts: credential storage/validation, the send path, and how
it rides the same alert pipeline as Web Push (gated by sms_enabled, off by
default, never sends unless a Twilio account is actually saved)."""
import asyncio
import json
import sys

import pytest


@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAP_DATA_DIR", str(tmp_path))
    for m in [m for m in list(sys.modules) if m.startswith("server")]:
        del sys.modules[m]
    from server.core import TrapApp
    a = TrapApp(demo=True)
    yield a
    a.db.close()
    a.shared.close()


# ---------------------------------------------------------------- validation
def test_looks_like_sid_and_phone():
    from server import sms as SMS
    assert SMS.looks_like_sid("AC" + "a" * 32)
    assert not SMS.looks_like_sid("AC" + "a" * 31)
    assert not SMS.looks_like_sid("bad")
    assert SMS.looks_like_phone("+15551234567")
    assert not SMS.looks_like_phone("5551234567")   # missing +
    assert not SMS.looks_like_phone("+1555")        # too short


def test_mask():
    from server import sms as SMS
    assert SMS.mask(None) == ""
    assert SMS.mask("AC" + "a" * 32) == "ACaaaa…aaaa"
    assert SMS.mask("short") == "****"


# ---------------------------------------------------------------- credential storage (local-file fallback)
def test_save_load_clear_roundtrip(tmp_path, monkeypatch):
    from server import sms as SMS
    monkeypatch.setattr(SMS, "_keyring", lambda: None)   # force the file fallback, like a keyring-less CI box
    monkeypatch.setattr(SMS, "_FALLBACK", tmp_path / ".twilio_credentials.json")
    assert SMS.load() is None
    kind = SMS.save("ACsid", "token", "+15550000000", "+15551111111")
    assert kind == "local-file"
    assert SMS.storage_kind() == "local-file"
    creds = SMS.load()
    assert creds == {"account_sid": "ACsid", "auth_token": "token",
                     "from_number": "+15550000000", "to_number": "+15551111111"}
    SMS.clear()
    assert SMS.load() is None


def test_incomplete_saved_file_reads_as_unconfigured(tmp_path, monkeypatch):
    from server import sms as SMS
    monkeypatch.setattr(SMS, "_keyring", lambda: None)
    f = tmp_path / ".twilio_credentials.json"
    monkeypatch.setattr(SMS, "_FALLBACK", f)
    f.write_text(json.dumps({"account_sid": "ACsid"}))   # partial write, e.g. an interrupted save
    assert SMS.load() is None


# ---------------------------------------------------------------- sending (fake aiohttp)
class _FakeResp:
    def __init__(self, status, text):
        self.status = status
        self._text = text

    async def text(self):
        return self._text

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _FakeSession:
    def __init__(self, status, text):
        self.status, self.text = status, text
        self.calls = []

    def post(self, url, **kw):
        self.calls.append((url, kw))
        return _FakeResp(self.status, self.text)

    def get(self, url, **kw):
        self.calls.append((url, kw))
        return _FakeResp(self.status, self.text)


def test_send_sms_success():
    from server import sms as SMS
    sess = _FakeSession(201, "{}")
    creds = {"account_sid": "ACsid", "auth_token": "tok", "from_number": "+1", "to_number": "+2"}
    ok, err = asyncio.run(SMS.send_sms(sess, creds, "hello"))
    assert ok and err is None
    assert sess.calls[0][0].endswith("/Accounts/ACsid/Messages.json")


def test_send_sms_twilio_error_surfaces_message():
    from server import sms as SMS
    sess = _FakeSession(400, json.dumps({"message": "The 'To' number is not a valid phone number."}))
    creds = {"account_sid": "ACsid", "auth_token": "tok", "from_number": "+1", "to_number": "+2"}
    ok, err = asyncio.run(SMS.send_sms(sess, creds, "hello"))
    assert not ok and "not a valid phone number" in err


def test_validate_rejects_bad_auth():
    from server import sms as SMS
    sess = _FakeSession(401, "{}")
    with pytest.raises(SMS.SmsError):
        asyncio.run(SMS.validate(sess, "ACsid", "wrong"))


def test_validate_accepts_ok():
    from server import sms as SMS
    sess = _FakeSession(200, "{}")
    asyncio.run(SMS.validate(sess, "ACsid", "right"))  # no raise


# ---------------------------------------------------------------- wired into the alert pipeline
def test_sms_off_by_default_even_when_configured(app, monkeypatch, tmp_path):
    from server import sms as SMS
    monkeypatch.setattr(SMS, "_keyring", lambda: None)
    monkeypatch.setattr(SMS, "_FALLBACK", tmp_path / ".twilio_credentials.json")
    SMS.save("ACsid", "tok", "+1", "+2")
    sent = []

    async def fake_send(session, creds, body):
        sent.append(body)
        return True, None
    monkeypatch.setattr(SMS, "send_sms", fake_send)
    asyncio.run(app.push_notify("Title", "Body"))
    assert sent == []   # sms_enabled defaults False


def test_sms_sends_when_enabled_and_configured(app, monkeypatch, tmp_path):
    from server import sms as SMS
    monkeypatch.setattr(SMS, "_keyring", lambda: None)
    monkeypatch.setattr(SMS, "_FALLBACK", tmp_path / ".twilio_credentials.json")
    SMS.save("ACsid", "tok", "+1", "+2")
    app.set_setting("sms_enabled", True)
    sent = []

    async def fake_send(session, creds, body):
        sent.append(body)
        return True, None
    monkeypatch.setattr(SMS, "send_sms", fake_send)
    asyncio.run(app.push_notify("Title", "Body"))
    assert sent == ["Title\nBody"]


def test_sms_enabled_defaults_false(app):
    assert app.settings()["sms_enabled"] is False
