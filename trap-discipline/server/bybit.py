"""Read-only Bybit V5 client.

Safety design (the most important invariant of the whole app):
  * The only HTTP verb this module can send is GET. There is no code path that
    builds a POST, PUT or DELETE request.
  * Every path must be on an explicit allowlist of read endpoints. Anything
    else raises ReadOnlyViolation before a socket is opened.
  * The private WebSocket may only send the ops "auth", "subscribe" and
    "ping". Order-entry ops are rejected locally.
  * The API key itself must report readOnly == 1 from /v5/user/query-api and
    must not carry withdrawal permission, or the app refuses to store it.
"""
from __future__ import annotations

import asyncio
import contextvars
import hashlib
import hmac
import json
import logging
import random
import time
from typing import Any, Awaitable, Callable
from urllib.parse import urlencode

import aiohttp

from . import config

log = logging.getLogger("trap.bybit")

PUBLIC_GET = frozenset({
    "/v5/market/time",
    "/v5/market/kline",
    "/v5/market/open-interest",
    "/v5/market/funding/history",
    "/v5/market/tickers",
    "/v5/market/instruments-info",
    "/v5/market/account-ratio",
    "/v5/market/recent-trade",
})
PRIVATE_GET = frozenset({
    "/v5/user/query-api",
    "/v5/position/list",
    "/v5/execution/list",
    "/v5/position/closed-pnl",
    "/v5/order/history",
    "/v5/order/realtime",
    "/v5/account/wallet-balance",
    "/v5/account/fee-rate",
})
WS_ALLOWED_OPS = frozenset({"auth", "subscribe", "ping"})

# Set by request handlers a person is waiting on (a chart, the market panel). Background
# work (auto-tune history, journal backfill, the market loop) steps aside while any such
# request is waiting for its turn, so a page never queues behind a long download.
INTERACTIVE: contextvars.ContextVar[bool] = contextvars.ContextVar("bybit_interactive", default=False)
PACE_S = 0.05     # about 20 requests a second, a sixth of Bybit's 600 per 5 seconds per IP
HEDGE_S = 2.5     # a public read slower than this for a waiting page gets one duplicate request
PRIVATE_TOPICS = ("position", "execution", "order", "wallet")


class ReadOnlyViolation(RuntimeError):
    """Raised if anything tries to leave the read-only envelope."""


class BybitError(RuntimeError):
    def __init__(self, code: int, msg: str, path: str = ""):
        super().__init__(f"Bybit {path} error {code}: {msg}")
        self.code = code
        self.msg = msg
        self.path = path


def sign(secret: str, payload: str) -> str:
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def evaluate_key_info(info: dict) -> dict:
    """Decide whether a key is acceptable. Pure function (tested)."""
    perms = info.get("permissions") or {}
    wallet = perms.get("Wallet") or []
    read_only = int(info.get("readOnly", 0) or 0) == 1
    withdraw = "Withdraw" in wallet
    problems = []
    if not read_only:
        problems.append("This key has Read-Write access. Create a new key with 'Read-Only' selected.")
    if withdraw:
        problems.append("This key has Withdraw permission. Remove it; the app never needs it.")
    return {
        "ok": read_only and not withdraw,
        "read_only": read_only,
        "withdraw": withdraw,
        "problems": problems,
        "ips": info.get("ips") or [],
        "expires": info.get("expiredAt"),
        "uta": info.get("uta"),
        "permissions": perms,
        "note": info.get("note", ""),
    }


