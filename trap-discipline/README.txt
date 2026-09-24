TRAP DISCIPLINE 1.0
====================
A read-only trading coach, journal and market monitor for your Bybit trap
strategy. It runs only on your own computer. It can see your account; it can
never trade, transfer or withdraw.

WHAT YOU NEED
-------------
- Your personal laptop (Windows, Mac or Linux) with Python 3.10 or newer.
  Windows: get it at python.org/downloads and tick "Add python.exe to PATH".
- Your VPN ON whenever you use Live mode. Bybit refuses connections from
  some regions and from data-center addresses; the app talks to Bybit
  directly from your laptop through whatever connection you give it.

START IT
--------
Windows: double-click "Start TRAP.bat".
         First run takes about a minute (it installs its own packages),
         then your browser opens at http://127.0.0.1:8080
Mac/Linux: run ./start-trap.sh
Keep the black window open while you use the app; closing it stops the app.

TRY DEMO MODE FIRST
-------------------
Double-click "Start TRAP (Demo).bat" (or ./start-trap.sh --demo).
Demo mode runs on a synthetic market with a sample month of trades in a
separate database, so you can explore every screen, the checklist, the coach
and the gamification with zero risk and no account connected. Switch between
Demo and Live any time in Settings > Mode.

CONNECT YOUR BYBIT ACCOUNT (LIVE MODE)
--------------------------------------
1. On bybit.com (website, not the phone app): profile icon (top right) > API.
2. Create New Key > System-generated API Keys.
3. Keep "API Transaction" selected and choose READ-ONLY.
   Do not tick any trade, transfer or withdraw permission.
4. IP restriction: choose "No IP restriction" (your VPN changes your address,
   so binding an IP would break the key). Keys without an IP binding expire
   (Bybit support articles say after 3 months); the app shows the exact
   expiry date once connected, so you'll know when to make a new one.
5. Copy the key AND the secret (the secret is shown only once), then paste
   both into TRAP under Settings > Bybit connection.

The app checks the key with Bybit before saving it. A key that can trade or
withdraw is refused and never stored. The secret is kept in your operating
system's credential vault (Windows Credential Manager / macOS Keychain) and
never appears in the browser, exports or log files.

WHAT IT DOES
------------
- Command Center: session status (thin hours, funding, macro days),
  discipline score, live positions with an R meter, and what still needs
  logging.
- Pre-Trade Checklist: the full C1-C4 scoring, both gates with the
  arithmetic shown, and a server-decided GO / NO TRADE stamp. The server
  makes the call; you cannot argue with it mid-session (rule 11).
- Position Planner: size from the stop, the +1R / +2R add-on ladder, and
  the stop moves that keep total risk at 1R.
- Market Monitor: candles with every level auto-classified through the
  trap state machine, open interest, CVD, funding percentile, liquidations,
  and the OI/volume mechanism lab. Pick any timeframe (5m to 1W) and a
  lookback (24h to 2 years). Drag to move, scroll or pinch to zoom, drag the
  price or time axis to stretch it, double-click an axis to reset it; Fit,
  Latest and Auto price snap the view back. Your choice is remembered on
  each device. Level states always come from 15m closes.
- The menu on the left collapses with the button at the top left (on a
  phone it slides in from the three-line button).
- Trade Journal: your Bybit fills journal themselves (entry, exits, add-on
  legs, fees, funding, stop history). You add setup, grade and the three
  orange calibration fields. Rule findings are cited by playbook number.
- Dashboard: the workbook's KPIs and all Diagnostics questions, live.
- Coach: firm, specific messages that cite the rule (no stop on the
  exchange, stop widened, candle four, loss limit, NO TRADE taken...).
- Study Hall: interactive guides (Volume & Open Interest; Chart Patterns &
  Failed Signals) with diagrams, quizzes and flashcards.
- Progress: XP, ranks, badges, streaks and weekly quests. Everything is
  earned by process - logging fresh, honoring NO TRADE verdicts, clean
  execution, studying. Nothing pays you for profit or for trading more.
- Setup and entry alerts: push notifications to your laptop and phone when a
  tracked level starts forming a trap (RECRUITING) and again when the entry
  candle closes (TRIGGERED). An earlier heads-up (price within 1 ATR of a
  level) can be switched on too. See the next section.

SETUP AND ENTRY ALERTS (PUSH NOTIFICATIONS)
------------------------------------------
Settings > Setup and entry alerts.
- This laptop: tap "Get alerts on this device" and allow notifications.
  Use a normal browser window; private/Incognito windows cannot get push.
