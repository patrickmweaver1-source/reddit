// Study guide: How to use TRAP. Every page and feature, what it does, and how the pieces work
// together. Facts here are taken from the app itself (rule numbers, XP values, level states,
// thresholds); if the app changes, update this guide with it.
import { h, icon, svg } from '../ui.js';
import { fig } from './diagrams.js';

const P = (...t) => h('p', ...t);
const B = (t) => h('b', t);
const UL = (...items) => h('ul', items.flat().map(i => h('li', i)));
const callout = (kind, ic, ...t) => h(`div.callout.${kind}`, icon(ic), h('div', ...t));
const tbl = (head, rows) => h('table.tbl', { style: { margin: '12px 0' } }, h('thead', h('tr', head.map(x => h('th', x)))),
  h('tbody', rows.map(r => h('tr', r.map(c => h('td', c))))));

// ---- diagrams (drawn on the dark figure panel) --------------------------------------------
const INK = '#edf2f8'; const DIM = '#a9b3c2'; const BOX = '#141b26'; const LINE = '#394453'; const AC = '#36d7c7'; const XPC = '#8b7bff';

function flow(steps, { w = 660, bw = 108, gap = 14, h: H = 118, color = AC } = {}) {
  const total = steps.length * bw + (steps.length - 1) * gap;
  w = Math.max(w, total + 16);
  const s = svg('svg', { viewBox: `0 0 ${w} ${H}`, width: '100%', role: 'img' });
  let x = (w - total) / 2;
  steps.forEach(([title, sub], i) => {
    s.appendChild(svg('rect', { x, y: 18, width: bw, height: 72, rx: 12, fill: BOX, stroke: i === 0 ? color : LINE, 'stroke-width': 1.5 }));
    s.appendChild(svg('text', { x: x + bw / 2, y: 46, 'text-anchor': 'middle', fill: INK, 'font-size': 12.5, 'font-weight': 700, 'font-family': 'Inter, sans-serif' }, title));
    (sub || '').split('|').forEach((ln, k) => s.appendChild(svg('text', { x: x + bw / 2, y: 64 + k * 13, 'text-anchor': 'middle', fill: DIM, 'font-size': 10.5, 'font-family': 'Inter, sans-serif' }, ln)));
    if (i < steps.length - 1) {
      const ax = x + bw + 2;
      s.appendChild(svg('path', { d: `M${ax},54 L${ax + gap - 4},54 M${ax + gap - 9},49 L${ax + gap - 4},54 L${ax + gap - 9},59`, stroke: color, 'stroke-width': 1.8, fill: 'none' }));
    }
    x += bw + gap;
  });
  return s;
}

const sessionLoop = () => fig(flow([['Check in', 'macro day?|+10 XP'], ['Command', 'session status|watchlist'], ['Monitor', 'levels & states|on the chart'],
  ['Checklist', 'C1–C4, gates|GO / NO TRADE'], ['Planner', 'size from|the stop'], ['Journal', 'within 10 min|orange fields']]),
  'One session, left to right. The trade itself is placed on Bybit: TRAP is read-only and cannot place, change or cancel orders.');

