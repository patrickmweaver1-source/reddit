"""AI analyst: one-button setup scan by Claude, checked by the app's own rules.

What happens on "Scan with AI":
1. The app builds a MARKET-ONLY data packet for one symbol: candles (15m, 1h,
   4h), open interest, funding, CVD, liquidations, the auto-classified levels,
   the 4h regime, the working range, market-based session flags and the live
   rulebook thresholds. It never includes API keys, balances, positions, trade
   history or loss counts.
2. Claude (Anthropic Messages API, structured JSON output) scores every
   checklist item (C1 to C4, both gates) against Pat's written trap checklist.
3. The server then re-checks the answer with the same rules the checklist
   verdict uses (decide_verdict). Claude can be MORE cautious than the rules,
   never less: "TRADEABLE NOW" is downgraded unless the rules agree, and the
   gate arithmetic shown is the server's own, not the model's.

The Anthropic key lives in the OS credential vault (never the browser, the
database, logs or exports). Every call is priced from the API's own token
usage and counted against a monthly budget the user sets.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import time
from datetime import datetime, timezone
from typing import Any

import aiohttp

from . import analysis as A
from . import config
from . import learning as L
from . import ai_backups as BK
from .db import now_ms

log = logging.getLogger("trap.ai")

API_BASE = os.environ.get("TRAP_ANTHROPIC_BASE", "https://api.anthropic.com")
API_VERSION = "2023-06-01"          # platform.claude.com/docs/en/api/versioning
KEYRING_SERVICE = "trap-discipline-anthropic"
_FALLBACK = config.DATA_DIR / ".anthropic_key.json"

# USD per million tokens (input, output), from platform.claude.com/docs/en/models/overview
MODELS = {
    "claude-opus-5-5": {"label": "Claude Opus 5.5 (recommended)", "in": 4.0, "out": 20.0},
    "claude-fable-5-1": {"label": "Claude Fable 5.1 (deepest, about 2.5x the cost)", "in": 10.0, "out": 50.0},
    "claude-sonnet-5": {"label": "Claude Sonnet 5 (about half the cost)", "in": 2.0, "out": 10.0},
}
DEFAULT_MODEL = "claude-opus-5-5"
DEFAULT_BUDGET_USD = 20.0
COOLDOWN_S = 20
RETRY_WAITS = (5, 15)            # seconds before the 2nd and 3rd attempt after a dropped connection or overload
MAX_TOKENS = 24000
VERDICTS = ("TRADEABLE NOW", "WATCH", "NO SETUP", "STAND DOWN")
SETUPS = ("Spring", "Upthrust", "Sweep", "Failed retest", "None")
QUALITY = ("engulfing", "large", "pin", "inside", "grind", "none")
CHECK_KEYS = {
    "c1": ("range", "swing", "prior", "round", "liq", "three", "only15", "weak"),
    "c2": ("closed", "bracket", "body", "range", "oi", "funding", "shallow"),
    "c3": ("contract", "bodies", "wicks", "same", "inside", "ran", "timedout"),
    "c4": ("closed", "far", "oi", "funding", "liqs"),
}


class AIError(Exception):
    pass


class AINotConnected(AIError):
    """No Claude key and no backup key is saved on this computer."""


# ---------------------------------------------------------------- key storage
def _keyring():
    try:
        import keyring  # type: ignore
        from keyring.backends import fail  # type: ignore
        kr = keyring.get_keyring()
        return None if isinstance(kr, fail.Keyring) else keyring
    except Exception:  # noqa: BLE001
        return None


def key_save(key: str) -> str:
    kr = _keyring()
    if kr:
        kr.set_password(KEYRING_SERVICE, "api_key", key)
        if _FALLBACK.exists():
            _FALLBACK.unlink()
        return "os-vault"
    _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(_FALLBACK, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(json.dumps({"api_key": key}))
    return "local-file"


def key_load() -> str | None:
    kr = _keyring()
    if kr:
        try:
            k = kr.get_password(KEYRING_SERVICE, "api_key")
            if k:
                return k
        except Exception as exc:  # noqa: BLE001
            log.warning("keyring read failed: %s", exc)
    if _FALLBACK.exists():
        try:
            return json.loads(_FALLBACK.read_text()).get("api_key")
        except (OSError, ValueError):
            return None
    return None


def key_clear() -> None:
    kr = _keyring()
    if kr:
        try:
            kr.delete_password(KEYRING_SERVICE, "api_key")
        except Exception:  # noqa: BLE001
            pass
    if _FALLBACK.exists():
        _FALLBACK.unlink()


def key_mask(k: str | None) -> str:
    return ("sk-ant-…" + k[-4:]) if k and len(k) > 16 else ("****" if k else "")


def looks_like_key(k: str) -> bool:
    return bool(re.fullmatch(r"sk-ant-[A-Za-z0-9_\-]{20,300}", k or ""))


# ---------------------------------------------------------------- data packet
def _r(v, sig=7):
    if v is None:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return float(f"{v:.{sig}g}")


def _utc(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%m-%d %H:%M")


def market_session(sess: dict, symbol: str | None = None) -> dict:
    """Session flags with everything derived from Pat's own trades removed
    (loss counts). Only market-clock facts leave the laptop, and only
    this symbol's funding clock (the rest of the watchlist stays private)."""
    other = re.compile(r"^[A-Z0-9]+ funding settles")
    reasons = [r["text"] for r in sess.get("reasons", []) if r.get("rule") != 10
               and not (other.match(r["text"]) and not (symbol and r["text"].startswith(symbol + " ")))]
    status = sess.get("status")
    if status in ("stand_down", "caution") and not reasons:
        status = "clear"
    return {"status": status, "flags": reasons}


