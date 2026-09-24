// Study guide: Chart patterns and failed signals. An ORIGINAL guide written for this
// app, organized around the topics in Jack D. Schwager, "Getting Started in Technical
// Analysis" (Wiley, 1999). Nothing here is quoted from the book. Read the book itself.
import { h, icon } from '../ui.js';
import { candleFig, fromCloses, fig } from './diagrams.js';

const rng = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const w = (i, a = 0.3) => Math.sin(i * 1.9) * a + Math.cos(i * 0.7) * a * 0.5;
const P = (...t) => h('p', ...t);
const callout = (kind, ic, ...t) => h(`div.callout.${kind}`, icon(ic), h('div', ...t));
const D = (opts, cap) => fig(candleFig({ height: 190, ...opts }), cap);

// ---- diagrams -------------------------------------------------------------
const up = () => D({ candles: fromCloses([100, 101.5, 103, 102, 101.2, 102.6, 104.4, 106, 105, 104.2, 105.8, 107.6, 109.2, 108.1, 107.3, 109, 111]),
  marks: [{ i: 4, y: 100.8, label: 'HL', dir: 'down' }, { i: 7, y: 106.4, label: 'HH' }, { i: 9, y: 103.8, label: 'HL', dir: 'down' }, { i: 12, y: 109.6, label: 'HH' }, { i: 14, y: 106.9, label: 'HL', dir: 'down' }],
  segs: [{ i0: 4, y0: 100.9, i1: 16, y1: 108.2, color: '#f4c24f', label: 'trend line' }] }, 'Uptrend: higher highs and higher lows. The trend line is useful but often needs redrawing as the trend extends.');
const range = () => D({ candles: fromCloses([...rng(22, i => 100 + Math.sin(i * 0.8) * 2.2 + w(i, 0.2))], { wick: 0.5 }),
  lines: [{ y: 102.6, label: 'ceiling', color: '#36d7c7' }, { y: 97.5, label: 'floor', color: '#36d7c7' }] }, 'Trading range: trend-following signals tend to fail inside it. A breakout beyond a boundary is a potential trend start.');
const flip = () => D({ candles: fromCloses([96, 97.5, 99.4, 100.6, 99.2, 98.2, 99.1, 100.4, 99.3, 98.6, 100.2, 102.5, 104, 103, 101.8, 100.9, 101.6, 103.2, 105, 106.5]),
  lines: [{ y: 100.8, label: 'old resistance = new support' }], marks: [{ i: 15, y: 100.5, label: 'role reversal', dir: 'down' }] }, 'Support and resistance switch roles once broken.');
const gaps = () => {
  const c = [100, 100.6, 100.1, 100.7, 100.3, 103.5, 104.4, 105.1, 107.9, 108.8, 109.6, 112.8, 111.9, 109.5, 108.2];
  const sp = { 5: { o: 102.8, l: 102.6 }, 8: { o: 107.2, l: 107.0 }, 11: { o: 111.8, l: 111.6, h: 113.4 } };
  return D({ candles: fromCloses(c, { special: sp, wick: 0.25 }), marks: [{ i: 2, y: 100.9, label: 'common' }, { i: 5, y: 104.1, label: 'breakaway' }, { i: 8, y: 108.6, label: 'runaway' }, { i: 11, y: 113.6, label: 'exhaustion' }] }, 'Gap types, in the order they tend to appear across a move. An exhaustion gap can only be told apart from a runaway gap after the fact.');
};
const spike = () => {
  const c = [100, 101, 102.2, 103.4, 104.6, 105.2, 104.1, 103.5, 103, 102.1, 101.5, 101.2];
  return D({ candles: fromCloses(c, { special: { 5: { o: 104.8, c: 104.9, h: 109.5, l: 104.3 } } }), marks: [{ i: 5, y: 109.5, label: 'spike high' }] }, 'Spike high: a bar whose high stands well above its neighbors, closing near its low after a rally. The wider the gap to neighboring highs and the weaker the close, the more it counts.');
};
const thrust = () => D({ candles: fromCloses([100, 100.4, 100.1, 101.9, 102.2, 102.0, 103.8, 104.1], { special: { 3: { h: 102.1 }, 6: { h: 104.0 } } }),
  marks: [{ i: 3, y: 102.4, label: 'up-thrust' }, { i: 6, y: 104.3, label: 'up-thrust' }] }, 'Thrust day: closes above the prior bar\'s high (up-thrust) or below the prior low (down-thrust). Clusters of them show strength.');
