// Study guide: Trends. An ORIGINAL guide written for this app, organized around the trend
// topics covered in Jack D. Schwager, "Getting Started in Technical Analysis" (Wiley, 1999).
// Nothing here is quoted from the book. Read the book itself for his full treatment.
import { h, icon } from '../ui.js';
import { candleFig, fromCloses, fig } from './diagrams.js';

const rng = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const P = (...t) => h('p', ...t);
const B = (t) => h('b', t);
const UL = (...items) => h('ul', items.map(i => h('li', i)));
const callout = (kind, ic, ...t) => h(`div.callout.${kind}`, icon(ic), h('div', ...t));
const tbl = (head, rows) => h('table.tbl', { style: { margin: '12px 0' } }, h('thead', h('tr', head.map(x => h('th', x)))),
  h('tbody', rows.map(r => h('tr', r.map(c => h('td', c))))));
const D = (opts, cap) => fig(candleFig({ height: 190, ...opts }), cap);

const GOLD = '#f4c24f'; const TEAL = '#36d7c7'; const RED = '#ef4b4b'; const VIO = '#8b7bff';

/** Exponential moving average of a close path, drawn as a polyline of segs (label on the last piece). */
function emaSegs(closes, n, color, label) {
  const k = 2 / (n + 1); const e = [closes[0]];
  for (let i = 1; i < closes.length; i++) e.push(closes[i] * k + e[i - 1] * (1 - k));
  return e.slice(1).map((v, i) => ({ i0: i, y0: e[i], i1: i + 1, y1: v, color, label: i === e.length - 2 ? label : undefined }));
}

// ---- diagrams (schematic, not market data) ----------------------------------------------
const swings = () => D({ candles: fromCloses([100, 101.6, 103.1, 102.2, 101.4, 102.9, 104.6, 106.2, 105.1, 104.1, 105.7, 107.5, 109.1, 108, 107, 108.8, 110.6, 111.4]),
  marks: [{ i: 2, y: 103.6, label: 'H' }, { i: 5, y: 100.86, label: 'L', dir: 'down' }, { i: 7, y: 106.76, label: 'HH' }, { i: 10, y: 103.75, label: 'HL', dir: 'down' },
    { i: 12, y: 109.72, label: 'HH' }, { i: 15, y: 106.48, label: 'HL', dir: 'down' }, { i: 17, y: 111.49, label: 'HH' }] },
'Uptrend by swing structure: each rally tops out above the last (HH) and each pullback holds above the last (HL). A downtrend is the mirror: lower highs and lower lows.');

const structureBreak = () => D({ candles: fromCloses([100, 101.8, 103.4, 105, 104, 103.1, 104.4, 105.9, 104.8, 103.6, 102.4, 103.3, 104.2, 103.1, 101.6, 100.4, 101.1, 99.6]),
  marks: [{ i: 3, y: 105.71, label: 'H' }, { i: 6, y: 102.67, label: 'L', dir: 'down' }, { i: 7, y: 106.42, label: 'HH' }, { i: 11, y: 102.11, label: 'LL', dir: 'down', color: RED },
    { i: 12, y: 104.55, label: 'LH', color: RED }, { i: 17, y: 99.24, label: 'LL', dir: 'down', color: RED }] },
'The uptrend ends when structure breaks: a pullback undercuts the last higher low, then the next rally fails below the last high. Only at the lower high is the new sequence visible, and only in hindsight is it obvious.');

const redraw = () => D({ candles: fromCloses([100, 100.8, 101.9, 101.3, 100.9, 101.8, 102.9, 102.3, 101.9, 103, 104.6, 104, 105.8, 107.6, 106.8, 108.9, 110.8, 110, 112.2]),
  segs: [{ i0: 0, y0: 99.59, i1: 12, y1: 101.97, color: GOLD, dash: '5 4', label: 'line 1' },
    { i0: 8, y0: 101.68, i1: 18, y1: 106.46, color: GOLD, dash: '5 4', label: 'line 2' },
    { i0: 12, y0: 103.59, i1: 18, y1: 108.79, color: GOLD, label: 'line 3' }] },
'Each acceleration makes the old line irrelevant and invites a steeper one. Which line\'s break "counts" is a judgment call, which is why trend lines look cleaner on old charts than on live ones.');

