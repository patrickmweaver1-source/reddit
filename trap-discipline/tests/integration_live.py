"""End-to-end live-mode test against the mock exchange.

Run:  python tests/integration_live.py
Starts the mock Bybit (port 9999) and the app (port 8766, temp data dir), then
walks a full trade lifecycle through the private WebSocket and checks the
journal, rule findings, coach messages, XP, and that no write was ever attempted.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOCK = "http://127.0.0.1:9999"
APP = "http://127.0.0.1:8766"


def http(method, url, body=None, token=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("X-Trap-Token", token)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw and raw[:1] in b"{[" else raw)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def wait(pred, timeout=30, step=0.5, what=""):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = pred()
        if v:
            return v
        time.sleep(step)
    raise AssertionError(f"timed out waiting for {what}")


def main():
    data = tempfile.mkdtemp(prefix="trap-it-")
    env = dict(os.environ, TRAP_DATA_DIR=data, TRAP_BYBIT_REST=MOCK, TRAP_BYBIT_WS_PUBLIC="ws://127.0.0.1:9999/v5/public/linear",
               TRAP_BYBIT_WS_PRIVATE="ws://127.0.0.1:9999/v5/private", PYTHON_KEYRING_BACKEND="keyring.backends.fail.Keyring")
    mock = subprocess.Popen([sys.executable, os.path.join(ROOT, "tests", "mock_bybit.py"), "9999"], cwd=ROOT)
    app = subprocess.Popen([sys.executable, "-m", "server", "--live", "--no-browser", "--port", "8766"], cwd=ROOT, env=env,
                           stdout=open(os.path.join(data, "app.out"), "w"), stderr=subprocess.STDOUT)
    ok = False
    try:
        time.sleep(4)
        _, html = http("GET", APP + "/")
        token = re.search(rb'name="trap-token" content="([^"]+)"', html).group(1).decode()
        T = lambda m, p, b=None: http(m, APP + p, b, token)  # noqa: E731

        # 1. a read-write key is refused and not stored
        http("POST", MOCK + "/ctl/set", {"read_only": 0})
        code, r = T("POST", "/api/connect", {"api_key": "MOCKKEY123", "api_secret": "MOCKSECRET456"})
        assert code == 400 and "Read-Write" in r["error"], r
        print("PASS read-write key refused")
        http("POST", MOCK + "/ctl/set", {"read_only": 1, "withdraw": True})
        code, r = T("POST", "/api/connect", {"api_key": "MOCKKEY123", "api_secret": "MOCKSECRET456"})
        assert code == 400 and "Withdraw" in r["error"], r
        print("PASS withdraw-capable key refused")

        # 2. a read-only key connects
        http("POST", MOCK + "/ctl/set", {"read_only": 1, "withdraw": False})
        code, r = T("POST", "/api/connect", {"api_key": "MOCKKEY123", "api_secret": "MOCKSECRET456"})
        assert code == 200 and r["data"]["read_only"], r
        st = wait(lambda: (lambda s: s if s["connection"]["private_ws"] and s["connection"]["status"] == "live" else None)(T("GET", "/api/state")[1]["data"]), what="private ws live")
        assert st["wallet"]["equity"] == 50000.0
        print("PASS read-only key connected, private stream live, wallet read")

        # 3. open a long with a stop, then widen the stop, then close for a win
        now = int(time.time() * 1000)
        http("POST", MOCK + "/ctl/position", {"symbol": "ETHUSDT", "side": "Buy", "size": 10, "entry": 3000, "stop": 2970, "liq": 2500, "leverage": 5})
        http("POST", MOCK + "/ctl/fill", {"symbol": "ETHUSDT", "execId": "e1", "orderId": "o1", "side": "Buy", "price": 3000, "qty": 10, "fee": 16.5, "time": now})
        tr = wait(lambda: [t for t in T("GET", "/api/trades")[1]["data"] if t["status"] == "open"], what="open trade")[0]
        assert tr["symbol"] == "ETHUSDT" and tr["direction"] == "Long" and tr["entry"] == 3000
        tr = wait(lambda: (lambda t: t if t.get("stop") == 2970 else None)(T("GET", f"/api/trades/{tr['id']}")[1]["data"]), what="stop attached")
        print("PASS open trade auto-journaled with the exchange stop")

        # market context captured at entry (journal <-> market integration)
        cx = wait(lambda: (T("GET", f"/api/trades/{tr['id']}")[1]["data"].get("context") or {}).get("price") and T("GET", f"/api/trades/{tr['id']}")[1]["data"]["context"], timeout=45, what="entry context")
        assert cx.get("atr15") and cx.get("mechanism") and "suggest" in cx, cx
        print("PASS entry market snapshot attached to the journal row (ATR, mechanism, suggestions)")

        http("POST", MOCK + "/ctl/position", {"symbol": "ETHUSDT", "side": "Buy", "size": 10, "entry": 3000, "stop": 2960, "liq": 2500, "leverage": 5})
        wait(lambda: any("AWAY from entry" in m["title"] for m in T("GET", "/api/coach")[1]["data"]), what="widen alert")
        print("PASS coach alerted on a widened stop (rule 7)")

        http("POST", MOCK + "/ctl/fill", {"symbol": "ETHUSDT", "execId": "e2", "orderId": "o2", "side": "Sell", "price": 3030, "qty": 10, "fee": 16.665, "time": now + 60_000})
        http("POST", MOCK + "/ctl/position", {"symbol": "ETHUSDT", "size": 0})
        t = wait(lambda: (lambda x: x if x["status"] == "closed" and x.get("r") is not None and x.get("violations") else None)(T("GET", f"/api/trades/{tr['id']}")[1]["data"]), what="closed trade")
        assert abs(t["net_pnl"] - (300 - 16.5 - 16.665)) < 1e-6, t["net_pnl"]
        assert abs(t["risk_usd"] - 300) < 1e-6 and abs(t["r"] - t["net_pnl"] / 300) < 1e-9
        codes = {v["code"] for v in t["violations"]}
        assert "stop_widened" in codes and t["followed_plan"] == "No", codes
        assert len(t["executions"]) == 2
        coach = T("GET", "/api/coach")[1]["data"]
        assert any("Log it now" in m["title"] for m in coach)
        print("PASS closed trade: P&L from real fees, R, rule 7 finding, followed plan = No, log-it reminder")

        # 4. review it; XP is paid; the major finding keeps followed_plan at No
        code, r = T("PATCH", f"/api/trades/{tr['id']}", {"setup": "Spring", "grade": "B", "pen_atr": 0.4, "candles_to_reclaim": 2, "oi_confirmed": "Yes", "followed_plan": "Yes", "mark_reviewed": True, "note": "it test"})
        assert code == 200 and r["xp_gained"] > 0 and r["data"]["followed_plan"] == "No", r
        print(f"PASS review saved, +{r['xp_gained']} XP, cannot self-certify past a major finding")

        # 5. exports work
        code, raw = T("GET", "/api/export.csv")
        assert code == 200
        req = urllib.request.Request(APP + "/api/export.xlsx?token=" + token)
        with urllib.request.urlopen(req) as resp:
            assert resp.status == 200 and len(resp.read()) > 10000
        print("PASS CSV and XLSX export")

        # 6. the exchange never saw a write attempt, and every signature verified
        _, stats = http("GET", MOCK + "/ctl/stats")
        assert stats["non_get"] == 0 and stats["bad_sig"] == 0, stats
        print("PASS zero write attempts, zero bad signatures")

        # 7. security: bad token and foreign Host are rejected
        code, _ = http("GET", APP + "/api/state", token="nope")
        assert code == 401
        req = urllib.request.Request(APP + "/api/state", headers={"Host": "evil.example.com", "X-Trap-Token": token})
        try:
            urllib.request.urlopen(req); raise AssertionError("foreign host accepted")
        except urllib.error.HTTPError as e:
            assert e.code == 403
        print("PASS token and Host checks")
        ok = True
    finally:
        app.terminate(); mock.terminate()
        app.wait(5); mock.wait(5)
        if not ok:
            print(open(os.path.join(data, "app.out")).read()[-4000:])
    print("\nALL INTEGRATION CHECKS PASSED" if ok else "\nINTEGRATION FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