const wrd = () => D({ candles: fromCloses([100, 101, 102.3, 103.1, 104, 104.8, 101.4, 101.9, 101.2, 100.6], { special: { 6: { o: 105.2, h: 106.4, l: 101, c: 101.4 } } }),
  lines: [{ y: 106.4, label: 'WRD high', color: '#f4c24f' }], marks: [{ i: 6, y: 106.6, label: 'wide-ranging day' }] }, 'Wide-ranging day after an advance that closes against the trend: a warning of reversal. Its far extreme becomes an important reference.');
const tri = () => D({ candles: fromCloses([...rng(18, i => 100 + Math.sin(i * 1.1) * (3 - i * 0.15)), 101.8, 103.2, 104.6], { wick: 0.25 }),
  segs: [{ i0: 1, y0: 103, i1: 17, y1: 100.5, color: '#f4c24f' }, { i0: 3, y0: 97.2, i1: 17, y1: 99.6, color: '#f4c24f' }], marks: [{ i: 19, y: 103.6, label: 'breakout' }] }, 'Triangle: a range that narrows as highs and lows converge. A breakout in the trend direction confirms continuation.');
const flag = () => D({ candles: fromCloses([100, 101.8, 103.9, 106.1, 108, 107.4, 106.9, 107.3, 106.6, 106.1, 106.5, 105.9, 107.8, 109.6, 111.2]),
  segs: [{ i0: 4, y0: 108.3, i1: 11, y1: 106.9, color: '#f4c24f' }, { i0: 5, y0: 106.9, i1: 11, y1: 105.5, color: '#f4c24f' }], marks: [{ i: 12, y: 108.2, label: 'resumes' }] }, 'Flag: a small, tight parallel channel after a sharp move. A pennant is the same idea drawn as a small converging triangle.');
const dtop = () => D({ candles: fromCloses([100, 102, 104.5, 106.8, 108, 106.4, 104.6, 105.8, 107.4, 107.9, 106, 104, 102.8, 101.5, 100.4]),
  lines: [{ y: 104.4, label: 'confirmation line' }], marks: [{ i: 4, y: 108.4, label: 'top 1' }, { i: 9, y: 108.3, label: 'top 2' }, { i: 12, y: 102.4, label: 'confirmed', dir: 'down' }] }, 'Double top: two tests of about the same high. Only confirmed when price breaks the low between the peaks.');
const hs = () => D({ candles: fromCloses([100, 102, 104, 103, 101.8, 103.5, 106.2, 108, 105.5, 102.3, 103.6, 105, 104, 102.5, 100.8, 99.2, 98]),
  lines: [{ y: 101.9, label: 'neckline' }], marks: [{ i: 2, y: 104.4, label: 'L shoulder' }, { i: 7, y: 108.4, label: 'head' }, { i: 11, y: 105.4, label: 'R shoulder' }] }, 'Head-and-shoulders: three peaks, the middle highest. The signal is a break of the neckline under the two troughs.');
const wedge = () => D({ candles: fromCloses([...rng(18, i => 100 + i * 0.45 + Math.sin(i * 1.2) * (1.6 - i * 0.07)), 106.2, 104.1, 102.3], { wick: 0.25 }),
  segs: [{ i0: 1, y0: 102, i1: 17, y1: 108.3, color: '#f4c24f' }, { i0: 2, y0: 99.1, i1: 17, y1: 107.1, color: '#f4c24f' }] }, 'Rising wedge: converging, sloping with the trend but losing momentum. It usually breaks against the slope.');
