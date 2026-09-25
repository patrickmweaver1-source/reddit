"""TrapApp: owns the database, data sources, engines, coach and the live event bus."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import aiohttp

from . import comovement as COV
from . import config, credentials
from . import game as G
from . import rules as R
from . import webpush as WP
from . import sms as SMS
from .account import AccountSync
from .bybit import BybitREST, BybitWS
from .coach import Coach
from .db import DB, now_ms
from .demo import DemoSource, seed_journal
from .market import MarketEngine
from .trades import compute_metrics
from .tuner import AutoTuner
from .ai import AIAnalyst
from .chart import ChartData

log = logging.getLogger("trap.core")

PUSH_STATE_CHOICES = ("APPROACHING", "RECRUITING", "TRIGGERED")


class RuleLocked(Exception):
    """Raised when something tries to change the rulebook outside an open
    monthly review (rule 11)."""


class TrapApp:
    def __init__(self, demo: bool = False):
        self.demo = demo
        self.db = DB(config.DEMO_DB_PATH if demo else config.DB_PATH)
        # Per-install, not per-mode: enrolled push devices, which states push,
        # and the Tailscale address. A phone enrolled while trying demo mode
        # must still be enrolled after switching to live.
        self.shared = DB(config.DATA_DIR / "devices.db")
        self.cfg_ws_private = config.BYBIT_WS_PRIVATE
        self.http: aiohttp.ClientSession | None = None
        self.rest: BybitREST | None = None
        self.source: Any = None
        self.market: MarketEngine | None = None
        self.account: AccountSync | None = None
        self.public_ws: BybitWS | None = None
        self.coach = Coach(self.db, self.push)
        self.subscribers: set[asyncio.Queue] = set()
        self._tasks: list[asyncio.Task] = []
        self._flags: dict[str, Any] = {}
        self._bg: set[asyncio.Task] = set()
        self.vapid = WP.load_or_create_vapid(config.DATA_DIR / "vapid_private.pem")
        self._ensure_rulebook()
        self.tuner = AutoTuner(self)
        self.ai = AIAnalyst(self)
        self.chart = ChartData(self)

    # ------------------------------------------------------------------ settings
    def _ensure_rulebook(self) -> None:
        if not self.db.one("SELECT id FROM rule_versions LIMIT 1"):
            self.db.execute("INSERT INTO rule_versions(ts,rules,thresholds,setups,note) VALUES(?,?,?,?,?)",
                            (now_ms(), json.dumps(config.DEFAULT_RULES), json.dumps(config.DEFAULT_THRESHOLDS),
                             json.dumps(config.DEFAULT_SETUPS), "v1 - from the Trap Journal playbook"))
            return
        # One-time: the daily loss limit (old rule 10) was removed at Pat's request. Existing rulebooks
        # get a new version without it, so the change shows in the playbook history like any other.
        row = self.db.one("SELECT * FROM rule_versions ORDER BY id DESC LIMIT 1")
        rules = json.loads(row["rules"])
        th = json.loads(row["thresholds"])
        if any(r.get("n") == 10 and "loss" in (r.get("title", "") + r.get("text", "")).lower() for r in rules) or "daily_loss_limit" in th:
            rules = [r for r in rules if not (r.get("n") == 10 and "loss" in (r.get("title", "") + r.get("text", "")).lower())]
            th.pop("daily_loss_limit", None)
            self.db.execute("INSERT INTO rule_versions(ts,rules,thresholds,setups,note) VALUES(?,?,?,?,?)",
                            (now_ms(), json.dumps(rules), json.dumps(th), row["setups"],
                             "Removed the three-losses-a-day stop (old rule 10) at your request"))

    def rulebook(self) -> dict:
        row = self.db.one("SELECT * FROM rule_versions ORDER BY id DESC LIMIT 1")
        th = dict(config.DEFAULT_THRESHOLDS)
        th.update(json.loads(row["thresholds"]))
        return {"id": row["id"], "ts": row["ts"], "rules": json.loads(row["rules"]), "thresholds": th,
                "setups": json.loads(row["setups"]), "note": row["note"]}

    def th(self) -> dict:
        return self.rulebook()["thresholds"]

    def review_open(self) -> dict | None:
        """The monthly review row that is currently open (started, not yet
        completed) for the current UTC month, or None. Also expires any review
        left open from a previous month so it can't gate this month's edits.
        This is the single source of truth for 'are rule changes allowed right
        now?' (rule 11), shared by manual edits and the auto-tuner."""
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        self.db.execute("UPDATE reviews SET completed_at=?, notes=? WHERE completed_at IS NULL AND month<>?",
                        (now_ms(), json.dumps({"auto": "expired unfinished"}), month))
        return self.db.one("SELECT * FROM reviews WHERE completed_at IS NULL AND month=? ORDER BY id DESC LIMIT 1", (month,))

    def commit_rule_version(self, rules: list, thresholds: dict, setups: list, note: str,
                            *, allow_outside_review: bool = False) -> dict:
        """The ONE place the live rulebook is ever written. Rule 11: refuses
        unless a monthly review is open, so nothing (manual edit or approved
        auto-tune) can change the rulebook mid-session. allow_outside_review is
        only for sanctioned exceptions: first-run bootstrap and undoing a change
        that was just applied in error."""
        if not allow_outside_review and self.review_open() is None:
            raise RuleLocked("Rules are locked. Start the monthly review to change them (rule 11).")
        self.db.execute("INSERT INTO rule_versions(ts,rules,thresholds,setups,note) VALUES(?,?,?,?,?)",
                        (now_ms(), json.dumps(rules), json.dumps(thresholds), json.dumps(setups), note[:300]))
        return self.rulebook()

    def settings(self) -> dict:
        s = self.db.get("settings", {}) or {}
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        out = {
            "watchlist": s.get("watchlist") or list(config.DEFAULT_WATCHLIST),
            "thin_assets": s.get("thin_assets") if s.get("thin_assets") is not None else list(config.DEFAULT_THIN_ASSETS),
            "starting_equity": float(s.get("starting_equity") or 50000),
            "backfill_days": int(s.get("backfill_days") or 30),
            "sound": s.get("sound", True),
            "notifications": s.get("notifications", True),
            # level states that send a device push: RECRUITING = setup forming,
            # TRIGGERED = entry signal; APPROACHING (within 1 ATR) is an opt-in heads-up
            "push_states": self.push_states(),
            "macro_today": s.get("macro_day") == today,
            "taker_fee_pct": s.get("taker_fee_pct"),
            "maker_fee_pct": s.get("maker_fee_pct"),
            "coach_name": s.get("coach_name") or "Coach",
            # your own private Tailscale address (for enrolling a phone); empty = laptop only
            "tailnet_host": self.shared.get("tailnet_host") or "",
            "reduced_motion": s.get("reduced_motion", False),
            # scan market history 3x a day and propose zone-boundary updates for approval
            "auto_tune": bool(s.get("auto_tune", False)),
            # SMS alerts (Twilio) only fire when both a Twilio account is saved
            # AND this is on; off by default so setting up the account alone
            # never starts sending texts.
            "sms_enabled": bool(self.shared.get("sms_enabled", False)),
        }
        out["thresholds"] = self.th()
        return out

    def push_states(self) -> list[str]:
        v = self.shared.get("push_states")
        return [x for x in (v if isinstance(v, list) else ["RECRUITING", "TRIGGERED"]) if x in PUSH_STATE_CHOICES]

    def set_setting(self, key: str, value: Any) -> None:
        if key in ("push_states", "tailnet_host", "sms_enabled"):
            self.shared.set(key, value)
            return
        s = self.db.get("settings", {}) or {}
        s[key] = value
        self.db.set("settings", s)

    # ------------------------------------------------------------------ lifecycle
    async def startup(self) -> None:
        self.http = aiohttp.ClientSession()
        if self.demo:
            self.source = DemoSource()
            seed_journal(self.db, self.settings()["starting_equity"])
        else:
            self.rest = BybitREST(self.http)
            self.source = self.rest
            await self._repair_watchlist()
        self.market = MarketEngine(self.db, self.source, self.settings, self._market_event)
        self.market.start()
        if self.demo:
            self._tasks.append(asyncio.create_task(self.source.run_live(self.market, self.settings()["watchlist"]), name="demo-live"))
        else:
            self._start_public_ws()
            k, s = credentials.load()
            if k and s:
                await self.connect_account(k, s, save=False)
        self._tasks.append(asyncio.create_task(self._periodic(), name="periodic"))
        self._tasks.append(asyncio.create_task(self.tuner.loop(), name="auto-tune"))
        self._tasks.append(asyncio.create_task(self._stall_watch(), name="stall-watch"))

    async def _stall_watch(self) -> None:
        """Diagnostics only: write to trap.log whenever the app server stops responding
        for more than a second, so a slow page can be traced to its cause."""
        while True:
            t0 = time.monotonic()
            await asyncio.sleep(1.0)
            late = time.monotonic() - t0 - 1.0
            if late > 1.0:
                log.warning("app server was busy for %.1fs (every page waited)", late)

    async def _repair_watchlist(self) -> None:
        """Older versions saved whatever was typed ("XRP"), which Bybit rejects.
        Fix those names once at start-up; drop ones Bybit doesn't list."""
        from . import symbols as SYM
        wl = self.settings()["watchlist"]
        if all(w.endswith(SYM.QUOTES) and w == SYM.clean(w) for w in wl):
            return
        try:
            fixed, notes, bad = await asyncio.wait_for(SYM.resolve_list(self.rest, wl), timeout=20)
        except Exception as exc:  # noqa: BLE001  (offline: leave it; saving the watchlist fixes it later)
            log.warning("watchlist check skipped: %s", exc)
            return
        if fixed and fixed != wl:
            log.info("watchlist corrected: %s -> %s (%s; dropped %s)", wl, fixed, "; ".join(notes), bad or "none")
            self.set_setting("watchlist", fixed)
            thin = self.settings().get("thin_assets") or []
            self.set_setting("thin_assets", [next((f for f in fixed if f in SYM.candidates(t)), t) for t in thin])

    async def shutdown(self) -> None:
        for t in list(self._bg):
            t.cancel()
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._tasks.clear()
        if self.market:
            await self.market.stop()
        if self.public_ws:
            await self.public_ws.stop()
        if self.account:
            await self.account.stop()
        if self.http:
            await self.http.close()
        self.db.close()
        self.shared.close()

    def _start_public_ws(self) -> None:
        if self.public_ws:
            asyncio.create_task(self.public_ws.stop())
        topics = []
        for sym in self.settings()["watchlist"]:
            topics += [f"tickers.{sym}", f"publicTrade.{sym}", f"allLiquidation.{sym}", f"kline.15.{sym}"]
        self.public_ws = BybitWS(self.http, config.BYBIT_WS_PUBLIC, topics, self._on_public, name="public")
        self.public_ws.start()

    async def _on_public(self, msg: dict) -> None:
        topic = msg["topic"]
        data = msg.get("data")
        kind, _, sym = topic.rpartition(".")
        if topic.startswith("tickers."):
            self.market.on_ticker(sym, data if isinstance(data, dict) else (data or [{}])[0])
        elif topic.startswith("publicTrade."):
            for tr in data or []:
                self.market.add_trade(sym, int(tr["T"]), tr["S"], float(tr["v"]))
        elif topic.startswith("allLiquidation."):
            for lq in data or []:
                self.market.add_liquidation(sym, int(lq["T"]), lq["S"], float(lq["v"]), float(lq["p"]))
            # no page draws these live; at most one note per coin every 5s instead of one per batch
            last = self._flags.get(f"liq_push:{sym}", 0.0)
            if time.monotonic() - last >= 5:
                self._flags[f"liq_push:{sym}"] = time.monotonic()
                await self.push("liquidation", {"symbol": sym, "data": data})
        elif topic.startswith("kline."):
            for k in data or []:
                self.market.on_kline(sym, k)

    async def restart_market(self) -> None:
        if self.market:
            await self.market.stop()
        self.market = MarketEngine(self.db, self.source, self.settings, self._market_event)
        self.market.start()
        if not self.demo:
            self._start_public_ws()

    # ------------------------------------------------------------------ account
    async def connect_account(self, api_key: str, api_secret: str, save: bool = True) -> dict:
        probe = BybitREST(self.http, api_key, api_secret)
        await probe.sync_time()
        info = await probe.key_info()
        from .bybit import evaluate_key_info
        ev = evaluate_key_info(info)
        if not ev["ok"]:
            return ev
        if save:
            ev["stored_in"] = credentials.save(api_key, api_secret)
        if self.account:
            await self.account.stop()
        self.account = AccountSync(self, probe)
        asyncio.create_task(self.account.start())
        return ev

    async def disconnect_account(self) -> None:
        if self.account:
            await self.account.stop()
        self.account = None
        credentials.clear()

    # ------------------------------------------------------------------ events
    async def push(self, kind: str, payload: Any) -> None:
        msg = {"kind": kind, "data": payload, "ts": now_ms()}
        for q in list(self.subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass

    async def push_notify(self, title: str, body: str, *, tag: str | None = None, url: str = "/", extra: dict | None = None) -> dict:
        """Send a Web Push notification to every device enrolled in Settings >
        Notifications, and a Twilio text if SMS alerts are turned on. Runs
        alongside the in-app coach/SSE alert, not instead of it. Prunes any
        subscription the push relay reports as gone (the browser unsubscribed,
        the device was reset, notifications were revoked) rather than
        retrying it forever."""
        out = {"sent": 0, "failed": 0, "removed": 0}
        subs = self.shared.push_subs()
        if subs and self.vapid is not None:
            payload = {"title": title, "body": body, "tag": tag or "trap", "url": url, **(extra or {})}
            for sub, sent_ok, err, status in await WP.broadcast(self.vapid, subs, payload):
                if sent_ok:
                    self.shared.push_sub_mark(sub["endpoint"], True, None)
                    out["sent"] += 1
                elif status in (404, 410):
                    self.shared.push_sub_remove(sub["endpoint"])
                    out["removed"] += 1
                else:
                    self.shared.push_sub_mark(sub["endpoint"], False, err)
                    out["failed"] += 1
                    log.info("push failed to %s: %s", sub.get("label") or sub["endpoint"][:40], err)
        if self.settings()["sms_enabled"]:
            creds = await asyncio.to_thread(SMS.load)     # an OS vault read must never stall the server
            if creds:
                ok, err = await SMS.send_sms(self.http, creds, f"{title}\n{body}" if body else title)
                if ok:
                    out["sms_sent"] = True
                else:
                    out["sms_failed"] = True
                    log.info("sms failed: %s", err)
        return out

    async def _market_event(self, kind: str, payload: dict) -> None:
        if kind == "level_state":
            lv = payload["level"]
            sym = payload["symbol"]
            reg = self.market.sd(sym).snapshot.get("regime", {}) if self.market else {}
            aligned = lv.get("direction") in (reg.get("permitted") or [])
            state = lv["state"]
            push_states = self.settings()["push_states"]
            if state == "APPROACHING" and state not in push_states:
                return  # opt-in heads-up only; otherwise too chatty to surface at all
            titles = {"APPROACHING": "approaching", "RECRUITING": "is recruiting", "WATCH": "is on WATCH", "TRIGGERED": "TRIGGERED"}
            title = f"{sym} {lv['price']:g} {titles.get(state, state)}"
            body = lv.get("note") or ""
            if state == "TRIGGERED":
                body = (f"{lv.get('setup')} candidate, {lv.get('direction')}. " + body +
                        " Run the checklist now. Score C1-C4, show both gates." +
                        ("" if aligned else " Counter to the 4h regime: ranks last."))
            elif state == "RECRUITING":
                body = (f"{lv.get('setup') or 'Level'} break in progress, {lv.get('direction') or ''}. " +
                        (body or "Watch for the reclaim candle."))
            elif state == "APPROACHING":
                body = body or "Within 1 ATR of a tracked level. Get to the chart."
            msg = await self.coach.say("warn" if state == "TRIGGERED" else "info", title, body,
                                       key=f"lvl:{lv['key']}:{state}:{now_ms() // (15 * 60_000)}", ref=f"market:{sym}")
            # Device push rides on the coach's dedupe: only a genuinely new alert
            # (not a repeat inside the same 15m window) reaches the phone. Sent in
            # the background so a slow push relay never delays the in-app alert.
            if msg is not None and state in push_states:
                self._spawn(self.push_notify(("DEMO · " if self.demo else "") + title, body,
                                             tag=f"lvl:{lv['key']}", url=f"/#/markets/{sym}"))
            await self.push("level", payload)

    def _spawn(self, coro) -> None:
        """Fire-and-forget with a held reference (asyncio only keeps weak refs
        to tasks) and logged failures."""
        task = asyncio.create_task(coro)
        self._bg.add(task)

        def _done(t: asyncio.Task) -> None:
            self._bg.discard(t)
            if not t.cancelled() and t.exception():
                log.warning("background task failed: %s", t.exception())
        task.add_done_callback(_done)

    # ------------------------------------------------------------------ helpers
    def session_status(self) -> dict:
        nf = {}
        if self.market:
            for sym in self.settings()["watchlist"]:
                f = (self.market.sd(sym).snapshot or {}).get("funding") or {}
                if f.get("next"):
                    nf[sym] = f["next"]
        open_n = len(self.account.positions) if self.account else 0
        return R.session_status(now_ms(), self.th(), self.db.trades("taken=1"), next_funding_ms=nf,
                                macro_today=self.settings()["macro_today"], open_positions=open_n)

    async def candles_between(self, sym: str, t0: int, t1: int) -> list[dict]:
        """15m candles covering a trade. Finished ranges are cached, so re-syncing the
        journal doesn't ask Bybit again for every closed trade (that tripped its rate limit)."""
        q = 15 * 60_000
        key = (sym, t0 // q, t1 // q)
        cache = self.__dict__.setdefault("_candle_cache", {})
        if key in cache:
            return cache[key]
        rows = []
        if self.market and sym in self.market.data:
            rows = [k for k in self.market.sd(sym).c["15"] if k["t"] >= t0 - q and k["t"] <= t1]
        if not rows and self.source is not None:
            try:
                start = t0 - t0 % q
                rows = await self.source.klines(sym, "15", limit=1000, start=start, end=t1)
                rows = [k for k in rows if start <= k["t"] <= t1]
            except Exception as exc:  # noqa: BLE001
                log.info("candles_between %s: %s", sym, exc)
                return []            # not cached: try again next time
        if rows and t1 < now_ms() - 2 * q:          # the range is finished: it will never change
            if len(cache) > 2000:
                cache.clear()
            cache[key] = rows
        return rows

    def market_context(self, sym: str, direction: str | None = None) -> dict:
        """Compact snapshot of the market at this moment, attached to a trade at
        entry so the journal, dashboard and coach all read the same numbers the
        Market Monitor showed when the trade was taken."""
        if not self.market:
            return {}
        sn = self.market.sd(sym).snapshot
        if not sn:
            return {}
        lv = None
        for cand in (sn.get("candidates") or []) + (sn.get("levels") or []):
            if cand.get("direction") in (None, direction) or direction is None:
                lv = cand
                break
        suggest = {}
        if lv:
            if lv.get("pen_atr") is not None:
                suggest["pen_atr"] = lv["pen_atr"]
            if lv.get("candles_since_break") is not None:
                suggest["candles_to_reclaim"] = lv["candles_since_break"]
            ob, orc = lv.get("oi_break_pct"), lv.get("oi_reclaim_pct")
            if ob is not None or orc is not None:
                suggest["oi_confirmed"] = "Yes" if ((ob or 0) > 0.2 and (orc or 0) < -0.2) else "No"
        f = sn.get("funding") or {}
        oi = sn.get("oi") or {}
        rng = sn.get("range") or {}
        mech = sn.get("mechanism") or {}
        return {
            "captured_at": now_ms(), "price": sn.get("price"), "atr15": sn.get("atr15"), "atr_pct": sn.get("atr_pct"),
            "rvol": sn.get("rvol"), "rvol_label": sn.get("rvol_label"),
            "funding_8h_pct": f.get("rate_8h_pct"), "funding_pctile": f.get("pctile"),
            "oi_chg_1h": oi.get("chg_1h"), "mechanism": mech.get("name"), "mechanism_code": mech.get("code"),
            "regime": (sn.get("regime") or {}).get("regime"), "third": rng.get("third"),
            "liquidity_state": (sn.get("liquidity") or {}).get("state"),
            "level": {"price": lv.get("price"), "state": lv.get("state"), "setup": lv.get("setup")} if lv else None,
            "suggest": suggest,
        }

    def learning_context(self, sym: str | None, setup: str | None, direction: str | None, grade: str | None = None) -> dict:
        """The facts a lesson or personal block can match: coin, setup, side,
        grade, the session right now and whether this side is with the 4h trend."""
        from . import learning as L
        sym = (sym or "").upper() or None
        regime = None
        if sym and self.market and sym in self.market.data:
            regime = ((self.market.sd(sym).snapshot or {}).get("regime") or {}).get("regime")
        hour = datetime.now(timezone.utc).hour
        return {"symbol": sym, "setup": setup if setup not in ("", "None") else None,
                "direction": direction if direction in ("Long", "Short") else None,
                "grade": grade, "hour": hour, "session": L.session_of(hour), "trend": L.trend_of(direction, regime)}

    def co_movement(self) -> dict:
        """How each watchlist coin's 15m price moves relative to the others:
        same direction / opposite direction, and by how many candles one
        tends to lag another. Pure market data already held in memory
        (MarketEngine.sd(sym).c["15"]) -- no new Bybit calls, no trade data."""
        wl = self.settings()["watchlist"]
        candles = {sym: self.market.sd(sym).c["15"] for sym in wl if self.market and sym in self.market.data}
        # The analysis only changes when a 15m candle closes, but it was recomputed on
        # every Learning visit and every lessons lookup, blocking the server each time.
        key = tuple((sym, len(c), c[-1]["t"] if c else None) for sym, c in candles.items())
        hit = self.__dict__.get("_cov_cache")
        if hit and hit[0] == key:
            return hit[1]
        res = COV.analyze(candles)
        self._cov_cache = (key, res)
        return res

    def exposure_for(self, sym: str, direction: str | None) -> list[dict]:
        """Warn (never block) when a contemplated trade would largely duplicate a
        position already open on a coin it has recently moved with. Read-only, and
        purely from price co-movement - it says nothing about size or dollars.
        A positive correlation with the same side, or a negative correlation with
        the opposite side, is effectively one bet, not two (P4.1 common-factor
        exposure)."""
        sym = (sym or "").upper()
        if not sym:
            return []
        open_syms = {t["symbol"]: t.get("direction") for t in self.db.trades("status='open' AND taken=1") if t.get("symbol") and t["symbol"] != sym}
        if not open_syms:
            return []
        pairs = (self.co_movement().get("pairs") or [])
        lookup = {frozenset((p["a"], p["b"])): p for p in pairs}
        out = []
        for other, other_dir in open_syms.items():
            p = lookup.get(frozenset((sym, other)))
            if not p or abs(p["r"]) < 0.5:
                continue
            same_move = p["direction"] == "same"
            # is the net position concentrated (one big bet) or offsetting (a hedge)?
            concentrated = None
            if direction and other_dir:
                aligned_dir = (direction == other_dir)
                concentrated = aligned_dir == same_move
            rel = "the same direction" if same_move else "the opposite direction"
            lagtxt = "" if p["lag_candles"] == 0 else f", lagging by ~{abs(p['lag_candles'])} candle(s)"
            note = (f"You have an open {other_dir or 'position'} on {other}. It and {sym} have recently moved "
                    f"in {rel} (correlation {p['r']}{lagtxt}). ")
            if concentrated is True:
                note += "A trade here would be largely the same bet - read the two as closer to one position than two."
            elif concentrated is False:
                note += "A trade here would partly offset it - closer to a hedge than a second independent trade."
            else:
                note += "Depending on your side, this may be closer to one crypto-market bet than two."
            out.append({"symbol": other, "their_direction": other_dir, "r": p["r"], "lag": p["lag_candles"],
                        "concentrated": concentrated, "text": note})
        return out

    def co_movement_history(self) -> dict:
        """How the co-movement findings above have held up across the daily
        snapshots taken so far -- whether a pair keeps showing the same
        direction/lag day after day, or whether it was a one-off."""
        return COV.stability(COV.recent_snapshots(self.db))

    async def _learning_tick(self) -> None:
        """Every 10 minutes: score finished calls; on Sunday (UTC), write the weekly review;
        once a day (UTC), snapshot the coin-relationship analysis so it can be tracked over time."""
        from . import learning as L
        last = self.__dict__.get("_learn_last")
        # `last is not None` matters: time.monotonic() is relative to an arbitrary
        # reference point, not wall-clock time, so on a container that has been up
        # for under 10 minutes a `0` default would make this throttle misfire and
        # skip the very first tick ever, including the first day's co-movement
        # snapshot and the first check for a due weekly review.
        if last is not None and time.monotonic() - last < 600:
            return
        self._learn_last = time.monotonic()
        await L.resolve_open(self)
        # advance the Prospective Edge Registry: confirm/fail watched hypotheses
        # on their reserved out-of-sample trades, and freeze any new candidates.
        try:
            trades = self.db.trades()
            L.update_registry(self.db, trades)
            L.register_candidates(self.db, L.edge_profile(trades, L.validated_keys(self.db)))
        except Exception:  # noqa: BLE001 - the registry must never stall the tick
            log.exception("edge registry")
        if L.due_for_review(self.db):
            rev = L.save_review(self.db, L.weekly_review(self.db, self.db.trades()))
            L.mark_auto_review(self.db, rev)
            extra = f" {len(rev['proposals'])} rule proposal(s) waiting for you." if rev["proposals"] else ""
            await self.coach.say("info", "Your weekly review is ready", rev["one_change"] + extra, key=f"review:{rev['week']}")
        if COV.due_for_snapshot(self.db):
            COV.save_snapshot(self.db, self.co_movement())

    def attach_context(self, tid: int) -> None:
        t = self.db.trade(tid)
        if not t or t.get("context"):
            return
        ctxd = self.market_context(t["symbol"], t.get("direction"))
        if ctxd:
            self.db.update_trade(tid, {"context": ctxd})

    def equity_at(self, ts: int | None) -> float:
        if self.account:
            v = self.account.equity_at(ts)
            if v:
                return v
        base = self.settings()["starting_equity"]
        if ts:
            before = self.db.one("SELECT COALESCE(SUM(net_pnl),0) AS s FROM trades WHERE taken=1 AND closed_at<?", (ts,))["s"]
            return base + before
        return base

    # ------------------------------------------------------------------ evaluation
    async def evaluate(self, tid: int, stop_history: list | None = None, candles: list | None = None) -> dict | None:
        t = self.db.trade(tid)
        if not t:
            return None
        th = self.th()
        if not t.get("taken"):
            if t.get("reviewed_at"):
                G.award(self.db, "skip_logged", f"skip:{tid}", ref=f"trade:{tid}", ts=t["reviewed_at"])
            self._after_xp_soon()
            return t
        fee = self.settings().get("taker_fee_pct") or th["taker_fee_pct"]
        t.update(compute_metrics(t, fee))
        plan = self.db.one("SELECT * FROM plans WHERE id=?", (t["plan_id"],)) if t.get("plan_id") else None
        if plan:
            plan["checklist"] = json.loads(plan["checklist"])
        if stop_history is None:
            ev = self.db.query("SELECT ts, stop_loss FROM stop_events WHERE symbol=? AND ts>=? AND ts<=? ORDER BY ts",
                               (t["symbol"], (t.get("opened_at") or 0) - 60_000, t.get("closed_at") or now_ms()))
            stop_history = [(e["ts"], e["stop_loss"]) for e in ev if e["stop_loss"]]
        if candles is None and t.get("opened_at") and t.get("status") == "closed" and t.get("source") != "demo":
            candles = await self.candles_between(t["symbol"], t["opened_at"], t["closed_at"])
        prior = 0
        if t.get("opened_at"):
            prior = R.losses_on_day([x for x in self.db.trades("taken=1") if x["id"] != tid], R.utc_day(t["opened_at"]), before_ms=t["opened_at"])
        viol = R.evaluate_trade(t, th=th, equity_at_entry=self.equity_at(t.get("opened_at")), stop_history=stop_history,
                                plan=plan, prior_losses_today=prior, logged_at=t.get("reviewed_at"),
                                candles_after_entry=[k for k in (candles or []) if k["t"] >= (t.get("opened_at") or 0) - 15 * 60_000][1:] if candles else None)
        if t.get("source") == "demo":
            viol = t.get("violations") or viol
        dismissed = {v["code"]: v for v in t.get("violations") or [] if v.get("dismissed")}
        for v in viol:
            if v["code"] in dismissed:
                v["dismissed"] = True
                v["dismiss_reason"] = dismissed[v["code"]].get("dismiss_reason")
        active = [v for v in viol if not v.get("dismissed")]
        complete = bool(t.get("setup") and t.get("grade") and t.get("pen_atr") is not None and
                        t.get("candles_to_reclaim") is not None and t.get("oi_confirmed") in ("Yes", "No"))
        auto_follow = R.followed_plan(active)
        followed = t.get("followed_plan")
        if auto_follow == "No":
            followed = "No"
        elif not followed:
            followed = "Yes" if t.get("status") == "closed" else None
        upd = {"risk_usd": t.get("risk_usd"), "net_pnl": t.get("net_pnl"), "r": t.get("r"), "liq_buffer": t.get("liq_buffer"),
               "violations": viol, "process_score": R.process_score(active, complete) if t.get("status") == "closed" else None,
               "followed_plan": followed}
        self.db.update_trade(tid, upd)
        # XP (only for reviewed, closed trades)
        if t.get("reviewed_at") and t.get("status") == "closed":
            ts = t["reviewed_at"]
            G.award(self.db, "journal_complete", f"journal:{tid}", ref=f"trade:{tid}", ts=ts)
            lag = ts - (t.get("closed_at") or ts)
            if 0 <= lag <= th["log_within_minutes"] * 60_000:
                G.award(self.db, "fresh_log", f"fresh:{tid}", ref=f"trade:{tid}", ts=ts)
            elif lag <= 60 * 60_000:
                G.award(self.db, "late_log_hour", f"fresh:{tid}", ref=f"trade:{tid}", ts=ts)
            if complete:
                G.award(self.db, "calibration", f"calib:{tid}", ref=f"trade:{tid}", ts=ts)
            if followed == "Yes":
                G.award(self.db, "clean_trade", f"clean:{tid}", ref=f"trade:{tid}", ts=ts)
                G.revoke(self.db, f"viol:{tid}")
            else:
                G.revoke(self.db, f"clean:{tid}")
                n_major = sum(1 for v in active if v["severity"] == "major")
                if n_major:
                    G.award(self.db, "violation_major", f"viol:{tid}", ref=f"trade:{tid}", xp=G.XP["violation_major"] * n_major, ts=ts)
        self._after_xp_soon()
        t = self.db.trade(tid)
        await self.push("trade", t)
        return t

    def _after_xp_soon(self) -> None:
        """Badges, level and streaks re-read the whole journal. A journal sync evaluates every trade in
        turn, and running this after each one froze the app for a minute on a long journal (the cost grew
        with the square of the trade count). Batch it: once, a moment after the last change."""
        if self.__dict__.get("_xp_pending"):
            return
        self._xp_pending = True

        async def later():
            try:
                await asyncio.sleep(1.0)
            finally:
                self._xp_pending = False
            self._after_xp_soon()
        self._spawn(later())

    async def _after_xp(self) -> None:
        for b in G.check_badges(self.db):
            await self.push("badge", b)
            await self.coach.say("praise", f"Badge unlocked: {b['name']}", b["desc"], key=f"badge:{b['code']}")
        await self.push("game", {"level": G.level_for(G.total_xp(self.db)), "streaks": G.streaks(self.db)})

    async def after_trade_change(self, tid: int) -> None:
        await self.evaluate(tid)

    async def live_checks(self, tid: int, pos: dict) -> None:
        t = self.db.trade(tid)
        if not t:
            return
        th = self.th()
        age = now_ms() - (t.get("opened_at") or now_ms())
        if not pos.get("stop") and age > 60_000:
            await self.coach.say("alert", f"{t['symbol']}: NO STOP ON THE EXCHANGE",
                                 "Rule 2. Put the stop a few ticks beyond the trap's extreme wick. Now.", rule=2, key=f"nostop:{tid}")
        entry, stop = t.get("entry"), pos.get("stop") or t.get("stop")
        if entry and stop and pos.get("liq"):
            buf = abs(entry - pos["liq"]) / abs(entry - stop) if entry != stop else None
            if buf is not None and buf < th["liq_buffer_min"]:
                await self.coach.say("alert", f"{t['symbol']}: liquidation too close",
                                     f"Liquidation is {buf:.2f} stop widths away (rule 3 needs {th['liq_buffer_min']:g}). Reduce leverage.",
                                     rule=3, key=f"liq:{tid}")
        # stop widened?
        ev = self.db.query("SELECT ts, stop_loss FROM stop_events WHERE symbol=? AND ts>=? ORDER BY ts", (t["symbol"], (t.get("opened_at") or 0) - 60_000))
        stops = [e["stop_loss"] for e in ev if e["stop_loss"]]
        long = t["direction"] == "Long"
        for a, b in zip(stops, stops[1:]):
            if (long and b < a) or (not long and b > a):
                await self.coach.say("alert", f"{t['symbol']}: you moved the stop AWAY from entry",
                                     f"{a:g} -> {b:g}. Rule 7: never widen a stop. Put it back.", rule=7, key=f"widen:{tid}:{b}")
        # risk check
        eq = self.equity_at(t.get("opened_at"))
        if entry and stop and t.get("initial_qty") and eq:
            risk = abs(entry - stop) * t["initial_qty"]
            if risk > eq * th["risk_pct"] / 100 * (1 + th["risk_tolerance_pct"] / 100):
                await self.coach.say("alert", f"{t['symbol']}: risking {risk / eq * 100:.2f}% of equity",
                                     f"Rule 1 caps risk at {th['risk_pct']:g}%. Size comes from the stop.", rule=1, key=f"risk:{tid}")
        # candle four
        n = th["no_expansion_candles"]
        if entry and stop and age >= (n + 1) * 15 * 60_000:
            candles = await self.candles_between(t["symbol"], t["opened_at"], now_ms())
            after = [k for k in candles if k["t"] >= (t["opened_at"] - t["opened_at"] % (15 * 60_000)) + 15 * 60_000][:n]
            if len(after) >= n:
                d = abs(entry - stop)
                mfe = max(((k["h"] - entry) if long else (entry - k["l"])) for k in after) / d
                if mfe < 0.5:
                    await self.coach.say("warn", f"{t['symbol']}: candle {n}, no expansion",
                                         f"Best excursion only +{mfe:.2f}R. Rule 6: exit at or near breakeven. Rule, not judgment.",
                                         rule=6, key=f"c4:{tid}")
        # add-on protocol: more than initial qty while stop still at risk > 1R
        if pos.get("size") and t.get("initial_qty") and pos["size"] > t["initial_qty"] * 1.01 and stop and pos.get("entry"):
            worst = abs(pos["entry"] - stop) * pos["size"] if ((long and stop < pos["entry"]) or (not long and stop > pos["entry"])) else 0
            one_r = abs(entry - (t.get("stop") or stop)) * t["initial_qty"]
            if one_r and worst > one_r * 1.05:
                await self.coach.say("alert", f"{t['symbol']}: add-on without moving the stop",
                                     f"Total risk is {worst / one_r:.2f}R. Rule 13: move the stop first so total risk never exceeds 1R.",
                                     rule=13, key=f"addrisk:{tid}:{round(pos['size'], 6)}")

    # ------------------------------------------------------------------ periodic
    async def _periodic(self) -> None:
        last_state = None
        while True:
            try:
                st = self.session_status()
                if st["status"] != last_state:
                    if last_state is not None and st["status"] == "stand_down":
                        await self.coach.say("warn", "Session: STAND DOWN",
                                             " ".join(r["text"] for r in st["reasons"][:2]), key=f"sess:{st['day']}:{st['status']}")
                    last_state = st["status"]
                    await self.push("session", st)
                self._honor_plans()
                self._day_end_awards()
                try:
                    await self._learning_tick()
                except Exception:  # noqa: BLE001  (learning never stops the app)
                    log.exception("learning")
                await self._after_xp()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("periodic")
            await asyncio.sleep(30)

    def _honor_plans(self) -> None:
        cutoff = now_ms() - 60 * 60_000
        for p in self.db.query("SELECT * FROM plans WHERE status='open' AND created_at<?", (cutoff,)):
            if p["verdict"] != "GO":
                self.db.execute("UPDATE plans SET status='honored' WHERE id=?", (p["id"],))
                G.award(self.db, "honored_no_go", f"nogo:{p['id']}", ref=f"plan:{p['id']}", note=f"{p['symbol']} NO TRADE honored")
            else:
                self.db.execute("UPDATE plans SET status='expired' WHERE id=?", (p["id"],))

    def _day_end_awards(self) -> None:
        th = self.th()
        yday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
        if self._flags.get("day_end") == yday:
            return
        self._flags["day_end"] = yday
        trades = [t for t in self.db.trades("taken=1") if t.get("opened_at") and R.utc_day(t["opened_at"]) == yday]
        checked = self.db.one("SELECT 1 AS x FROM checkins WHERE day=?", (yday,))
        if checked and not trades:
            G.award(self.db, "quiet_day", f"quiet:{yday}", xp=20, note="Sat on hands")
