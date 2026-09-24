"""A mock Bybit V5 exchange for integration tests (REST + public/private WebSocket).

Response shapes follow the official V5 docs. Private requests must carry a valid
HMAC signature, and any non-GET request is rejected loudly (the app must never send one).
Control endpoints (/ctl/*) let a test inject fills, positions and stop changes.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import sys
import time

from aiohttp import web, WSMsgType

sys.path.insert(0, __file__.rsplit("/tests/", 1)[0])
from server.demo import DemoSource  # noqa: E402

KEY, SECRET = "MOCKKEY123", "MOCKSECRET456"
STATE = {"read_only": 1, "withdraw": False, "positions": {}, "executions": [], "orders": [], "equity": 50000.0,
         "private_ws": set(), "public_ws": set(), "non_get": 0, "bad_sig": 0}
demo = DemoSource(seed=11)


def ok(result):
    return web.json_response({"retCode": 0, "retMsg": "OK", "result": result, "retExtInfo": {}, "time": int(time.time() * 1000)})


@web.middleware
async def guard(request, handler):
    if request.path.startswith("/v5/") and request.method != "GET":
        STATE["non_get"] += 1
        return web.json_response({"retCode": 10005, "retMsg": "WRITE ATTEMPT BLOCKED BY MOCK"}, status=403)
    return await handler(request)


def check_sig(request) -> bool:
    k = request.headers.get("X-BAPI-API-KEY"); ts = request.headers.get("X-BAPI-TIMESTAMP")
    rw = request.headers.get("X-BAPI-RECV-WINDOW"); sg = request.headers.get("X-BAPI-SIGN")
    qs = request.query_string
    want = hmac.new(SECRET.encode(), f"{ts}{k}{rw}{qs}".encode(), hashlib.sha256).hexdigest()
    good = k == KEY and sg == want
    if not good:
        STATE["bad_sig"] += 1
    return good


def private(fn):
    async def wrap(request):
        if not check_sig(request):
            return web.json_response({"retCode": 10004, "retMsg": "error sign!"})
        return await fn(request)
    return wrap


# ---------------------------------------------------------------- public
async def mtime(r):
    return ok({"timeSecond": str(int(time.time())), "timeNano": str(time.time_ns())})


async def kline(r):
    rows = await demo.klines(r.query["symbol"], r.query["interval"], int(r.query.get("limit", 200)))
    lst = [[str(k["t"]), str(k["o"]), str(k["h"]), str(k["l"]), str(k["c"]), str(k["v"]), str(k["q"])] for k in reversed(rows)]
    return ok({"symbol": r.query["symbol"], "category": "linear", "list": lst})


async def oi(r):
    rows = await demo.open_interest(r.query["symbol"], limit=int(r.query.get("limit", 50)))
    return ok({"symbol": r.query["symbol"], "category": "linear", "nextPageCursor": "",
               "list": [{"openInterest": str(x["oi"]), "timestamp": str(x["t"])} for x in reversed(rows)]})


async def funding(r):
    rows = await demo.funding_history(r.query["symbol"], pages=1)
    return ok({"category": "linear", "list": [{"symbol": r.query["symbol"], "fundingRate": str(x["rate"]), "fundingRateTimestamp": str(x["t"])} for x in reversed(rows)]})


async def tickers(r):
    return ok({"category": "linear", "list": await demo.tickers(r.query.get("symbol", "ETHUSDT"))})


async def instruments(r):
    return ok({"category": "linear", "list": [await demo.instrument(r.query.get("symbol", "ETHUSDT"))], "nextPageCursor": ""})


async def ratio(r):
    rows = await demo.account_ratio(r.query["symbol"])
    return ok({"list": [{"symbol": r.query["symbol"], "buyRatio": str(x["buy"]), "sellRatio": str(x["sell"]), "timestamp": str(x["t"])} for x in rows], "nextPageCursor": ""})


async def recent(r):
    rows = await demo.recent_trades(r.query["symbol"])
    return ok({"category": "linear", "list": [{"execId": str(i), "symbol": r.query["symbol"], "price": x["price"], "size": x["size"], "side": x["side"], "time": x["time"]} for i, x in enumerate(rows)]})


# ---------------------------------------------------------------- private
@private
async def query_api(r):
    return ok({"id": "1", "note": "mock", "apiKey": KEY, "readOnly": STATE["read_only"], "secret": "",
               "permissions": {"ContractTrade": ["Order", "Position"], "Wallet": ["Withdraw"] if STATE["withdraw"] else [], "Spot": [], "Options": [], "Derivatives": [], "Exchange": ["ExchangeHistory"]},
               "ips": ["*"], "type": 1, "deadlineDay": 88, "expiredAt": "2026-12-20T00:00:00Z", "createdAt": "2026-09-20T00:00:00Z", "uta": 1})


@private
async def positions(r):
    return ok({"category": "linear", "list": list(STATE["positions"].values()), "nextPageCursor": ""})


@private
async def executions(r):
    t0 = int(r.query.get("startTime", 0)); t1 = int(r.query.get("endTime", 10 ** 15))
    lst = [e for e in STATE["executions"] if t0 <= int(e["execTime"]) <= t1]
    return ok({"category": "linear", "list": lst, "nextPageCursor": ""})


@private
async def empty_list(r):
    return ok({"category": "linear", "list": [], "nextPageCursor": ""})


@private
async def orders(r):
    return ok({"category": "linear", "list": STATE["orders"], "nextPageCursor": ""})


@private
async def wallet(r):
    return ok({"list": [{"accountType": "UNIFIED", "totalEquity": str(STATE["equity"]), "totalWalletBalance": str(STATE["equity"]),
                         "totalAvailableBalance": str(STATE["equity"] * 0.9), "totalPerpUPL": "0", "totalInitialMargin": "0", "totalMaintenanceMargin": "0", "coin": []}]})


@private
async def fee(r):
    return ok({"list": [{"symbol": r.query.get("symbol", "ETHUSDT"), "takerFeeRate": "0.00055", "makerFeeRate": "0.0002"}]})


# ---------------------------------------------------------------- websockets
async def ws_public(request):
    ws = web.WebSocketResponse(); await ws.prepare(request)
    STATE["public_ws"].add(ws)
    async for msg in ws:
        if msg.type == WSMsgType.TEXT:
            d = json.loads(msg.data)
            if d.get("op") not in ("subscribe", "ping"):
                STATE["non_get"] += 1
            await ws.send_str(json.dumps({"success": True, "op": d.get("op"), "ret_msg": "pong" if d.get("op") == "ping" else ""}))
    STATE["public_ws"].discard(ws)
    return ws


async def ws_private(request):
    ws = web.WebSocketResponse(); await ws.prepare(request)
    authed = False
    async for msg in ws:
        if msg.type != WSMsgType.TEXT:
            continue
        d = json.loads(msg.data)
        op = d.get("op")
        if op == "auth":
            k, exp, sig = d["args"]
            authed = k == KEY and sig == hmac.new(SECRET.encode(), f"GET/realtime{exp}".encode(), hashlib.sha256).hexdigest()
            await ws.send_str(json.dumps({"success": authed, "op": "auth", "ret_msg": "" if authed else "bad sig", "conn_id": "x"}))
            if authed:
                STATE["private_ws"].add(ws)
        elif op in ("subscribe", "ping"):
            await ws.send_str(json.dumps({"success": True, "op": op}))
        else:
            STATE["non_get"] += 1
    STATE["private_ws"].discard(ws)
    return ws


async def push_private(topic, data):
    for ws in list(STATE["private_ws"]):
        await ws.send_str(json.dumps({"id": "x", "topic": topic, "creationTime": int(time.time() * 1000), "data": data}))


# ---------------------------------------------------------------- control
async def ctl_fill(request):
    b = await request.json()
    e = {"category": "linear", "symbol": b["symbol"], "execId": b["execId"], "orderId": b.get("orderId", b["execId"]), "side": b["side"],
         "execPrice": str(b["price"]), "execQty": str(b["qty"]), "execFee": str(b.get("fee", 0)), "execType": b.get("execType", "Trade"),
         "execTime": str(b.get("time", int(time.time() * 1000))), "closedSize": "0", "isMaker": False, "orderType": "Market", "stopOrderType": "", "createType": "CreateByUser"}
    STATE["executions"].append(e)
    await push_private("execution", [e])
    return web.json_response({"ok": True})


async def ctl_position(request):
    b = await request.json()
    sym = b["symbol"]
    if float(b.get("size", 0)) == 0:
        STATE["positions"].pop(sym, None)
        p = {"symbol": sym, "side": "", "size": "0", "avgPrice": "0", "entryPrice": "0", "stopLoss": "", "updatedTime": str(int(time.time() * 1000))}
    else:
        p = {"symbol": sym, "side": b["side"], "size": str(b["size"]), "avgPrice": str(b["entry"]), "entryPrice": str(b["entry"]), "markPrice": str(b.get("mark", b["entry"])),
             "leverage": str(b.get("leverage", 5)), "liqPrice": str(b.get("liq", "")), "stopLoss": str(b.get("stop", "")), "takeProfit": "", "unrealisedPnl": "0",
             "positionValue": str(float(b["size"]) * float(b["entry"])), "positionIdx": 0, "positionStatus": "Normal", "updatedTime": str(int(time.time() * 1000))}
        STATE["positions"][sym] = p
    await push_private("position", [p])
    return web.json_response({"ok": True})


async def ctl_set(request):
    b = await request.json()
    STATE.update({k: v for k, v in b.items() if k in ("read_only", "withdraw", "equity")})
    return web.json_response({"ok": True})


async def ctl_stats(request):
    return web.json_response({"non_get": STATE["non_get"], "bad_sig": STATE["bad_sig"], "private_ws": len(STATE["private_ws"]), "public_ws": len(STATE["public_ws"])})


def make_app():
    app = web.Application(middlewares=[guard])
    g = app.router.add_get
    g("/v5/market/time", mtime); g("/v5/market/kline", kline); g("/v5/market/open-interest", oi); g("/v5/market/funding/history", funding)
    g("/v5/market/tickers", tickers); g("/v5/market/instruments-info", instruments); g("/v5/market/account-ratio", ratio); g("/v5/market/recent-trade", recent)
    g("/v5/user/query-api", query_api); g("/v5/position/list", positions); g("/v5/execution/list", executions); g("/v5/position/closed-pnl", empty_list)
    g("/v5/order/history", orders); g("/v5/account/wallet-balance", wallet); g("/v5/account/fee-rate", fee)
    g("/v5/public/linear", ws_public); g("/v5/private", ws_private)
    app.router.add_post("/ctl/fill", ctl_fill); app.router.add_post("/ctl/position", ctl_position); app.router.add_post("/ctl/set", ctl_set); app.router.add_get("/ctl/stats", ctl_stats)
    return app


if __name__ == "__main__":
    web.run_app(make_app(), host="127.0.0.1", port=int(sys.argv[1]) if len(sys.argv) > 1 else 9999, print=None)
