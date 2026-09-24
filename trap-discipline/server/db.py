"""SQLite storage. One file, WAL mode, a single connection used from the event loop."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Iterable

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Immutable record of every exchange message we used. Never updated or deleted.
CREATE TABLE IF NOT EXISTS raw_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_raw_kind ON raw_events(kind, ts);

CREATE TABLE IF NOT EXISTS executions (
  exec_id TEXT PRIMARY KEY,
  order_id TEXT, symbol TEXT NOT NULL, side TEXT NOT NULL,
  price REAL NOT NULL, qty REAL NOT NULL, fee REAL NOT NULL DEFAULT 0,
  exec_type TEXT NOT NULL, exec_time INTEGER NOT NULL,
  closed_size REAL DEFAULT 0, is_maker INTEGER DEFAULT 0,
  order_type TEXT, stop_order_type TEXT, create_type TEXT,
  trade_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_exec_sym_time ON executions(symbol, exec_time);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  symbol TEXT, side TEXT, order_type TEXT, status TEXT,
  stop_order_type TEXT, trigger_price REAL, stop_loss REAL, take_profit REAL,
  create_type TEXT, reduce_only INTEGER, qty REAL,
  created INTEGER, updated INTEGER
);
CREATE INDEX IF NOT EXISTS ix_orders_sym ON orders(symbol, created);

CREATE TABLE IF NOT EXISTS stop_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL, ts INTEGER NOT NULL,
  stop_loss REAL, source TEXT, trade_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_stop_sym ON stop_events(symbol, ts);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  direction TEXT,              -- Long / Short
  taken INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,        -- open / closed / skipped
  source TEXT NOT NULL,        -- bybit / manual / demo
  opened_at INTEGER, closed_at INTEGER,
  date TEXT, time_utc TEXT,
  entry REAL, stop REAL, exit REAL, qty REAL, initial_qty REAL,
  leverage REAL, liq_price REAL,
  fees REAL DEFAULT 0, funding REAL DEFAULT 0,
  gross_pnl REAL, net_pnl REAL, risk_usd REAL, r REAL, liq_buffer REAL,
  max_fav_r REAL, max_adv_r REAL,
  setup TEXT, grade TEXT, followed_plan TEXT,
  pen_atr REAL, candles_to_reclaim INTEGER, oi_confirmed TEXT,
  note TEXT DEFAULT '',
  emotion TEXT, tags TEXT DEFAULT '[]',
  plan_id INTEGER,
  legs TEXT DEFAULT '[]',
  violations TEXT DEFAULT '[]',
  context TEXT DEFAULT '{}',
  process_score INTEGER,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_trades_open ON trades(opened_at);

-- Every call the app made (AI scan or checklist verdict), later checked
-- against what the market actually did. This is the app's report card.
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  source TEXT NOT NULL,        -- ai / checklist
  ref TEXT,
  symbol TEXT NOT NULL,
  verdict TEXT NOT NULL,       -- TRADEABLE NOW / WATCH / NO SETUP / STAND DOWN / GO / NO TRADE
  direction TEXT, setup TEXT, grade TEXT,
  entry REAL, stop REAL, target REAL,
  needs_fill INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',   -- open / done / void
  outcome TEXT, outcome_r REAL, resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_calls_open ON calls(status, at);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  symbol TEXT NOT NULL, direction TEXT, setup TEXT, level REAL,
  entry REAL, stop REAL, target REAL, qty REAL, grade TEXT,
  verdict TEXT NOT NULL,       -- GO / NO TRADE
  status TEXT NOT NULL,        -- open / matched / expired / honored
  checklist TEXT NOT NULL,
  trade_id INTEGER
);

CREATE TABLE IF NOT EXISTS xp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, kind TEXT NOT NULL, xp INTEGER NOT NULL,
  ref TEXT, note TEXT, key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS badges (
  code TEXT PRIMARY KEY, unlocked_at INTEGER NOT NULL, seen INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS coach (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, level TEXT NOT NULL, rule INTEGER,
  title TEXT NOT NULL, body TEXT NOT NULL, ref TEXT,
  acked INTEGER DEFAULT 0, key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS rule_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, rules TEXT NOT NULL, thresholds TEXT NOT NULL,
  setups TEXT NOT NULL, note TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL, started_at INTEGER NOT NULL, completed_at INTEGER,
  notes TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS study_progress (
  key TEXT PRIMARY KEY, ts INTEGER NOT NULL, data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS liquidations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL, ts INTEGER NOT NULL, side TEXT, size REAL, price REAL
);
CREATE INDEX IF NOT EXISTS ix_liq_sym ON liquidations(symbol, ts);

CREATE TABLE IF NOT EXISTS cvd (
  symbol TEXT NOT NULL, bucket INTEGER NOT NULL,
  buy REAL NOT NULL DEFAULT 0, sell REAL NOT NULL DEFAULT 0,
  PRIMARY KEY(symbol, bucket)
);

CREATE TABLE IF NOT EXISTS checkins (
  day TEXT PRIMARY KEY, ts INTEGER NOT NULL
);

-- Prospective Edge Registry: when a pattern reaches the 'candidate' tier it is
-- frozen here with its discovery snapshot, and the next `reserve_n` qualifying
-- trades (closed AFTER discovery) are set aside to confirm it out of sample.
-- The hypothesis is immutable once written, so a later rule change can't quietly
-- redefine what is being tested. Only a confirmed row counts as a real edge/leak.
CREATE TABLE IF NOT EXISTS edge_registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dim TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,                -- leak / edge
  discovered_at INTEGER NOT NULL,
  discovery_n INTEGER NOT NULL,
  discovery_avg_r REAL NOT NULL,
  reserve_n INTEGER NOT NULL,        -- qualifying trades to set aside before judging
  status TEXT NOT NULL DEFAULT 'watching',   -- watching / confirmed / failed
  confirmed_at INTEGER,
  confirm_n INTEGER,
  confirm_avg_r REAL,
  UNIQUE(dim, value)
);

-- Daily snapshots of the coin-relationship (co-movement) analysis, so the
-- app can eventually say whether a relationship has held up over time
-- rather than only showing what the last couple of weeks of candles say.
CREATE TABLE IF NOT EXISTS comovement_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_cov_snap_ts ON comovement_snapshots(ts);

-- Web Push subscriptions: one row per browser/device that opted in.
-- p256dh/auth are the subscription's public encryption keys, not secrets of
-- ours - they only let THIS app's VAPID-signed messages reach that device.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_sent_at INTEGER,
  last_error TEXT
);
"""

