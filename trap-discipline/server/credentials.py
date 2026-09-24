"""API key storage.

Preferred store: the operating system's credential vault via `keyring`
(Windows Credential Manager, macOS Keychain). The secret never goes to the
browser, never into the database, never into logs or exports.

If no OS vault is available, falls back to a local file readable only by the
current user, and the Settings page says so.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from . import config

log = logging.getLogger("trap.credentials")

_FALLBACK = config.DATA_DIR / ".bybit_credentials.json"


def _keyring():
    try:
        import keyring  # type: ignore
        from keyring.backends import fail  # type: ignore
        kr = keyring.get_keyring()
        if isinstance(kr, fail.Keyring):
            return None
        return keyring
    except Exception:  # noqa: BLE001
        return None


def storage_kind() -> str:
    return "os-vault" if _keyring() else "local-file"


def save(api_key: str, api_secret: str) -> str:
    kr = _keyring()
    if kr:
        kr.set_password(config.KEYRING_SERVICE, "api_key", api_key)
        kr.set_password(config.KEYRING_SERVICE, "api_secret", api_secret)
        if _FALLBACK.exists():
            _FALLBACK.unlink()
        return "os-vault"
    _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(_FALLBACK, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(json.dumps({"api_key": api_key, "api_secret": api_secret}))
    return "local-file"


def load() -> tuple[str | None, str | None]:
    kr = _keyring()
    if kr:
        try:
            k = kr.get_password(config.KEYRING_SERVICE, "api_key")
            s = kr.get_password(config.KEYRING_SERVICE, "api_secret")
            if k and s:
                return k, s
        except Exception as exc:  # noqa: BLE001
            log.warning("keyring read failed: %s", exc)
    if _FALLBACK.exists():
        try:
            d = json.loads(_FALLBACK.read_text())
            return d.get("api_key"), d.get("api_secret")
        except (OSError, ValueError):
            return None, None
    return None, None


def clear() -> None:
    kr = _keyring()
    if kr:
        for name in ("api_key", "api_secret"):
            try:
                kr.delete_password(config.KEYRING_SERVICE, name)
            except Exception:  # noqa: BLE001
                pass
    if _FALLBACK.exists():
        _FALLBACK.unlink()


def mask(api_key: str | None) -> str:
    if not api_key:
        return ""
    return api_key[:4] + "…" + api_key[-3:] if len(api_key) > 8 else "****"


def data_dir_exists() -> Path:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    return config.DATA_DIR
