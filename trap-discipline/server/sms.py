"""SMS alerts via Twilio, for the one case Web Push cannot cover: a personal
VPN that captures Apple's push channel and makes the phone look "offline" to
Apple's push relay until the VPN disconnects (see the Settings > Notifications
help text). A carrier text message does not ride the phone's data connection
or any VPN tunnel at all, so it arrives regardless of VPN state.

Only the same short alert text push already sends (symbol, level, state)
ever reaches Twilio. No Bybit key, balance, position size or dollar figure is
ever built into an SMS body; see server/ai.py's own privacy rule for the same
principle applied to the AI packet.

Credentials are stored like the Bybit and AI keys: the OS credential vault
via `keyring`, or a 0600 file in the data folder if no vault is available.
Never sent to the browser, logs or exports.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re

import aiohttp

from . import config

log = logging.getLogger("trap.sms")

TWILIO_BASE = os.environ.get("TRAP_TWILIO_BASE", "https://api.twilio.com")
KEYRING_SERVICE = "trap-discipline-twilio"
_FIELDS = ("account_sid", "auth_token", "from_number", "to_number")
_FALLBACK = config.DATA_DIR / ".twilio_credentials.json"

SID_RE = re.compile(r"AC[a-f0-9]{32}", re.IGNORECASE)
# E.164: a leading + then 8-15 digits total, which covers a US number
# (+1XXXXXXXXXX) and anything else Twilio can send to or from.
PHONE_RE = re.compile(r"\+[1-9]\d{7,14}")


class SmsError(Exception):
    pass


def _keyring():
    from .ai import _keyring as k
    return k()


def storage_kind() -> str:
    return "os-vault" if _keyring() else "local-file"


def looks_like_sid(v: str) -> bool:
    return bool(SID_RE.fullmatch((v or "").strip()))


def looks_like_phone(v: str) -> bool:
    return bool(PHONE_RE.fullmatch((v or "").strip()))


def save(account_sid: str, auth_token: str, from_number: str, to_number: str) -> str:
    vals = dict(zip(_FIELDS, (account_sid, auth_token, from_number, to_number)))
    kr = _keyring()
    if kr:
        for name, v in vals.items():
            kr.set_password(KEYRING_SERVICE, name, v)
        if _FALLBACK.exists():
            _FALLBACK.unlink()
        return "os-vault"
    _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(_FALLBACK, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(json.dumps(vals))
    return "local-file"


def load() -> dict | None:
    """Returns {"account_sid", "auth_token", "from_number", "to_number"} or
    None if nothing is configured yet, or a saved entry is incomplete."""
    kr = _keyring()
    if kr:
        try:
            vals = {name: kr.get_password(KEYRING_SERVICE, name) for name in _FIELDS}
            if all(vals.values()):
                return vals
        except Exception as exc:  # noqa: BLE001
            log.warning("keyring read failed: %s", exc)
    if _FALLBACK.exists():
        try:
            vals = json.loads(_FALLBACK.read_text())
            if all(vals.get(name) for name in _FIELDS):
                return vals
        except (OSError, ValueError):
            return None
    return None


def clear() -> None:
    kr = _keyring()
    if kr:
        for name in _FIELDS:
            try:
                kr.delete_password(KEYRING_SERVICE, name)
            except Exception:  # noqa: BLE001
                pass
    if _FALLBACK.exists():
        _FALLBACK.unlink()


def mask(sid: str | None) -> str:
    if not sid:
        return ""
    return sid[:6] + "…" + sid[-4:] if len(sid) > 12 else "****"


# ---------------------------------------------------------------- sending
async def validate(session: aiohttp.ClientSession, account_sid: str, auth_token: str) -> None:
    """Confirms the account SID and auth token are accepted by Twilio, without
    sending anything. Raises SmsError with a message safe to show in Settings."""
    url = f"{TWILIO_BASE}/2010-04-01/Accounts/{account_sid}.json"
    try:
        async with session.get(url, auth=aiohttp.BasicAuth(account_sid, auth_token),
                               timeout=aiohttp.ClientTimeout(total=20)) as resp:
            if resp.status == 401:
                raise SmsError("Twilio rejected that account SID / auth token pair. Copy both again from the Twilio Console.")
            if resp.status != 200:
                raise SmsError(f"Twilio returned an error checking the account ({resp.status}).")
    except asyncio.TimeoutError as exc:
        raise SmsError("Twilio did not answer within 20 seconds.") from exc
    except aiohttp.ClientError as exc:
        raise SmsError("Could not reach Twilio. Check the internet connection.") from exc


async def send_sms(session: aiohttp.ClientSession, creds: dict, body: str) -> tuple[bool, str | None]:
    """Sends one text. Returns (ok, error); never raises, matching webpush.send_push
    so a bad number or a lapsed trial never kills the alert pipeline."""
    url = f"{TWILIO_BASE}/2010-04-01/Accounts/{creds['account_sid']}/Messages.json"
    data = {"From": creds["from_number"], "To": creds["to_number"], "Body": body[:1580]}
    try:
        async with session.post(url, data=data,
                                auth=aiohttp.BasicAuth(creds["account_sid"], creds["auth_token"]),
                                timeout=aiohttp.ClientTimeout(total=15)) as resp:
            text = await resp.text()
            if resp.status in (200, 201):
                return True, None
            try:
                msg = json.loads(text).get("message")
            except ValueError:
                msg = None
            return False, (msg or f"Twilio HTTP {resp.status}")[:300]
    except asyncio.TimeoutError:
        return False, "Twilio did not answer within 15 seconds."
    except aiohttp.ClientError as exc:
        return False, str(exc)[:300]