const breakFails = () => D({ candles: fromCloses([100, 101.2, 102.5, 101.8, 102.9, 104.2, 103.5, 104.8, 106, 105.1, 104.3, 104, 104.6, 104.1, 104.5, 105.6, 106.9, 108.1, 109]),
  segs: [{ i0: 0, y0: 99.59, i1: 13, y1: 105.8, color: GOLD, label: 'trend line' }],
  marks: [{ i: 11, y: 103.81, label: 'line broken', dir: 'down', color: RED }, { i: 18, y: 109.19, label: 'new high' }] },
'A trend-line break that goes nowhere: price closes under the line, drifts sideways, then makes a new high. The break only told you the pace changed, not that the trend reversed.');

const channel = () => D({ candles: fromCloses(rng(20, i => +(100 + 0.5 * i + 1.5 * Math.sin(i * 0.9)).toFixed(2)), { wick: 0.25 }),
  segs: [{ i0: 1, y0: 98.36, i1: 19, y1: 107.3, color: GOLD, label: 'base line' }, { i0: 1, y0: 102.19, i1: 19, y1: 111.16, color: GOLD, dash: '5 4', label: 'channel line' }],
  marks: [{ i: 17, y: 109.5, label: 'falls short', color: RED }] },
'Channel: a parallel line drawn off the swing highs of an uptrend (off the lows in a downtrend). A rally that stalls well short of the channel line hints the trend is losing drive.');

const internal = () => D({ candles: fromCloses([100, 101, 101.8, 101.2, 100.9, 101.9, 103, 103.8, 103.1, 102.8, 103.9, 105, 105.8, 105.1, 104.9, 106, 107.2, 108], { wick: 0.25, special: { 4: { l: 99.6 }, 9: { l: 101.3 } } }),
  segs: [{ i0: 4, y0: 99.6, i1: 17, y1: 104.02, color: RED, dash: '5 4', label: 'wick line' }, { i0: 4, y0: 100.8, i1: 17, y1: 105.37, color: GOLD, label: 'internal line' }],
  marks: [{ i: 4, y: 99.6, label: 'wick', dir: 'down', color: RED }, { i: 9, y: 101.3, label: 'wick', dir: 'down', color: RED }] },
'Conventional vs internal line. The dashed line is anchored on two extreme wicks and price never comes back to it. The internal line runs through where most pullbacks actually stopped, cutting through the outlier wicks.');

const tdLine = () => D({ candles: fromCloses([110, 109, 107.6, 108.4, 109.1, 108, 106.5, 105.2, 106.1, 107, 105.8, 104.4, 103.5, 104.3, 105.1, 104.2, 103.8, 105.3, 106.9, 108.2], { special: { 10: { h: 106.9 } } }),
  segs: [{ i0: 5, y0: 109.58, i1: 10, y1: 106.82, color: GOLD, dash: '5 4' }, { i0: 9, y0: 107.37, i1: 19, y1: 104.0, color: GOLD, label: 'TD line' }],
  marks: [{ i: 9, y: 107.37, label: 'swing high' }, { i: 15, y: 105.35, label: 'swing high' }, { i: 17, y: 105.3, label: 'close above', dir: 'down', color: TEAL }] },
'TD-style line: connect the two most recent qualifying swing highs (swing lows for an up line). When a new swing forms, the line is redrawn from the new points. The faded line is the previous one.');

const maLag = () => {
  const c = [110, 109.2, 108.1, 107.4, 106.2, 105.5, 104.3, 103.8, 103.1, 103.6, 104.5, 105.6, 106.8, 107.9, 108.6, 109.8, 110.5, 111.2, 112];
  return D({ candles: fromCloses(c), segs: emaSegs(c, 8, TEAL, 'EMA'),
    marks: [{ i: 8, y: 102.85, label: 'price low', dir: 'down' }, { i: 11, y: 105.12, label: 'MA turns up', color: TEAL }] },
  'Lag: the average bottoms several bars after price does. A longer average (like a 50 EMA) is smoother and lags far more.');
};

const rangeMA = () => {
  const c = rng(22, i => +(100 + 2 * Math.sin(i * 0.75)).toFixed(2));
  return D({ candles: fromCloses(c, { wick: 0.4 }), segs: emaSegs(c, 8, TEAL, 'EMA'),
    lines: [{ y: 102.3, label: 'range high', color: VIO }, { y: 97.8, label: 'range low', color: VIO }],
    marks: [{ i: 5, y: 100.32, label: 'cross down', color: RED }, { i: 9, y: 99.79, label: 'cross up', color: RED, dir: 'down' }, { i: 13, y: 100.37, label: 'cross down', color: RED }, { i: 17, y: 99.59, label: 'cross up', color: RED, dir: 'down' }] },
  'In a range the average goes flat and price crosses it again and again. Every cross looks like a trend signal and most of them fail. A flat average is itself the regime read: no trend.');
};