- Your phone (one-time setup): phones only allow notifications from a
  secure https address, and the app only listens on this laptop. Tailscale
  (free for personal use, tailscale.com) gives the laptop a private https
  address that only your own signed-in devices can reach. The step-by-step
  is inside the Settings card. In short: install Tailscale on both devices,
  turn on MagicDNS and HTTPS in the Tailscale admin console, run
  "tailscale serve --bg 8080" on the laptop, paste the address into
  Settings, open it on the phone and enroll. To stop sharing the laptop
  address later, run "tailscale serve reset" and clear the address in
  Settings (enrolled phones keep getting alerts). iPhone: iOS 16.4 or newer, and
  you must "Add to Home Screen" and open TRAP from that icon first.
  Privacy note: turning on Tailscale HTTPS publishes the laptop's Tailscale
  machine name in a public certificate log, so rename the machine to
  something that does not identify you before enabling it.
- What leaves the laptop: only the alert text (symbol, level, state), sent
  through your browser maker's push service (Google, Apple, Mozilla or
  Microsoft). Never your API keys, positions or trades.
- Limits: alerts come from the app on this laptop, so the laptop must be
  awake with the TRAP window open. A closed or sleeping laptop sends nothing.
  Demo mode alerts are labeled "DEMO" so they can't be mistaken for real ones.
  Use "Send test" after enrolling to confirm each device.

AI SCAN (CLAUDE) ON THE CHECKLIST
---------------------------------
Pre-Trade Checklist > "Scan with AI". One press sends the selected symbol's
market data to Claude, which scores every checklist item (C1 to C4, both
gates) against your written trap checklist. A quick breakdown appears at the
top of the checklist in about 30 to 90 seconds.
One-time setup (Settings > AI analyst):
1. Go to platform.claude.com (the Claude Console) and sign in. API use is
   billed separately from a Claude app subscription.
2. Settings > Billing > Buy credits (the API runs on prepaid credits).
3. Settings > API keys > Create key. Copy it (shown once, starts sk-ant-).
4. Paste it into TRAP and press Save. The app checks it with Claude first.
- What is sent: candles, open interest, funding, CVD, liquidations, the
  auto-classified levels, the 4h regime and your rulebook numbers for that
  one symbol. Never your Bybit keys, balance, positions, trades or loss
  count.
- The app re-checks Claude's answer with the same rules the Verdict step
  uses. Claude can be stricter than your rules, never looser: the level, its
  direction, the reclaim close, the entry and the stop are the app's own
  measurements, and the gate arithmetic shown is the app's. If Claude says
  "TRADEABLE NOW" and the rules disagree, the panel says so and shows why.
- "Load into checklist" fills every box and score so you can walk the steps
  and change anything. The Verdict step still makes the call (rule 11).
- A read goes stale when the next 15 minute candle closes; the panel warns.
- Cost: shown under every scan, from Claude's own token counts (estimated
  $0.10 to $0.30 a scan on Opus 5.5). Set a monthly budget in Settings;
  scans stop when it is reached. The Anthropic key is kept in your OS
  credential vault, like the Bybit secret.
- This is pattern classification against your own checklist, not
  financial advice.

AUTO-TUNE THE ZONE BOUNDARIES
-----------------------------
Playbook & Coach > Auto-tune zone boundaries. Switch it on once.
- Three times a day it downloads (then tops up) about four months of
  15-minute Bybit history for your watchlist - read-only public data - and
  runs the app's own live trap detector over every historical candle, then
  simulates each trade the playbook way (enter on the trigger close, stop
  just beyond the trap's extreme, exit at +2R, -1R or after 8 hours, net of
  fees and slippage). Trades your rule 8 cost gate would refuse don't count.
- It checks whether a different penetration floor (majors and thin assets),
  abandon line or reclaim window would have paid better. A change is only
  proposed when it also wins on the most recent weeks of history, which the
  search never saw, by more than the day-to-day noise. Each value moves one
  small step at most, within hard limits, and a value with too little
  evidence is left alone.
- You get a notification (Apply / Dismiss buttons on Android and desktop;
  on iPhone, tap it to open the Playbook page). Nothing changes until you
  approve it, never while you have an open position, and every applied
  change can be undone from the History list.
- Once 30 of your own trades carry the orange calibration fields, they act
  as a check: a change that would cut away a region where your trades made
  money is blocked.
- Rule 11 still locks manual threshold edits outside the monthly review.
  Approved auto-tune proposals are the only exception.
- It will move rarely, by design. In testing it proposed a change on pure
  noise less than 2% of the time and never moved already-correct boundaries
  in a harmful direction. "No change needed" is the normal result.
- Worth knowing: with standard taker fees, most 15-minute traps fail your
  10% cost gate (the scan shows how many). If almost everything is refused,
  the scan will keep saying there isn't enough evidence - that is your
  strategy's cost structure talking, not a fault.

YOUR DATA
---------
Everything lives in one data folder per Windows user, OUTSIDE the app folder:
  %LOCALAPPDATA%\TRAP Discipline\data