class BybitREST:
    def __init__(self, session: aiohttp.ClientSession, api_key: str | None = None,
                 api_secret: str | None = None, base: str | None = None):
        self.session = session
        self.api_key = api_key
        self.api_secret = api_secret
        self.base = (base or config.BYBIT_REST).rstrip("/")
        self.recv_window = 10000
        self.time_offset_ms = 0
        self._last_sync = 0.0
        self._next_slot = 0.0
        self._hi_waiting = 0
        self.last_error: str | None = None

    @property
    def has_keys(self) -> bool:
        return bool(self.api_key and self.api_secret)

    async def sync_time(self) -> None:
        t0 = time.time()
        data = await self._get("/v5/market/time", {}, private=False)
        t1 = time.time()
        if data.get("timeNano"):
            server_ms = int(data["timeNano"]) // 1_000_000
        elif data.get("timeSecond"):
            server_ms = int(data["timeSecond"]) * 1000
        else:
            server_ms = None
        if server_ms:
            local_mid = int((t0 + t1) / 2 * 1000)
            # Bybit accepts server_time - recv_window <= timestamp < server_time + 1000, so aim a
            # little behind the server rather than risk landing in the future.
            self.time_offset_ms = server_ms - local_mid - 300
            if abs(self.time_offset_ms) > 5000:
                log.warning("This computer's clock is %.0f seconds %s Bybit's. The app corrects for it, "
                            "but syncing the Windows clock is a good idea.", abs(self.time_offset_ms) / 1000,
                            "behind" if self.time_offset_ms > 0 else "ahead of")
        self._last_sync = time.time()

    def _ts(self) -> int:
        return int(time.time() * 1000) + self.time_offset_ms

    async def _wait_turn(self) -> None:
        """Pace requests far below Bybit's 600 per 5 seconds per IP, so a journal rebuild or a
        long chart lookback never trips a limit or a ban. Requests a person is waiting on go first."""
        hi = INTERACTIVE.get()
        if hi:
            self._hi_waiting += 1
        else:
            while self._hi_waiting:
                await asyncio.sleep(0.05)
        try:
            now = time.monotonic()
            slot = max(now, self._next_slot)       # reserve a slot (no await in between: single event loop)
            self._next_slot = slot + PACE_S
            if slot > now:
                await asyncio.sleep(slot - now)
        finally:
            if hi:
                self._hi_waiting -= 1

    async def get_public(self, path: str, params: dict | None = None) -> dict:
        return await self._get(path, params or {}, private=False)

    async def get_private(self, path: str, params: dict | None = None) -> dict:
        if not self.has_keys:
            raise BybitError(-1, "No API key connected", path)
        if time.time() - self._last_sync > 600:
            try:
                await self.sync_time()
            except Exception as exc:  # noqa: BLE001
                log.warning("time sync failed: %s", exc)
        return await self._get(path, params or {}, private=True)

    async def _get(self, path: str, params: dict, private: bool) -> dict:
        allow = PRIVATE_GET if private else PUBLIC_GET
        if path not in allow:
            raise ReadOnlyViolation(f"Endpoint not on the read-only allowlist: {path}")
        clean = {k: v for k, v in params.items() if v is not None and v != ""}
        qs = urlencode(clean)
        url = f"{self.base}{path}" + (f"?{qs}" if qs else "")
        for attempt in range(4):
            headers = {"User-Agent": f"{config.APP_NAME}/{config.APP_VERSION}"}
            if private:
                # signed fresh on every attempt: a retry must never resend an old timestamp
                ts = str(self._ts())
                rw = str(self.recv_window)
                headers.update({
                    "X-BAPI-API-KEY": self.api_key or "",
                    "X-BAPI-TIMESTAMP": ts,
                    "X-BAPI-RECV-WINDOW": rw,
                    "X-BAPI-SIGN": sign(self.api_secret or "", ts + (self.api_key or "") + rw + qs),
                })
            await self._wait_turn()
            reset_ms = None
            try:
                if not private and INTERACTIVE.get():
                    body, reset_ms = await self._hedged(url, headers, path)
                else:
                    body, reset_ms = await self._fetch(url, headers, path)
            except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as exc:
                self.last_error = f"Network error: {exc.__class__.__name__}"
                if attempt >= 2:
                    raise BybitError(-2, self.last_error, path) from exc
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            except BybitError as exc:
                if exc.code >= 500 and attempt < 3:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                raise
            code = int(body.get("retCode", -1))
            if code != 0:
                self.last_error = f"{code}: {body.get('retMsg')}"
                if code == 10002 and private and attempt < 3:  # clock drifted: re-sync, then re-sign
                    await self.sync_time()
                    continue
                if code == 10006 and attempt < 3:              # per-endpoint rate limit: wait for the reset
                    wait = 1.0 * (attempt + 1)
                    try:
                        if reset_ms:
                            wait = min(5.0, max(0.2, int(reset_ms) / 1000 - time.time()))
                    except ValueError:
                        pass
                    log.info("Bybit rate limit on %s; waiting %.1fs", path, wait)
                    await asyncio.sleep(wait)
                    continue
                raise BybitError(code, str(body.get("retMsg")), path)
            self.last_error = None
            return body.get("result") or {}
        raise BybitError(-3, "exhausted retries", path)

    async def _fetch(self, url: str, headers: dict, path: str) -> tuple[dict, str | None]:
        async with self.session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status == 403:
                text = (await resp.text())[:200]
                self.last_error = "HTTP 403 from Bybit (access denied: IP/region block or rate-limit ban)."
                raise BybitError(403, self.last_error + " " + text, path)
            if resp.status >= 500:
                raise BybitError(resp.status, f"HTTP {resp.status}", path)
            return await resp.json(content_type=None), resp.headers.get("X-Bapi-Limit-Reset-Timestamp")

    async def _hedged(self, url: str, headers: dict, path: str) -> tuple[dict, str | None]:
        """Public data a person is waiting on: if Bybit has not answered in HEDGE_S (a stalled
        connection over a VPN), send the same read once more and take whichever answers first.
        A chart built from many pages otherwise waits on its single slowest page."""
        tasks = [asyncio.ensure_future(self._fetch(url, headers, path))]
        try:
            done, _ = await asyncio.wait(tasks, timeout=HEDGE_S)
            if done:
                return tasks[0].result()
            await self._wait_turn()
            tasks.append(asyncio.ensure_future(self._fetch(url, headers, path)))
            pending = set(tasks)
            err: BaseException | None = None
            while pending:
                done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                for t in done:
                    if t.exception() is None:
                        return t.result()
                    err = t.exception()
            raise err  # both failed: the caller's retry handling takes it from here
        finally:
            for t in tasks:
                if not t.done():
                    t.cancel()

    async def paged(self, path: str, params: dict, private: bool, max_pages: int = 20) -> list[dict]:
        out: list[dict] = []
        cursor = None
        for _ in range(max_pages):
            p = dict(params)
            if cursor:
                p["cursor"] = cursor
            res = await (self.get_private(path, p) if private else self.get_public(path, p))
            out.extend(res.get("list") or [])
            cursor = res.get("nextPageCursor")
            if not cursor:
                break
        return out

    # ---- convenience wrappers -------------------------------------------
    async def key_info(self) -> dict:
        return await self.get_private("/v5/user/query-api")

    async def klines(self, symbol: str, interval: str, limit: int = 1000, end: int | None = None, start: int | None = None) -> list[dict]:
        res = await self.get_public("/v5/market/kline", {"category": "linear", "symbol": symbol, "interval": interval, "limit": limit, "end": end, "start": start})
        rows = []
        for r in res.get("list") or []:
            rows.append({"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5]), "q": float(r[6])})
        rows.sort(key=lambda x: x["t"])
        return rows

    async def open_interest(self, symbol: str, interval: str = "15min", limit: int = 200, pages: int = 1,
                            start: int | None = None, end: int | None = None) -> list[dict]:
        rows = await self.paged("/v5/market/open-interest", {"category": "linear", "symbol": symbol, "intervalTime": interval, "limit": limit,
                                                             "startTime": start, "endTime": end}, private=False, max_pages=pages)
        out = [{"t": int(r["timestamp"]), "oi": float(r["openInterest"])} for r in rows]
        out.sort(key=lambda x: x["t"])
        return out

    async def funding_history(self, symbol: str, pages: int = 3, start: int | None = None, end: int | None = None) -> list[dict]:
        out: list[dict] = []
        for _ in range(pages):
            res = await self.get_public("/v5/market/funding/history", {"category": "linear", "symbol": symbol, "limit": 200,
                                                                         "startTime": start if end is not None else None, "endTime": end})
            rows = res.get("list") or []
            if not rows:
                break
            for r in rows:
                out.append({"t": int(r["fundingRateTimestamp"]), "rate": float(r["fundingRate"])})
            oldest = min(int(r["fundingRateTimestamp"]) for r in rows)
            end = oldest - 1
            if len(rows) < 200:
                break
        dedup = {r["t"]: r for r in out}
        return sorted(dedup.values(), key=lambda x: x["t"])

    async def tickers(self, symbol: str | None = None) -> list[dict]:
        res = await self.get_public("/v5/market/tickers", {"category": "linear", "symbol": symbol})
        return res.get("list") or []

    async def instrument(self, symbol: str) -> dict | None:
        res = await self.get_public("/v5/market/instruments-info", {"category": "linear", "symbol": symbol})
        lst = res.get("list") or []
        return lst[0] if lst else None

    async def account_ratio(self, symbol: str, period: str = "1h", limit: int = 100) -> list[dict]:
        res = await self.get_public("/v5/market/account-ratio", {"category": "linear", "symbol": symbol, "period": period, "limit": limit})
        out = [{"t": int(r["timestamp"]), "buy": float(r["buyRatio"]), "sell": float(r["sellRatio"])} for r in res.get("list") or []]
        out.sort(key=lambda x: x["t"])
        return out

    async def recent_trades(self, symbol: str, limit: int = 1000) -> list[dict]:
        res = await self.get_public("/v5/market/recent-trade", {"category": "linear", "symbol": symbol, "limit": limit})
        return res.get("list") or []


WsHandler = Callable[[dict], Awaitable[None]]


class BybitWS:
    """Reconnecting WebSocket with 20s heartbeat. Private mode authenticates first."""

    def __init__(self, session: aiohttp.ClientSession, url: str, topics: list[str], handler: WsHandler,
                 api_key: str | None = None, api_secret: str | None = None, name: str = "ws"):
        self.session = session
        self.url = url
        self.topics = list(topics)
        self.handler = handler
        self.api_key = api_key
        self.api_secret = api_secret
        self.name = name
        self.connected = False
        self.last_msg_at = 0.0
        self.last_error: str | None = None
        self._task: asyncio.Task | None = None
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._stop = False

    def start(self) -> None:
        if not self._task:
            self._task = asyncio.create_task(self._run(), name=f"bybit-{self.name}")

    async def stop(self) -> None:
        self._stop = True
        if self._ws is not None:
            await self._ws.close()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._task = None

    async def _send(self, msg: dict) -> None:
        if msg.get("op") not in WS_ALLOWED_OPS:
            raise ReadOnlyViolation(f"WebSocket op not allowed: {msg.get('op')}")
        assert self._ws is not None
        await self._ws.send_str(json.dumps(msg))

    async def _run(self) -> None:
        backoff = 1.0
        while not self._stop:
            try:
                async with self.session.ws_connect(self.url, heartbeat=None, timeout=aiohttp.ClientWSTimeout(ws_close=10)) as ws:
                    self._ws = ws
                    if self.api_key and self.api_secret:
                        expires = int(time.time() * 1000) + 10000
                        await self._send({"req_id": "auth", "op": "auth", "args": [self.api_key, expires, sign(self.api_secret, f"GET/realtime{expires}")]})
                    for i in range(0, len(self.topics), 10):
                        await self._send({"req_id": f"sub{i}", "op": "subscribe", "args": self.topics[i:i + 10]})
                    self.connected = True
                    self.last_error = None
                    backoff = 1.0
                    pinger = asyncio.create_task(self._ping_loop())
                    try:
                        async for msg in ws:
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                self.last_msg_at = time.time()
                                data = json.loads(msg.data)
                                if data.get("op") == "auth" and not data.get("success"):
                                    self.last_error = f"auth failed: {data.get('ret_msg')}"
                                    log.error("%s %s", self.name, self.last_error)
                                    break
                                if "topic" in data:
                                    try:
                                        await self.handler(data)
                                    except Exception:  # noqa: BLE001
                                        log.exception("%s handler error", self.name)
                            elif msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSED):
                                break
                    finally:
                        pinger.cancel()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                self.last_error = f"{exc.__class__.__name__}: {exc}"[:200]
                log.warning("%s disconnected: %s", self.name, self.last_error)
            self.connected = False
            self._ws = None
            if self._stop:
                break
            await asyncio.sleep(backoff + random.random())
            backoff = min(backoff * 2, 60)

    async def _ping_loop(self) -> None:
        while True:
            await asyncio.sleep(20)
            try:
                await self._send({"req_id": "ping", "op": "ping"})
            except Exception:  # noqa: BLE001
                return
