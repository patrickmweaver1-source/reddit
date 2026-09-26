"""Static configuration and the default rulebook.

Every numeric threshold below is a *starting hypothesis* taken from the Trap
Journal playbook and the crypto-trap-checklist. None is calibrated until at least
thirty trades are logged. They can only be changed through the Monthly Review
flow (Playbook rule 11), never mid-session.
"""
from __future__ import annotations

import os
from pathlib import Path

APP_NAME = "TRAP Discipline"
APP_VERSION = "1.9.1"

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"
def _stable_data_dir() -> Path:
    """One data folder per computer user, outside the app folder, so a newly
    downloaded copy of the app keeps the journal, XP, rulebook history and
    enrolled phones. Windows: %LOCALAPPDATA%\\TRAP Discipline\\data."""
    base = os.environ.get("LOCALAPPDATA")
    if base:
        return Path(base) / "TRAP Discipline" / "data"
    return Path.home() / ".trap-discipline" / "data"


DATA_DIR = Path(os.environ["TRAP_DATA_DIR"]) if os.environ.get("TRAP_DATA_DIR") else _stable_data_dir()
LEGACY_DATA_DIR = ROOT / "data"          # where versions before this one kept it
DB_PATH = DATA_DIR / "trap.db"
DEMO_DB_PATH = DATA_DIR / "demo.db"
TEMPLATE_XLSX = Path(__file__).resolve().parent / "journal_template.xlsx"

HOST = "127.0.0.1"  # never bind to a public interface
PORT = int(os.environ.get("TRAP_PORT", "8080"))

BYBIT_REST = os.environ.get("TRAP_BYBIT_REST", "https://api.bybit.com")
BYBIT_WS_PUBLIC = os.environ.get("TRAP_BYBIT_WS_PUBLIC", "wss://stream.bybit.com/v5/public/linear")
BYBIT_WS_PRIVATE = os.environ.get("TRAP_BYBIT_WS_PRIVATE", "wss://stream.bybit.com/v5/private")

KEYRING_SERVICE = "trap-discipline-bybit"

DEFAULT_WATCHLIST = ["ETHUSDT", "TRUMPUSDT", "FARTCOINUSDT"]
# Thin / fragmented assets get the 0.4 ATR penetration floor, the 2% width
# floor and a CVD reliability warning.
DEFAULT_THIN_ASSETS = ["TRUMPUSDT", "FARTCOINUSDT"]

# The rulebook. Versioned; edits only during a Monthly Review.
DEFAULT_THRESHOLDS = {
    "risk_pct": 1.0,                 # rule 1
    "liq_buffer_min": 3.0,           # rule 3, in stop widths
    "no_expansion_candles": 4,       # rule 6
    "range_atr_min": 6.0,            # rule 8, range height >= 6x ATR
    "range_stop_min": 4.0,           # rule 8, range >= 4x stop
    "thin_range_pct_min": 2.0,       # width >= 2% of price on thin assets
    "cost_pct_of_risk_max": 10.0,    # rule 8 cost gate
    "log_within_minutes": 10,        # rule 12
    "pen_floor_atr": 0.25,           # C2 floor
    "pen_floor_atr_thin": 0.40,      # C2 floor on thin assets
    "pen_abandon_atr": 1.0,          # C2 abandon line
    "window_min_candles": 2,         # C3 decision window
    "window_max_candles": 4,
    "funding_baseline_pct": 0.01,    # per 8h baseline
    "funding_stretched_pct": 0.03,   # stretched funding
    "thin_hours_start_utc": 3,
    "thin_hours_end_utc": 7,
    "slippage_pct_major": 0.02,      # per side, BTC/ETH
    "slippage_pct_thin": 0.06,       # per side, memecoins (assumption, shown as such)
    "taker_fee_pct": 0.055,          # replaced by live account fee rate when connected
    "maker_fee_pct": 0.020,
    "addon1_trigger_r": 1.0,         # add-on protocol (Pat's addition, v1)
    "addon1_fraction": 0.5,
    "addon2_trigger_r": 2.0,
    "addon2_fraction": 0.5,
    "risk_tolerance_pct": 10.0,      # risk may exceed plan by this % before it is a violation
}

DEFAULT_RULES = [
    {"n": 1, "title": "Risk 1% per trade", "text": "Risk 1% of equity per trade. Size comes from the stop, never the other way round."},
    {"n": 2, "title": "Stop beyond the wick", "text": "Stop goes a few ticks beyond the trap's extreme wick, not beyond the level."},
    {"n": 3, "title": "Liquidation 3 stops away", "text": "Liquidation must sit at least 3 stop widths away. Check the liquidation buffer before sending."},
    {"n": 4, "title": "Leverage = risk% / stop%", "text": "Required leverage is risk% divided by stop%. Anything above that is unused risk."},
    {"n": 5, "title": "Enter on the close", "text": "Entry is the decisive CLOSE back inside. Never the wick."},
    {"n": 6, "title": "Candle four or out", "text": "No expansion by candle four: exit at breakeven. Rule, not judgment."},
    {"n": 7, "title": "Never widen a stop", "text": "Never move a stop away from entry."},
    {"n": 8, "title": "Both gates pass", "text": "Both gates must pass: range 6x ATR and 4x the stop, cost under 10% of risk."},
    {"n": 9, "title": "No middle third", "text": "Middle third of the range: no trade."},
    {"n": 11, "title": "Rules change monthly", "text": "Rule changes happen at the monthly review, never during a session."},
    {"n": 12, "title": "Log within 10 minutes", "text": "Log within 10 minutes, win or lose, taken or skipped."},
    {"n": 13, "title": "Add only to winners", "text": "Add-ons only after candle-four expansion, at +1R and +2R, and only after the stop is moved so total risk never exceeds the original 1R."},
]

DEFAULT_SETUPS = [
    {"name": "Spring", "trigger": "Close back above the range low after a break", "invalidation": "Below the sweep wick", "target": "Range high", "notes": ""},
    {"name": "Upthrust", "trigger": "Close back below the range high after a break", "invalidation": "Above the trap wick", "target": "Range low", "notes": ""},
    {"name": "Sweep", "trigger": "Wick through the level, close back inside, OI drops", "invalidation": "Beyond the sweep wick", "target": "Prior swing", "notes": ""},
    {"name": "Failed retest", "trigger": "Retest of a broken level closes back through", "invalidation": "Beyond the retest extreme", "target": "Prior range", "notes": ""},
]

SETUP_NAMES = [s["name"] for s in DEFAULT_SETUPS]
GRADES = ["A", "B", "C", "D"]
