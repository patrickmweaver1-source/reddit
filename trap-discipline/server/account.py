"""Private account sync (read-only): executions, positions, stops, wallet.

Turns exchange activity into journal rows automatically and feeds the coach's
live rule checks.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from . import rules as R
from . import trades as T
from .bybit import BybitREST, BybitWS, PRIVATE_TOPICS, evaluate_key_info
from .db import DB, now_ms

log = logging.getLogger("trap.account")
DAY = 86_400_000
WEEK = 7 * DAY


def _f(x: Any, default: float | None = None) -> float | None:
    try:
        if x in (None, ""):
            return default
        return float(x)
    except (TypeError, ValueError):
        return default


def norm_exec(e: dict) -> dict:
    return {
        "exec_id": str(e["execId"]), "order_id": e.get("orderId"), "symbol": e["symbol"], "side": e["side"],
        "price": _f(e.get("execPrice"), 0.0), "qty": _f(e.get("execQty"), 0.0), "fee": _f(e.get("execFee"), 0.0),
        "exec_type": e.get("execType") or "Trade", "exec_time": int(e.get("execTime") or 0),
        "closed_size": _f(e.get("closedSize"), 0.0), "is_maker": 1 if e.get("isMaker") in (True, "true", 1) else 0,
        "order_type": e.get("orderType"), "stop_order_type": e.get("stopOrderType"), "create_type": e.get("createType"),
    }


class AccountSync:
    def __init__(self, app: Any, rest: BybitREST):
        self.app = app
        self.db: DB = app.db
        self.rest = rest
        self.ws: BybitWS | None = None
        self.positions: dict[str, dict] = {}
        self.wallet: dict = {}
        self.key: dict = {}
        self.fee: dict = {}
        self.status = "idle"
        self.last_error: str | None = None
        self._tasks: list[asyncio.Task] = []
        self._last_stop: dict[str, float | None] = {}
        self._rebuild_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    async def verify_key(self) -> dict:
        info = await self.rest.key_info()
        self.key = evaluate_key_info(info)
        return self.key

    async def start(self) -> None:
        self.status = "verifying"
        try:
            await self.rest.sync_time()
            k = await self.verify_key()
            if not k["ok"]:
                self.status = "rejected"
                self.last_error = " ".join(k["problems"])
                await self.app.coach.say("alert", "API key refused", self.last_error, key=f"keyrefused:{int(time.time()//3600)}")
                return
            self.status = "backfilling"
            await self.refresh_fee()
            await self.refresh_wallet()
            await self.refresh_positions()
            days = int(self.app.settings().get("backfill_days", 30))
            await self.backfill(days)
            self.status = "live"
        except Exception as exc:  # noqa: BLE001
            self.status = "error"
            self.last_error = str(exc)[:300]
            log.exception("account start failed")
        self.ws = BybitWS(self.app.http, self.app.cfg_ws_private, list(PRIVATE_TOPICS), self._on_ws,
                          api_key=self.rest.api_key, api_secret=self.rest.api_secret, name="private")
        self.ws.start()
        self._tasks.append(asyncio.create_task(self._poll_loop(), name="account-poll"))

    async def stop(self) -> None:
        if self.ws:
            await self.ws.stop()
        for t in self._tasks:
            t.cancel()
        self._tasks.clear()

    # ------------------------------------------------------------------
    async def refresh_fee(self) -> None:
        try:
            res = await self.rest.get_private("/v5/account/fee-rate", {"category": "linear", "symbol": self.app.settings()["watchlist"][0]})
            lst = res.get("list") or []
            if lst:
                self.fee = {"taker_pct": _f(lst[0].get("takerFeeRate"), 0) * 100, "maker_pct": _f(lst[0].get("makerFeeRate"), 0) * 100}
                self.app.set_setting("taker_fee_pct", self.fee["taker_pct"])
                self.app.set_setting("maker_fee_pct", self.fee["maker_pct"])
        except Exception as exc:  # noqa: BLE001
            log.warning("fee-rate: %s", exc)

    async def refresh_wallet(self) -> None:
        res = await self.rest.get_private("/v5/account/wallet-balance", {"accountType": "UNIFIED"})
        lst = res.get("list") or []
        if lst:
            w = lst[0]
            self.wallet = {"equity": _f(w.get("totalEquity")), "wallet": _f(w.get("totalWalletBalance")),
                           "available": _f(w.get("totalAvailableBalance")), "upl": _f(w.get("totalPerpUPL")),
                           "im": _f(w.get("totalInitialMargin")), "mm": _f(w.get("totalMaintenanceMargin")),
                           "ts": now_ms()}
            hist = self.db.get("equity_hist", [])
            if not hist or now_ms() - hist[-1][0] > 5 * 60_000:
                hist.append([now_ms(), self.wallet["equity"]])
                self.db.set("equity_hist", hist[-5000:])

    async def refresh_positions(self) -> None:
        rows = await self.rest.paged("/v5/position/list", {"category": "linear", "settleCoin": "USDT", "limit": 200}, private=True, max_pages=5)
        seen = set()
        for p in rows:
            await self._on_position(p, source="rest")
            seen.add(p["symbol"])
        for sym in list(self.positions):
            if sym not in seen:
                self.positions.pop(sym, None)

    async def backfill(self, days: int) -> None:
        end = now_ms()
        start = end - days * DAY
        t = start
        n_exec = 0
        while t < end:
            t1 = min(t + WEEK - 1, end)
            rows = await self.rest.paged("/v5/execution/list", {"category": "linear", "startTime": t, "endTime": t1, "limit": 100}, private=True, max_pages=50)
            for e in rows:
                if self._insert_exec(norm_exec(e)):
                    n_exec += 1
            for flt in ("StopOrder", "tpslOrder"):
                try:
                    orows = await self.rest.paged("/v5/order/history", {"category": "linear", "startTime": t, "endTime": t1, "limit": 50, "orderFilter": flt}, private=True, max_pages=20)
                    for o in orows:
                        self._record_order(o)
                except Exception as exc:  # noqa: BLE001
                    log.info("order history %s: %s", flt, exc)
            # leverage from closed PnL
            try:
                cp = await self.rest.paged("/v5/position/closed-pnl", {"category": "linear", "startTime": t, "endTime": t1, "limit": 100}, private=True, max_pages=20)
                lev = self.db.get("closed_pnl_leverage", {})
                for c in cp:
                    lev[f"{c['symbol']}:{c.get('orderId')}"] = _f(c.get("leverage"))
                self.db.set("closed_pnl_leverage", lev)
            except Exception as exc:  # noqa: BLE001
                log.info("closed pnl: %s", exc)
            t = t1 + 1
        self.db.raw("bybit", "backfill_done", {"days": days, "new_executions": n_exec})
        await self.rebuild()

    # ------------------------------------------------------------------
    def _insert_exec(self, e: dict) -> bool:
        cur = self.db.execute(
            "INSERT OR IGNORE INTO executions(exec_id,order_id,symbol,side,price,qty,fee,exec_type,exec_time,closed_size,is_maker,order_type,stop_order_type,create_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (e["exec_id"], e["order_id"], e["symbol"], e["side"], e["price"], e["qty"], e["fee"], e["exec_type"],
             e["exec_time"], e["closed_size"], e["is_maker"], e["order_type"], e["stop_order_type"], e["create_type"]),
        )
        return cur.rowcount > 0

    def _record_stop(self, symbol: str, ts: int, stop: float | None, source: str) -> None:
        last = self._last_stop.get(symbol, "unset")
        if last != "unset" and last == stop:
            return
        self._last_stop[symbol] = stop
        self.db.execute("INSERT INTO stop_events(symbol,ts,stop_loss,source) VALUES(?,?,?,?)", (symbol, ts, stop, source))

    def _record_order(self, o: dict) -> None:
        sot = o.get("stopOrderType") or ""
        self.db.execute(
            "INSERT OR REPLACE INTO orders(order_id,symbol,side,order_type,status,stop_order_type,trigger_price,stop_loss,take_profit,create_type,reduce_only,qty,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (o.get("orderId"), o.get("symbol"), o.get("side"), o.get("orderType"), o.get("orderStatus"), sot,
             _f(o.get("triggerPrice")), _f(o.get("stopLoss")), _f(o.get("takeProfit")), o.get("createType"),
             1 if o.get("reduceOnly") in (True, "true") else 0, _f(o.get("qty")), int(o.get("createdTime") or 0), int(o.get("updatedTime") or 0)),
        )
        if sot in ("StopLoss", "PartialStopLoss") and _f(o.get("triggerPrice")):
            ts = int(o.get("updatedTime") or o.get("createdTime") or now_ms())
            exists = self.db.one("SELECT 1 AS x FROM stop_events WHERE symbol=? AND ts=? AND stop_loss=?", (o["symbol"], ts, _f(o.get("triggerPrice"))))
            if not exists:
                self.db.execute("INSERT INTO stop_events(symbol,ts,stop_loss,source) VALUES(?,?,?,?)",
                                (o["symbol"], ts, _f(o.get("triggerPrice")), "order"))

    async def _on_position(self, p: dict, source: str = "ws") -> None:
        sym = p.get("symbol")
        if not sym:
            return
        size = _f(p.get("size"), 0) or 0
        ts = int(p.get("updatedTime") or now_ms())
        if size > 0:
            self.positions[sym] = {
                "symbol": sym, "side": p.get("side"), "size": size,
                "entry": _f(p.get("avgPrice")) or _f(p.get("entryPrice")), "mark": _f(p.get("markPrice")),
                "leverage": _f(p.get("leverage")), "liq": _f(p.get("liqPrice")), "stop": _f(p.get("stopLoss")) or None,
                "tp": _f(p.get("takeProfit")) or None, "upl": _f(p.get("unrealisedPnl")), "value": _f(p.get("positionValue")),
                "updated": ts,
            }
            self._record_stop(sym, ts, _f(p.get("stopLoss")) or None, f"position-{source}")
        else:
            self.positions.pop(sym, None)
            self._last_stop[sym] = "unset"  # type: ignore[assignment]
        await self.app.push("positions", list(self.positions.values()))

    async def _on_ws(self, msg: dict) -> None:
        topic = msg.get("topic", "")
        data = msg.get("data") or []
        if topic.startswith("execution"):
            self.db.raw("bybit-ws", "execution", data)
            new = False
            for e in data:
                new |= self._insert_exec(norm_exec(e))
            if new:
                await self.rebuild({e["symbol"] for e in data})
        elif topic.startswith("position"):
            for p in data:
                await self._on_position(p)
            await self.update_open_trades()
        elif topic.startswith("order"):
            for o in data:
                self._record_order(o)
        elif topic.startswith("wallet"):
            for w in data:
                if w.get("accountType") == "UNIFIED":
                    self.wallet.update({"equity": _f(w.get("totalEquity")), "wallet": _f(w.get("totalWalletBalance")),
                                        "available": _f(w.get("totalAvailableBalance")), "ts": now_ms()})

    async def _poll_loop(self) -> None:
        n = 0
        while True:
            await asyncio.sleep(10)
            n += 1
            try:
                ws_ok = bool(self.ws and self.ws.connected)
                if not ws_ok or n % 3 == 0:
                    await self.refresh_positions()
                    await self.update_open_trades()
                if n % 6 == 0:
                    await self.refresh_wallet()
                if n % 12 == 0 or not ws_ok:
                    t0 = now_ms() - DAY
                    rows = await self.rest.paged("/v5/execution/list", {"category": "linear", "startTime": t0, "endTime": now_ms(), "limit": 100}, private=True, max_pages=10)
                    new = False
                    for e in rows:
                        new |= self._insert_exec(norm_exec(e))
                    if new:
                        await self.rebuild()
                if n % 360 == 0:
                    await self.refresh_fee()
                if self.status == "error":
                    self.status = "live"
                self.last_error = None
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                self.last_error = str(exc)[:300]
                log.warning("account poll: %s", exc)

    # ------------------------------------------------------------------
    def equity_at(self, ts: int | None) -> float | None:
        hist = self.db.get("equity_hist", [])
        best = None
        for t, eq in hist:
            if ts and t <= ts + 5 * 60_000:
                best = eq
        if best is not None:
            return best
        cur = self.wallet.get("equity")
        if cur is None or ts is None:
            return self.app.settings().get("starting_equity")
        later = self.db.one("SELECT COALESCE(SUM(net_pnl),0) AS s FROM trades WHERE taken=1 AND closed_at>?", (ts,))["s"]
        return cur - later

    async def rebuild(self, symbols: set[str] | None = None) -> None:
        async with self._rebuild_lock:
            where = "exec_type IS NOT NULL"
            params: list = []
            if symbols:
                where += f" AND symbol IN ({','.join('?' for _ in symbols)})"
                params = list(symbols)
            rows = self.db.query(f"SELECT * FROM executions WHERE {where} ORDER BY exec_time", params)
            recon = T.reconstruct(rows)
            for tr in recon:
                await self._upsert(tr)

    async def _upsert(self, tr: dict) -> None:
        existing = self.db.one("SELECT id FROM trades WHERE source='bybit' AND symbol=? AND opened_at=?", (tr["symbol"], tr["opened_at"]))
        date, tm = T.utc_parts(tr["opened_at"])
        auto = {
            "symbol": tr["symbol"], "direction": tr["direction"], "taken": 1, "source": "bybit",
            "status": tr["status"], "opened_at": tr["opened_at"], "closed_at": tr["closed_at"],
            "date": date, "time_utc": tm, "entry": tr["entry"], "exit": tr["exit"], "qty": tr["qty"],
            "initial_qty": tr["initial_qty"], "fees": tr["fees"], "funding": tr["funding"],
            "gross_pnl": tr["gross_pnl"], "net_pnl": tr["net_pnl"], "legs": tr["legs"],
        }
        is_new = existing is None
        if is_new:
            tid = self.db.insert_trade(auto)
            await self._on_open(tid)
        else:
            tid = existing["id"]
            before = self.db.trade(tid)
            self.db.update_trade(tid, auto)
            if before and before["status"] == "open" and tr["status"] == "closed":
                await self._on_close(tid)
        if tr["exec_ids"]:
            self.db.execute(f"UPDATE executions SET trade_id=? WHERE exec_id IN ({','.join('?' for _ in tr['exec_ids'])})", [tid, *tr["exec_ids"]])
        if is_new and tr["status"] == "closed":
            await self._on_close(tid, backfilled=True)
        try:
            await self.enrich(tid)
        except Exception:  # noqa: BLE001  (one odd trade must not stop the whole journal sync)
            log.exception("enrich failed for trade %s", tid)

    async def _on_open(self, tid: int) -> None:
        t = self.db.trade(tid)
        if not t:
            return
        if now_ms() - (t.get("opened_at") or 0) < 30 * 60_000:
            self.app.attach_context(tid)
        # match a checklist plan from the last 90 minutes
        plan = self.db.one(
            "SELECT * FROM plans WHERE symbol=? AND status='open' AND created_at>=? AND created_at<=? ORDER BY created_at DESC",
            (t["symbol"], (t["opened_at"] or now_ms()) - 90 * 60_000, (t["opened_at"] or now_ms()) + 60_000))
        if plan and (plan.get("direction") in (None, t["direction"])):
            chk = json.loads(plan["checklist"])
            self.db.execute("UPDATE plans SET status='matched', trade_id=? WHERE id=?", (tid, plan["id"]))
            prefill = {"plan_id": plan["id"], "setup": plan.get("setup"), "grade": plan.get("grade"),
                       "pen_atr": chk.get("pen_atr"), "candles_to_reclaim": chk.get("candles_to_reclaim"),
                       "oi_confirmed": chk.get("oi_confirmed")}
            self.db.update_trade(tid, {k: v for k, v in prefill.items() if v is not None})
            if plan["verdict"] != "GO":
                await self.app.coach.say("alert", "Entered against a NO TRADE verdict",
                                         f"The checklist for {t['symbol']} said NO TRADE. Rule 8: both gates must pass. Consider flattening.",
                                         rule=8, key=f"nogo:{tid}")
        elif now_ms() - (t["opened_at"] or 0) < 10 * 60_000:
            await self.app.coach.say("warn", f"{t['symbol']} position with no checklist",
                                     "No pre-trade checklist in the last 90 minutes. Run it now and be honest about the grade.",
                                     key=f"nochk:{tid}")

    async def _on_close(self, tid: int, backfilled: bool = False) -> None:
        t = self.db.trade(tid)
        if not t:
            return
        if not backfilled and now_ms() - (t.get("closed_at") or 0) < 30 * 60_000:
            await self.app.coach.say("warn", f"{t['symbol']} closed. Log it now.",
                                     "You have 10 minutes for the fresh-log bonus. Fill the three orange calibration fields first.",
                                     rule=12, key=f"log:{tid}", ref=f"trade:{tid}")
        await self.app.after_trade_change(tid)

    # ------------------------------------------------------------------
    async def enrich(self, tid: int) -> None:
        """Attach stops, leverage, liquidation, MFE/MAE, metrics and rule findings."""
        t = self.db.trade(tid)
        if not t or not t.get("opened_at"):
            return
        t0 = t["opened_at"] - 60_000
        t1 = t.get("closed_at") or now_ms()
        ev = self.db.query("SELECT ts, stop_loss FROM stop_events WHERE symbol=? AND ts>=? AND ts<=? ORDER BY ts", (t["symbol"], t0, t1))
        hist = [(e["ts"], e["stop_loss"]) for e in ev if e["stop_loss"]]
        upd: dict = {}
        if not t.get("stop") and hist:
            upd["stop"] = hist[0][1]
        pos = self.positions.get(t["symbol"])
        if t["status"] == "open" and pos:
            if pos.get("leverage"):
                upd["leverage"] = pos["leverage"]
            if pos.get("liq") and not t.get("liq_price"):
                upd["liq_price"] = pos["liq"]
        if not t.get("leverage") and not upd.get("leverage"):
            levmap = self.db.get("closed_pnl_leverage", {})
            for lg in t.get("legs") or []:
                v = levmap.get(f"{t['symbol']}:{lg.get('order_id')}")
                if v:
                    upd["leverage"] = v
                    break
        if upd:
            self.db.update_trade(tid, upd)
            t = self.db.trade(tid)
        # MFE / MAE and candles for rule 6
        candles = await self.app.candles_between(t["symbol"], t["opened_at"], t.get("closed_at") or now_ms())
        d = abs((t.get("entry") or 0) - (t.get("stop") or 0))
        if candles and t.get("entry") and t.get("stop") and d > 0:     # stop at entry (breakeven) has no R
            long = t["direction"] == "Long"
            mfe = max(((k["h"] - t["entry"]) if long else (t["entry"] - k["l"])) for k in candles) / d
            mae = min(((k["l"] - t["entry"]) if long else (t["entry"] - k["h"])) for k in candles) / d
            self.db.update_trade(tid, {"max_fav_r": mfe, "max_adv_r": mae})
            t = self.db.trade(tid)
        await self.app.evaluate(tid, stop_history=hist, candles=candles)

    async def update_open_trades(self) -> None:
        for t in self.db.trades("status='open' AND source='bybit'"):
            pos = self.positions.get(t["symbol"])
            if not pos:
                continue
            upd = {}
            if pos.get("leverage") and pos["leverage"] != t.get("leverage"):
                upd["leverage"] = pos["leverage"]
            if pos.get("liq") and pos["liq"] != t.get("liq_price"):
                upd["liq_price"] = pos["liq"]
            if pos.get("stop") and not t.get("stop"):
                upd["stop"] = pos["stop"]
            if upd:
                self.db.update_trade(t["id"], upd)
            await self.app.live_checks(t["id"], pos)