const states = () => {
  const s = svg('svg', { viewBox: '0 0 660 170', width: '100%', role: 'img' });
  const row = [['DORMANT', '#4a5566'], ['APPROACHING', '#3987e5'], ['TESTED', '#b4c3d6'], ['RECRUITING', '#fab219'], ['WATCH', '#ec835a'], ['TRIGGERED', AC]];
  row.forEach(([n, c], i) => {
    const x = 8 + i * 109;
    s.appendChild(svg('rect', { x, y: 20, width: 100, height: 40, rx: 20, fill: BOX, stroke: c, 'stroke-width': 2 }));
    s.appendChild(svg('text', { x: x + 50, y: 45, 'text-anchor': 'middle', fill: c, 'font-size': 11, 'font-weight': 700, 'font-family': 'JetBrains Mono, monospace' }, n));
    if (i < row.length - 1) s.appendChild(svg('path', { d: `M${x + 101},40 L${x + 108},40`, stroke: DIM, 'stroke-width': 1.5 }));
  });
  [['DEAD · ran', 'cleared a full ATR beyond and held'], ['DEAD · timed out', 'no reclaim inside the window'], ['DEAD · too shallow', 'never reached the floor']].forEach(([n, d], i) => {
    const x = 36 + i * 212;
    s.appendChild(svg('rect', { x, y: 96, width: 190, height: 52, rx: 10, fill: BOX, stroke: '#ef4b4b', 'stroke-dasharray': '4 3' }));
    s.appendChild(svg('text', { x: x + 95, y: 116, 'text-anchor': 'middle', fill: '#ff9b9b', 'font-size': 11, 'font-weight': 700, 'font-family': 'JetBrains Mono, monospace' }, n));
    s.appendChild(svg('text', { x: x + 95, y: 134, 'text-anchor': 'middle', fill: DIM, 'font-size': 10.5, 'font-family': 'Inter, sans-serif' }, d));
  });
  s.appendChild(svg('text', { x: 330, y: 84, 'text-anchor': 'middle', fill: DIM, 'font-size': 10.5, 'font-family': 'Inter, sans-serif' }, 'from RECRUITING or WATCH, a break can die instead of trapping:'));
  return fig(s, 'Every level on the Market Monitor sits in one of these states, always judged on closed 15-minute candles. Alerts fire on RECRUITING and TRIGGERED.');
};

const feedback = () => {
  const s = svg('svg', { viewBox: '0 0 660 250', width: '100%', role: 'img' });
  const nodes = { j: [330, 30, 'Journal', 'fills + your 3 orange fields'], l: [560, 125, 'Learning', 'edges, leaks, report card'],
    c: [330, 220, 'Checklist + AI scan', 'lessons & personal blocks'], p: [100, 125, 'Playbook', 'monthly review, auto-tune'] };
  const box = ([x, y, t, d], c) => {
    s.appendChild(svg('rect', { x: x - 95, y: y - 22, width: 190, height: 46, rx: 12, fill: BOX, stroke: c, 'stroke-width': 1.6 }));
    s.appendChild(svg('text', { x, y: y - 3, 'text-anchor': 'middle', fill: INK, 'font-size': 12.5, 'font-weight': 700, 'font-family': 'Inter, sans-serif' }, t));
    s.appendChild(svg('text', { x, y: y + 13, 'text-anchor': 'middle', fill: DIM, 'font-size': 10.5, 'font-family': 'Inter, sans-serif' }, d));
  };
  const arrow = (d) => s.appendChild(svg('path', { d, stroke: XPC, 'stroke-width': 1.8, fill: 'none', 'marker-end': 'url(#ah)' }));
  s.appendChild(svg('defs', {}, svg('marker', { id: 'ah', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: XPC }))));
  arrow('M430,40 Q530,55 545,98'); arrow('M545,152 Q520,205 430,215'); arrow('M230,215 Q140,205 115,152'); arrow('M115,98 Q140,50 230,38');
  box(nodes.j, AC); box(nodes.l, XPC); box(nodes.c, AC); box(nodes.p, XPC);
  return fig(s, 'The learning loop. What you log becomes evidence; evidence becomes lessons at the checklist; lessons and your data feed the monthly review that changes the rules.');
};

