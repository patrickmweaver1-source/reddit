"""Turn what you type in the watchlist ("XRP", "xrp/usdt", "XRPUSDT.P",
"PEPE") into the exact Bybit USDT perpetual symbol ("XRPUSDT",
"1000PEPEUSDT"), and refuse anything Bybit doesn't list, before it reaches
the market engine."""
from __future__ import annotations

import re

from .bybit import BybitError

QUOTES = ("USDT", "USDC", "PERP")
# Bybit lists very cheap coins per 1,000 (or more) units, e.g. 1000PEPEUSDT.
MULTIPLIERS = ("", "1000", "10000", "100000", "1000000", "10000000")


def clean(raw: str) -> str:
    s = re.sub(r"[\s/\-_:]", "", str(raw or "").upper())
    s = s.removeprefix("BYBIT")                 # "BYBIT:XRPUSDT.P" (TradingView style)
    for suffix in (".P", ".PERP"):
        s = s.removesuffix(suffix)
    return re.sub(r"[^A-Z0-9]", "", s)


def candidates(raw: str) -> list[str]:
    s = clean(raw)
    if not s:
        return []
    if s.endswith(QUOTES):
        base = s[:-4]
        out = [s]
    else:
        base = s
        out = []
    # USDT perpetuals first (what the app is built around), then the per-1,000 listings
    for m in MULTIPLIERS:
        c = f"{m}{base}USDT"
        if c not in out:
            out.append(c)
    return out


def _tradeable(info: dict | None) -> bool:
    return bool(info) and info.get("contractType") == "LinearPerpetual" and info.get("status") in ("Trading", None)


async def resolve(rest, raw: str) -> str | None:
    """The Bybit symbol for what was typed, or None if Bybit has no USDT
    perpetual for it. Network errors propagate (the caller decides)."""
    saved = getattr(rest, "last_error", None)
    try:
        for c in candidates(raw):
            try:
                info = await rest.instrument(c)
            except BybitError as exc:
                if exc.code == 10001:          # "symbol invalid": try the next spelling
                    continue
                raise
            if _tradeable(info):
                return info.get("symbol") or c
        return None
    finally:
        rest.last_error = saved                # probing wrong spellings isn't a connection problem


async def resolve_list(rest, raws: list[str], demo: bool = False) -> tuple[list[str], list[str], list[str]]:
    """(symbols, renamed notes, rejected inputs). Duplicates are dropped.
    In demo mode nothing is looked up: the synthetic feed accepts any name."""
    out, notes, bad = [], [], []
    for raw in raws:
        if not str(raw or "").strip():
            continue
        if demo or rest is None:
            c = candidates(raw)
            sym = c[0] if c else None
        else:
            sym = await resolve(rest, raw)
        if not sym:
            bad.append(str(raw).strip())
            continue
        if sym not in out:
            out.append(sym)
        if sym != str(raw).strip().upper():
            notes.append(f"{str(raw).strip()} is {sym} on Bybit")
    return out, notes, bad
