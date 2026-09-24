"""The coach: short, firm, specific. Every message cites the rule it enforces.

Messages are de-duplicated by key so the same event never nags twice.
"""
from __future__ import annotations

import random
from typing import Any, Awaitable, Callable

from .db import DB, now_ms

MANTRAS = [
    "Grade the process, not the outcome.",
    "Most setups should fail. That is the gate working.",
    "Never enter before the close back inside.",
    "Size comes from the stop. Never the other way round.",
    "A losing trade with perfect execution is a good trade.",
    "If nobody entered, nobody is trapped.",
    "No expansion by candle four: out at breakeven.",
    "Rising OI adds fuel. Falling OI removes it. Price decides who is winning.",
    "You do not need to trade today.",
    "Rule changes happen at the monthly review. Not now.",
    "Log it within ten minutes. Emotion fades and takes the data with it.",
    "The trap is the entry. The anticipation is the tuition.",
    "Being flat is a position.",
    "Wick is not a close.",
]


class Coach:
    def __init__(self, db: DB, push: Callable[[str, Any], Awaitable[None]]):
        self.db = db
        self.push = push

    async def say(self, level: str, title: str, body: str, *, rule: int | None = None, key: str | None = None,
                  ref: str | None = None, sound: str | None = None) -> dict | None:
        """level: info | warn | alert | praise | stop"""
        ts = now_ms()
        try:
            cur = self.db.execute(
                "INSERT INTO coach(ts,level,rule,title,body,ref,key) VALUES(?,?,?,?,?,?,?)",
                (ts, level, rule, title, body, ref, key),
            )
        except Exception:  # noqa: BLE001  duplicate key
            return None
        msg = {"id": cur.lastrowid, "ts": ts, "level": level, "rule": rule, "title": title, "body": body,
               "ref": ref, "acked": 0, "sound": sound or {"alert": "alarm", "stop": "alarm", "warn": "warn", "praise": "chime"}.get(level, "tick")}
        await self.push("coach", msg)
        return msg

    def recent(self, limit: int = 50, unacked_only: bool = False) -> list[dict]:
        where = "WHERE acked=0" if unacked_only else ""
        return self.db.query(f"SELECT * FROM coach {where} ORDER BY ts DESC LIMIT ?", (limit,))

    def ack(self, msg_id: int | None = None) -> None:
        if msg_id is None:
            self.db.execute("UPDATE coach SET acked=1 WHERE acked=0")
        else:
            self.db.execute("UPDATE coach SET acked=1 WHERE id=?", (msg_id,))

    @staticmethod
    def mantra(seed: int | None = None) -> str:
        if seed is None:
            return random.choice(MANTRAS)
        return MANTRAS[seed % len(MANTRAS)]