const island = () => D({ candles: fromCloses([100, 101.5, 102.8, 104, 107.4, 108.1, 107.5, 108.3, 104.2, 103.1, 101.9], { special: { 4: { o: 106.4, l: 106.2 }, 8: { o: 105.2, h: 105.4 } } }),
  shade: [{ i0: 4, i1: 7, color: 'rgba(244,194,79,.10)' }], marks: [{ i: 6, y: 109, label: 'island' }] }, 'Island reversal: a cluster of bars cut off by a gap on each side, in opposite directions.');

// failed signals
const bullTrap = () => D({ candles: fromCloses([...rng(12, i => 99 + Math.sin(i * 1.1) * 1.3), 101.4, 101.9, 100.2, 99.1, 97.8, 96.6, 95.9]),
  lines: [{ y: 100.9, label: 'range high' }], marks: [{ i: 13, y: 102.3, label: 'breakout' }, { i: 14, y: 99.8, label: 'back inside = failed', dir: 'down', color: '#ef4b4b' }] }, 'Bull trap: an upside breakout that falls back into the range. The mirror at the low is a bear trap. In your playbook these are the Upthrust and the Spring.');
const falseTL = () => D({ candles: fromCloses([100, 101.2, 102.6, 101.9, 103.1, 104.5, 103.6, 104.8, 104.1, 105.9, 107.2, 108.6]),
  segs: [{ i0: 0, y0: 99.6, i1: 11, y1: 105.8, color: '#f4c24f', label: 'trend line' }], marks: [{ i: 6, y: 103.1, label: 'pierced, closed back above', dir: 'down', color: '#ef4b4b' }] }, 'False trend-line breakout: price pierces the line but closes back on the original side. Trade with the original trend.');
const spikeRet = () => D({ candles: fromCloses([100, 101.2, 102.6, 104, 104.5, 103.2, 102.4, 102.9, 103.8, 104.9, 106.3, 107.8], { special: { 4: { o: 104.1, c: 104.2, h: 108, l: 103.9 } } }),
  lines: [{ y: 108, label: 'spike high' }], marks: [{ i: 4, y: 108.3, label: 'spike' }, { i: 11, y: 108.3, label: 'returns: spike voided', color: '#ef4b4b' }] }, 'Return to a spike extreme: when price later trades back through the spike\'s high, the spike\'s reversal meaning is cancelled.');
const flagFail = () => D({ candles: fromCloses([100, 101.8, 103.9, 106.1, 108, 107.4, 106.9, 107.3, 106.6, 105.1, 103.6, 102]),
  segs: [{ i0: 4, y0: 108.3, i1: 8, y1: 107.3, color: '#f4c24f' }, { i0: 5, y0: 106.9, i1: 8, y1: 106.1, color: '#f4c24f' }], marks: [{ i: 9, y: 104.8, label: 'breaks against the trend', dir: 'down', color: '#ef4b4b' }] }, 'Counter-to-anticipated flag breakout: the flag breaks against the prevailing trend. A strong clue the trend is failing.');
const topPen = () => D({ candles: fromCloses([100, 102, 104.5, 106.8, 108, 106.4, 104.6, 105.8, 107.4, 107.9, 106, 104, 105.2, 107.1, 108.9, 110.2]),
  lines: [{ y: 108.2, label: 'top extreme' }], marks: [{ i: 14, y: 109.2, label: 'penetrates top', color: '#ef4b4b' }] }, 'Penetration of a completed top formation: once price moves beyond the formation\'s extreme, the top has failed and the prior trend is likely resuming.');