def build_packet(snap: dict, sd: Any, th: dict, sess: dict, fee_pct: float, *, demo: bool = False) -> dict:
    """Everything Claude sees. Market data only, by construction."""
    oi_by_t = {p["t"]: p.get("oi") for p in (sd.oi15 if sd else [])}
    cvd_by_t = {p["t"]: p.get("delta") for p in (snap.get("series", {}).get("cvd") or [])}
    c15 = [k for k in (snap.get("series", {}).get("candles") or [])]
    now = now_ms()
    closed = [k for k in c15 if k["t"] + 900_000 <= now][-32:]
    forming = [k for k in c15 if k["t"] + 900_000 > now]
    live = forming[-1] if forming else None

    def rows(cs, extra=False):
        out = []
        for k in cs:
            row = [_utc(k["t"]), _r(k["o"]), _r(k["h"]), _r(k["l"]), _r(k["c"]), _r(k.get("v"), 5)]
            if extra:
                row += [_r(oi_by_t.get(k["t"]), 6), _r(cvd_by_t.get(k["t"]), 5)]
            out.append(row)
        return out

    c1h = (sd.c.get("60") or [])[-16:] if sd else []
    c4h = (sd.c.get("240") or [])[-16:] if sd else []
    liqs = [x for x in (snap.get("series", {}).get("liqs") or []) if now - x["ts"] <= 3_600_000]
    # Bybit liquidation side = the side of the position that was liquidated (Buy = a long was liquidated)
    liq_sum = {label: {"count": sum(1 for x in liqs if x["side"] == side),
                       "size": _r(sum(x["size"] for x in liqs if x["side"] == side), 5)}
               for side, label in (("Buy", "longs_liquidated"), ("Sell", "shorts_liquidated"))}
    lv_fields = ("price", "state", "setup", "direction", "sources", "touches", "c1", "dist_atr", "pen_atr",
                 "candles_since_break", "oi_break_pct", "oi_reclaim_pct", "trigger", "extreme", "liq_near", "note")
    levels = [{k: (_r(lv.get(k)) if isinstance(lv.get(k), float) else lv.get(k)) for k in lv_fields}
              for lv in (snap.get("levels") or [])[:10]]
    thin = bool(snap.get("thin"))
    slip = th["slippage_pct_thin"] if thin else th["slippage_pct_major"]
    f = snap.get("funding") or {}
    return {
        "demo_data": demo,
        "symbol": snap.get("symbol"),
        "now_utc": datetime.fromtimestamp(now / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M"),
        "thin_asset": thin,
        "price": _r(snap.get("price")), "tick": _r(snap.get("tick")),
        "atr14_15m": _r(snap.get("atr15")), "atr_pct": _r(snap.get("atr_pct"), 4),
        "rvol": _r(snap.get("rvol"), 3), "rvol_label": snap.get("rvol_label"),
        "liquidity_state": snap.get("liquidity"),
        "regime_4h": snap.get("regime"),
        "working_range": {k: _r(v) if isinstance(v, (int, float)) else v for k, v in (snap.get("range") or {}).items()},
        "funding": {"rate_pct": _r(f.get("rate_pct"), 4), "rate_8h_equiv_pct": _r(f.get("rate_8h_pct"), 4),
                    "percentile_vs_own_history": _r(f.get("pctile"), 3), "interval_h": f.get("interval_h"),
                    "next_settlement_utc": _utc(f["next"]) if f.get("next") else None},
        "open_interest": {k: _r(v, 5) for k, v in (snap.get("oi") or {}).items()},
        "oi_volume_mechanism": snap.get("mechanism"),
        "last_4_candles_summary": snap.get("summary"),
        "levels_auto_classified": levels,
        "top_candidate_by_app": (snap.get("top") or {}).get("price"),
        "app_gate_estimate_for_top": snap.get("gates"),
        "liquidations_last_60m": liq_sum,
        "candles_15m_closed": {"cols": ["utc", "open", "high", "low", "close", "volume", "open_interest", "cvd_delta"],
                               "rows": rows(closed, extra=True)},
        "candle_15m_forming": rows([live])[0] if live else None,
        "candles_1h_closed": {"cols": ["utc", "open", "high", "low", "close", "volume"], "rows": rows(c1h)},
        "candles_4h_closed": {"cols": ["utc", "open", "high", "low", "close", "volume"], "rows": rows(c4h)},
        "session_market_flags": market_session(sess, snap.get("symbol")),
        "costs": {"taker_fee_pct_per_side": fee_pct, "slippage_pct_per_side": slip},
        "rulebook": {k: th[k] for k in ("pen_floor_atr", "pen_floor_atr_thin", "pen_abandon_atr", "window_min_candles",
                                         "window_max_candles", "range_atr_min", "range_stop_min", "thin_range_pct_min",
                                         "cost_pct_of_risk_max", "funding_baseline_pct", "funding_stretched_pct",
                                         "no_expansion_candles")},
    }


# ---------------------------------------------------------------- prompt + schema
SYSTEM = """You are the analyst inside TRAP Discipline, Pat's personal trading coach for 15 minute crypto perpetual futures traps on Bybit. Bring the full judgment of an elite discretionary crypto derivatives trader: market structure, liquidity and stop placement, open interest and funding as positioning evidence, liquidation cascades, CVD, volatility regimes, and the difference between a failed break and a real one. That expertise serves one purpose: applying Pat's written checklist below with more skill and honesty than he could at 2am. You do not have a strategy of your own and you do not add rules.

Your job is to be the gate, not the cheerleader. Most setups should fail. Say so plainly and say which component failed. Never talk Pat into a trade. If components fail, the answer is no trade: no smaller size as a compromise, no waiting for a better entry on the same idea. This is pattern classification against his own written criteria, not financial advice.

OBSERVABLE VS INTERPRETED (say things at the level the data supports)
- Separate three layers and keep them separate in your words: (1) the OBSERVABLE EVENT, which is only what the candles, open interest, funding, CVD and liquidation prints actually show (a close beyond a level then back inside; OI rose then fell; liquidations printed on one side); (2) the WYCKOFF LABEL you assign (Spring, Upthrust, Sweep, Failed retest), which is a classification of that event, NOT proof it will pay; (3) the EMPIRICAL RECORD, which is only what trader_profile reports for this class.
- Prefer mechanical language over causal or intent language. The data can show that price rejected a level and that positions were forced out; it cannot show that someone hunted stops or that longs were trapped on purpose. Say "closed back through the level," "OI expanded on the break then dropped on the reclaim," "liquidations printed against the break side" - not "stop hunt," "trapped longs," or "the sweep clears stops." Intent and causation are usually unknowable from this packet; do not assert them as fact.
- A named setup is a hypothesis, not an edge. Never let the fact that something is a clean Spring or Upthrust, on its own, argue for a trade; the gates and the trader's own record decide.

DATA RULES
- The JSON packet is the only truth. Never invent a number. If something is missing, say what is missing and score that item conservatively.
- Candle rows are [utc, open, high, low, close, volume, open_interest, cvd_delta]; the forming candle is NOT closed and never counts as a close.
- CVD degrades badly on thin assets (thin_asset true); lean on open interest and funding there and say so.
- liquidity_state.state is a live read of how tradeable this coin is versus its OWN recent norm (normal / degraded / severely_thin). When degraded or severely_thin, say the modeled cost and slippage likely understate real cost, and lean more conservative; it is an input, never on its own a reason to trade.
- Every threshold is a starting hypothesis with fewer than 30 calibrated trades. Say so when a reading lands near a boundary.
- If demo_data is true, the market is synthetic; analyze it normally.

STATE MACHINE (assign one state to every level in play)
DORMANT more than about 1 ATR away. APPROACHING within about 1 ATR, untested. TESTED touched, no close beyond. RECRUITING a candle closed beyond with penetration inside the floor to abandon bracket. WATCH recruiting plus a stall signature, candle 1 to {wmax} of the window. TRIGGERED decisive close back inside: this is the entry. DEAD ran: cleared a full ATR beyond and consolidated (flag, not trap). DEAD timed out: {wmax}+ candles beyond, no reclaim (break is real). DEAD too shallow: penetration below the floor (nobody recruited).
Rank candidates: state first (TRIGGERED, WATCH, RECRUITING), then C1 quality, then alignment with the 4h regime (counter trend ranks last).

THE FOUR PERMITTED SETUPS (nothing else is a trade; never invent a fifth)
Spring: break of a qualified range low fails, decisive close back inside, target the range high. Upthrust: the mirror at the range high. Sweep: one candle spikes through an obvious level, trades through the stop and liquidation levels resting there, closes back inside. Failed retest: a breakout holds, the retest fails and closes back through.

C1 IS THE LEVEL OBVIOUS TO EVERYONE? Qualifying, strongest first: range boundary with 3+ touches; 4h or 1h swing high or low; prior UTC day high, low or close; prior week high or low; round number; extreme of a 2x ATR candle. Not qualifying: two touch diagonal trend line, Fibonacci alone, moving average alone, any level visible only on the 15m chart (hard disqualifier). Score 2 = 3+ touches on a 4h level plus a visible liquidation cluster; 1 = higher timeframe level, no cluster; 0 = only on the 15m.

C2 DID THE BREAK RECRUIT ANYONE? The candle must CLOSE beyond, not wick. Penetration between the floor ({floor} ATR, {floor_thin} ATR on thin assets) and the abandon line ({abandon} ATR). Body two thirds or more of the range. Candle range at or above ATR and expanded versus the prior candles. Open interest RISING through the break is the primary check; flat or falling means positions closed rather than opened: score 0 and stop. Funding stretched in the break direction (baseline {fbase}% per 8h, stretched {fstr}%). Score 2 = strong close, clear OI rise, stretched funding; 1 = partial; 0 = OI flat or falling, or small body.

C3 DID IT FAIL TO FOLLOW THROUGH? Decision window {wmin} to {wmax} candles. Stall signature: ranges contracting below 1 ATR, bodies shrinking, wicks on both sides, doji at the level, two or more candles wicking to the same price. Inside bar right after the breakout candle is the cleanest version (break of its far side means the break is real). Hard disqualifiers: cleared a full ATR beyond and consolidated; {wmax} candles elapsed with no reclaim. Score 2 = clear stall inside the window; 1 = some stall evidence; 0 = no stall.

C4 DECISIVE CLOSE BACK INSIDE: THIS IS THE ENTRY. NEVER BEFORE IT. The candle CLOSES back inside, near its far extreme, body at or above average, ideally engulfing the breakout candle. Open interest dropping sharply (if it does not drop, nobody was forced out). Funding normalizing or flipping. Liquidations printing against the trapped side (for a Long, the trapped shorts show up as shorts_liquidated; for a Short, the trapped longs show up as longs_liquidated). Quality best to worst: engulfing, large, pin (plus confirm), inside (bar break), grind (weakest). Score 2 = engulfing or large close with a sharp OI drop; 1 = closed back inside with partial confirmation; 0 = no close back inside yet. If no reclaim close has happened, C4 is 0 and quality is none: say what close would trigger it.

GRADING: C1 to C4 at 0, 1 or 2, total out of 8. A 7 to 8, B 5 to 6, C 3 to 4, D below 3 = no trade. Drop one letter for session caution flags or a counter trend trap. If a hard disqualifier fired, name it.

GATES (both must pass; the app recomputes the arithmetic, you judge the inputs): range height at least {ratr}x ATR and at least {rstop}x the stop, and at least {thinpct}% of price on thin assets. Round trip cost (2 x fee + 2 x slippage) divided by the stop distance under {cost}%. Invalidation = a few ticks beyond the trap's extreme wick, NOT beyond the level. Target = opposite range boundary. Deadline = no expansion by candle {noexp} means exit at breakeven. Rule 9: entry in the middle third of the range is no trade.

SESSION: only two things gate the session now: funding settlement within the hour, or a flagged macro event (both = stand down or drop a letter). In a clean 4h trend, only trap in the trend direction. Pat removed the old low-liquidity-hours rule; it is NOT a criterion here even though it is common market knowledge that certain UTC hours are thinner. Never say a level or setup is not actionable, tell Pat to wait, or put a clock time in watch_next because of the time of day or overnight liquidity. If thin_asset is true in the packet, that describes the SYMBOL being thin (lean on open interest and funding, per DATA RULES), never the time of day, and it is not a stand-down trigger either.

VERDICT
TRADEABLE NOW only if a permitted setup has a decisive 15m CLOSE back inside (TRIGGERED), C2 is not 0, no hard disqualifier, the grade is C or better after drops, and both gates pass with your invalidation and target. WATCH if a qualified level is RECRUITING or in WATCH and could trigger within the window: give the exact close that would trigger it. NO SETUP if nothing qualifies. STAND DOWN if the session flags say so.

TRADER PROFILE: the packet's trader_profile is the trader's own record with this strategy (R multiples and counts from their journal, plus how the app's past calls turned out). It can only make you MORE cautious, never less: if matching_this_setup or leaks describe this kind of setup losing, say so in the breakdown and lean toward WATCH or NO SETUP when the evidence is otherwise marginal. Respect personal_blocks: a blocked pattern is never TRADEABLE NOW. An edge is context, never a reason to relax C1 to C4 or the gates. With fewer than 8 trades in a group, treat it as noise and do not mention it.

OUTPUT STYLE: plain American English, short sentences, no em dashes, no hype, no emojis. headline is one sentence. breakdown is 3 to 5 bullets a trader can read in ten seconds, most important first. Every component reason names the specific evidence (numbers from the packet). The checks objects map to Pat's checklist boxes: set a box true only when the packet supports it. For negative boxes (only15, weak, shallow, ran, timedout) true means the problem is present. watch_next lists the concrete price events or closes to set alerts on. missing_data lists what you could not verify."""


def _nn(t: str) -> dict:
    return {"anyOf": [{"type": t}, {"type": "null"}]}


def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def _comp(key: str, quality: bool = False) -> dict:
    p = {"score": {"type": "integer", "enum": [0, 1, 2]}, "reason": {"type": "string"}}
    if quality:
        p["quality"] = {"type": "string", "enum": list(QUALITY)}
    p["checks"] = _obj({k: {"type": "boolean"} for k in CHECK_KEYS[key]})
    return _obj(p)


SCHEMA = _obj({
    "verdict": {"type": "string", "enum": list(VERDICTS)},
    "headline": {"type": "string"},
    "breakdown": {"type": "array", "items": {"type": "string"}},
    "session": _obj({"status": {"type": "string", "enum": ["clear", "caution", "stand_down"]}, "reason": {"type": "string"}}),
    "regime": _obj({"read": {"type": "string"}, "permitted": {"type": "string"}}),
    "levels_in_play": {"type": "array", "items": _obj({"price": {"type": "number"}, "state": {"type": "string"},
                                                        "would_be": {"type": "string"}, "next": {"type": "string"}})},
    "candidate": _obj({"level": _nn("number"), "setup": {"type": "string", "enum": list(SETUPS)},
                       "direction": {"type": "string", "enum": ["Long", "Short", "None"]},
                       "trap_zone_low": _nn("number"), "trap_zone_high": _nn("number"), "reclaim_trigger": _nn("number")}),
    "c1": _comp("c1"), "c2": _comp("c2"), "c3": _comp("c3"), "c4": _comp("c4", quality=True),
    "disqualifier": _nn("string"),
    "plan": _obj({"entry": _nn("number"), "invalidation": _nn("number"), "target": _nn("number"), "deadline": {"type": "string"}}),
    "watch_next": {"type": "array", "items": {"type": "string"}},
    "missing_data": {"type": "array", "items": {"type": "string"}},
    "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
})


def system_prompt(th: dict) -> str:
    return SYSTEM.format(wmin=th["window_min_candles"], wmax=th["window_max_candles"], floor=th["pen_floor_atr"],
                         floor_thin=th["pen_floor_atr_thin"], abandon=th["pen_abandon_atr"], fbase=th["funding_baseline_pct"],
                         fstr=th["funding_stretched_pct"], ratr=th["range_atr_min"], rstop=th["range_stop_min"],
                         thinpct=th["thin_range_pct_min"], cost=th["cost_pct_of_risk_max"], noexp=th["no_expansion_candles"])


def user_message(packet: dict) -> str:
    return ("Run the scan for this symbol. First assign a state to every level in play (IDENTIFY), then fully score the "
            "top candidate against C1 to C4 and both gates (SCORE). If nothing is in play, say so and use verdict NO SETUP "
            "with the component scores at 0.\n\nMARKET PACKET (JSON):\n" + json.dumps(packet, separators=(",", ":")))


# ---------------------------------------------------------------- Claude call
def cost_usd(model: str, usage: dict) -> float:
    p = MODELS.get(model) or MODELS[DEFAULT_MODEL]
    tin = (usage.get("input_tokens") or 0) + (usage.get("cache_creation_input_tokens") or 0) * 1.25 \
        + (usage.get("cache_read_input_tokens") or 0) * 0.1
    return round(tin * p["in"] / 1e6 + (usage.get("output_tokens") or 0) * p["out"] / 1e6, 4)


def _api_message(body: str) -> str:
    try:
        return str((((json.loads(body) or {}).get("error")) or {}).get("message") or "")[:240]
    except (ValueError, AttributeError):
        return ""


def _friendly(status: int, body: str) -> str:
    low = body.lower()
    said = _api_message(body)
    tail = f' (Claude said: "{said}")' if said else ""
    if status == 401:
        return "Claude rejected the API key. Create a new key in the Claude Console and paste it in Settings > AI analyst."
    if status == 403:
        return ("Anthropic refused the request (403). Either the key's workspace can't use this model, or the connection "
                "comes from a country Anthropic doesn't serve (check which country your VPN is set to)." + tail)
    if status == 402 or "credit balance" in low or "billing" in low:
        return "Your Claude API account is out of credits. Add credits under Billing in the Claude Console, then scan again."
    if "spend limit" in low or "usage limit" in low or "spend cap" in low:
        return "Your Claude API spend limit is reached. Raise it in the Claude Console (Settings > Limits or your workspace), then scan again." + tail
    if status == 404 or "model" in low and "not found" in low:
        return "Your API account can't use this model. Pick another model in Settings > AI analyst." + tail
    if status == 413:
        return "The market packet was too large for Claude. Scan again." + tail
    if status == 429:
        return "Claude's rate limit was hit. Wait a minute and scan again." + tail
    if status in (500, 502, 503, 504, 529) or "overloaded" in low:
        return "Claude is busy right now. Try again in a minute."
    return f"Claude returned an error ({status}){tail}."


class AITransient(AIError):
    """Worth one automatic retry: dropped connection, overload, server error."""
    def __init__(self, msg: str, usage: dict | None = None):
        super().__init__(msg)
        self.usage = usage or {}


async def _read_stream(resp, model: str) -> dict:
    """Assemble a Messages API server-sent-event stream into the same shape as
    a non-streaming response. Streaming keeps the connection busy (Anthropic
    sends ping events), so a VPN or router can't drop it as idle during a long
    think; it's what Anthropic recommends for long requests."""
    msg: dict = {"model": model, "content": [], "usage": {}, "stop_reason": None}
    blocks: dict[int, dict] = {}
    done = False
    event, data_lines = None, []

    def handle(ev, raw):
        nonlocal done
        try:
            d = json.loads(raw)
        except ValueError:
            return
        t = d.get("type") or ev
        if t == "message_start":
            m = d.get("message") or {}
            msg["model"] = m.get("model") or model
            msg["usage"].update({k: v for k, v in (m.get("usage") or {}).items() if isinstance(v, (int, float))})
        elif t == "content_block_start":
            cb = dict(d.get("content_block") or {})
            if cb.get("type") == "text":
                cb["text"] = cb.get("text") or ""
            blocks[d.get("index", len(blocks))] = cb
        elif t == "content_block_delta":
            delta = d.get("delta") or {}
            b = blocks.setdefault(d.get("index", 0), {"type": "text", "text": ""})
            if delta.get("type") == "text_delta":
                b["text"] = (b.get("text") or "") + (delta.get("text") or "")
        elif t == "message_delta":
            msg["stop_reason"] = (d.get("delta") or {}).get("stop_reason") or msg["stop_reason"]
            msg["usage"].update({k: v for k, v in (d.get("usage") or {}).items() if isinstance(v, (int, float))})
        elif t == "message_stop":
            done = True
        elif t == "error":
            err = d.get("error") or {}
            etype, emsg = str(err.get("type") or ""), str(err.get("message") or "")[:240]
            if etype in ("overloaded_error", "api_error", "timeout_error") or "overloaded" in emsg.lower():
                raise AITransient("Claude is busy right now. Try again in a minute.", dict(msg["usage"]))
            raise AIError(_friendly(400, json.dumps({"error": err})))

    try:
        async for raw_line in resp.content:
            line = raw_line.decode("utf-8", "replace").rstrip("\r\n")
            if not line:
                if data_lines:
                    handle(event, "\n".join(data_lines))
                event, data_lines = None, []
                continue
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
        if data_lines:
            handle(event, "\n".join(data_lines))
    except (aiohttp.ClientError, asyncio.TimeoutError, ConnectionError) as exc:
        raise AITransient("The connection to Claude dropped mid-answer (often a VPN or Wi-Fi hiccup).", dict(msg["usage"])) from exc
    if not done:
        raise AITransient("The connection to Claude dropped mid-answer (often a VPN or Wi-Fi hiccup).", dict(msg["usage"]))
    msg["content"] = [blocks[i] for i in sorted(blocks)]
    return msg


async def call_claude(session: aiohttp.ClientSession, key: str, model: str, system: str, user: str,
                      *, structured: bool = True, effort: bool = True) -> dict:
    """One streamed Messages API call. Returns the assembled response (usage
    is present on every completed answer, so the caller can bill it before
    parsing anything)."""
    body: dict = {"model": model, "max_tokens": MAX_TOKENS, "system": system, "stream": True,
                  "messages": [{"role": "user", "content": user}]}
    oc: dict = {}
    if structured:
        oc["format"] = {"type": "json_schema", "schema": SCHEMA}
    if effort:
        oc["effort"] = "high"
    if oc:
        body["output_config"] = oc
    headers = {"x-api-key": key, "anthropic-version": API_VERSION, "content-type": "application/json",
               "accept": "text/event-stream"}
    # No overall cap short of 10 minutes (the first use of the answer format can take a while to prepare);
    # the read timeout only trips if Claude goes silent, and it sends keep-alive pings while thinking.
    timeout = aiohttp.ClientTimeout(total=600, sock_connect=20, sock_read=180)
    try:
        async with session.post(f"{API_BASE}/v1/messages", json=body, headers=headers, timeout=timeout) as resp:
            status = resp.status
            if status == 200 and "event-stream" in resp.headers.get("Content-Type", ""):
                data = await _read_stream(resp, model)
                return {"data": data, "usage": data.get("usage") or {}, "model": data.get("model") or model}
            text = await resp.text()
    except AITransient:
        raise
    except AIError:
        raise
    except asyncio.TimeoutError as exc:
        raise AITransient("Claude went quiet for too long and the request timed out.") from exc
    except aiohttp.ClientError as exc:
        raise AITransient("Could not reach Claude (api.anthropic.com). Check the internet connection and VPN.") from exc
    if status == 400 and (structured or effort):
        msg = _api_message(text)
        if re.search(r"output_config|effort|json_schema|schema", msg):
            # Unsupported option: drop effort first; if the schema itself is the problem, drop structured output next.
            log.info("retrying without %s (%s)", "effort" if effort else "structured output", msg)
            return await call_claude(session, key, model, system, user,
                                     structured=structured if effort else False, effort=False)
    if status != 200:
        log.warning("claude HTTP %s: %s", status, _api_message(text) or text[:200])
        if status in (500, 502, 503, 504, 529):
            raise AITransient(_friendly(status, text))
        raise AIError(_friendly(status, text))
    try:
        data = json.loads(text)                    # a plain JSON answer (a proxy that ignored "stream")
    except ValueError as exc:
        raise AIError("Claude's answer was not readable. Scan again.") from exc
    return {"data": data, "usage": data.get("usage") or {}, "model": data.get("model") or model}


def parse_answer(data: dict) -> dict:
    if data.get("stop_reason") == "refusal":
        raise AIError("Claude declined this request.")
    if data.get("stop_reason") == "max_tokens":
        raise AIError("Claude ran out of room before finishing. Scan again.")
    texts = [b.get("text", "") for b in (data.get("content") or []) if isinstance(b, dict) and b.get("type") == "text"]
    raw = (texts[-1] if texts else "").strip()
    try:
        out = json.loads(raw)
    except ValueError:
        m = re.search(r"\{.*\}", raw, re.S)       # unstructured fallback: the JSON object in the text
        try:
            out = json.loads(m.group(0)) if m else None
        except ValueError:
            out = None
    if not isinstance(out, dict):
        raise AIError("Claude's answer was not readable. Scan again.")
    return out


async def validate_key(session: aiohttp.ClientSession, key: str) -> None:
    headers = {"x-api-key": key, "anthropic-version": API_VERSION}
    try:
        async with session.get(f"{API_BASE}/v1/models", headers=headers, timeout=aiohttp.ClientTimeout(total=20)) as resp:
            if resp.status == 200:
                return
            raise AIError(_friendly(resp.status, await resp.text()))
    except asyncio.TimeoutError as exc:
        raise AIError("Claude did not answer within 20 seconds. Try again.") from exc
    except aiohttp.ClientError as exc:
        raise AIError("Could not reach Claude (api.anthropic.com). Check the internet connection and VPN.") from exc


# ---------------------------------------------------------------- server-side rule check
def _num(v) -> float | None:
    try:
        f = float(v) if v is not None and not isinstance(v, bool) else None
    except (TypeError, ValueError):
        return None
    return f if f is not None and math.isfinite(f) else None


def _s(v, n: int = 300) -> str:
    return (v if isinstance(v, str) else json.dumps(v) if v is not None else "")[:n]


def _strs(v, n: int, k: int) -> list[str]:
    return [_s(x, n) for x in v][:k] if isinstance(v, list) else []


def _pick(v, allowed, default):
    """Structured output can change the capitalization of enum values
    (Anthropic documents this), so match them case-insensitively."""
    if isinstance(v, str):
        for a in allowed:
            if v.strip().lower() == a.lower():
                return a
    return default


def normalize(raw) -> dict:
    """Coerce the model's JSON into the exact shape the UI expects. Every
    field is forced to its type; nothing the model sends reaches the page
    as anything but plain text or a number."""
    r = raw if isinstance(raw, dict) else {}
    sess = r.get("session") if isinstance(r.get("session"), dict) else {}
    reg = r.get("regime") if isinstance(r.get("regime"), dict) else {}
    out: dict = {
        "verdict": _pick(r.get("verdict"), VERDICTS, "NO SETUP"),
        "headline": _s(r.get("headline"), 400),
        "breakdown": _strs(r.get("breakdown"), 300, 6),
        "session": {"status": _pick(sess.get("status"), ("clear", "caution", "stand_down"), "clear"),
                    "reason": _s(sess.get("reason"))},
        "regime": {"read": _s(reg.get("read"), 200), "permitted": _s(reg.get("permitted"), 60)},
        "levels_in_play": [{"price": _num(x.get("price")), "state": _s(x.get("state"), 40), "would_be": _s(x.get("would_be"), 60),
                            "next": _s(x.get("next"), 200)} for x in (r.get("levels_in_play") or []) if isinstance(x, dict)][:8]
        if isinstance(r.get("levels_in_play"), list) else [],
        "disqualifier": _s(r.get("disqualifier")) or None,
        "watch_next": _strs(r.get("watch_next"), 300, 6),
        "missing_data": _strs(r.get("missing_data"), 300, 6),
        "confidence": _pick(r.get("confidence"), ("low", "medium", "high"), "low"),
    }
    c = r.get("candidate") if isinstance(r.get("candidate"), dict) else {}
    lvl = _num(c.get("level"))
    out["candidate"] = {"level": lvl if lvl and lvl > 0 else None, "setup": _pick(c.get("setup"), SETUPS, "None"),
                        "direction": _pick(c.get("direction"), ("Long", "Short"), "None"),
                        "trap_zone_low": _num(c.get("trap_zone_low")), "trap_zone_high": _num(c.get("trap_zone_high")),
                        "reclaim_trigger": _num(c.get("reclaim_trigger"))}
    for k in ("c1", "c2", "c3", "c4"):
        comp = r.get(k) if isinstance(r.get(k), dict) else {}
        sc = comp.get("score")
        sc = int(sc) if isinstance(sc, (int, float)) and not isinstance(sc, bool) and math.isfinite(sc) else 0
        checks = comp.get("checks") if isinstance(comp.get("checks"), dict) else {}
        out[k] = {"score": min(2, max(0, sc)), "reason": _s(comp.get("reason"), 500),
                  "checks": {ck: checks.get(ck) is True or checks.get(ck) == 1 for ck in CHECK_KEYS[k]}}
        if k == "c4":
            out[k]["quality"] = _pick(comp.get("quality"), QUALITY, "none")
    p = r.get("plan") if isinstance(r.get("plan"), dict) else {}
    out["plan"] = {"entry": _num(p.get("entry")), "invalidation": _num(p.get("invalidation")),
                   "target": _num(p.get("target")), "deadline": _s(p.get("deadline"), 200)}
    return out


DEAD_TEXT = {"DEAD_RAN": "Price cleared a full ATR beyond and held (flag, not trap)",
             "DEAD_TIMED_OUT": "Four or more candles beyond with no reclaim (the break is real)",
             "DEAD_SHALLOW": "Penetration below the floor line (nobody recruited)"}


def enforce(res: dict, snap: dict, th: dict, sess: dict, fee_pct: float, decide, blocker=None) -> dict:
    """Re-check Claude's answer with the app's own rules. `decide` is the same
    decide_verdict the checklist uses. Claude can be stricter, never looser.
    Facts the app measures (which level, its direction and setup, the reclaim
    close, entry at the trigger, the stop beyond the extreme wick) come from
    the app, not from the model."""
    cand = res["candidate"]
    levels = [x for x in (snap.get("levels") or []) if isinstance(x.get("price"), (int, float)) and x["price"] > 0]
    lv = None
    if cand["level"]:
        lv = min(levels, key=lambda x: abs(x["price"] - cand["level"]), default=None)
        if lv and abs(lv["price"] - cand["level"]) / cand["level"] > 0.001:
            lv = None
    notes: list[str] = []
    dq = res["disqualifier"]
    direction = cand["direction"] if cand["direction"] != "None" else None
    if lv and lv.get("direction"):
        if direction and direction != lv["direction"]:
            dq = dq or f"Claude read this as a {direction}, but the level's trap points {lv['direction']}"
        direction = lv["direction"]
        cand["direction"] = direction
    if lv and lv.get("setup") and cand["setup"] not in ("None", lv["setup"]):
        notes.append(f"The app classifies this level as a {lv['setup']}; Claude called it a {cand['setup']}.")
    reg = snap.get("regime") or {}
    counter = bool(direction and reg.get("regime") in ("uptrend", "downtrend") and direction not in (reg.get("permitted") or []))
    # entry = the level's reclaim trigger; stop = a few ticks beyond the extreme wick (rule 2)
    rng = snap.get("range") or {}
    entry = (lv or {}).get("trigger") or res["plan"]["entry"]
    stop = res["plan"]["invalidation"]
    if lv and lv.get("extreme") and direction:
        buf = 3 * (snap.get("tick") or 0)
        stop = lv["extreme"] - buf if direction == "Long" else lv["extreme"] + buf
    stop_dist = abs(entry - stop) if entry and stop and entry != stop else None
    thin = bool(snap.get("thin"))
    slip = th["slippage_pct_thin"] if thin else th["slippage_pct_major"]
    g = A.gates(rng.get("height"), stop_dist, snap.get("price") or 0, snap.get("atr15"), fee_pct, slip, thin, th)
    third = None
    if rng.get("height") and entry and rng.get("low") is not None:
        pos = (entry - rng["low"]) / rng["height"]
        third = "lower" if pos < 1 / 3 else "upper" if pos > 2 / 3 else "middle"
    stop_wrong_side = bool(entry and stop and direction and ((direction == "Long" and stop >= entry) or (direction == "Short" and stop <= entry)))
    # the reclaim close is a fact the app measures, not an opinion
    c4_closed = bool(res["c4"]["checks"]["closed"] and lv and lv.get("state") == "TRIGGERED")
    if not dq and lv and str(lv.get("state", "")).startswith("DEAD"):
        dq = DEAD_TEXT.get(lv["state"], "Level is dead")
    if not dq and cand["setup"] == "None":
        dq = "Not one of the four setups"
    if not dq and stop_wrong_side:
        dq = "Invalidation is on the wrong side of entry"
    body = {"scores": {k: res[k]["score"] for k in ("c1", "c2", "c3", "c4")}, "disqualifier": dq,
            "c4_closed": c4_closed, "counter_trend": counter, "trend_block": counter,
            "gates": {"range_ok": g["range"]["ok"] if g["range"] else None,
                      "cost_ok": g["cost"]["ok"] if g["cost"] else None},
            "third": third, "recovering": False}
    setup = (lv or {}).get("setup") or (cand["setup"] if cand["setup"] != "None" else None)
    verdict, reasons, grade = decide(body, sess, th)
    if blocker:
        # personal blocks the trader approved on the Learning page: stricter, never looser
        blocks = blocker({"symbol": snap.get("symbol"), "setup": setup, "direction": direction, "grade": grade})
        if blocks:
            body["personal_blocks"] = blocks
            verdict, reasons, grade = decide(body, sess, th)
    if not lv:
        verdict = "NO TRADE"
        reasons = ["Claude's level does not match any level the app tracks, so nothing can be confirmed."] + reasons
    total = sum(res[k]["score"] for k in ("c1", "c2", "c3", "c4"))
    ai_verdict = res["verdict"]
    final = ai_verdict
    overrides: list[str] = []
    if ai_verdict == "TRADEABLE NOW" and verdict != "GO":
        live = lv and lv.get("state") in ("RECRUITING", "WATCH", "TESTED", "APPROACHING", "TRIGGERED") and not dq
        final = "WATCH" if live and lv.get("state") != "TRIGGERED" else "NO SETUP"
        overrides = [r for r in reasons if not r.startswith("Grade dropped")]
    if dq and final in ("TRADEABLE NOW", "WATCH"):
        # a disqualified candidate cannot trigger later either
        if final == "WATCH":
            overrides = [f"Hard disqualifier: {dq}."]
        final = "NO SETUP"
    res.update({
        "verdict": final, "ai_verdict": ai_verdict, "overrides": overrides, "notes": notes,
        "total": total, "grade": grade,
        "rules_check": {"verdict": verdict, "reasons": reasons},
        "gates": {"lines": g["lines"], "range_ok": body["gates"]["range_ok"], "cost_ok": body["gates"]["cost_ok"],
                  "entry": entry, "stop": stop, "stop_dist": stop_dist, "third": third},
        "level_state": (lv or {}).get("state"), "counter_trend": counter, "disqualifier": dq, "setup": setup,
        "direction": direction,
        "c4_closed": c4_closed,
    })
    return res


# ---------------------------------------------------------------- orchestration
class AIAnalyst:
    def __init__(self, app):
        self.app = app
        self.running: dict[str, int] = {}      # symbol -> started ms
        self.errors: dict[str, dict] = {}
        self._last_start = 0.0

    # settings live in the per-install shared store (the key is per-install too)
    def model(self) -> str:
        m = self.app.shared.get("ai_model")
        return m if m in MODELS else DEFAULT_MODEL

    def budget(self) -> float:
        v = self.app.shared.get("ai_budget_usd")
        try:
            return DEFAULT_BUDGET_USD if v is None else float(v)
        except (TypeError, ValueError):
            return DEFAULT_BUDGET_USD

    def _month(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m")

    def _bill(self, cost: float) -> None:
        k = f"ai_spend:{self._month()}"
        self.app.shared.set(k, round(float(self.app.shared.get(k) or 0) + (cost or 0), 4))

    def backup_order(self) -> list[str]:
        return [p for p in (self.app.shared.get("ai_backup_order") or ["openai", "gemini"]) if p in BK.PROVIDERS]

    def backup_model(self, prov: str) -> str:
        m = str(self.app.shared.get(f"ai_model_{prov}") or "").strip()
        return m if re.fullmatch(r"[A-Za-z0-9._\-]{2,60}", m) else BK.PROVIDERS[prov]["default_model"]

    def backups_info(self) -> list[dict]:
        out = []
        for p in self.backup_order():
            k = BK.key_load(p)
            out.append({"id": p, "label": BK.PROVIDERS[p]["label"], "connected": bool(k), "key_masked": BK.mask(k),
                        "model": self.backup_model(p), "default_model": BK.PROVIDERS[p]["default_model"],
                        "private": BK.is_private(p), "max_class": BK.max_class(p),
                        "max_class_label": BK.CLASS_LABEL[BK.max_class(p)], "priced": bool(BK.PROVIDERS[p]["prices"])})
        return out

    def spent(self) -> float:
        return float(self.app.shared.get(f"ai_spend:{self._month()}") or 0)

    def info(self) -> dict:
        k = key_load()
        return {"connected": bool(k), "key_masked": key_mask(k), "model": self.model(), "budget_usd": self.budget(),
                "spent_usd": round(self.spent(), 2), "month": self._month(),
                "models": [{"id": m, "label": v["label"]} for m, v in MODELS.items()],
                "storage": "os-vault" if _keyring() else "local-file", "backups": self.backups_info()}

    def status(self, sym: str) -> dict:
        last = self.app.db.get(f"ai_last:{sym}")
        info = self.info()          # one read of each key from the vault per poll, not two
        return {"symbol": sym, "running": sym in self.running, "started": self.running.get(sym),
                "error": self.errors.get(sym), "last": last, "connected": info["connected"], "model": info["model"],
                "any_ai": info["connected"] or any(b["connected"] for b in info["backups"])}

    def start(self, sym: str, recovering: bool = False) -> dict:
        """Validate, then run the scan in the background. Returns the status."""
        a = self.app
        if recovering:
            # Trading to recover: stop entirely, do not evaluate. No data leaves the laptop.
            why = "You said you are trying to make back a loss"
            a.db.set(f"ai_last:{sym}", {"at": now_ms(), "symbol": sym, "local": True, "result": {
                "verdict": "STAND DOWN", "headline": f"{why}. Stop entirely. The setup is not evaluated.",
                "breakdown": ["Close the platform for today.", "Study instead: the Study Hall counts toward your streak."],
                "overrides": [], "rules_check": {"verdict": "NO TRADE", "reasons": [why]}}})
            self.errors.pop(sym, None)
            return self.status(sym)
        key = key_load()
        backups = [b for b in self.backups_info() if b["connected"]]
        if not key and not backups:
            raise AINotConnected("Connect Claude first: Settings > AI analyst.")
        if self.running:
            raise AIError("A scan is already running. One at a time keeps the cost predictable.")
        if time.monotonic() - self._last_start < COOLDOWN_S:
            raise AIError(f"Give it {COOLDOWN_S} seconds between scans.")
        if self.spent() >= self.budget() and not any(not b["priced"] for b in backups):
            raise AIError(f"This month's AI budget (${self.budget():.2f}) is used up. Raise it in Settings > AI analyst.")
        self._last_start = time.monotonic()
        self.running[sym] = now_ms()
        self.errors.pop(sym, None)
        a._spawn(self._run(sym, key))
        return self.status(sym)

    async def _run(self, sym: str, key: str) -> None:
        a = self.app
        t0 = time.monotonic()
        try:
            if not a.market:
                raise AIError("Market data is not running yet.")
            sd = a.market.sd(sym)
            if not sd.snapshot:
                await a.market.refresh(sym, force=True)
            snap = sd.snapshot
            if not snap or not snap.get("atr15"):
                raise AIError("Not enough market data for this symbol yet.")
            th = a.th()
            fee = a.settings().get("taker_fee_pct") or th["taker_fee_pct"]
            sess = a.session_status()
            packet = build_packet(snap, sd, th, sess, fee, demo=a.demo)
            trades = a.db.trades()
            try:      # option B: a short pattern summary (R and counts only) goes with the market data
                packet["trader_profile"] = L.ai_summary(a.db, trades, a.learning_context(sym, None, None))
            except Exception:  # noqa: BLE001
                log.exception("trader profile")
            month_key = f"ai_spend:{self._month()}"
            resp, provider, notes, answer = None, "claude", [], None
            if key and self.spent() < self.budget():
                model = self.model()
                try:
                    for attempt in range(3):
                        try:
                            resp = await call_claude(a.http, key, model, system_prompt(th), user_message(packet))
                            break
                        except AITransient as exc:
                            # a dropped stream may already have used tokens: count them against the budget
                            if exc.usage:
                                self._bill(cost_usd(model, exc.usage))
                            log.warning("ai scan attempt %d: %s", attempt + 1, exc)
                            if attempt == 2 or self.spent() >= self.budget():
                                raise AIError(f"{exc} Tried 3 times.") from exc
                            await asyncio.sleep(RETRY_WAITS[attempt])
                    # bill first: Anthropic charges for every completed response, readable or not
                    cost = cost_usd(model, resp["usage"])
                    self._bill(cost)
                    answer = parse_answer(resp["data"])
                except AIError as exc:
                    notes.append(f"Claude: {exc}")
                    resp, answer = None, None
            elif key:
                notes.append("Claude: this month's AI budget is used up.")
            if answer is None:
                # backups, in order: ChatGPT (paid API) then Gemini (free tier, market data only)
                for prov in self.backup_order():
                    bkey = BK.key_load(prov)
                    if not bkey:
                        continue
                    if BK.PROVIDERS[prov]["prices"] and self.spent() >= self.budget():
                        notes.append(f"{BK.PROVIDERS[prov]['label']}: this month's AI budget is used up.")
                        continue
                    # strip the packet to what this provider's data class allows
                    pk = BK.strip_packet_for(dict(packet), prov)
                    bmodel = self.backup_model(prov)
                    try:
                        resp = await BK.call(a.http, prov, bkey, bmodel, system_prompt(th), user_message(pk), SCHEMA)
                        cost = BK.cost_usd(prov, bmodel, resp["usage"])
                        self._bill(cost)
                        answer = parse_answer(resp["data"])
                        provider = prov
                        break
                    except (BK.BackupError, AIError) as exc:
                        notes.append(f"{BK.PROVIDERS[prov]['label']}: {exc}")
                        resp = None
            if answer is None:
                if not notes:
                    raise AIError("Connect an AI first: Settings > AI analyst.")
                raise AIError(" ".join(notes))
            from .api import decide_verdict      # same rules as the checklist verdict (lazy: api imports core)
            def blocker(c):
                try:
                    return L.restriction_hits(a.db, a.learning_context(sym, c["setup"], c["direction"], c["grade"]))
                except Exception:  # noqa: BLE001  (fail closed: never TRADEABLE NOW if blocks can't be checked)
                    log.exception("personal blocks")
                    return ["Personal blocks could not be checked."]
            res = enforce(normalize(answer), snap, th, sess, fee, decide_verdict, blocker)
            if provider != "claude":
                res["backup"] = {"provider": provider, "label": BK.PROVIDERS[provider]["label"], "why": notes[:2],
                                 "private": BK.is_private(provider)}
            try:
                lctx = a.learning_context(sym, res.get("setup"), res.get("direction"), res.get("grade"))
                res["lessons"] = L.lessons_for(L.edge_profile(trades), lctx)
                L.record_ai(a.db, sym, res, snap)
            except Exception:  # noqa: BLE001  (the report card never breaks a scan)
                log.exception("ai learning")
            rec = {"at": now_ms(), "symbol": sym, "model": resp["model"], "provider": provider, "seconds": round(time.monotonic() - t0, 1),
                   "cost_usd": cost, "usage": {k: resp["usage"].get(k) for k in ("input_tokens", "output_tokens")},
                   "price": snap.get("price"), "demo": a.demo, "result": res}
            a.db.set(f"ai_last:{sym}", rec)
        except AIError as exc:
            log.warning("ai scan %s failed: %s", sym, exc)
            self.errors[sym] = {"at": now_ms(), "message": str(exc)}
        except Exception as exc:  # noqa: BLE001
            log.exception("ai scan failed")
            self.errors[sym] = {"at": now_ms(), "message": f"Scan failed inside the app ({exc.__class__.__name__}: {str(exc)[:160]}). "
                                                          "Send me trap.log from your data folder."}
        finally:
            self.running.pop(sym, None)
            await a.push("ai_scan", {"symbol": sym})
