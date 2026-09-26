"""Gamification. Rewards PROCESS, never profit and never trade count.

Design principles (why the numbers look like this):
  * No XP for P&L or for the number of trades taken. The game must never pay
    you to trade more.
  * Logging a skipped setup is worth about as much as logging a taken trade.
  * Honoring a NO TRADE verdict or the daily stop earns the biggest one-off
    rewards, because sitting still is the hardest part.
  * Rule violations cost XP and break the clean streak.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .db import DB, now_ms

XP = {
    "checkin": 10,
    "checklist": 15,
    "skip_logged": 25,
    "journal_complete": 40,
    "fresh_log": 30,
    "late_log_hour": 10,
    "calibration": 20,
    "clean_trade": 40,
    "violation_major": -15,
    "walk_away": 100,
    "honored_no_go": 30,
    "monthly_review": 250,
    "study_section": 15,
    "quiz_pass": 50,
    "quiz_perfect": 25,
    "weekly_quest": 150,
}
DAILY_CAPS = {"checklist": 6, "skip_logged": 8, "study_section": 10, "journal_complete": 12,
              "fresh_log": 12, "calibration": 12, "clean_trade": 12, "honored_no_go": 3}

RANKS = ["Rookie", "Chart Watcher", "Level Marker", "Patient Hunter", "Trap Setter", "Gatekeeper",
         "Risk Warden", "Iron Hands", "Tape Reader", "Market Stoic", "Trap Master", "Grandmaster of Patience"]


def level_threshold(level: int) -> int:
    """Cumulative XP needed to reach `level` (1-based)."""
    if level <= 1:
        return 0
    return int(round(150 * (level - 1) ** 1.8 / 10) * 10)


def level_for(xp: int) -> dict:
    lvl = 1
    while level_threshold(lvl + 1) <= xp:
        lvl += 1
    cur, nxt = level_threshold(lvl), level_threshold(lvl + 1)
    rank = RANKS[min((lvl - 1) // 2, len(RANKS) - 1)]
    return {"level": lvl, "rank": rank, "xp": xp, "floor": cur, "next": nxt,
            "progress": (xp - cur) / (nxt - cur) if nxt > cur else 1.0}


BADGES = [
    # code, name, description, icon, tier
    ("first_log", "First Entry", "Journal your first trade.", "pen", 1),
    ("first_skip", "The Pass", "Log a setup you chose not to take.", "hand", 1),
    ("fresh_5", "Fresh Ink", "Log 5 trades within 10 minutes of the close.", "clock", 1),
    ("fresh_25", "Wet Ink", "Log 25 trades within 10 minutes of the close.", "clock", 2),
    ("calibrator_10", "Calibrator I", "Fill Pen. ATR, Candles to reclaim and OI confirmed on 10 trades.", "dial", 1),
    ("calibrator_30", "Calibrator II", "Thirty calibrated trades. Your thresholds can now be tested.", "dial", 3),
    ("clean_5", "Clean Sheet", "5 trades in a row with the plan followed.", "shield", 1),
    ("clean_10", "Iron Discipline", "10 trades in a row with the plan followed.", "shield", 2),
    ("clean_25", "The Machine", "25 trades in a row with the plan followed.", "shield", 3),
    ("no_go_10", "Gatekeeper", "Honor 10 NO TRADE verdicts.", "gate", 2),
    ("checklist_25", "Pilot's Checklist", "Run the pre-trade checklist 25 times.", "list", 1),
    ("checklist_100", "Flight Hours", "Run the pre-trade checklist 100 times.", "list", 3),
    ("full_ladder", "Full Ladder", "Execute both add-ons by the protocol with no rule 13 finding.", "ladder", 2),
    ("candle_four", "Candle Four", "Scratch a trade near breakeven when it failed to expand.", "four", 2),
    ("thirty", "The Thirty", "30 taken trades logged. Diagnostics are now meaningful.", "thirty", 3),
    ("reviewer", "Monthly Reviewer", "Complete a monthly review.", "calendar", 2),
    ("scholar_voi", "OI Scholar", "Pass the Volume and Open Interest quiz.", "book", 1),
    ("scholar_schwager", "Pattern Scholar", "Pass the Chart Patterns quiz.", "book", 1),
    ("streak_7", "Seven Sessions", "Check in 7 days in a row.", "flame", 1),
    ("streak_30", "Thirty Sessions", "Check in 30 days in a row.", "flame", 3),
    ("night_owl", "Night Owl Denied", "Log a skipped setup during the thin hours.", "moon", 1),
    ("quiet_day", "Sat On Hands", "Check in, see nothing worth taking, take nothing.", "lotus", 1),
]
BADGE_INDEX = {b[0]: b for b in BADGES}


def _hour_of(time_utc) -> int:
    try:
        return int(str(time_utc).split(":")[0])
    except (ValueError, TypeError, AttributeError, IndexError):
        return 99


def award(db: DB, kind: str, key: str, ref: str | None = None, note: str | None = None,
          xp: int | None = None, ts: int | None = None) -> int:
    """Idempotent: the same key never pays twice. Returns XP granted (0 if duplicate or capped)."""
    amount = XP.get(kind, 0) if xp is None else xp
    ts = ts or now_ms()
    if kind in DAILY_CAPS and amount > 0:
        day0 = int(datetime.fromtimestamp(ts / 1000, tz=timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
        n = db.one("SELECT COUNT(*) AS n FROM xp_events WHERE kind=? AND ts>=? AND ts<?", (kind, day0, day0 + 86_400_000))["n"]
        if n >= DAILY_CAPS[kind]:
            amount = 0
    try:
        db.execute("INSERT INTO xp_events(ts,kind,xp,ref,note,key) VALUES(?,?,?,?,?,?)", (ts, kind, amount, ref, note, key))
    except Exception:  # noqa: BLE001  (unique key -> already awarded)
        return 0
    return amount


def revoke(db: DB, key: str) -> None:
    db.execute("DELETE FROM xp_events WHERE key=?", (key,))


def total_xp(db: DB) -> int:
    return max(0, int(db.one("SELECT COALESCE(SUM(xp),0) AS s FROM xp_events")["s"]))


def _closed_taken(db: DB) -> list[dict]:
    return db.trades("taken=1 AND status='closed'", order="closed_at ASC")


def streaks(db: DB) -> dict:
    closed = _closed_taken(db)
    clean = 0
    for t in reversed(closed):
        if t.get("followed_plan") == "Yes":
            clean += 1
        elif t.get("followed_plan") == "No":
            break
    best_clean = run = 0
    for t in closed:
        if t.get("followed_plan") == "Yes":
            run += 1
            best_clean = max(best_clean, run)
        elif t.get("followed_plan") == "No":
            run = 0
    fresh = 0
    for t in reversed(closed):
        if t.get("reviewed_at") and t.get("closed_at") and t["reviewed_at"] - t["closed_at"] <= 10 * 60000:
            fresh += 1
        elif t.get("reviewed_at"):
            break
    days = {r["day"] for r in db.query("SELECT day FROM checkins")}
    today = datetime.now(timezone.utc).date()
    chk = 0
    d = today if today.isoformat() in days else today - timedelta(days=1)
    while d.isoformat() in days:
        chk += 1
        d -= timedelta(days=1)
    best_chk = run = 0                      # one pass over the sorted days (was a scan back from every day)
    prev = None
    for day in sorted(days):
        dd = datetime.fromisoformat(day).date()
        run = run + 1 if prev is not None and dd - prev == timedelta(days=1) else 1
        best_chk = max(best_chk, run)
        prev = dd
    return {"clean": clean, "best_clean": best_clean, "fresh": fresh, "checkin": chk, "best_checkin": best_chk,
            "checked_in_today": today.isoformat() in days}


def discipline_score(db: DB) -> dict:
    closed = [t for t in _closed_taken(db) if t.get("process_score") is not None][-20:]
    if not closed:
        return {"score": None, "n": 0, "trend": []}
    scores = [t["process_score"] for t in closed]
    return {"score": round(sum(scores) / len(scores)), "n": len(scores), "trend": scores}


def check_badges(db: DB) -> list[dict]:
    """Unlock any newly earned badges. Returns the new ones."""
    have = {r["code"] for r in db.query("SELECT code FROM badges")}
    trades = db.trades()
    taken = [t for t in trades if t.get("taken") and t.get("status") == "closed"]
    reviewed = [t for t in taken if t.get("reviewed_at")]
    fresh = [t for t in reviewed if t.get("closed_at") and t["reviewed_at"] - t["closed_at"] <= 10 * 60000]
    calibrated = [t for t in taken if t.get("pen_atr") is not None and t.get("candles_to_reclaim") is not None and t.get("oi_confirmed") in ("Yes", "No")]
    skipped = [t for t in trades if not t.get("taken")]
    st = streaks(db)
    xpk = {r["kind"]: r["n"] for r in db.query("SELECT kind, COUNT(*) AS n FROM xp_events GROUP BY kind")}
    earned = {
        "first_log": len(reviewed) >= 1,
        "first_skip": len(skipped) >= 1,
        "fresh_5": len(fresh) >= 5,
        "fresh_25": len(fresh) >= 25,
        "calibrator_10": len(calibrated) >= 10,
        "calibrator_30": len(calibrated) >= 30,
        "clean_5": st["best_clean"] >= 5,
        "clean_10": st["best_clean"] >= 10,
        "clean_25": st["best_clean"] >= 25,
        "no_go_10": xpk.get("honored_no_go", 0) >= 10,
        "checklist_25": xpk.get("checklist", 0) >= 25,
        "checklist_100": xpk.get("checklist", 0) >= 100,
        "full_ladder": any(len([g for g in t.get("legs") or [] if g.get("kind") == "entry"]) >= 3 and
                           not any(v.get("rule") == 13 and not v.get("dismissed") for v in t.get("violations") or []) for t in taken),
        "candle_four": any(t.get("r") is not None and abs(t["r"]) < 0.2 and t.get("closed_at") and t.get("opened_at") and
                           t["closed_at"] - t["opened_at"] <= 80 * 60000 and t.get("followed_plan") == "Yes" for t in taken),
        "thirty": len(taken) >= 30,
        "reviewer": xpk.get("monthly_review", 0) >= 1,
        "scholar_voi": db.one("SELECT 1 AS x FROM xp_events WHERE key='quiz_pass:voi'") is not None,
        "scholar_schwager": db.one("SELECT 1 AS x FROM xp_events WHERE key='quiz_pass:schwager'") is not None,
        "streak_7": st["best_checkin"] >= 7,
        "streak_30": st["best_checkin"] >= 30,
        "night_owl": any(3 <= _hour_of(t.get("time_utc")) < 7 for t in skipped),
        "quiet_day": xpk.get("quiet_day", 0) >= 1,
    }
    new = []
    for code, ok in earned.items():
        if ok and code not in have:
            db.execute("INSERT OR IGNORE INTO badges(code,unlocked_at,seen) VALUES(?,?,0)", (code, now_ms()))
            b = BADGE_INDEX[code]
            new.append({"code": code, "name": b[1], "desc": b[2], "icon": b[3], "tier": b[4]})
    return new


QUEST_TEMPLATES = [
    ("fresh_all", "Log every trade within 10 minutes", "All trades closed this week logged inside the window (min 1)."),
    ("checklist_all", "Checklist before every entry", "Every exchange trade this week matched to a checklist (min 1)."),
    ("calibrate_all", "Calibrate everything", "Pen. ATR, Candles and OI filled on every trade this week (min 1)."),
    ("skip3", "Log three passes", "Log 3 skipped setups this week."),
    ("study3", "Hit the books", "Complete 3 study sections this week."),
    ("zero_major", "Zero major violations", "No major rule findings this week (min 1 trade)."),
    ("checkin5", "Show up five days", "Check in on 5 different days this week."),
]


def week_bounds(ts: int | None = None) -> tuple[int, int, str]:
    d = datetime.fromtimestamp((ts or now_ms()) / 1000, tz=timezone.utc)
    start = (d - timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=7)
    iso = start.isocalendar()
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000), f"{iso[0]}-W{iso[1]:02d}"


def quests(db: DB) -> list[dict]:
    w0, w1, wk = week_bounds()
    seed = int(wk.split("-W")[1]) + int(wk[:4])
    picks = [QUEST_TEMPLATES[(seed + i * 3) % len(QUEST_TEMPLATES)] for i in range(3)]
    seen = set()
    chosen = []
    for p in picks + QUEST_TEMPLATES:
        if p[0] not in seen:
            chosen.append(p)
            seen.add(p[0])
        if len(chosen) == 3:
            break
    trades = db.trades("COALESCE(closed_at, opened_at, created_at) >= ? AND COALESCE(closed_at, opened_at, created_at) < ?", (w0, w1))
    taken = [t for t in trades if t.get("taken") and t.get("status") == "closed"]
    out = []
    for code, title, desc in chosen:
        if code == "fresh_all":
            n = len(taken)
            done = sum(1 for t in taken if t.get("reviewed_at") and t["reviewed_at"] - (t.get("closed_at") or 0) <= 600000)
            prog, goal, ok = done, max(n, 1), n >= 1 and done == n
        elif code == "checklist_all":
            ex = [t for t in taken if t.get("source") == "bybit"]
            done = sum(1 for t in ex if t.get("plan_id"))
            prog, goal, ok = done, max(len(ex), 1), len(ex) >= 1 and done == len(ex)
        elif code == "calibrate_all":
            done = sum(1 for t in taken if t.get("pen_atr") is not None and t.get("candles_to_reclaim") is not None and t.get("oi_confirmed"))
            prog, goal, ok = done, max(len(taken), 1), len(taken) >= 1 and done == len(taken)
        elif code == "skip3":
            prog = sum(1 for t in trades if not t.get("taken"))
            goal, ok = 3, prog >= 3
        elif code == "study3":
            prog = db.one("SELECT COUNT(*) AS n FROM xp_events WHERE kind='study_section' AND ts>=? AND ts<?", (w0, w1))["n"]
            goal, ok = 3, prog >= 3
        elif code == "zero_major":
            bad = sum(1 for t in taken if any(v.get("severity") == "major" and not v.get("dismissed") for v in t.get("violations") or []))
            prog, goal, ok = (1 if taken and not bad else 0), 1, bool(taken) and bad == 0
        else:  # checkin5
            prog = db.one("SELECT COUNT(*) AS n FROM checkins WHERE ts>=? AND ts<?", (w0, w1))["n"]
            goal, ok = 5, prog >= 5
        key = f"quest:{wk}:{code}"
        if ok:
            award(db, "weekly_quest", key, ref=code, note=title)
        out.append({"code": code, "title": title, "desc": desc, "progress": min(prog, goal), "goal": goal,
                    "done": ok, "xp": XP["weekly_quest"], "week": wk,
                    "ends_in_h": max(0, int((w1 - now_ms()) / 3600000))})
    return out


def summary(db: DB) -> dict:
    xp = total_xp(db)
    lv = level_for(xp)
    have = {r["code"]: r for r in db.query("SELECT code, unlocked_at, seen FROM badges")}
    badges = [{"code": c, "name": n, "desc": d, "icon": i, "tier": t,
               "unlocked_at": have[c]["unlocked_at"] if c in have else None,
               "seen": bool(have[c]["seen"]) if c in have else False} for c, n, d, i, t in BADGES]
    recent = db.query("SELECT ts, kind, xp, note FROM xp_events WHERE xp<>0 ORDER BY ts DESC LIMIT 25")
    return {"level": lv, "streaks": streaks(db), "discipline": discipline_score(db), "badges": badges,
            "recent_xp": recent, "quests": quests(db), "xp_table": XP,
            "ranks": [{"rank": r, "from_level": i * 2 + 1, "xp": level_threshold(i * 2 + 1)} for i, r in enumerate(RANKS)]}