// ---- guide --------------------------------------------------------------------
export const SCHWAGER = {
  id: 'schwager',
  title: 'Chart Patterns & Failed Signals',
  subtitle: 'An original study guide to the patterns in Schwager\'s "Getting Started in Technical Analysis"',
  minutes: 40,
  accent: '#d55181',
  sections: [
    { id: 'intro', title: 'Why this guide exists', body: () => h('div',
      h('h2', 'Why this guide exists'),
      P('Your trap checklist is derived from Jack Schwager\'s work on failed signals and adapted for a 24-hour leveraged market. This guide walks the chart patterns his book covers, then spends the most time on the part your strategy is built on: what happens when a textbook signal fails.'),
      callout('warnbox', 'book-open-text', h('b', 'Source note. '), 'Written in original words for this app, organized around topics in Jack D. Schwager, ', h('i', 'Getting Started in Technical Analysis'), ' (Wiley, 1999). It is not a summary of any chapter\'s text and quotes nothing. The book\'s chapter on failed signals is titled "The Most Important Rule in Chart Analysis." Read the book for his full treatment and charts.'),
      callout('key', 'crosshair', h('b', 'Adaptation. '), 'Schwager framed one-day patterns on daily futures bars. Your strategy applies the same logic to 15-minute perpetual candles in a market that never closes. Treat the mapping as an analogy that your own journal must validate, not as a proven equivalence.')) },
    { id: 'trends', title: 'Trends and trend lines', body: () => h('div',
      h('h2', 'Trends'), up(),
      P('An uptrend is a series of higher highs and higher lows; a downtrend, lower highs and lower lows. Defining the trend by swing structure is more robust than eyeballing slope.'),
      P('Trend lines connect those lows (or highs). They help, but they are often redrawn as a trend extends, and they look far better in hindsight than in real time. Breaks of trend lines are unreliable on their own.'),
      callout('key', 'lightbulb', 'The app\'s 4h regime uses exactly this swing logic: higher high plus higher low (with a rising 50 EMA) is an uptrend. In a clean trend, your playbook only traps in the trend direction.')) },
    { id: 'ranges', title: 'Ranges, support and resistance', body: () => h('div',
      h('h2', 'Trading ranges'), range(),
      P('Much of the time, markets move sideways between a fairly clear ceiling and floor. Trend-following signals whipsaw inside ranges. A move beyond a boundary is a potential signal that a trend is beginning, and it is also the raw material for a trap when it fails.'),
      h('h2', 'Support and resistance'), flip(),
      P('Zones where declines or rallies have stalled before: prior major highs and lows, and places where several minor highs or lows cluster. Once broken, they often switch roles: old resistance becomes support, old support becomes resistance.'),
      callout('key', 'layers', 'This is your C1 test. The level must be obvious to everyone: a range boundary with three or more touches, a higher-timeframe swing, a prior day or week extreme, a round number. If three other traders would not draw it, nobody will be trapped at it.')) },
    { id: 'oneday', title: 'One-day patterns', body: () => h('div',
      h('h2', 'One-day patterns'),
      h('h3', 'Gaps'), gaps(),
      h('ul', h('li', h('b', 'Common gap: '), 'inside a trading range; little meaning.'), h('li', h('b', 'Breakaway gap: '), 'price jumps beyond a range boundary. Significant if it is not filled within a few bars.'),
        h('li', h('b', 'Runaway gap: '), 'appears as a strong trend accelerates, sometimes several in a row.'), h('li', h('b', 'Exhaustion gap: '), 'late in a long move, followed by reversal.')),
      callout('warnbox', 'info', 'A 24-hour crypto perpetual rarely gaps between candles. The concept matters most at weekend-style liquidity holes and on exchange outages.'),
      h('h3', 'Spike highs and lows'), spike(),
      h('h3', 'Thrust days'), thrust(),
      h('h3', 'Run days'), P('An up-run day has a high above the highest high of the preceding several bars and a low below the lowest low of the following several bars (a down-run day is the reverse). Because it uses future bars, it can only be identified after the fact: a way to read trend strength, not an entry.'),
      h('h3', 'Reversal days'), P('The common definition: in an advance, a bar makes a new high and then closes lower, below the prior close or, in a stronger version, below the prior bar\'s low. Mirror image for reversal lows. Schwager\'s exact criteria may differ from this standard definition; check the book.'),
      h('h3', 'Wide-ranging days'), wrd(),
      P('A bar whose true range is much larger than usual. Schwager\'s volatility ratio compares today\'s true range with the recent average true range; one charting site uses a ratio above 2.0 as its threshold (that threshold is theirs, not necessarily his).'),
      callout('key', 'crosshair', 'Your C2 asks for a break candle whose range is at or above ATR and expanded relative to the prior candles: a wide-ranging bar. A wide-ranging bar that recruits and then fails is the fuel for your trap.')) },
    { id: 'continuation', title: 'Continuation patterns', body: () => h('div',
      h('h2', 'Continuation patterns'), P('Pauses inside a trend that usually resolve in the trend\'s direction.'),
      h('h3', 'Triangles'), tri(),
      h('h3', 'Flags and pennants'), flag(),
      P('A breakout from any of these in the trend direction confirms continuation. What matters most for you is what happens when that expected breakout goes the wrong way, covered under failed signals.')) },
    { id: 'tops', title: 'Top and bottom formations', body: () => h('div',
      h('h2', 'Top and bottom formations'),
      h('h3', 'V tops and bottoms'), P('A sharp reversal with no consolidation. Easy to see afterwards and hard to trade in real time.'),
      h('h3', 'Double tops and bottoms'), dtop(),
      h('h3', 'Head-and-shoulders'), hs(),
      h('h3', 'Rounding tops and bottoms'), P('A slow, curved change of direction. Its failure (price stops following the curve) is itself a signal, covered below.'),
      h('h3', 'Wedges'), wedge(),
      h('h3', 'Island reversals'), island()) },
    { id: 'failed', title: 'The most important rule: failed signals', body: () => h('div',
      h('h2', 'Failed signals'),
      callout('truth', 'shield-check', h('b', 'The core idea. '), 'A failed signal is among the most reliable signals on a chart. When price does not follow through on a textbook pattern, the traders who acted on it are wrong-footed, and their exits can drive a hard move the other way. The rule that follows: if a trade based on a chart signal fails, get out, and consider the opposite direction.'),
      h('h3', 'Bull and bear traps'), bullTrap(),
      h('h3', 'False trend-line breakouts'), falseTL(),
      P('A pierce of the trend line that keeps closing back on the original side argues for the original trend, and is more trustworthy than an ordinary trend-line break.'),
      h('h3', 'Return to spike extremes'), spikeRet(),
      h('h3', 'Return to wide-ranging-day extremes'), P('The same logic for a wide-ranging bar: when price later moves back through its far extreme, the bar\'s implied reversal has failed.'),
      h('h3', 'Flag and pennant failures'), flagFail(),
      P('Two versions: a breakout against the prevailing trend (counter to what the pattern anticipates), and a normal breakout that then reverses back through the other side of the pattern.'),
      h('h3', 'Penetration of top and bottom formations'), topPen(),
      h('h3', 'Breaking of curvature'), P('A rounding pattern that stops following its curve has failed.'),
      callout('warnbox', 'info', 'The exact confirmation rules and stop placement Schwager uses for each failure type are in the book. The stop logic in your playbook (a few ticks beyond the trap\'s extreme wick) is your own adaptation.')) },
    { id: 'mapping', title: 'Mapping it to your four setups', body: () => h('div',
      h('h2', 'From failed signals to your four setups'),
      h('table.tbl', h('thead', h('tr', h('th', 'Your setup'), h('th', 'Failed-signal family'), h('th', 'What failed'), h('th', 'Your trigger'))), h('tbody',
        h('tr', h('td', h('b', 'Spring')), h('td', 'Bear trap'), h('td', 'A break of the range low that finds no follow-through'), h('td', 'Decisive close back above the range low')),
        h('tr', h('td', h('b', 'Upthrust')), h('td', 'Bull trap'), h('td', 'A break of the range high that finds no follow-through'), h('td', 'Decisive close back below the range high')),
        h('tr', h('td', h('b', 'Sweep')), h('td', 'Trap inside a single bar; related to spike logic'), h('td', 'A one-candle spike through an obvious level that closes back inside'), h('td', 'The same candle closes back inside; OI drops')),
        h('tr', h('td', h('b', 'Failed retest')), h('td', 'Failure of a breakout\'s retest'), h('td', 'A breakout that held, whose retest fails and closes back through'), h('td', 'The retest candle closes back through the level')))),
      callout('key', 'waves', 'What Schwager\'s daily-bar framework did not have: open interest and funding in real time. Your C2 (OI rises through the break) and C4 (OI drops on the reclaim) test directly whether anyone was recruited and then forced out. That is the modern edge on an old idea.'),
      callout('warnbox', 'triangle-alert', 'Every threshold in your checklist (0.25 ATR floor, 1.0 ATR abandon, two to four candles) is a starting hypothesis. Thirty journaled trades with the orange fields filled is what turns them into your rules.')) },
  ],
  quiz: [
    { q: 'What defines an uptrend most robustly?', o: ['A rising moving average alone', 'Higher highs and higher lows', 'A two-touch trend line', 'Rising volume'], a: 1, why: 'Swing structure; trend lines are redrawn often and look best in hindsight.' },
    { q: 'A double top is confirmed when…', o: ['The second peak prints', 'Price breaks the low between the peaks', 'Volume spikes', 'Funding turns negative'], a: 1, why: 'Until the intervening low breaks, it is just two highs.' },
    { q: 'An upside range breakout falls back inside the range. Schwager\'s view:', o: ['Ignore it', 'It is a failed signal, often more reliable than the breakout', 'Add to the long', 'Wait for a second breakout'], a: 1, why: 'Failed signals are among the most reliable; the trapped buyers fuel the move down.' },
    { q: 'Which of your setups is the bear-trap family?', o: ['Upthrust', 'Spring', 'Failed retest', 'None'], a: 1, why: 'A failed break of the range low, reclaimed: the Spring.' },
    { q: 'A run day can be identified…', o: ['In real time', 'Only after the following bars print', 'At the open', 'From funding'], a: 1, why: 'Its definition uses the following bars, so it is an after-the-fact read.' },
    { q: 'Price pierces a trend line but keeps closing on the original side. This is…', o: ['A trend reversal', 'A false trend-line breakout: favor the original trend', 'A flag', 'An exhaustion gap'], a: 1, why: 'The failure of the break argues for the original trend.' },
    { q: 'A flag after a rally breaks DOWN. What does that suggest?', o: ['Continuation up', 'The trend may be failing: counter-to-anticipated breakout', 'Nothing', 'A buying climax'], a: 1, why: 'The pattern anticipated continuation; breaking the other way is a failure clue.' },
    { q: 'Which gap type can only be distinguished after the fact?', o: ['Common', 'Breakaway', 'Exhaustion (vs runaway)', 'None'], a: 2, why: 'An exhaustion gap looks like a runaway gap until the reversal follows.' },
    { q: 'What does your C2 add that a daily-bar failed-signal framework lacks?', o: ['Moving averages', 'Real-time open interest recruitment check', 'Fibonacci', 'Gaps'], a: 1, why: 'OI rising through the break shows traders were actually recruited.' },
    { q: 'Old resistance that is broken often becomes…', o: ['Irrelevant', 'Support', 'A gap', 'A spike'], a: 1, why: 'Role reversal is a core support/resistance behavior.' },
  ],
  cards: [
    ['Uptrend', 'Higher highs and higher lows.'], ['Trend lines', 'Useful but overrated: redrawn often, clearer in hindsight.'],
    ['Role reversal', 'Broken resistance becomes support, and vice versa.'], ['Spike high', 'High well above neighbors, weak close, after a rally.'],
    ['Thrust day', 'Close beyond the prior bar\'s high (up) or low (down).'], ['Wide-ranging day', 'True range far above average; watch its far extreme.'],
    ['Double top confirmed', 'Only on a break of the low between the peaks.'], ['Head-and-shoulders signal', 'Break of the neckline.'],
    ['Bull trap', 'Upside breakout that falls back into the range. Your Upthrust.'], ['Bear trap', 'Downside breakout that rallies back into the range. Your Spring.'],
    ['The most important rule', 'When a chart signal fails, get out, and consider the other side.'], ['Your modern edge', 'OI up through the break (C2), OI down on the reclaim (C4).'],
  ],
};
