"""Web Push notifications (the open W3C Push API + RFC 8292 VAPID signing),
sent straight to the person's own devices with no third-party account and no
outside service to sign up for. pywebpush talks directly to whichever push
relay the subscribing browser already uses - Google's for Chrome/Edge/Android,
Mozilla's for Firefox, Apple's for Safari/iOS - the same relay every website's
notifications already go through. Only a short alert (symbol, level, state)
ever leaves this machine; API keys, positions and trade data never do.

The VAPID (Voluntary Application Server Identification) keypair identifies
this install to those relays so they will accept its messages. It is
generated once on first use and kept next to the database, owner-readable
only, like the fallback Bybit credential file.

If the push library is missing (for example, the launcher could not reach the
package index), push is reported as unavailable and everything else in the
app keeps working.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from pathlib import Path
from typing import Any

log = logging.getLogger("trap.push")

try:
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid02
    from pywebpush import WebPushException, webpush
    AVAILABLE = True
    IMPORT_ERROR: str | None = None
except Exception as exc:  # noqa: BLE001
    AVAILABLE = False
    IMPORT_ERROR = str(exc)

# Required by the Push API spec as a contact point for relay operators. It is
# never emailed to or used for anything else; nothing here sends mail.
VAPID_CLAIMS_SUB = "mailto:trap-discipline@localhost"


def load_or_create_vapid(path: Path) -> Any | None:
    """Load the VAPID keypair, generating one on first use. The private key
    file is created owner-read/write only (0600) before any bytes are written."""
    if not AVAILABLE:
        log.warning("Push notifications unavailable: %s", IMPORT_ERROR)
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return Vapid02.from_file(str(path))
    v = Vapid02()
    v.generate_keys()
    pem = v.private_pem()
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(pem)
    return v


def public_key_b64(vapid: Any) -> str:
    """The uncompressed EC point, base64url with no padding - the exact form
    the browser's PushManager.subscribe({applicationServerKey}) expects."""
    raw = vapid.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


async def send_push(vapid: Any, subscription: dict, payload: dict, *, ttl: int = 300) -> tuple[bool, str | None, int | None]:
    """Send one push message. The blocking HTTPS call runs in a thread so it
    never stalls the event loop. Returns (ok, error, http_status); never raises.
    ttl=300: a relay holds an undelivered alert for 5 minutes at most - a
    setup alert that arrives an hour late is worse than none."""
    def _send() -> tuple[bool, str | None, int | None]:
        try:
            resp = webpush(subscription_info=subscription, data=json.dumps(payload),
                           vapid_private_key=vapid, vapid_claims={"sub": VAPID_CLAIMS_SUB},
                           ttl=ttl, timeout=10)
            return True, None, getattr(resp, "status_code", 201)
        except WebPushException as exc:
            status = exc.response.status_code if getattr(exc, "response", None) is not None else None
            return False, str(exc)[:300], status
        except Exception as exc:  # noqa: BLE001 - a bad subscription must never kill the alert pipeline
            return False, str(exc)[:300], None

    return await asyncio.to_thread(_send)


async def broadcast(vapid: Any, subs: list[dict], payload: dict) -> list[tuple[dict, bool, str | None, int | None]]:
    """Send to every subscription concurrently; one result per subscription so
    the caller can prune the ones the relay reports gone (HTTP 404/410)."""
    async def one(sub: dict):
        info = {"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}}
        sent, err, status = await send_push(vapid, info, payload)
        return sub, sent, err, status
    return list(await asyncio.gather(*(one(s) for s in subs)))