(paste that into the File Explorer address bar to open it; the black window
also prints the exact path at startup). Because it sits outside the app, a
newly downloaded copy of TRAP keeps your journal, XP, rulebook history and
enrolled phones. The first time a new version starts, it copies the newest
data it finds inside older copies of the app (for example
Downloads\TRAP-Discipline (3)\trap-discipline\data); the old copies are
left untouched and can be deleted once you've checked everything is there.
Back up that data folder and you keep everything.
Exports: Settings > Export gives CSV, a full JSON backup, and an Excel file
that fills your original Trap Journal workbook so its Dashboard and
Diagnostics tabs keep working.

KNOWN LIMITS (honest ones)
--------------------------
- Liquidation prints and CVD are recorded from the live stream, so they
  start from the first time the app runs. Bybit has no history for them.
- The cost gate uses your live taker fee. With standard taker fees, very
  tight stops fail the 10% cost gate - that is your rule 8 working, not a
  bug. Maker entries and wider structural stops are what pass it.
- If Bybit returns "403 access denied" in Live mode, that is Bybit refusing
  your network location. Check the VPN, then Settings > reconnect. The app
  will not try to route around a block.
- Every threshold (0.25 ATR floor, 2-4 candle window, 6x range gate...) is
  a starting hypothesis. Thirty calibrated trades unlock meaningful
  Diagnostics; change rules only in the Monthly Review.

LEARNING (sidebar: Review > Learning)
--------
- Report card: every AI scan and checklist verdict is saved, then about 10
  hours later replayed on the real 15-minute candles (+2R target, -1R stop,
  or the price after 8 hours, after fees). It shows whether the app's green
  lights pay and whether its NO TRADE calls saved you money.
- Edge profile: your closed trades grouped by setup, coin, session, grade,
  side, trend and rule breaks. A group needs 8+ trades and a result that
  holds up after allowing for luck before it is called a leak or an edge.
- Lessons: the checklist and AI scan show the leaks and edges that match the
  setup in front of you.
- Weekly review: written every Sunday (UTC), or any time with "Run the review
  now". It can propose personal blocks (for example "no Upthrust setups on
  FARTCOINUSDT"). Blocks only make the rules stricter, apply only after you
  approve them, and can be removed any time.
- What the AI scan receives (your choice, option B): a short caution-only
  summary in R and counts (leaks, personal blocks, and app calls that have
  been losing). Never balances, sizes, dollars, prices, dates, notes or a
  trade list.

TROUBLESHOOTING
---------------
- "Python is required": install from python.org, restart the launcher.
- Page will not load: make sure the launcher window is still open; the app
  only listens on your own machine (127.0.0.1:8080).
- The browser keeps showing an old version, or no page opens: an older
  black TRAP window is probably still open. From version 1.1.0 the launcher
  finds an older copy and closes it for you. If it can't, close every black
  TRAP window, run Start TRAP.bat again, and type http://127.0.0.1:8080 into
  Edge. The "Open TRAP" shortcut in the app folder opens the page whenever
  the app is already running.
- AI scan fails: the red "Last scan failed" line now quotes what Claude
  reported. Answers stream, so a VPN can't drop a long scan as idle, and a
  dropped connection or a busy Claude is retried twice by itself. A 403
  usually means the VPN is set to a country Anthropic doesn't serve.
- AI scan says "out of credits": add credits in the Claude Console
  (Settings > Billing), then scan again. "Rejected the API key": create a
  new key and paste it in Settings > AI analyst.
- Log says "error 10002 ... check your server timestamp": the laptop's clock
  is off. The app corrects for it automatically, but fix the clock too:
  Settings > Time & language > Date & time > turn on "Set time
  automatically", then click "Sync now".
- Log says "error 10006 Too many visits": Bybit's rate limit. The app now
  paces its requests and waits for the limit to reset on its own.
- "Test not delivered": check the laptop's internet connection. A device
  the push service reports as unsubscribed is removed automatically; enroll
  it again from that device.
- Windows says "tailscale" is not recognized: open a NEW command prompt
  (one opened before installing Tailscale cannot find it), or use the full
  path: "C:\Program Files\Tailscale\tailscale.exe" serve --bg 8080
- Phone shows "Forbidden host": the Tailscale address saved in Settings
  does not match the one the phone opened. Re-copy it from
  "tailscale serve status" on the laptop.
- Port in use: run "Start TRAP.bat" from a command prompt with
  "--port 8090" added, then open http://127.0.0.1:8090
- Fresh start: close the app and delete the "data" folder (this erases the
  journal - export first).

Charts by TradingView Lightweight Charts (Apache-2.0). Icons by Lucide
(ISC). Fonts: Inter, Space Grotesk, JetBrains Mono (OFL). Confetti by
canvas-confetti (ISC). License texts are in static/vendor/.