const exhaustion = () => D({ candles: fromCloses([100, 100.9, 101.7, 102.9, 102.4, 103.8, 105.3, 107.2, 109.6, 112.4, 110.2, 109, 110.3, 111.1, 109.4, 107.8, 106.2, 105.3], { special: { 9: { h: 114.2 } } }),
  shade: [{ i0: 6, i1: 9, color: 'rgba(244,194,79,.10)' }],
  marks: [{ i: 9, y: 114.2, label: 'climax bar' }, { i: 11, y: 108.61, label: 'last HL', dir: 'down' }, { i: 14, y: 111.34, label: 'lower high', color: RED }, { i: 15, y: 107.34, label: 'HL broken', dir: 'down', color: RED }] },
'Exhaustion: the move goes nearly vertical (shaded), prints a wide climactic bar, fails to exceed it, then breaks the last higher low. Each sign alone is weak; the sequence is what matters, and it is only certain afterwards.');

const aligned = () => D({ candles: fromCloses([106, 105.2, 104.3, 103.4, 102.7, 103.3, 104.1, 103.4, 102.8, 102.2, 103.3, 104.4, 105.6, 106.5], { special: { 4: { l: 102.45 }, 8: { l: 102.5 }, 9: { l: 101.8 } } }),
  lines: [{ y: 102.5, label: '4h level', color: TEAL }],
  marks: [{ i: 9, y: 101.8, label: 'break', dir: 'down', color: RED }, { i: 10, y: 103.3, label: 'close back inside' }] },
'15m view of a pullback inside a 4h uptrend. The break of an obvious 4h level recruits shorts, fails, and closes back inside: a Spring in the direction of the higher-timeframe trend.');