JSON_TRADE_FIELDS = ("legs", "violations", "tags", "context")
JSON_FIELD_DEFAULTS = {"context": {}}


def now_ms() -> int:
    return int(time.time() * 1000)


class DB:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.conn.executescript(SCHEMA)
        # migrations for databases created by earlier versions
        cols = {r["name"] for r in self.query("PRAGMA table_info(trades)")}
        if "context" not in cols:
            self.execute("ALTER TABLE trades ADD COLUMN context TEXT DEFAULT '{}'")

    # ---- low level -------------------------------------------------------
    def execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self.lock:
            return self.conn.execute(sql, tuple(params))

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, tuple(params)).fetchall()]

    def one(self, sql: str, params: Iterable[Any] = ()) -> dict | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def close(self) -> None:
        with self.lock:
            self.conn.close()

    # ---- key/value -------------------------------------------------------
    def get(self, key: str, default: Any = None) -> Any:
        row = self.one("SELECT value FROM kv WHERE key=?", (key,))
        return json.loads(row["value"]) if row else default

    def set(self, key: str, value: Any) -> None:
        self.execute(
            "INSERT INTO kv(key,value,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (key, json.dumps(value), now_ms()),
        )

    # ---- raw events ------------------------------------------------------
    def raw(self, source: str, kind: str, payload: Any) -> None:
        self.execute(
            "INSERT INTO raw_events(ts,source,kind,payload) VALUES(?,?,?,?)",
            (now_ms(), source, kind, json.dumps(payload, default=str)),
        )

    # ---- trades ----------------------------------------------------------
    @staticmethod
    def decode_trade(row: dict | None) -> dict | None:
        if row is None:
            return None
        for f in JSON_TRADE_FIELDS:
            default = JSON_FIELD_DEFAULTS.get(f, [])
            try:
                row[f] = json.loads(row.get(f) or json.dumps(default))
            except (TypeError, ValueError):
                row[f] = default
        return row

    def trade(self, trade_id: int) -> dict | None:
        return self.decode_trade(self.one("SELECT * FROM trades WHERE id=?", (trade_id,)))

    def trades(self, where: str = "1=1", params: Iterable[Any] = (), order: str = "COALESCE(opened_at, created_at) DESC") -> list[dict]:
        return [self.decode_trade(r) for r in self.query(f"SELECT * FROM trades WHERE {where} ORDER BY {order}", params)]

    def insert_trade(self, fields: dict) -> int:
        f = dict(fields)
        for k in JSON_TRADE_FIELDS:
            if k in f and not isinstance(f[k], str):
                f[k] = json.dumps(f[k])
        ts = now_ms()
        f.setdefault("created_at", ts)
        f["updated_at"] = ts
        cols = ",".join(f.keys())
        qs = ",".join("?" for _ in f)
        cur = self.execute(f"INSERT INTO trades({cols}) VALUES({qs})", list(f.values()))
        return int(cur.lastrowid)

    def update_trade(self, trade_id: int, fields: dict) -> None:
        if not fields:
            return
        f = dict(fields)
        for k in JSON_TRADE_FIELDS:
            if k in f and not isinstance(f[k], str):
                f[k] = json.dumps(f[k])
        f["updated_at"] = now_ms()
        sets = ",".join(f"{k}=?" for k in f)
        self.execute(f"UPDATE trades SET {sets} WHERE id=?", [*f.values(), trade_id])

    def delete_trade(self, trade_id: int) -> None:
        self.execute("UPDATE executions SET trade_id=NULL WHERE trade_id=?", (trade_id,))
        self.execute("DELETE FROM trades WHERE id=?", (trade_id,))

    # ---- push subscriptions ------------------------------------------------
    def push_subs(self) -> list[dict]:
        return self.query("SELECT * FROM push_subscriptions ORDER BY created_at DESC")

    def push_sub_add(self, endpoint: str, p256dh: str, auth: str, label: str | None) -> None:
        self.execute(
            "INSERT INTO push_subscriptions(endpoint,p256dh,auth,label,created_at) VALUES(?,?,?,?,?) "
            "ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, "
            "label=COALESCE(excluded.label, push_subscriptions.label)",
            (endpoint, p256dh, auth, label, now_ms()),
        )

    def push_sub_remove(self, endpoint: str) -> None:
        self.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (endpoint,))

    def push_sub_mark(self, endpoint: str, ok: bool, error: str | None) -> None:
        if ok:
            self.execute("UPDATE push_subscriptions SET last_sent_at=?, last_error=NULL WHERE endpoint=?", (now_ms(), endpoint))
        else:
            self.execute("UPDATE push_subscriptions SET last_error=? WHERE endpoint=?", (error, endpoint))
