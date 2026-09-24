"""Backup AI analysts for the scan: ChatGPT (OpenAI API) and Gemini (Google).

Used only when Claude can't answer (out of credits, spend limit, rate limit,
busy, or no Claude key). Each backup gets the same system prompt and market
packet and must return the same JSON; the app then applies the exact same
rule re-check (enforce), so a backup can never be looser than Claude.

Privacy
- ChatGPT (paid API): same packet as Claude, including the caution-only
  pattern summary (option B).
- Gemini FREE tier: Google may use free-tier prompts to improve its products
  and people may review them, so Gemini gets MARKET DATA ONLY. The pattern
  summary is removed before sending.

Keys are stored like the Claude key: the OS credential vault, else a 0600
file in the data folder. Never sent to the browser, logs or exports.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re

import aiohttp

from . import config

log = logging.getLogger("trap.ai")

OPENAI_BASE = os.environ.get("TRAP_OPENAI_BASE", "https://api.openai.com")
GEMINI_BASE = os.environ.get("TRAP_GEMINI_BASE", "https://generativelanguage.googleapis.com")
KEYRING_SERVICE = "trap-discipline-anthropic"      # same vault entry group, different usernames

# Data-class matrix. Instead of a single private=True/False flag whose meaning
# is buried in code, every class of information the app holds is ranked by how
# personally consequential it is, and every AI provider declares the MOST
# sensitive class it is allowed to receive. The packet builder then strips
# anything above that line. A future policy change (a provider's terms change,
# a new provider is added) is a one-line edit here, not a code rewrite, and the
# matrix is shown to the user so the boundary is never hidden.
DATA_CLASSES = [
    "public_market",       # candles, OI, funding, CVD, liquidation prints - not personal
    "rulebook",            # the trader's thresholds and setups - their method, not their money
    "aggregate_r_counts",  # journal patterns as R-multiples and counts, no dates/sizes/dollars
    "trade_timestamps",    # when specific trades happened
    "position_size",       # size / notional of positions
    "account_balance",     # balance, equity
    "credentials",         # API keys - never leave the machine, ever
]
CLASS_RANK = {c: i for i, c in enumerate(DATA_CLASSES)}
CLASS_LABEL = {
    "public_market": "Public market data", "rulebook": "Your rulebook",
    "aggregate_r_counts": "Aggregate R-multiples & counts", "trade_timestamps": "Trade timestamps",
    "position_size": "Position size", "account_balance": "Account balance", "credentials": "API credentials",
}
# which packet field carries which class (fields not listed are public_market)
PACKET_FIELD_CLASS = {"trader_profile": "aggregate_r_counts", "rulebook": "rulebook"}

PROVIDERS = {
    "openai": {"label": "ChatGPT (OpenAI API)", "default_model": "gpt-6-luna",
               # USD per million tokens (input, output); platform pricing page, Sept 2026
               "prices": {"gpt-6-luna": (0.10, 0.50), "gpt-6-astra": (10.0, 50.0)},
               "key_re": r"sk-[A-Za-z0-9_\-]{20,300}",
               # paid API, no training on API data: same class as the primary
               "max_class": "aggregate_r_counts"},
    "gemini": {"label": "Gemini (Google, free tier)", "default_model": "gemini-3.8-flash",
               "prices": {}, "key_re": r"[A-Za-z0-9_\-]{30,60}",
               # free tier may be used to improve products and be human-reviewed: market + rulebook only
               "max_class": "rulebook"},
}
PRIMARY_MAX_CLASS = "aggregate_r_counts"      # Claude, the primary analyst


def max_class(provider: str | None) -> str:
    """The most sensitive data class a provider may receive. None/'claude' is
    the primary analyst."""
    if not provider or provider == "claude":
        return PRIMARY_MAX_CLASS
    return PROVIDERS.get(provider, {}).get("max_class", "public_market")


def is_private(provider: str | None) -> bool:
    """Back-compat: does this provider receive the aggregate pattern summary?"""
    return CLASS_RANK[max_class(provider)] >= CLASS_RANK["aggregate_r_counts"]


def strip_packet_for(packet: dict, provider: str | None) -> dict:
    """Remove every packet field whose data class is above what this provider is
    allowed to receive. Nothing above aggregate_r_counts is ever placed in the
    packet in the first place (position size, balance and credentials never
    leave the machine), so this is defense in depth, not the only guard."""
    limit = CLASS_RANK[max_class(provider)]
    for field, cls in PACKET_FIELD_CLASS.items():
        if CLASS_RANK[cls] > limit and field in packet:
            packet.pop(field, None)
    return packet


def data_policy() -> dict:
    """The full matrix, for display: each class and, per provider, allowed or not."""
    provs = ["claude", *PROVIDERS]
    labels = {"claude": "Claude (primary)", **{p: PROVIDERS[p]["label"] for p in PROVIDERS}}
    rows = []
    for cls in DATA_CLASSES:
        allow = {p: (CLASS_RANK[cls] <= CLASS_RANK[max_class(p)] and cls != "credentials") for p in provs}
        rows.append({"cls": cls, "label": CLASS_LABEL[cls], "allow": allow})
    return {"providers": provs, "labels": labels, "rows": rows}


class BackupError(Exception):
    pass


# ---------------------------------------------------------------- keys
def _file(provider: str):
    return config.DATA_DIR / f".{provider}_key.json"


def _keyring():
    from .ai import _keyring as k
    return k()


def key_save(provider: str, key: str) -> str:
    kr = _keyring()
    if kr:
        kr.set_password(KEYRING_SERVICE, f"{provider}_key", key)
        if _file(provider).exists():
            _file(provider).unlink()
        return "os-vault"
    f = _file(provider)
    f.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(f, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(json.dumps({"api_key": key}))
    return "local-file"


def key_load(provider: str) -> str | None:
    kr = _keyring()
    if kr:
        try:
            k = kr.get_password(KEYRING_SERVICE, f"{provider}_key")
            if k:
                return k
        except Exception as exc:  # noqa: BLE001
            log.warning("keyring read failed: %s", exc)
    f = _file(provider)
    if f.exists():
        try:
            return json.loads(f.read_text()).get("api_key")
        except (OSError, ValueError):
            return None
    return None


def key_clear(provider: str) -> None:
    kr = _keyring()
    if kr:
        try:
            kr.delete_password(KEYRING_SERVICE, f"{provider}_key")
        except Exception:  # noqa: BLE001
            pass
    if _file(provider).exists():
        _file(provider).unlink()


def looks_like_key(provider: str, k: str) -> bool:
    return bool(re.fullmatch(PROVIDERS[provider]["key_re"], (k or "").strip()))


def mask(k: str | None) -> str:
    return ("…" + k[-4:]) if k and len(k) > 12 else ""


def cost_usd(provider: str, model: str, usage: dict) -> float:
    p = PROVIDERS[provider]["prices"].get(model)
    if not p:
        return 0.0                  # free tier, or a model we have no price for (shown as "not tracked")
    return round((usage.get("input_tokens") or 0) * p[0] / 1e6 + (usage.get("output_tokens") or 0) * p[1] / 1e6, 4)


# ---------------------------------------------------------------- calls
def _json_instructions(schema: dict) -> str:
    return ("\n\nANSWER FORMAT: reply with ONE JSON object only (no prose, no code fences) that matches this JSON Schema "
            "exactly, with every field present:\n" + json.dumps(schema, separators=(",", ":")))


def _friendly(name: str, status: int, body: str) -> tuple[str, bool]:
    """(message, worth trying the next backup)."""
    low = body.lower()
    if status in (401, 403):
        return f"{name} rejected the API key. Paste a new one in Settings > AI analyst.", True
    if status == 429 or "quota" in low or "resource_exhausted" in low or "insufficient_quota" in low:
        return f"{name} is out of quota or rate-limited right now.", True
    if status == 404:
        return f"{name} doesn't have that model. Check the model name in Settings > AI analyst.", True
    if status >= 500:
        return f"{name} is busy right now.", True
    return f"{name} returned an error ({status}).", True


async def call(session: aiohttp.ClientSession, provider: str, key: str, model: str, system: str, user: str,
               schema: dict, max_tokens: int = 16000) -> dict:
    """One call. Returns {"data": <Claude-shaped message>, "usage": {...}, "model": str}."""
    name = "ChatGPT" if provider == "openai" else "Gemini"
    sys_full = system + _json_instructions(schema)
    timeout = aiohttp.ClientTimeout(total=300, sock_connect=20)
    if provider == "openai":
        url = f"{OPENAI_BASE}/v1/chat/completions"
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        body = {"model": model, "response_format": {"type": "json_object"}, "max_completion_tokens": max_tokens,
                "messages": [{"role": "system", "content": sys_full}, {"role": "user", "content": user}]}
    else:
        url = f"{GEMINI_BASE}/v1beta/models/{model}:generateContent"
        headers = {"x-goog-api-key": key, "Content-Type": "application/json"}
        body = {"systemInstruction": {"parts": [{"text": sys_full}]},
                "contents": [{"role": "user", "parts": [{"text": user}]}],
                "generationConfig": {"responseMimeType": "application/json", "maxOutputTokens": max_tokens}}
    try:
        async with session.post(url, json=body, headers=headers, timeout=timeout) as resp:
            status, text = resp.status, await resp.text()
    except asyncio.TimeoutError as exc:
        raise BackupError(f"{name} took too long.") from exc
    except aiohttp.ClientError as exc:
        raise BackupError(f"Could not reach {name}. Check the internet connection and VPN.") from exc
    if status != 200:
        log.warning("%s HTTP %s: %s", provider, status, text[:200])
        raise BackupError(_friendly(name, status, text)[0])
    try:
        d = json.loads(text)
    except ValueError as exc:
        raise BackupError(f"{name}'s answer was not readable.") from exc
    if provider == "openai":
        ch = (d.get("choices") or [{}])[0]
        out = ((ch.get("message") or {}).get("content")) or ""
        stop = "max_tokens" if ch.get("finish_reason") == "length" else "end_turn"
        u = d.get("usage") or {}
        usage = {"input_tokens": u.get("prompt_tokens") or 0, "output_tokens": u.get("completion_tokens") or 0}
    else:
        cand = (d.get("candidates") or [{}])[0]
        out = "".join(p.get("text", "") for p in ((cand.get("content") or {}).get("parts") or []) if not p.get("thought"))
        fr = cand.get("finishReason")
        stop = "max_tokens" if fr == "MAX_TOKENS" else "refusal" if fr in ("SAFETY", "PROHIBITED_CONTENT") else "end_turn"
        u = d.get("usageMetadata") or {}
        usage = {"input_tokens": u.get("promptTokenCount") or 0,
                 "output_tokens": (u.get("candidatesTokenCount") or 0) + (u.get("thoughtsTokenCount") or 0)}
    data = {"stop_reason": stop, "content": [{"type": "text", "text": out}], "usage": usage, "model": model}
    return {"data": data, "usage": usage, "model": d.get("model") or model}


async def validate(session: aiohttp.ClientSession, provider: str, key: str) -> None:
    name = "ChatGPT" if provider == "openai" else "Gemini"
    if provider == "openai":
        url, headers = f"{OPENAI_BASE}/v1/models", {"Authorization": f"Bearer {key}"}
    else:
        url, headers = f"{GEMINI_BASE}/v1beta/models", {"x-goog-api-key": key}
    try:
        async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=20)) as resp:
            if resp.status != 200:
                raise BackupError(_friendly(name, resp.status, await resp.text())[0])
    except asyncio.TimeoutError as exc:
        raise BackupError(f"{name} did not answer within 20 seconds.") from exc
    except aiohttp.ClientError as exc:
        raise BackupError(f"Could not reach {name}.") from exc