// ---- guide --------------------------------------------------------------------------------
export const TRENDS = {
  id: 'trends',
  title: 'Trends',
  subtitle: 'Defining, drawing and filtering trends, and what the 4h regime means for a trap trader',
  minutes: 40,
  accent: '#8b7bff',
  sections: [
    { id: 'intro', title: 'Why a trap trader studies trends', body: () => h('div',
      h('h2', 'Why a trap trader studies trends'),
      P('Your edge lives at the edges of ranges: a break that recruits traders, fails, and closes back inside. So why spend forty minutes on trends? Because the trend decides which of those failed breaks are worth taking. A Spring inside a 4h uptrend has the higher timeframe pushing it toward target. An Upthrust inside the same uptrend is fighting it. The regime read is the filter that sits above every checklist score.'),
      P('This guide covers how analysts define a trend (swing structure), the tools they draw on it (trend lines, channels, internal lines, TD lines), the tools they compute on it (moving averages), how to tell a trend from a range, how timeframes fit together, and the signs that a trend is running out of fuel. The last section ties each idea to your checklist, the 4h regime and your playbook rules.'),
      callout('warnbox', 'book-open-text', B('Source note. '), 'Written in original words for this app, organized around trend topics covered in Jack D. Schwager, ', h('i', 'Getting Started in Technical Analysis'), ' (Wiley, 1999). It is not a summary of the book\'s text and quotes nothing. Where an idea is standard practice rather than specifically his, it is presented that way. Read the book for his full treatment and charts.'),
      callout('truth', 'triangle-alert', B('The caution that runs through every section. '), 'Trend identification is always clearer in hindsight. On a finished chart every swing, line and turn looks obvious; at the right edge of a live chart you never know whether the last swing is a pullback or the first leg of a reversal. Every method below trades some speed for some reliability, and none removes the uncertainty.'),
      callout('key', 'crosshair', B('Adaptation. '), 'Most classic trend tools were described on daily futures bars. You apply them on 4h and 15-minute candles of a 24/7 leveraged market full of liquidation wicks. Where this guide suggests how an idea carries over, treat it as a hypothesis for your journal to test, not a proven equivalence.')) },

    { id: 'swings', title: 'Defining a trend by swing structure', body: () => h('div',
      h('h2', 'Defining a trend by swing structure'), swings(),
      P('The most widely used definition is structural. An uptrend is a sequence of higher highs and higher lows; a downtrend, lower highs and lower lows. Anything else (a higher high with a lower low, or a lower high with a higher low) is mixed structure, which usually means a range or a transition.'),
      P('Structure beats eyeballed slope because it is anchored to specific prices. A pullback that holds above the last swing low is, by definition, still consistent with the uptrend; one that trades below it has broken the pattern, however it looks.'),
      h('h3', 'What counts as a swing?'),
      P('A definition of trend is only as good as its definition of a swing. A one-bar dip inside a rally is not a swing low; a multi-bar pullback that turns is. Chart analysts commonly use a fixed rule so the choice is objective, for example: a swing high is a bar whose high exceeds the highs of a set number of bars on each side (a swing low is the mirror). The larger that number, the fewer and more significant the swings.'),
      UL(
        [B('Small window (1 bar each side): '), 'catches every wiggle. Fast, but the "trend" flips constantly.'],
        [B('Medium window (2 to 3 bars each side): '), 'the usual compromise. The app\'s 4h regime uses 2 bars each side.'],
        [B('Large window (5+ bars): '), 'only major swings. Stable, but a swing is only confirmed many bars after it happened.']),
      callout('warnbox', 'hourglass', B('The built-in lag. '), 'A swing high defined by "higher than the 2 bars after it" cannot be confirmed until those 2 bars have closed. On 4h candles that is 8 hours after the actual top. Any swing-based trend read is therefore describing the market as it was, not as it is.'),
      h('h3', 'When the trend changes'), structureBreak(),
      P('A common convention: an uptrend is in doubt once price breaks below the most recent higher low, and a downtrend is established once a lower high follows. Between those two events the structure is mixed, and a structural definition should read it as "not a trend", not as "downtrend already".')) },

    { id: 'trendlines', title: 'Trend lines: drawing, redrawing, breaking', body: () => h('div',
      h('h2', 'Trend lines'),
      P('An up trend line connects rising swing lows; a down trend line connects falling swing highs. Two points define a line; a third touch that holds is what makes analysts take it seriously. The line gives a visual reference for where pullbacks have been finding buyers (or rallies finding sellers).'),
      h('h3', 'Drawing conventions'),
      UL('Anchor on swing lows (uptrend) or swing highs (downtrend), not on arbitrary bars.',
        'Decide in advance whether you anchor on wicks or bodies, and be consistent. On a wick-heavy market the choice changes the line a lot (see internal lines below).',
        'A line with a steep angle is fragile: it will be broken by the first sideways pause even if the trend continues.',
        'More touches make a line more visible, which also makes it a more obvious place for stops to cluster.'),
      h('h3', 'Redrawing'), redraw(),
      P('As a trend accelerates or slows, the original line stops describing it and a new line gets drawn. That is legitimate, but it creates a problem: if you can always redraw, a "break" of the line never has to mean anything. This is a big part of why trend lines look authoritative on historical charts and slippery in real time.'),
      h('h3', 'Why a break alone is unreliable'), breakFails(),
      P('A break of a trend line often means only that the market moved from trending to pausing. Price can break the line and go sideways, and the trend can resume from a new, shallower line. Standard practice treats a trend-line break as a warning that needs confirmation (for example, a structural break of the last swing low), not as a reversal signal by itself.'),
      callout('truth', 'shield-check', B('Failed breaks are your territory. '), 'Schwager treats a false trend-line breakout (price pierces the line, then keeps closing back on the original side) as a failed signal that argues for the original trend. That is the same logic as your traps: the traders who acted on the break are now wrong.')) },

    { id: 'channels', title: 'Channels', body: () => h('div',
      h('h2', 'Channels'), channel(),
      P('A channel adds a second line parallel to the trend line. In an uptrend the base line runs along the swing lows and the channel line is drawn parallel through the swing highs; a downtrend is the mirror. The result frames the rhythm of the trend: pullbacks toward the base, rallies toward the channel line.'),
      h('h3', 'How analysts commonly read a channel'),
      UL(
        [B('Rallies falling short '), 'of the channel line suggest the trend is losing drive, an early (and unreliable) hint of weakening.'],
        [B('A strong push through the channel line '), 'can mean acceleration, and the channel may need redrawing wider or steeper. It is not automatically a reversal signal.'],
        [B('The base line '), 'behaves like any trend line: its break is a warning that needs structural confirmation.']),
      callout('warnbox', 'info', B('Channels are not ranges. '), 'A sloping channel\'s "boundaries" move every bar. Your C1 wants an obvious horizontal level with 3+ touches on the 4h chart. A channel line is a weak substitute: fewer traders draw it the same way, so fewer are trapped when it fails. Treat channel touches as context, not as C1 levels.')) },

    { id: 'internal', title: 'Internal trend lines', body: () => h('div',
      h('h2', 'Internal trend lines'), internal(),
      P('A conventional trend line must touch the extreme points and must not be crossed by prices between them. An internal trend line drops that requirement: it is drawn through the bulk of the price action, so that it lines up with as many relative lows (or highs) as possible, even if that means slicing through a few extreme wicks.'),
      P('Schwager is a known advocate of internal trend lines. The usual argument for them, in plain terms: the extreme points of a move are often its least representative prices (a spike, a panic, a thin moment), and forcing a line through them can produce a line the market never respects again. A line through where most turns actually happened may describe support and resistance better.'),
      h('h3', 'The trade-off'),
      UL('More subjective: two analysts can draw different internal lines on the same chart. There is no single correct one.',
        'Less mechanical to "break": price is already allowed to poke through, so you need a rule for what counts as a real violation (for example, closes rather than wicks).',
        'Often closer to where price actually reacts, which is the whole point.'),
      callout('key', 'lightbulb', B('Why this matters on perps. '), 'On leveraged crypto, the extreme wicks are frequently liquidation cascades or stop runs: exactly the events your Sweep setup trades. A line anchored on those wicks bakes a one-off flush into your map of the trend. A working hypothesis worth testing in your journal: on 15m and 4h perp charts, lines drawn through bodies and clustered lows describe the trend better than lines drawn through the most extreme wicks.')) },

    { id: 'td', title: 'TD lines: objective trend lines', body: () => h('div',
      h('h2', 'TD lines'), tdLine(),
      P('The weakness of every hand-drawn line is choice: which points, how many, when to redraw. Tom DeMark proposed trend lines defined by rules instead of by eye, now usually called TD lines, and Schwager discusses them as a way to make trend-line drawing objective.'),
      h('h3', 'The general idea'),
      UL('Define swing points by a fixed rule (a high above a set number of surrounding bars, or a low below them), so everyone gets the same points.',
        'Draw the down line through the two most recent qualifying swing highs, with the more recent one lower; the up line through the two most recent qualifying swing lows, with the more recent one higher.',
        'Emphasize the most recent price action: as soon as a new qualifying swing appears, the line is redrawn from the latest two points. The line always describes the current leg, not the start of the trend.',
        'A break of the line is judged by rule as well (for example by closes), rather than by impression.'),
      callout('warnbox', 'info', B('Details are in the sources. '), 'DeMark\'s exact definitions of qualifying points and his extra conditions for accepting or rejecting a breakout are more specific than this outline. This guide gives only the concept; read Schwager\'s discussion and DeMark\'s own work before relying on any particular rule set.'),
      P('The value for you is not the specific rule but the discipline: the same inputs always give the same line. That is the same philosophy as your checklist, and it is exactly how the app\'s 4h regime reads swings (a fixed 2-bar-each-side rule, no eyeballing).')) },

    { id: 'ma', title: 'Moving averages as trend filters', body: () => h('div',
      h('h2', 'Moving averages as trend filters'),
      P('A moving average smooths price into a single line. Analysts commonly use it as a filter rather than a trigger: trade long only while the average is rising (or price is above it), short only while it is falling. An exponential moving average (EMA) weights recent bars more heavily than a simple average, so it reacts a little faster.'),
      h('h3', 'The cost: lag'), maLag(),
      P('Every average describes the past. It turns only after price has already turned, and the longer the period, the later the turn. That is the trade: a long average ignores noise but tells you late; a short one tells you early but flips on every wiggle. There is no period that is both quick and quiet.'),
      h('h3', 'Slope beats crossings'), rangeMA(),
      P('In a range, price crosses a flat average over and over, and each cross looks like a signal. A common convention is to judge the average\'s slope over a fixed lookback instead: rising, falling, or flat. A flat average is useful information in itself, since it says the market is not trending.'),
      tbl(['Use', 'Good at', 'Weak at'], [
        ['Slope of a long average', 'Filtering direction, staying out of fights with the higher timeframe', 'Calling turns: it confirms a new trend long after it began'],
        ['Price above/below the average', 'A quick read of which side has control', 'Ranges, where price whipsaws across it'],
        ['Crossovers of two averages', 'Mechanical, easy to test', 'Chop: many small losses between the few big trends']]),
      callout('key', 'trending-up', B('Your 50 EMA. '), 'The app computes a 50 EMA on 4h closes and measures its slope over the last 6 bars (24 hours). It is used only as a confirming filter alongside swing structure, never as a signal on its own. That combination guards against the two classic errors: calling a trend from structure while the average is still falling, or from the average while structure is mixed.')) },

    { id: 'regimes', title: 'Trend vs range, and timeframe alignment', body: () => h('div',
      h('h2', 'Trend or range: which one are you in?'),
      P('Markets spend a large share of their time moving sideways. Trend tools lose money in ranges (whipsaws), and range tools lose money in trends (fading a move that keeps going). So the first question on any chart is which regime you are in, and the honest answer is sometimes "unclear".'),
      tbl(['Evidence', 'Trending', 'Ranging'], [
        ['Swing structure', 'Consistent HH + HL (or LH + LL)', 'Mixed: highs and lows overlap'],
        ['Long moving average', 'Clearly sloped', 'Flat, price crossing it repeatedly'],
        ['Breaks of prior swings', 'Follow through', 'Reverse back inside'],
        ['Pullbacks', 'Shallow, hold above prior lows', 'Travel the full width of the range'],
        ['Horizontal levels', 'Broken and left behind', 'Tested repeatedly (the 3+ touches your C1 wants)']]),
      callout('truth', 'triangle-alert', 'Regime labels are lagging. A range is only visible after several touches, and a trend only after a couple of swings. The transition between them is exactly where every classifier (including the app\'s) is wrong for a while.'),
      h('h2', 'Timeframe alignment'),
      P('A 15-minute uptrend can sit inside a 4h downtrend, which can sit inside a weekly uptrend. Each timeframe answers a different question. A widely used arrangement is to take direction from the higher timeframe and timing from the lower one.'),
      tbl(['Timeframe', 'Question it answers', 'In your process'], [
        ['4h', 'Which way is the tide running? Where are the obvious levels?', 'Regime read and C1 levels'],
        ['15m', 'Did this break recruit, stall and fail? Where exactly is the entry?', 'C2 to C4, the decisive close, the stop']]),
      aligned(),
      P('The logic behind alignment: when a 15m trap fires in the direction of the 4h trend, the trapped traders\' exits and the higher-timeframe flow push the same way. When it fires against the 4h trend, the reversal has to overcome the bigger tide. That is a plausible mechanism, not a measured fact for your markets. The app stores the 4h regime with each logged trade, which is how you find out.')) },

    { id: 'exhaustion', title: 'Signs of trend exhaustion', body: () => h('div',
      h('h2', 'Signs of trend exhaustion'), exhaustion(),
      P('Trends do not end on a bell. Analysts commonly watch for a cluster of warnings, each weak alone:'),
      UL(
        [B('Parabolic acceleration: '), 'the move goes nearly vertical and the trend lines keep needing to be redrawn steeper.'],
        [B('Climactic bars: '), 'an unusually wide bar (often with a long wick against the trend) after an extended move.'],
        [B('Failure to follow through: '), 'a new high that immediately falls back, or a rally that falls short of the channel line.'],
        [B('Lower high after a higher high: '), 'the first crack in the swing sequence.'],
        [B('Break of the last higher low: '), 'the structural confirmation that the uptrend, as defined, is over.'],
        [B('Crypto-specific context: '), 'stretched funding and a large build of open interest in the trend direction can mean a crowded side. This is positioning evidence, not a timing signal.']),
      callout('warnbox', 'triangle-alert', B('Exhaustion is a hindsight label. '), 'Many "climactic" bars are followed by more trend. Picking the top of a strong move is one of the most expensive habits in trading. The sequence above is useful mainly for knowing when a trend read has become fragile, not for calling the exact turn.'),
      h('h3', 'Where your setups meet exhaustion'),
      P('An Upthrust at the high of an extended uptrend is, by construction, a counter-trend trap: the 4h regime will still say "uptrend" until structure actually breaks, because swing confirmation lags. That is uncomfortable but intended. The regime does not try to call tops, and your playbook does not ask you to either.'),
      h('h3', 'Midtrend entries are covered elsewhere'),
      P('Joining an established trend on pullbacks, and adding to a winner as it extends, is a different skill from trading failed breaks. It is only mentioned here; see the "Trade Variations" guide for midtrend entry and pyramiding, and rule 13 for how add-ons work in your playbook.')) },

    { id: 'mapping', title: 'Mapping it to your trading', body: () => h('div',
      h('h2', 'Mapping it to your trading'),
      h('h3', 'The 4h regime, exactly'),
      P('The app reads the 4h chart with the same swing logic this guide describes. Swing highs and lows are found with a fixed 2-bars-each-side rule. It then compares the last two swing highs and the last two swing lows, and checks the slope of the 50 EMA over the last 24 hours:'),
      tbl(['Regime', 'Condition', 'Permitted trap direction'], [
        ['Uptrend', 'Higher high AND higher low AND 50 EMA rising', 'Long only (Spring, bullish Sweep or Failed retest)'],
        ['Downtrend', 'Lower high AND lower low AND 50 EMA falling', 'Short only (Upthrust, bearish Sweep or Failed retest)'],
        ['Range', 'Anything else: mixed structure, or structure and EMA disagree', 'Both directions']]),
      P('In a clean trend the playbook only traps in the trend direction. Counter-trend candidates are not hidden: the monitor still lists them, using regime alignment as a tiebreaker after trigger state and C1 (so a counter-trend candidate ranks below an aligned one with the same state and C1), a TRIGGERED alert on one says it is counter to the 4h regime, and the checklist verdict for it is NO TRADE. Treat that note as the playbook speaking.'),
      h('h3', 'Checklist and rules'),
      tbl(['Trend idea', 'Where it lands', 'How'], [
        ['Swing structure on the 4h', 'Regime read', 'Decides which direction of trap is permitted before you score anything.'],
        ['Horizontal levels that hold across swings', 'C1', 'Obvious 4h level with 3+ touches plus a visible liquidation cluster. Trend lines, channels and TD lines are context, not C1 levels.'],
        ['Trend vs range', 'Rule 8 and rule 9', 'Range height at least 6x ATR and 4x the stop; no trade in the middle third of the range. When a trend carries price away from its old range, the working range between the nearest qualified levels may be too narrow to pass rule 8.'],
        ['Failed trend-line breaks', 'Your four setups', 'Same mechanism as a trap: the break recruits, fails, and the recruits are forced out.'],
        ['Hindsight bias', 'Rule 11 and rule 12', 'Do not redefine the regime mid-session because the chart "obviously" turned. Log every trade within 10 minutes, taken or skipped, so the regime at the time is on record for the monthly review.']]),
      h('h3', 'Rule 9 in a trending market'),
      P('Rule 9 says no trade in the middle third of the range, and the regime never overrides it. A strong trend can make a mid-range entry feel safe ("the trend will carry it"), but the rule does not change with the regime. What the regime changes is which boundary is worth watching: in a clean uptrend, the lower boundary for a Spring; in a clean downtrend, the upper boundary for an Upthrust.'),
      h('h3', 'Targets and the trend'),
      P('Your default targets (Spring to range high, Upthrust to range low, Sweep to prior swing, Failed retest to prior range; the planner\'s "opposite range boundary") do not change with the regime. What the trend changes is the odds of reaching them, which is a question for your journal, not for in-session judgment.'),
      callout('key', 'notebook-pen', B('What to watch in your journal. '), 'The app stores the 4h regime with each logged trade, and its learning analysis sorts trades into with trend, against trend, and range. After enough logged trades, compare the three groups. If counter-trend traps really are weaker for you, the data will show it; if range-regime trades carry the edge, that will show too. Change the rule at the monthly review, never during a session.'),
      callout('truth', 'shield-check', B('The one-line version. '), 'Read the 4h trend by structure plus a sloped 50 EMA, trap with it when it is clean, treat everything else as a range, and remember that every trend read is a statement about the recent past.')) },
  ],
  quiz: [
    { q: 'Which sequence defines an uptrend by swing structure?', o: ['Rising volume on up bars', 'Higher highs and higher lows', 'Price above a trend line', 'A bullish moving-average crossover'], a: 1, why: 'Structure is anchored to specific swing prices; the other items are supporting evidence at best.' },
    { q: 'Why is a single trend-line break unreliable as a reversal signal?', o: ['Trend lines never break', 'Breaks only happen on low volume', 'A break often means only a pause, and the line can be redrawn', 'Trend lines only work on daily bars'], a: 2, why: 'Price can break the line and go sideways, then resume; standard practice waits for structural confirmation.' },
    { q: 'What distinguishes an internal trend line from a conventional one?', o: ['It is drawn through the bulk of prices, ignoring some extreme wicks', 'It is always horizontal', 'It uses closing prices only on weekly bars', 'It is drawn from the first bar of the trend'], a: 0, why: 'It aligns with as many relative lows or highs as possible, even if it cuts through outlier extremes. Schwager advocates this approach.' },
    { q: 'The core idea of TD lines is…', o: ['Drawing lines by eye through three touches', 'Connecting the two most recent qualifying swing points by a fixed rule', 'Using a 50-period moving average as a line', 'Drawing lines from the start of the trend'], a: 1, why: 'Objective swing points, most recent price action, redrawn as new swings form. Exact qualifiers are in DeMark\'s and Schwager\'s material.' },
    { q: 'What is the main cost of a longer moving average?', o: ['More whipsaws', 'It cannot be computed on 4h bars', 'It ignores closes', 'More lag'], a: 3, why: 'Longer periods are smoother but turn later after price turns.' },
    { q: 'Price keeps crossing a flat 50 EMA. The most likely regime is…', o: ['A strong uptrend', 'A strong downtrend', 'An exhaustion top', 'A range'], a: 3, why: 'A flat average with repeated crosses is the classic signature of a sideways market.' },
    { q: 'The 4h shows a higher high and a higher low, but the 50 EMA is falling. The app\'s regime reads…', o: ['Uptrend', 'Downtrend', 'Range (both directions permitted)', 'Unknown'], a: 2, why: 'Uptrend requires HH, HL AND a rising 50 EMA. When structure and the average disagree, it reads range.' },
    { q: 'The 4h regime is a clean uptrend. A 15m Upthrust triggers at a range high. Per your playbook…', o: ['It is counter-trend: the playbook only traps with the trend in a clean trend', 'Take it at double size', 'It is automatically a Spring', 'Ignore the 4h and trade the 15m only'], a: 0, why: 'In a clean trend, only traps in the trend direction; the checklist returns NO TRADE for a counter-trend candidate.' },
    { q: 'Why can the 4h regime still say "uptrend" right at an exhaustion top?', o: ['It uses future data', 'Swing points need later bars to confirm, so structure breaks are recognized late', 'It ignores highs', 'Funding overrides it'], a: 1, why: 'A 2-bars-each-side swing needs two more 4h closes (8 hours) to confirm; every structural read lags.' },
    { q: 'In the timeframe-alignment scheme used here, the 4h provides…', o: ['The entry candle', 'Direction and the obvious levels (C1)', 'The stop distance', 'The OI drop for C4'], a: 1, why: '4h gives regime and levels; the 15m gives C2 to C4, the entry close and the stop.' },
    { q: 'Price sits in the middle third of the working range during a strong uptrend. What applies?', o: ['Trade long since the trend is up', 'Rule 9: no trade in the middle third', 'Rule 6: exit at breakeven', 'Rule 13: add on'], a: 1, why: 'The regime narrows direction; it never overrides rule 9.' },
    { q: 'Which statement about trend identification is most accurate?', o: ['A good indicator makes it clear in real time', 'Trend lines remove the uncertainty', 'It is always clearer in hindsight than at the right edge of the chart', 'Exhaustion bars reliably mark tops'], a: 2, why: 'Every method trades speed for reliability; none removes real-time uncertainty.' },
  ],
  cards: [
    ['Uptrend (structure)', 'Higher highs and higher lows. Downtrend: lower highs and lower lows.'],
    ['Swing high (rule-based)', 'A bar whose high exceeds a set number of bars on each side. The app uses 2 on the 4h.'],
    ['Swing lag', 'A swing needs later bars to confirm it: 2 bars on the 4h means about 8 hours late.'],
    ['Trend-line break', 'A warning that the pace changed. Needs structural confirmation to mean reversal.'],
    ['Redrawing', 'Legitimate, but if you can always redraw, a break never has to mean anything.'],
    ['Channel', 'Parallel line off the opposite swings. Falling short of it hints at weakening.'],
    ['Internal trend line', 'Drawn through the bulk of prices, ignoring extreme wicks. Advocated by Schwager.'],
    ['TD line', 'DeMark: connect the two most recent qualifying swing points by rule; redraw as new swings form.'],
    ['Moving-average lag', 'Longer average: quieter but later. No period is both quick and quiet.'],
    ['Flat average', 'A regime read in itself: no trend. Crossings in a range are whipsaws.'],
    ['4h regime', 'HH + HL + rising 50 EMA = uptrend (longs only). Mirror = downtrend. Anything else = range.'],
    ['Counter-trend trap', 'A trap against a clean 4h trend. Still shown and flagged, but the checklist says NO TRADE; the playbook only traps with the trend.'],
    ['Timeframe roles', '4h: direction and C1 levels. 15m: C2 to C4, the decisive close, the stop.'],
    ['Exhaustion signs', 'Acceleration, climax bar, lower high, break of the last higher low. Only certain afterwards.'],
    ['Midtrend entries', 'Not this guide. See "Trade Variations" and rule 13.'],
  ],
};
