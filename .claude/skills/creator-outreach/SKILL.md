---
name: creator-outreach
description: Run partner outreach for TRAP Discipline - keep the prospect tracker, tailor the pitch to each creator, check it against the compliance rules, and send it by email (Gmail draft or send, only after the user approves each batch) or hand the user copy-ready DMs for X, YouTube, Discord and Telegram. Use when the user asks to pitch, message, follow up with, or track creators, influencers or community owners about the app.
---

# Creator outreach for TRAP Discipline

Goal: sign up 5-10 trading creators as referral partners (free licence + 35% lifetime revenue share).
The tracker is `outreach/prospects.csv` next to this file. Read it first; update it after every action.

## Hard rules (never break these)
1. **Nothing is sent without the user's explicit approval of that exact message** in this conversation.
   Approval of one batch does not carry to the next.
2. **Email only, through the Gmail tools**, and only to a business address the creator *publishes*
   (YouTube About page, website contact page, newsletter footer). Never guess or construct an address.
3. **X, YouTube, Discord, Telegram: never automate.** Their rules forbid automated or bulk unsolicited
   DMs (self-bots, scripted DMs), and accounts get banned. Give the user the finished message and the
   profile link; the user sends it and tells you, and you mark it sent.
4. One first message and at most one follow-up (7+ days later). If they say no or ignore the
   follow-up, mark `closed` and never contact them again.
5. Compliance in every message:
   - no profit, win-rate or "make money" claims; describe it as a discipline and risk tool, not signals;
   - say the commission plainly ("35% of every subscription you refer");
   - ask partners to disclose the paid relationship if they post (#ad / "I earn a commission").
6. Never send before the assets exist: the 60-second clip link, the landing page and the demo build.
   If any `{clip}` / `{page}` placeholder is still empty, stop and tell the user.

## Workflow
1. **Load** `outreach/prospects.csv` (columns: id, name, platform, url, audience, focus, contact,
   contact_type [email|dm|server], fit, status [new|drafted|approved|sent|followed_up|replied|partner|closed],
   send_on, sent_on, notes).
2. **Verify** each new prospect before drafting: open the profile/search for it, confirm it exists and
   is still active, note audience size with the date seen, and search "<name> scam / paid promotion".
   Drop anyone with signal-selling or scam reputations.
3. **Tailor** from `template.md`: replace `{name}`, `{specific}` (a real, recent, checkable thing they
   made - a series, a video title, their known setup), `{fit_line}`, `{audience}`, `{clip}`, `{page}`.
   Keep it under 120 words. No flattery that cannot be checked.
4. **Show the batch** to the user as a table: who, channel, send date, full message. Wait for approval.
5. **Send / hand off**
   - email: `create_draft` (default) or send only if the user said "send"; subject line from template;
   - DM / server: give the message in a copy block plus the profile URL.
6. **Schedule**: 3-4 first messages per week (Tue-Thu, the user's mornings), follow-ups 7 days later.
   To be reminded on a date, use `send_later` with a message such as
   "Outreach day: draft and show today's approved messages for <ids>" - the reminder re-runs this
   workflow and still asks for approval before anything is sent.
7. **Log** every step in the CSV (status, dates, reply notes). Summarise the pipeline when asked.
