"""Run this on YOUR computer:  python probe_endpoints.py
It makes a handful of public, read-only requests (no keys, no login, nothing sent but the request) and saves the first part of each answer to
probe_results.json, so the app's developer can check each data format against a real answer. Send the file back."""
import json
import time
import urllib.request

H = {"User-Agent": "Mozilla/5.0 TRAP-probe"}
GET = [
    ("binance futures premium index", "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=ETHUSDT"),
    ("binance futures funding history", "https://fapi.binance.com/fapi/v1/fundingRate?symbol=ETHUSDT&limit=3"),
    ("binance futures open interest", "https://fapi.binance.com/fapi/v1/openInterest?symbol=ETHUSDT"),
    ("binance futures OI history", "https://fapi.binance.com/futures/data/openInterestHist?symbol=ETHUSDT&period=5m&limit=3"),
    ("binance futures long/short", "https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=ETHUSDT&period=5m&limit=3"),
    ("binance futures taker ratio", "https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=ETHUSDT&period=5m&limit=3"),
    ("binance futures book", "https://fapi.binance.com/fapi/v1/depth?symbol=ETHUSDT&limit=5"),
    ("coinbase products", "https://api.exchange.coinbase.com/products/ETH-USD/ticker"),
    ("coinbase trades", "https://api.exchange.coinbase.com/products/ETH-USD/trades?limit=3"),
    ("cryptodatadownload page", "https://www.cryptodatadownload.com/data/"),
    ("data.binance.vision root", "https://data.binance.vision/"),
    ("data.binance.vision funding file", "https://data.binance.vision/data/futures/um/monthly/fundingRate/ETHUSDT/ETHUSDT-fundingRate-2026-08.zip"),
    ("bybit instruments", "https://api.bybit.com/v5/market/instruments-info?category=linear&symbol=ETHUSDT"),
    ("bybit historical data page", "https://www.bybit.com/derivatives/en/history-data"),
    ("gemini public ticker", "https://api.gemini.com/v1/pubticker/ethusd"),
    ("gemini v2 ticker", "https://api.gemini.com/v2/ticker/ethusd"),
    ("gemini candles 1m", "https://api.gemini.com/v2/candles/ethusd/1m"),
    ("gemini order book", "https://api.gemini.com/v1/book/ethusd?limit_bids=5&limit_asks=5"),
    ("gemini trades", "https://api.gemini.com/v1/trades/ethusd?limit_trades=3"),
    ("gemini symbol details", "https://api.gemini.com/v1/symbols/details/ethusd"),
    ("gemini perp candles 1m", "https://api.gemini.com/v2/candles/ETHGUSDPERP/1m"),
    ("gemini perp ticker", "https://api.gemini.com/v2/ticker/ETHGUSDPERP"),
    ("gemini prediction events", "https://api.gemini.com/v1/prediction-markets/events?status=active&limit=3"),
    ("tardis bybit sample (first-of-month, free)", "https://datasets.tardis.dev/v1/bybit/trades/2026/09/01/ETHUSDT.csv.gz"),
    ("tardis bybit book sample (first-of-month, free)", "https://datasets.tardis.dev/v1/bybit/incremental_book_L2/2026/09/01/ETHUSDT.csv.gz"),
]
POST = [
    ("hyperliquid meta and asset contexts", "https://api.hyperliquid.xyz/info", {"type": "metaAndAssetCtxs"}),
    ("hyperliquid candles", "https://api.hyperliquid.xyz/info", {"type": "candleSnapshot", "req": {"coin": "ETH", "interval": "1h", "startTime": int(time.time() * 1000) - 6 * 3600_000}}),
    ("hyperliquid funding history", "https://api.hyperliquid.xyz/info", {"type": "fundingHistory", "coin": "ETH", "startTime": int(time.time() * 1000) - 24 * 3600_000}),
    ("hyperliquid l2 book", "https://api.hyperliquid.xyz/info", {"type": "l2Book", "coin": "ETH"}),
]


def hit(name, url, body=None):
    try:
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers=dict(H, **({"Content-Type": "application/json"} if body else {})))
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read(1500)
            return {"name": name, "url": url, "status": r.status, "type": r.headers.get("Content-Type"), "first_bytes": raw[:1500].decode("utf-8", "replace") if "zip" not in (r.headers.get("Content-Type") or "") and not url.endswith((".zip", ".gz")) else f"binary, first bytes {raw[:8].hex()}"}
    except Exception as exc:  # noqa: BLE001
        return {"name": name, "url": url, "error": f"{exc.__class__.__name__}: {exc}"[:300]}


out = [hit(n, u) for n, u in GET] + [hit(n, u, b) for n, u, b in POST]
json.dump(out, open("probe_results.json", "w"), indent=1)
for o in out:
    print(("OK   " if o.get("status") == 200 else "FAIL ") + o["name"], o.get("error", ""))
print("Saved probe_results.json - send it back.")