// ---- guide ----------------------------------------------------------------------------------
export const MANUAL = {
  id: 'manual',
  title: 'How to Use TRAP',
  subtitle: 'Every page and feature, what it does, and how to use them together',
  minutes: 45,
  accent: '#36d7c7',
  sections: [
    { id: 'what', title: 'What TRAP is (and is not)', body: () => h('div',
      h('h2', 'What TRAP is'),
      P('TRAP Discipline is a coach, journal and market monitor for one strategy: 15-minute trap setups on Bybit perpetual futures (Spring, Upthrust, Sweep and Failed retest). It watches the market, scores setups against your written checklist, journals your fills automatically, and measures whether you followed your own rules.'),
      P('It rewards process, not profit. XP, badges and the discipline score come from checking in, running the checklist, honoring NO TRADE verdicts, logging fresh and following the plan. Nothing in the app pays you for trading more or for a winning trade.'),
      h('h3', 'What it cannot do'),
      UL([B('It cannot trade. '), 'The Bybit key must be read-only; a key that can trade or withdraw is refused and never stored. You place every order on Bybit yourself.'],
        [B('It runs only on your laptop. '), 'The app listens on 127.0.0.1. Your data lives in the data folder on this computer, and keys live in the operating system\'s credential vault.'],
        [B('It is not advice. '), 'The AI scan and the verdicts are pattern classification against your own checklist. Every threshold is a starting hypothesis until about 30 calibrated trades say otherwise.']),
      callout('key', 'lightbulb', B('The one-sentence version. '), 'Check in, let the monitor find the levels, let the checklist be the gate, size from the stop, trade on Bybit, log within ten minutes, and let the weekly and monthly reviews change the rules, never the moment.')) },

    { id: 'setup', title: 'First-time setup', body: () => h('div',
      h('h2', 'First-time setup'),
      h('h3', '1. Start in Demo mode'),
      P('Demo mode runs a synthetic market with a sample month of trades in a separate database, so you can press every button with zero risk. Switch between Demo and Live any time in Settings > Mode. Demo alerts are labeled DEMO.'),
      h('h3', '2. Connect Bybit (read-only)'),
      P('On bybit.com: profile > API > Create New Key > System-generated. Choose Read-Only and no IP restriction (a VPN changes your address). Paste the key and secret in Settings > Bybit connection. TRAP checks the key with Bybit first, and on connect it backfills your recent trades into the journal.'),
      h('h3', '3. Connect the AI analyst (optional)'),
      P('Settings > AI analyst: paste a Claude API key from the Claude Console (API credit is billed separately from a Claude app subscription). Pick the model, the scan depth and a monthly budget. Backup AIs (ChatGPT, Gemini) can step in when Claude cannot answer.'),
      h('h3', '4. Alerts and phone'),
      P('Settings > Setup and entry alerts turns on push notifications for this laptop. Your phone needs the one-time Tailscale setup described in that card; text-message alerts (Twilio) are there for when a phone VPN blocks push.'),
      h('h3', '5. Make it yours'),
      UL(['Watchlist and thin assets (thin coins get the 0.40 ATR penetration floor and a CVD warning).', 'Appearance: Light, Dark or Match this computer, and a color theme. Saved per device; price charts stay black.', 'Preferences: sounds, desktop notifications, reduced motion, coach name.']),
      callout('warnbox', 'triangle-alert', 'Keep the TRAP window open and the laptop awake while you trade: alerts, the journal and the coach all run from the app on this laptop.')) },

    { id: 'session', title: 'A session, start to finish', body: () => h('div',
      h('h2', 'A session, start to finish'), sessionLoop(),
      h('h3', 'Before you look at a chart'),
      P('Do the pre-session check-in (it pops up once a day, or use the button on the Command Center). Flag a macro day (CPI, FOMC, a major unlock): the session goes to CAUTION and every grade drops a letter. The check-in is +10 XP and keeps your streak.'),
      h('h3', 'Finding and judging a setup'),
      P('Glance at the Command Center: session status, open positions, what needs logging, and the watchlist tiles with each coin\'s top candidate level. Open the Market Monitor for the chart, then run the Pre-Trade Checklist on the level. Press "Scan with AI" for a second opinion. The Verdict step gives GO or NO TRADE.'),
      h('h3', 'Placing and managing it'),
      P('If GO: the Position Planner gives the size from your stop, the leverage and the add-on ladder. Place the order and the stop on Bybit. TRAP sees the fill within seconds, starts the R meter and the candle-four timer, and the coach watches for a missing stop, a widened stop, and risk above 1R.'),
      h('h3', 'Afterwards'),
      P('Log it within ten minutes, win or lose: setup, grade and the three orange fields. If you passed on a setup, log that too. NO TRADE verdicts you honor earn XP an hour later.')) },

    { id: 'command', title: 'Command Center', body: () => h('div',
      h('h2', 'Command Center'),
      P('The home page. It answers "should I even be looking?" and "what do I owe the journal?"'),
      tbl(['Card', 'What it tells you'], [
        ['Session', 'CLEAR, CAUTION or STAND DOWN, with the reasons: a flagged macro day, or funding settling within the hour. Countdown to the next funding.'],
        ['Discipline score', 'Average process score of your last 20 closed trades, plus your level, rank and streaks.'],
        ['Open positions', 'Live from Bybit: size, entry, stop, an R meter from stop to +3R, and the rule checks (stop present, candle four).'],
        ['Log these now', 'Closed trades not yet reviewed, with the 10-minute fresh-log countdown.'],
        ['Watchlist', 'Each coin\'s price, regime and top candidate level with its state. Click through to the chart.'],
        ['Coach & weekly quests', 'Recent coach messages and this week\'s three quests (+150 XP each).']]),
      callout('key', 'lightbulb', 'The top bar is always there: session pill, streaks, level and XP, and the bell for coach messages. Click the session pill to come back here from anywhere.')) },

    { id: 'monitor', title: 'Market Monitor', body: () => h('div',
      h('h2', 'Market Monitor'),
      P('Candles with every level auto-classified, plus open interest, CVD, funding and liquidations, stacked and locked together.'),
      states(),
      h('h3', 'Reading the chart'),
      UL(['Levels come from 1h, 4h, daily and weekly structure, round numbers and wide candles, clustered and colored by state. Dashed = dormant, thick = recruiting, watch or triggered.',
        'Pick any timeframe (5m to 1W) and lookback (24h to 2 years). Drag to move, scroll or pinch to zoom, drag an axis to stretch it, double-click an axis to reset it. Fit, Latest and Auto price snap the view back. Level states always come from 15-minute closes, whatever timeframe you view.',
        'Open interest (both sides), CVD (taker buy minus sell, recorded live since the app started), funding at each settlement, and recorded liquidations near price.']),
      h('h3', 'The side panel'),
      UL(['Top candidate: the best level right now, its trap zone, penetration in ATR, OI through the break and on the reclaim, candles since the break.',
        'OI / volume lab: what the last four closed candles suggest (new positions, covering, liquidation, absorption), with the creation ratio.',
        'Funding: the current rate, its 8-hour equivalent, and its percentile against this coin\'s own history.']),
      callout('key', 'crosshair', '"Checklist this" opens the Pre-Trade Checklist already loaded with this coin and its top level.')) },

    { id: 'checklist', title: 'Pre-Trade Checklist', body: () => h('div',
      h('h2', 'Pre-Trade Checklist'),
      P('The gate, not the cheerleader. Eight steps: Session gate, Level & setup, C1 Obvious level, C2 Recruitment, C3 No follow-through, C4 Close back inside, Gates & sizing, Verdict.'),
      tbl(['Component', 'The question', 'Scores 2 when…'], [
        ['C1', 'Is the level obvious to everyone?', '3+ touches on a 4h level plus a visible liquidation cluster'],
        ['C2', 'Did the break recruit anyone?', 'Strong close beyond, open interest clearly rising, funding stretched'],
        ['C3', 'Did it fail to follow through?', 'A clear stall inside the 2 to 4 candle window'],
        ['C4', 'Decisive close back inside?', 'Engulfing or large close with a sharp OI drop (this is the entry)']]),
      P('Scores add to 8: A is 7 to 8, B 5 to 6, C 3 to 4, D below 3 (no trade). A session caution or a counter-trend trap drops a letter. Both gates must pass (rule 8): range at least 6x ATR and 4x the stop, and round-trip cost under 10% of the risk. Rule 9: an entry in the middle third of the range is no trade.'),
      P('The server makes the GO or NO TRADE call from your inputs (rule 11: you cannot argue with it mid-session). Every verdict is saved; a NO TRADE you honor for an hour earns +30 XP. Each checklist run is +15 XP.'),
      h('h3', 'Scan with AI'),
      UL(['One button sends this coin\'s market data (candles, OI, funding, CVD, liquidations, levels, your rule numbers) to Claude, which scores every item and names the exact close that would trigger a WATCH setup. It never receives your keys, balance, positions or trades; it gets a short R-and-counts summary of your own record.',
        'The app re-checks the answer with the same rules the Verdict step uses. Claude can be stricter than your rules, never looser.',
        'Scan depth (Settings): Fast (about 30 to 90 seconds) or Deep (slower). The reasoning streams in as live progress. The read goes stale when the next 15-minute candle closes; the panel warns you.',
        '"Load into checklist" fills every box so you can walk the steps and change anything. The Verdict step still decides.']),
      callout('truth', 'shield-alert', B('From your own record. '), 'When the setup matches a pattern your journal shows losing (a leak) or a personal block you approved, the checklist says so at the top. A blocked pattern is never GO.')) },

    { id: 'planner', title: 'Position Planner', body: () => h('div',
      h('h2', 'Position Planner'),
      P('Size comes from the stop (rule 1: risk 1% of equity per trade). Enter the entry and invalidation; the planner returns the quantity, the leverage actually needed (rule 4: risk% divided by stop%, anything more is unused risk), and where liquidation would sit (rule 3: at least 3 stop-widths away).'),
      h('h3', 'The add-on ladder (rule 13)'),
      P('Add-ons are only for winners: after candle-four expansion, at +1R and +2R (half size each by default), and only after the stop has been moved so total risk never exceeds the original 1R. The planner shows each rung and the stop move it requires. Executing both rungs cleanly earns the Full Ladder badge.'),
      callout('warnbox', 'triangle-alert', 'Rule 6: no expansion by candle four means exit at breakeven. The Command Center and the journal show the countdown; scratching a failed trade near breakeven earns the Candle Four badge.')) },

    { id: 'journal', title: 'Trade Journal', body: () => h('div',
      h('h2', 'Trade Journal'),
      P('One row per opportunity, taken or not. Your Bybit fills journal themselves: entry, exits, add-on legs, fees, funding and the stop history. Your job is the judgment part.'),
      tbl(['You fill in', 'Why it matters'], [
        ['Setup and grade', 'Groups your results by setup and grade in Dashboard and Learning.'],
        ['The three orange fields: Pen. ATR, Candles to reclaim, OI confirmed', 'These calibrate your checklist thresholds. Thirty rows with all three is when the numbers can be tested (+20 XP each).'],
        ['Followed plan, emotion, note', 'Process versus outcome: a good decision can lose and a bad one can win.']]),
      UL(['Log within 10 minutes of the close for +30 XP (rule 12); within the hour is +10. A complete review is +40, a clean trade (plan followed) +40.',
        'Rule findings are cited by playbook number (no stop, stop widened, candle four ignored, risk above 1R...). Each major finding is -15 XP. A finding the app got wrong can be dismissed with a reason.',
        'Log skipped setups (+25 XP): they show whether your problem is finding setups or pulling the trigger.',
        'Cards or Sheet view, filters by status, symbol, setup and grade, and export to your original Trap Journal workbook (.xlsx), CSV or a full JSON backup.'])) },

    { id: 'playbook', title: 'Playbook & Coach', body: () => h('div',
      h('h2', 'Playbook & Coach'),
      P('Your rulebook, versioned. If it is not on this page, it is not a trade. Everything is locked until you open the month\'s review (rule 11: rules change monthly, never during a session).'),
      tbl(['Rule', ''], [['1', 'Risk 1% per trade'], ['2', 'Stop beyond the wick'], ['3', 'Liquidation 3 stops away'], ['4', 'Leverage = risk% / stop%'], ['5', 'Enter on the close'],
        ['6', 'Candle four or out'], ['7', 'Never widen a stop'], ['8', 'Both gates pass'], ['9', 'No middle third'], ['11', 'Rules change monthly'], ['12', 'Log within 10 minutes'], ['13', 'Add only to winners']]),
      h('h3', 'The monthly review'),
      P('Start it from the Playbook. Change thresholds, setups and rule text with your data in front of you, then save a new version (+250 XP). Every page (checklist floors, planner triggers, dashboard buckets, session gates) switches to the new version at once, and the version history keeps the old ones.'),
      h('h3', 'Auto-tune'),
      P('Optional. Three times a day it replays months of Bybit history through the live level detector and checks whether different zone boundaries would have paid better, on recent history it never searched. A proposal only queues; it takes effect at your next monthly review, and once you have 30 calibrated trades your own results can block any change that would cut away a region where you made money.'),
      h('h3', 'The coach'),
      P('Firm, specific messages that cite the rule: no stop on the exchange, stop widened, candle four, a NO TRADE taken, risk above 1R, an add-on without the stop moved. The bell in the top bar holds them; the Coach log on the Playbook keeps the history.')) },

    { id: 'review', title: 'Dashboard & Learning', body: () => h('div',
      h('h2', 'Dashboard'),
      P('The workbook\'s KPIs (expectancy in R, net P&L, win rate, profit factor, rule adherence, leverage, liquidation buffer) and all the Diagnostics, live. Read the diagnostics after 30 trades, not before: until then they are noise.'),
      UL(['Process vs outcome: earned wins, good losses, lucky wins, deserved losses.', 'Rolling 10-trade discipline and expectancy, the R distribution, the last 35 days, and rule findings by rule.']),
      h('h2', 'Learning'),
      P('Where the app checks its own calls and learns your patterns, all on this laptop:'),
      tbl(['Card', 'What it does'], [
        ['Report card', 'Every AI scan and checklist verdict is replayed against the candles that followed (+2R target, -1R stop, or the mark after 8 hours, after costs). Did TRADEABLE NOW pay? Did NO TRADE save money?'],
        ['Your edge profile', 'Your trades grouped by setup, coin, session, grade, side, trend alignment and rule breaks. A group is only called an edge or a leak with enough evidence.'],
        ['Weekly review', 'Written each Sunday (UTC), with proposals. A proposal can only make you stricter, and nothing applies until you approve it.'],
        ['Personal blocks', 'Patterns you approved blocking. The checklist and the AI scan will never call them GO. Remove a block any time.'],
        ['Which checklist signals help', 'Whether each checklist input actually separated winners from losers in your data.'],
        ['Stability & execution', 'Whether an edge holds across regimes, and how far your fills drift from the intended entry.'],
        ['Prospective edge registry', 'Candidate edges frozen now and confirmed or failed only on trades you take afterwards: the honest test.'],
        ['Coin relationships', 'Which watchlist coins move together, and by how many candles one leads. The checklist warns when a new trade would double up on an open one.']])) },

    { id: 'progress', title: 'Progress, XP and badges', body: () => h('div',
      h('h2', 'Progress: earned by process, never by profit'),
      tbl(['Action', 'XP'], [['Daily check-in', '+10'], ['Checklist run', '+15'], ['Skipped setup logged', '+25'], ['Journal row complete', '+40'], ['Fresh log (within 10 min)', '+30'],
        ['Orange fields filled', '+20'], ['Clean trade (plan followed)', '+40'], ['NO TRADE honored', '+30'], ['Study section / quiz pass / perfect quiz', '+15 / +50 / +25'],
        ['Weekly quest', '+150'], ['Monthly review', '+250'], ['Major rule finding', '-15 each']]),
      P('Levels unlock a new rank every two levels, from Rookie to Grandmaster of Patience. Daily caps stop grinding (for example, 6 checklist runs a day). Streaks track check-ins, clean trades and fresh logs.'),
      P('Badges mark milestones: First Entry, The Pass, Fresh Ink, Calibrator I and II, Clean Sheet, Iron Discipline, The Machine, Gatekeeper, Pilot\'s Checklist, Full Ladder, Candle Four, The Thirty, Monthly Reviewer, Seven and Thirty Sessions, Sat On Hands, and the Study Hall scholar badges.'),
      callout('key', 'trophy', 'Weekly quests rotate: log every trade within 10 minutes, checklist before every entry, calibrate everything, log three passes, finish three study sections, zero major violations, show up five days.')) },

    { id: 'alerts', title: 'Alerts, phone and settings', body: () => h('div',
      h('h2', 'Alerts'),
      P('Push notifications fire when a tracked level starts forming a trap (RECRUITING) and again when the entry candle closes (TRIGGERED); the entry alert replaces the forming one and stays on screen. An earlier heads-up when price comes within about 1 ATR (APPROACHING) can be switched on. Only the alert text leaves the laptop, never keys, positions or trades.'),
      UL(['Laptop: "Get alerts on this device" in a normal (not private) browser window.', 'Phone: the Tailscale steps in the Settings card give the laptop a private https address; on iPhone, add TRAP to the Home Screen first. "Send test" confirms each device.', 'Text messages (Twilio) as a fallback when a phone VPN blocks push.']),
      h('h2', 'Settings worth knowing'),
      tbl(['Card', 'Use it for'], [['Mode', 'Demo or Live; reset the demo data.'], ['Bybit connection', 'Connect, see the key\'s expiry date, disconnect.'],
        ['AI analyst', 'Model, scan depth (Fast or Deep), monthly budget and spend.'], ['Backup AI', 'ChatGPT and Gemini as fallbacks.'], ['Watchlist', 'Coins to monitor and which are thin.'],
        ['Appearance', 'Light, Dark or Match this computer, and six color themes.'], ['Export and backup', 'Trap Journal.xlsx, CSV and a full JSON backup.'],
        ['Troubleshooting', 'Slow pages, freezes and AI scan timings. "Copy report" to share them when something goes wrong.']])) },

    { id: 'together', title: 'Using it all together', body: () => h('div',
      h('h2', 'Using it all together'), feedback(),
      h('h3', 'Every session'),
      UL(['Check in first. Honest macro flag.', 'No level, no trade: let the monitor and the checklist find it. Never trade a level that is only on the 15-minute chart.', 'Run the checklist on every entry, and scan with AI when a level is RECRUITING or WATCH so you know the exact close that would trigger it.', 'Take the verdict. Size from the stop. Stop on the exchange before anything else.', 'Log within ten minutes, including passes.']),
      h('h3', 'Every week'),
      UL(['Read the weekly review on the Learning page. Approve or reject its proposals.', 'Check the report card: are the AI\'s TRADEABLE NOW calls actually paying?', 'Finish the week\'s quests; spend quiet time in the Study Hall.']),
      h('h3', 'Every month'),
      UL(['Run the monthly review with the Dashboard diagnostics and the auto-tune proposals open. Change only what the data supports, one thing at a time.', 'Export a backup.']),
      callout('truth', 'brain', B('Why it works. '), 'The journal only becomes evidence if the orange fields are filled; the Learning page only becomes useful with enough logged trades; the checklist only gets smarter because of both. Skipping the logging breaks the loop.')) },

    { id: 'trouble', title: 'Troubleshooting', body: () => h('div',
      h('h2', 'When something goes wrong'),
      tbl(['Symptom', 'What to do'], [
        ['"Connect an AI first"', 'Settings > AI analyst: is Claude shown as connected? If not, paste the key again.'],
        ['A scan failed', 'The message says which limit tripped. Out of credits or a spend limit is on your Anthropic account; "TRAP\'s monthly AI spending cap" is the budget in Settings. Otherwise scan again.'],
        ['Pages slow or not loading', 'Close extra TRAP tabs you do not need, then Settings > Troubleshooting > Copy report and share it.'],
        ['Bybit 403 errors', 'Turn the VPN on: Bybit refuses some regions and data-center addresses.'],
        ['No alerts on the phone', 'Laptop awake and TRAP open? Use "Send test"; if a phone VPN blocks push, set up text alerts.'],
        ['Prices frozen', 'The live connection reconnects by itself after a minute of silence (for example after the laptop slept).']]),
      callout('key', 'life-buoy', 'Your data lives in the data folder (trap.db). Back it up, or use Export > Full backup, and nothing is lost when you install a new version.')) },
  ],
  quiz: [
    { q: 'Can TRAP place or cancel an order on Bybit?', o: ['Yes, from the planner', 'Only stop orders', 'No. The key must be read-only and a trading key is refused', 'Only in Demo mode'], a: 2, why: 'TRAP is read-only by design: you place every order on Bybit yourself.' },
    { q: 'What does flagging a macro day at check-in do?', o: ['Nothing', 'Session goes to CAUTION and grades drop a letter', 'Blocks all trades', 'Doubles XP'], a: 1, why: 'A flagged macro event puts the session on caution: drop the grade one letter or stand down.' },
    { q: 'A level shows RECRUITING. What does that mean?', o: ['Price is far away', 'A candle closed beyond it, inside the floor-to-abandon bracket', 'The entry candle closed back inside', 'The break is real'], a: 1, why: 'Recruiting = a close beyond with penetration inside the bracket. TRIGGERED is the reclaim close: the entry.' },
    { q: 'On which candles are level states judged?', o: ['Whatever timeframe the chart shows', 'Closed 15-minute candles, always', 'Daily candles', 'The forming candle'], a: 1, why: 'States always come from 15-minute closes, whatever timeframe you view.' },
    { q: 'Claude says TRADEABLE NOW but your rules disagree. What happens?', o: ['Claude wins', 'The app downgrades it and shows why', 'The trade is placed', 'The scan is deleted'], a: 1, why: 'The AI can be stricter than your rules, never looser.' },
    { q: 'Where does position size come from?', o: ['Your conviction', 'The leverage you like', 'The stop: 1% risk divided by the stop distance', 'The last trade\'s size'], a: 2, why: 'Rule 1: size comes from the stop, never the other way round.' },
    { q: 'When may you add to a position (rule 13)?', o: ['Whenever it dips', 'After candle-four expansion, at +1R and +2R, after moving the stop so total risk stays at 1R', 'Only at entry', 'Never'], a: 1, why: 'Add only to winners, and never let total risk exceed the original 1R.' },
    { q: 'What are the three orange journal fields?', o: ['Entry, exit, P&L', 'Pen. ATR, Candles to reclaim, OI confirmed', 'Setup, grade, note', 'Fees, funding, leverage'], a: 1, why: 'They calibrate your checklist thresholds; 30 calibrated trades is when they can be tested.' },
    { q: 'When can you change a threshold in the playbook?', o: ['Any time', 'During the monthly review only (rule 11)', 'After a loss', 'When the AI suggests it'], a: 1, why: 'Rules change monthly, never during a session. Auto-tune proposals also wait for the review.' },
    { q: 'What can a weekly-review proposal do?', o: ['Loosen a rule', 'Only make you stricter, and only after you approve it', 'Change your risk %', 'Place a trade'], a: 1, why: 'Proposals can only block a pattern that keeps losing, and nothing applies without your approval.' },
    { q: 'Which earns XP?', o: ['A winning trade', 'Trading more', 'Honoring a NO TRADE verdict', 'Raising leverage'], a: 2, why: 'XP comes from process: honoring NO TRADE is +30. Nothing pays for profit or volume.' },
    { q: 'A scan fails and you want help. What do you share?', o: ['Your API key', 'Settings > Troubleshooting > Copy report', 'Your Bybit password', 'Nothing'], a: 1, why: 'The report holds timings, freezes and errors, never keys, balances or trades.' },
  ],
  cards: [
    ['What TRAP is', 'A read-only coach, journal and market monitor for 15-minute trap setups. It cannot trade.'],
    ['The session loop', 'Check in → Command Center → Monitor → Checklist (+AI) → Planner → trade on Bybit → Journal within 10 min.'],
    ['Level states', 'Dormant, Approaching, Tested, Recruiting, Watch, Triggered, or Dead (ran, timed out, too shallow).'],
    ['TRIGGERED', 'The decisive 15-minute close back inside: the entry. Never before it.'],
    ['C1 to C4', 'Obvious level, recruitment, no follow-through, close back inside. Each 0 to 2, total out of 8.'],
    ['Grades', 'A 7–8, B 5–6, C 3–4, D below 3 (no trade). Caution or counter-trend drops a letter.'],
    ['The two gates (rule 8)', 'Range ≥ 6x ATR and ≥ 4x the stop; round-trip cost under 10% of risk.'],
    ['AI scan', 'Claude scores the checklist on market data only; the app re-checks it. Stricter, never looser.'],
    ['Sizing (rules 1 & 4)', '1% risk from the stop; leverage = risk% ÷ stop%.'],
    ['Liquidation (rule 3)', 'At least 3 stop-widths away.'],
    ['Candle four (rule 6)', 'No expansion by candle four: exit at breakeven.'],
    ['Add-ons (rule 13)', '+1R and +2R, after expansion, stop moved so total risk stays 1R.'],
    ['Orange fields', 'Pen. ATR, Candles to reclaim, OI confirmed. Thirty rows make thresholds testable.'],
    ['Fresh log', 'Within 10 minutes of the close: +30 XP (rule 12).'],
    ['Rule 11', 'Rules change at the monthly review, never during a session.'],
    ['Report card', 'The app replays its own past calls: +2R, −1R or the 8-hour mark, after costs.'],
    ['Personal blocks', 'Patterns you approved blocking; never GO. Proposals can only make you stricter.'],
    ['Troubleshooting', 'Settings > Troubleshooting > Copy report: timings and freezes, no secrets.'],
  ],
};
