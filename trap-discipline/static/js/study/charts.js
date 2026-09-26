// Study guide: Charts, ranges and patterns. An ORIGINAL guide written for this app,
// organized around chart-reading topics covered in Jack D. Schwager, "Getting Started in
// Technical Analysis" (Wiley, 1999). Nothing here is quoted from the book. Read the book itself.
import { h, icon } from '../ui.js';
import { candleFig, fromCloses, fig } from './diagrams.js';

const rng = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const P = (...t) => h('p', ...t);
const B = (t) => h('b', t);
const UL = (...items) => h('ul', items.map(i => h('li', i)));
const callout = (kind, ic, ...t) => h(`div.callout.${kind}`, icon(ic), h('div', ...t));
const tbl = (head, rows) => h('table.tbl', h('thead', h('tr', head.map(x => h('th', x)))),
  h('tbody', rows.map(r => h('tr', r.map(c => h('td', c))))));
const D = (opts, cap) => fig(candleFig({ height: 190, ...opts }), cap);
const GOLD = '#f4c24f'; const TEAL = '#36d7c7'; const RED = '#ef4b4b';

// ---- diagrams (schematic, not market data) ----------------------------------------
// Same closes drawn two ways: as candles, and as a close-only line.
const typeCloses = [100.2, 99.5, 98.9, 98.4, 98.7, 99.2, 98.5, 98.6, 99.3, 99.9, 100.5, 100.9, 100.4, 101.1];
const asCandles = () => D({ candles: fromCloses(typeCloses, { special: { 7: { l: 96.6, h: 98.9 } } }),
  lines: [{ y: 98.1, label: 'swing low' }], marks: [{ i: 7, y: 96.6, label: 'the wick', dir: 'down', color: RED }] },
  'Candles: the long lower wick shows price traded well below the swing low and was rejected inside the same bar.');
const asLine = () => {
  const flat = typeCloses.map(c => ({ o: c, c, h: c, l: c, color: 'rgba(0,0,0,0)' }));
  const segs = typeCloses.slice(1).map((c, i) => ({ i0: i, y0: typeCloses[i], i1: i + 1, y1: c, color: TEAL }));
  return D({ candles: flat, segs, lines: [{ y: 98.1, label: 'swing low' }], marks: [{ i: 7, y: 98.6, label: 'no wick shown', dir: 'down', color: RED }] },
    'The same bars as a close-only line. Every close stays above the swing low, so the break and rejection vanish. The line is cleaner and blind to the exact thing a sweep trades.');
};

const rangeMap = () => D({ candles: fromCloses([100, ...rng(25, i => 100 + Math.sin((i + 1) * 0.75) * 3.2)], { wick: 0.3 }),
  zones: [{ y0: 103.3, y1: 104.3, color: 'rgba(54,215,199,.14)' }, { y0: 95.7, y1: 96.7, color: 'rgba(54,215,199,.14)' }, { y0: 98.67, y1: 101.33, color: 'rgba(239,75,75,.08)' }],
  lines: [{ y: 103.8, label: 'high zone', color: TEAL }, { y: 96.2, label: 'low zone', color: TEAL }],
  marks: [{ i: 13, y: 100, label: 'middle third', color: RED }] },
  'A range drawn as two boundary zones, not two exact lines. The shaded middle third is where neither side has an edge and trend signals whipsaw.');

const breakout = () => D({ candles: fromCloses([...rng(12, i => 100 + Math.sin(i * 1.3) * 1.1), 102.2, 103.1, 102.6, 101.9, 102.7, 103.8, 104.6], { wick: 0.3 }),
  lines: [{ y: 101.5, label: 'range high' }], marks: [{ i: 12, y: 102.6, label: 'close beyond' }, { i: 15, y: 101.7, label: 'retest holds', dir: 'down' }] },
  'A breakout that works: a decisive close beyond the boundary, then a pullback that holds above it. The same picture with a close back inside is a failed breakout.');

const levels = () => D({ candles: fromCloses([99, 100.6, 102.2, 103.6, 104.0, 102.8, 101.9, 101.5, 101.9, 101.4, 101.8, 101.5, 101.7, 100.8, 100.2, 100.5, 101.3, 102.1, 101.6, 102.5, 103.4],
  { special: { 4: { h: 104.3 }, 14: { l: 99.95 } } }),
  zones: [{ y0: 101.2, y1: 102.2, color: 'rgba(244,194,79,.10)' }],
  lines: [{ y: 104.3, label: 'prior high' }, { y: 100, label: 'round 100' }],
  marks: [{ i: 9, y: 102.3, label: 'congestion', color: GOLD }, { i: 14, y: 99.95, label: 'tests 100', dir: 'down' }] },
  'Three sources of support and resistance on one chart: a prior swing high, a congestion zone where price spent many bars, and a round number.');

const flipDown = () => D({ candles: fromCloses([102.4, 101.3, 100.4, 101.2, 102.1, 101.0, 100.3, 101.1, 100.6, 99.2, 98.1, 97.6, 98.4, 99.3, 99.8, 99.1, 98.2, 97.1, 96.4],
  { special: { 2: { l: 100.0 }, 6: { l: 99.95 }, 14: { h: 100.1 } } }),
  lines: [{ y: 100, label: 'old support' }],
  marks: [{ i: 2, y: 100, label: 'holds', dir: 'down' }, { i: 6, y: 99.95, label: 'holds', dir: 'down' }, { i: 9, y: 99.1, label: 'breaks', dir: 'down', color: RED }, { i: 14, y: 100.1, label: 'now resistance' }] },
  'Role reversal: a floor that held twice breaks, and the first rally back up stalls at the same level from below.');

const revBar = () => D({ candles: fromCloses([100, 101, 102.1, 103, 104, 105, 103.6, 103.0, 102.2, 101.6], { special: { 5: { l: 103.9 }, 6: { o: 105.3, h: 106.4, l: 103.4, c: 103.6 } } }),
  lines: [{ y: 103.9, label: 'prior low' }], marks: [{ i: 6, y: 106.4, label: 'new high' }, { i: 6, y: 103.4, label: 'closes below prior low', dir: 'down', color: RED }] },
  'A reversal bar in its stronger form: a new high for the move, then a close below the prior bar\'s low. The weaker form only needs a close below the prior close.');

const runBar = () => D({ candles: fromCloses([100, 100.8, 101.3, 102, 102.6, 103.3, 104.5, 105.3, 106.0, 106.8, 107.5, 108.1], { wick: 0.25 }),
  shade: [{ i0: 3, i1: 9, color: 'rgba(244,194,79,.08)' }], marks: [{ i: 6, y: 104.8, label: 'run bar' }, { i: 9, y: 106.3, label: 'known only here', dir: 'down' }] },
  'A run bar: its high tops the preceding few bars and its low sits under the following few. Because the definition uses bars that come after it, you only know it was a run bar several bars later.');

const ascTri = () => D({ candles: fromCloses([100, 101.8, 103.4, 102.2, 101.0, 102.3, 103.6, 102.8, 101.9, 102.9, 103.7, 103.1, 102.6, 103.3, 103.8, 105.0, 106.1],
  { wick: 0.25, special: { 2: { h: 104.0 }, 4: { l: 100.8 }, 5: { l: 101.0 }, 6: { h: 104.0 }, 8: { l: 101.7 }, 9: { l: 101.85 }, 10: { h: 104.0 }, 12: { l: 102.4 }, 13: { l: 102.6 }, 14: { h: 104.0 } } }),
  segs: [{ i0: 2, y0: 104, i1: 14, y1: 104, color: GOLD }, { i0: 4, y0: 100.8, i1: 14, y1: 102.8, color: GOLD }], marks: [{ i: 15, y: 105.3, label: 'breakout' }] },
  'Ascending triangle: a flat ceiling with rising lows. Sellers defend one price while buyers keep stepping up. The descending triangle is the mirror image.');

const pennant = () => D({ candles: fromCloses([108, 107.6, 105.8, 103.7, 101.6, 100.0, 100.9, 100.3, 100.8, 100.4, 100.7, 100.5, 99.2, 97.8, 96.5], { wick: 0.25 }),
  segs: [{ i0: 6, y0: 101.3, i1: 11, y1: 100.85, color: GOLD }, { i0: 5, y0: 99.7, i1: 11, y1: 100.3, color: GOLD }],
  marks: [{ i: 3, y: 105.6, label: 'flagpole', color: GOLD }, { i: 12, y: 98.9, label: 'resumes', dir: 'down' }] },
  'Bear pennant: a sharp drop (the flagpole), a brief small triangle, then continuation lower. A flag is the same pause drawn as a small parallel channel.');

const dblBottom = () => D({ candles: fromCloses([106, 104.3, 102.6, 101.0, 100.2, 101.6, 103.1, 103.8, 102.7, 101.3, 100.3, 101.8, 103.2, 104.4, 105.6, 106.4],
  { special: { 4: { l: 99.9 }, 5: { l: 100.0 }, 7: { h: 104.0 }, 8: { h: 103.9 }, 10: { l: 99.95 }, 11: { l: 100.1 } } }),
  lines: [{ y: 104, label: 'confirm line' }],
  marks: [{ i: 4, y: 99.9, label: 'bottom 1', dir: 'down' }, { i: 10, y: 99.95, label: 'bottom 2', dir: 'down' }, { i: 13, y: 104.6, label: 'confirmed' }] },
  'Double bottom: two tests of about the same low. It is only a double bottom once price closes above the high between the two lows; before that it is just a range.');

const invHS = () => D({ candles: fromCloses([106, 104.4, 102.8, 103.9, 104.6, 103.0, 100.9, 99.2, 101.6, 104.0, 104.5, 103.1, 102.4, 103.6, 105.1, 106.3, 107.0],
  { special: { 2: { l: 102.4, h: 104.6 }, 4: { h: 104.8 }, 5: { h: 104.7 }, 7: { l: 98.8 }, 8: { l: 99.0 }, 9: { h: 104.4 }, 10: { h: 104.75 }, 11: { h: 104.6 }, 12: { l: 102.2 }, 13: { l: 102.4 } } }),
  lines: [{ y: 104.8, label: 'neckline' }],
  marks: [{ i: 2, y: 102.4, label: 'L shoulder', dir: 'down' }, { i: 7, y: 98.8, label: 'head', dir: 'down' }, { i: 12, y: 102.2, label: 'R shoulder', dir: 'down' }, { i: 14, y: 105.3, label: 'break' }] },
  'Inverse head-and-shoulders: three lows, the middle lowest. The signal is a close above the neckline drawn across the two rally highs.');

const roundCloses = [...rng(20, i => 100 + 0.035 * (i - 9.5) ** 2), 104.1, 105.0];
const rounding = () => D({ candles: fromCloses(roundCloses, { wick: 0.2 }),
  segs: [0, 4, 8, 12, 16].map(a => { const b = Math.min(a + 4, 19); const y = (i) => 99.25 + 0.035 * (i - 9.5) ** 2; return { i0: a, y0: y(a), i1: b, y1: y(b), color: GOLD }; }),
  lines: [{ y: 103.3, label: 'rim' }], marks: [{ i: 20, y: 104.4, label: 'clears rim' }] },
  'Rounding bottom: selling pressure fades gradually and the curve turns up. There is no single signal bar, which makes the pattern easy to see afterwards and hard to time.');

const wedgeCloses = [106.0, 105.0, 103.3, 104.0, 104.5, 103.4, 102.2, 102.8, 103.0, 102.2, 101.1, 101.5, 101.6, 100.8, 100.0, 100.3, 100.0, 101.5, 102.7, 103.8];
const wedgeHi = (i) => 106.5 - 0.375 * i; const wedgeLo = (i) => 103.54 - 0.27 * i;
const fallWedge = () => D({ candles: fromCloses(wedgeCloses, { wick: 0.2, special: { 0: { h: 106.5 }, 1: { h: 106.05 }, 2: { l: 103.0 }, 4: { h: 105.0 }, 5: { h: 104.6 }, 6: { l: 101.92 }, 8: { h: 103.5 }, 9: { h: 103.1 }, 10: { l: 100.84 }, 12: { h: 102.0 }, 13: { h: 101.6 }, 14: { l: 99.76 } } }),
  segs: [{ i0: 0, y0: wedgeHi(0), i1: 16, y1: wedgeHi(16), color: GOLD }, { i0: 2, y0: wedgeLo(2), i1: 16, y1: wedgeLo(16), color: GOLD }], marks: [{ i: 18, y: 102.9, label: 'breaks up' }] },
  'Falling wedge: highs and lows both slope down but converge, so each new low gains less ground. It tends to resolve upward, against its slope. The rising wedge is the mirror.');

// ---- guide --------------------------------------------------------------------
export const CHARTS = {
  id: 'charts',
  title: 'Charts, Ranges & Patterns',
  subtitle: 'The foundations of chart reading: chart types, timeframes, ranges, support and resistance, and the classic patterns',
  minutes: 50,
  accent: '#e3a33b',
  sections: [
    { id: 'why', title: 'What a chart can and cannot tell you', body: () => h('div',
      h('h2', 'What a chart can and cannot tell you'),
      P('Every trade you take starts with a chart, so it is worth being precise about what a chart is. A price chart is a record of where trades happened and when. Nothing more is stored in it. Everything else (trends, ranges, levels, patterns) is an interpretation that a human lays on top of that record.'),
      callout('warnbox', 'book-open-text', B('Source note. '), 'Written in original words for this app, organized around chart-reading topics covered in Jack D. Schwager, ', h('i', 'Getting Started in Technical Analysis'), ' (Wiley, 1999). It quotes nothing and is not a summary of any chapter\'s text. Where an idea is attributed to Schwager specifically, that is stated; everything else is presented as common technical-analysis practice. Read the book for his full treatment and charts. Educational only, not investment advice.'),
      h('h3', 'What a chart does show'),
      UL([B('Where price has been, '), 'including the extremes it reached and where it settled at the end of each bar.'],
        [B('Structure: '), 'whether price is making higher highs and higher lows, lower highs and lower lows, or going sideways.'],
        [B('Where decisions clustered: '), 'prices where rallies or declines stopped repeatedly, and where price spent a lot of time.'],
        [B('Volatility: '), 'how large the bars are now compared with before.'],
        [B('Where other traders are likely positioned: '), 'if a level is obvious to you, it is obvious to others, and their stops and breakout orders tend to sit just beyond it. For a trap trader this is the most useful thing a chart shows.']),
      h('h3', 'What a chart does not show'),
      UL([B('Why '), 'price moved. A chart never contains the reason.'],
        [B('The future. '), 'A pattern is a description of the past that sometimes precedes a particular outcome. It is not a forecast with a known probability.'],
        [B('The order inside a bar. '), 'A 15-minute candle does not tell you whether the high or the low came first.'],
        [B('Positioning directly. '), 'Price alone does not show who opened or closed positions. That is why your checklist adds open interest.'],
        [B('One objective reading. '), 'Two competent analysts can look at the same chart and draw different ranges and name different patterns.']),
      callout('key', 'lightbulb', B('How this guide fits. '), 'This is the foundations guide: how to read what is on the screen, and the classic patterns in more depth. What happens when those patterns ', h('i', 'fail'), ', which is the core of your strategy, is covered in the ', B('Chart Patterns & Failed Signals'), ' guide. It is not repeated here.')) },

    { id: 'types', title: 'Chart types and what each hides', body: () => h('div',
      h('h2', 'Chart types and what each hides'),
      P('Every chart type is a compression. It keeps some information and throws the rest away. Choosing a chart type is choosing what you are willing not to see.'),
      h('h3', 'Bar charts (OHLC)'),
      P('Each bar is a vertical line from the high to the low, with a small tick on the left for the open and a tick on the right for the close. It carries all four prices. It is visually quieter than a candle, so the difference between an up bar and a down bar is less immediate.'),
      h('h3', 'Candlesticks'),
      P('The same four prices. The body spans open to close and is colored by direction; the thin wicks (shadows) run to the high and low. Candles make the open-to-close direction and the rejected extremes jump out, which is why they dominate crypto charting.'),
      P('Two things to remember. First, the coloring emphasizes open to close, so a bar with a tiny body and an enormous range can look unimportant when it was actually the most violent bar on the screen. Second, on a market that trades continuously, each candle usually opens at or very near the prior close, so bodies join end to end and gaps between candles are rare.'),
      asCandles(), asLine(),
      h('h3', 'Close-only (line) charts'),
      P('A line joining the closes. It removes intrabar noise and makes structure easy to see at a glance, and it is the natural chart when only closing prices are available. The cost is total: every high and low that did not become a close disappears. Wicks, sweeps, and spike extremes are invisible.'),
      h('h3', 'Point-and-figure (briefly)'),
      P('Point-and-figure drops time altogether. A column of X marks records rising prices and a column of O marks records falling ones. You choose a box size (the minimum price move that counts) and a reversal amount (how many boxes against the column start a new one; three boxes is a common convention). Small moves and quiet periods simply do not appear. It is good at showing levels where price reversed repeatedly and bad at anything involving time, speed, or single-bar behavior.'),
      h('h3', 'A note on smoothed candles'),
      P('Some platforms offer averaged candles (Heikin-Ashi is the best-known). They look like candles but their open and close are computed averages (and the high and low are adjusted to fit them), not the prices that actually traded. They are fine for a quick look at direction and wrong for anything that depends on a real close or a real wick.'),
      tbl(['Chart type', 'Keeps', 'Hides', 'Fit for your checklist'], [
        [B('Bar (OHLC)'), 'Open, high, low, close', 'Order of events inside the bar', 'Yes'],
        [B('Candlestick'), 'Open, high, low, close, direction emphasized', 'Order of events inside the bar; can understate small-bodied wide bars', 'Yes: your default'],
        [B('Close-only line'), 'Closes only', 'Every high and low, so every wick and sweep', 'No: hides the extreme your stop is built from'],
        [B('Point-and-figure'), 'Significant reversals by price', 'Time, bar-level detail, small moves', 'No: no candle window, no close'],
        [B('Smoothed candles'), 'Direction, roughly', 'The real traded prices', 'No: closes and wicks are not real']]),
      callout('key', 'crosshair', 'Your rule 5 enters on the close, and your rule 2 places the stop beyond the extreme wick. You need both numbers, so you need real candles or bars.')) },

    { id: 'timeframes', title: 'Timeframes, contract linking and perpetuals', body: () => h('div',
      h('h2', 'Timeframes'),
      P('The same stream of trades can be cut into bars of any length. Nothing about the market changes when you switch timeframe; only the slice size changes. What looks like a trend on one slice is a single leg on a larger one and a dozen swings on a smaller one.'),
      tbl(['Bar', '15-minute bars inside it', 'What it is good for'], [
        [B('15 minutes'), '1', 'Execution: the break candle, the stall window, the close back inside'],
        [B('4 hours'), '16', 'Structure: the app\'s regime (swing highs and lows plus the 50 EMA) and the levels for C1'],
        [B('Daily'), '96', 'Context: the bigger picture a 4h level sits inside, prior day extremes']]),
      h('h3', 'How the 15m relates to the 4h and daily'),
      UL([B('Top down. '), 'Levels and regime come from the higher timeframe; the trigger comes from the lower one. A level that only exists on the 15m is rarely obvious to anyone else.'],
        [B('A line becomes a zone. '), 'A single 4h swing low can be built from several 15m candles poking below and closing above. Zoom in and a clean 4h level looks like a messy band.'],
        [B('Patterns nest. '), 'A 4h candle with a long lower wick may contain a complete 15m Spring. A 15m range may be nothing more than a flag inside a 4h trend.'],
        [B('Volatility scales. '), 'ATR on the 15m is much smaller than on the 4h. Always measure penetration and range height with the ATR of the timeframe you are trading, which in your checklist is the 15m.']),
      callout('warnbox', 'clock-3', B('24/7 markets have no natural daily bar. '), 'A daily candle on a crypto chart closes at a time someone chose, commonly midnight UTC, and 4h candles are usually aligned to it. Different platforms or settings can draw different daily and 4h bars from the same trades. Pick one convention and keep it, so your levels are consistent.'),
      h('h2', 'Linking futures contracts'),
      P('Traditional futures expire. A single contract may only trade actively for a few months, so a long chart has to be stitched together from a sequence of contracts. There are two common ways to do it.'),
      tbl(['Method', 'How it is built', 'Strength', 'Weakness'], [
        [B('Nearest futures'), 'Show the front contract until it expires, then switch to the next', 'Every price shown actually traded', 'At each roll the price jumps by the difference between the two contracts. Those jumps never happened to anyone holding a position, but they can look like gaps, breakouts, or levels'],
        [B('Continuous (spread-adjusted)'), 'Shift the older history by the price difference at each roll so the pieces join smoothly', 'Price swings match what a position holder actually experienced', 'Older prices are adjusted, so they no longer match the prices that traded then']]),
      P('Schwager argues that for technical work that depends on price swings (signals, trend analysis, testing a method on history), the continuous, spread-adjusted series is generally the more faithful choice, while a nearest-futures chart remains useful for seeing the actual price levels of the past.'),
      h('h3', 'Why perpetuals avoid the problem'),
      P('A perpetual swap has no expiry, so there is one continuous instrument and nothing to roll. Your 15-minute chart has no splice points and no artificial roll gaps. The mechanism that keeps a perpetual near the underlying spot price is funding: periodic payments between longs and shorts (Bybit sets the funding interval per contract). Funding shows up in your account, not on the price chart.'),
      h('h3', 'Mark price versus last price'),
      P('Perpetuals introduce a different split. The ', B('last price'), ' is the most recent trade on that exchange, and it is what a standard candle chart draws. The ', B('mark price'), ' is a reference price derived from an index of spot prices across several venues; exchanges use it for unrealized P&L and for liquidation. Because it is anchored to an index, the mark price usually does not show the thin-book wicks that the last price does.'),
      UL(['A long wick on the last-price chart may never have reached anyone\'s liquidation price, because liquidation runs off the mark price.',
        'Bybit lets you choose whether a stop triggers on last, mark or index price. The extreme wick your rule 2 stop is measured from is a last-price wick. Know which trigger your stop actually uses.',
        'Different venues print slightly different highs and lows. Draw levels on the chart of the venue you trade.']),
      callout('key', 'lightbulb', 'Bybit also lists dated futures that do expire. If you ever chart one of those, the linking problem above applies to it again.')) },

    { id: 'ranges', title: 'Trading ranges', body: () => h('div',
      h('h2', 'Trading ranges'),
      P('A trading range is a period where price moves sideways between a ceiling and a floor. Markets spend a large share of their time like this. For most methods ranges are a nuisance. For yours they are the raw material: the boundaries are where the obvious orders sit.'),
      rangeMap(),
      h('h3', 'How to draw one'),
      UL([B('Start with swings, not lines. '), 'You want at least two highs that stalled at about the same price and two lows that did the same. Your C1 asks for three or more touches on the 4h level.'],
        [B('Draw through the cluster, not the single extreme. '), 'One freak wick should not define the boundary. Place the line where most of the turning points bunch up.'],
        [B('Treat each boundary as a zone. '), 'Highs rarely turn at exactly the same tick. The boundary is a band covering the cluster of turning points.'],
        [B('Be consistent about wicks and closes. '), 'Decide whether your boundaries are drawn at the wicks or at the bodies, and do it the same way every time. Inconsistency here quietly changes every measurement downstream (penetration, range height, targets).']),
      h('h3', 'Why trend signals fail inside ranges'),
      P('Trend-following tools assume that a move in one direction tends to continue. Inside a range that assumption is wrong by construction: each move toward a boundary is followed by a move back. Moving-average crossovers flip back and forth, breaks of minor highs and lows reverse, and short trend lines are broken in both directions. The middle of the range is the worst place of all, because price is far from both boundaries and has no reason to go either way.'),
      h('h3', 'Breakouts'),
      breakout(),
      P('A move beyond a range boundary is the classic signal that a new trend may be starting. Analysts commonly want more than a touch: a close beyond the zone, sometimes a few bars holding beyond it, or a pullback to the old boundary that holds. The longer and more obvious the range, the more attention its breakout gets.'),
      P('That attention cuts both ways. Because the boundaries are obvious, stops and breakout entries crowd just beyond them. A break often runs those orders and then has nothing left to push it. When it falls back inside, that failure is its own signal, and it is the subject of the Chart Patterns & Failed Signals guide.'),
      callout('truth', 'shield-check', B('The range is a map of other people\'s orders. '), 'Above the high: short sellers\' stops and breakout buyers\' entries. Below the low: long holders\' stops and breakout sellers\' entries. Your whole checklist is about what happens when price goes and collects those orders.')) },

    { id: 'sr', title: 'Support and resistance', body: () => h('div',
      h('h2', 'Support and resistance'),
      P('Support is a price area where declines have tended to stop; resistance is where rallies have tended to stop. Range boundaries are the simplest example, but levels come from several sources.'),
      levels(),
      h('h3', 'Prior highs and lows'),
      P('A significant swing high or low stays on traders\' minds. Anyone who bought the old high and watched it fall may sell to get out when price returns there; anyone who missed the old low may buy it. The more significant the swing (the higher the timeframe, the larger the move away from it), the more attention it gets.'),
      h('h3', 'Congestion zones'),
      P('An area where price spent many bars moving sideways is a place where a lot of positions were opened. When price comes back, many of those traders react: to exit at breakeven, to add, or to defend. Congestion zones act as support or resistance even without a clean single swing point.'),
      h('h3', 'Role reversal'),
      flipDown(),
      P('Once a level breaks decisively, it often switches roles: broken support becomes resistance and broken resistance becomes support. Traders who were long from the old floor are now trapped below it, and a rally back to that price gives them a chance to get out. This is also the geometry behind a retest: price comes back to the broken level from the other side.'),
      h('h3', 'Round numbers'),
      P('Traders place orders, take-profits and stops at round prices far more often than at arbitrary ones. Whole thousands on bitcoin, whole dollars or half dollars on smaller coins: these attract orders even with no chart history at all.'),
      h('h3', 'Levels are zones, and touches are ambiguous'),
      P('A level is an area, not a tick. Price will overshoot and undershoot it. There is also a genuine disagreement about repeated tests: some analysts treat each touch as confirmation that the level matters, others argue each test uses up the orders defending it. Your checklist sidesteps the argument. It counts touches for a different reason: ', B('obviousness'), '. A level touched three or more times on the 4h is one that many traders can see, which means many stops sit just beyond it.'),
      callout('key', 'layers', 'Candidate levels for C1 include range boundaries, prior 4h swing highs and lows, prior day or week extremes, congestion edges and round numbers. A candidate only passes C1 with three or more touches on the 4h and a visible liquidation cluster.')) },

    { id: 'onebar', title: 'One-bar patterns', body: () => h('div',
      h('h2', 'One-bar patterns'),
      P('Some patterns are a single bar, or a single bar judged against its neighbors. The categories below follow the grouping of one-day patterns in Schwager\'s book: gaps, spikes, reversal days, thrust days, run days and wide-ranging days. The definitions given here are standard ones in plain words; his exact criteria are in the book.'),
      callout('warnbox', 'info', B('Adaptation. '), 'These were framed on daily futures bars, where each bar is a trading session with a real open and close. A 15-minute perpetual candle is an arbitrary slice of a 24/7 stream. Treat every one-bar idea below as a hypothesis on your timeframe, to be accepted or rejected by your journal.'),
      h('h3', 'Gaps'),
      P('A gap is a price range where no trading happened between one bar and the next. The usual families: a common gap inside a range (little meaning), a breakaway gap out of a range, a runaway gap during a strong move, and an exhaustion gap late in a move. Markets with session breaks gap regularly. A continuously traded perpetual almost never does between 15-minute candles, except around exchange maintenance or outages. The closest equivalent on your chart is a single candle that covers a huge distance in one bar.'),
      h('h3', 'Spikes'),
      P('A spike high is a bar whose high stands well above the highs of the bars around it; a spike low is the mirror. The case analysts watch for is a spike that closes far from its extreme after an extended move. On a 15m chart, many spikes are exactly the one-candle excursions through obvious levels that your Sweep setup looks for.'),
      h('h3', 'Reversal bars'),
      revBar(),
      P('A bar that makes a new extreme for the move and then closes the other way. Common definitions range from weak (a close beyond the prior close) to strong (a close beyond the prior bar\'s entire range). They are frequent and many of them occur mid-trend with no reversal following, so on their own they are a weak signal. Their value is in context: at an obvious level, after a stretched move.'),
      h('h3', 'Thrust bars'),
      P('A bar that closes beyond the prior bar\'s high (an up-thrust) or below the prior bar\'s low (a down-thrust). One means little. A cluster of them in one direction shows sustained pressure.'),
      h('h3', 'Run bars'),
      runBar(),
      h('h3', 'Wide-ranging bars'),
      P('A bar whose true range is much larger than recent bars. Wide bars mark moments when a lot of orders hit the market at once. The extremes of a wide bar often become reference points, and where the bar closes within its range tells you which side won that burst.'),
      tbl(['Pattern', 'Known at the close?', 'What it suggests', 'Link to your checklist'], [
        [B('Spike'), 'Only after neighbors print', 'Rejection of an extreme', 'Sweep candidate'],
        [B('Reversal bar'), 'Yes', 'Possible turn, weak alone', 'Shape of many C4 closes'],
        [B('Thrust bar'), 'Yes', 'Pressure in one direction', 'Background only'],
        [B('Run bar'), 'No: needs later bars', 'Trend strength, in hindsight', 'Review only, never an entry'],
        [B('Wide-ranging bar'), 'Yes', 'A burst of orders', 'C2: break candle range at least ATR']]),
      callout('key', 'crosshair', 'Your C2 wants the break candle\'s range to be at least ATR, penetrating at least 0.25 ATR, and abandons the level if price gets more than 1.0 ATR beyond. In one-bar terms: you want a wide bar that recruits traders, not one that runs away.')) },

    { id: 'continuation', title: 'Continuation patterns', body: () => h('div',
      h('h2', 'Continuation patterns'),
      P('A continuation pattern is a pause inside a trend: price consolidates, then (the pattern says) resumes in the original direction. The pause is where late traders enter and early traders take profit, and the resolution shows which group was right.'),
      h('h3', 'Triangles'),
      ascTri(),
      UL([B('Symmetrical: '), 'lower highs and higher lows converging. Neutral in shape; analysts usually expect a break in the direction of the prior trend.'],
        [B('Ascending: '), 'flat highs, rising lows. Commonly read as leaning upward, because buyers keep paying more while sellers hold one price.'],
        [B('Descending: '), 'flat lows, falling highs. The mirror, leaning downward.']),
      P('A triangle is a small trading range whose boundaries slope. Everything from the ranges section applies: the edges are zones, the middle is noise, and the flat side of an ascending or descending triangle is a very obvious level.'),
      h('h3', 'Flags and pennants'),
      pennant(),
      P('Both follow a sharp, near-vertical move called the flagpole. A flag is a short, tight channel that usually slopes gently against the pole; a pennant is a short, small converging triangle. Both are expected to be brief relative to the pole. A common convention projects the pole\'s length from the breakout as a rough target. Treat that as a convention, not a law.'),
      h('h3', 'Reading continuation patterns on 15m perps'),
      UL(['A 15m flag inside a 4h trend is just a pullback on the 4h. Check the 4h regime before giving the 15m shape any weight.',
        'The flat edge of a triangle collects stops the same way a range boundary does, so the first break of it is exactly the kind of move that gets trapped.',
        'Continuation patterns that break the wrong way, or break and then reverse, are covered in the Chart Patterns & Failed Signals guide.'])) },

    { id: 'tops', title: 'Top and bottom formations', body: () => h('div',
      h('h2', 'Top and bottom formations'),
      P('Reversal formations mark the end of a trend. They are shown here as bottoms; each top is the mirror image. A general rule for all of them: a formation is not complete until price breaks a confirming level. Before that it is a hypothesis.'),
      h('h3', 'V tops and bottoms'),
      P('A sharp reversal with no consolidation at the turn. By definition there is no pattern to see while it forms, so it can only be recognized after price has already moved a long way from the extreme. Often driven by a sudden change in positioning (for example, a liquidation cascade that exhausts itself).'),
      h('h3', 'Double and triple bottoms'),
      dblBottom(),
      P('Two (or three) declines that stop at about the same price. Confirmation comes from a break of the high between them. Until then, two equal lows are simply the floor of a range, and a third test is just as likely to break it. Note how closely this resembles your range: the lows of a double bottom are an obvious level, and a brief break below them that reverses is a Spring.'),
      h('h3', 'Head-and-shoulders'),
      invHS(),
      P('Three peaks for a top (the middle highest) or three troughs for a bottom (the middle lowest). The neckline joins the two intervening swings, and the signal is a decisive break of it. A common convention projects the distance from head to neckline beyond the break as a rough target. Necklines can slope, and deciding which swings define the shoulders is often a judgment call.'),
      h('h3', 'Rounding tops and bottoms'),
      rounding(),
      h('h3', 'Wedges'),
      fallWedge(),
      P('A wedge converges like a triangle but both lines slope the same way. A rising wedge in an uptrend shows each push higher gaining less, and tends to break down. A falling wedge in a downtrend shows each push lower gaining less, and tends to break up. Wedges can appear as reversals or as pauses within the larger trend.'),
      h('h3', 'Island reversals'),
      P('A group of bars cut off by a gap on each side: a gap in the direction of the trend, some trading, then a gap the other way. It needs gaps, so on a continuously traded perpetual it is rare. The idea survives in a looser form: a burst beyond a level followed by a fast, clean move back, leaving the traders who entered in the burst stranded.'),
      tbl(['Formation', 'Confirmation', 'Main difficulty'], [
        [B('V'), 'Only in hindsight', 'Nothing to see while it forms'],
        [B('Double / triple'), 'Break of the intervening swing', 'Looks identical to a range until confirmed'],
        [B('Head-and-shoulders'), 'Break of the neckline', 'Choosing the shoulders; sloping necklines'],
        [B('Rounding'), 'Clearing the rim', 'No single signal bar'],
        [B('Wedge'), 'Break of the opposite line', 'Two sloped lines, lots of drawing choice'],
        [B('Island'), 'The second gap', 'Rare without session gaps']]),
      callout('key', 'lightbulb', 'The Chart Patterns & Failed Signals guide covers the other half: what it means when price pushes back through a completed top or bottom formation, and why that failure can be more useful than the pattern.')) },

    { id: 'limits', title: 'The limits of pattern reading', body: () => h('div',
      h('h2', 'The limits of pattern reading'),
      P('Every pattern in this guide is real in the sense that it appears on charts. None of them is reliable in the sense of working most of the time by itself. Be honest about why.'),
      h('h3', 'Hindsight'),
      P('Textbook examples are drawn after the fact, with the outcome already on the page. In real time the right side of the chart does not exist. A left shoulder and a head are just two highs until the right shoulder forms, and the right shoulder is just a pullback until the neckline breaks. The run bar in this guide is a clean example: its definition literally requires future bars.'),
      h('h3', 'Subjectivity'),
      P('Where exactly is the range boundary? Wick or close? Which swings define the triangle? Two careful analysts will often answer differently, and each answer produces a different entry, stop, and target. When a pattern can be drawn several ways, it is easy to pick the drawing that fits what you already want to do.'),
      h('h3', 'Many patterns fail'),
      P('Plenty of textbook breakouts fall back, many double tops become ranges that later break upward, and many flags break the wrong way. No honest source can give you a single success rate for a named pattern that applies to your market and timeframe. Examples in books and posts are selected because they worked, which makes patterns look more reliable than they are.'),
      h('h3', 'Confirmation costs'),
      P('Waiting for confirmation (a neckline break, a close beyond the range) reduces false signals but moves your entry further from the natural stop. By the time some patterns are confirmed, much of the move is gone and the stop is far away. Size comes from the stop (rule 1), so late confirmation means a smaller position or a worse ratio.'),
      h('h3', 'Data quirks'),
      P('Timeframe alignment, venue, last versus mark price, and chart type all change what you see. A pattern on one chart may not exist on another chart of the same market.'),
      callout('truth', 'shield-check', B('The defenses are procedural, not visual. '), UL(
        'Define the pattern in numbers before the session (your checklist does this: touches, ATR multiples, candle windows).',
        'Log every instance, taken or skipped, within 10 minutes (rule 12), so your evidence is not only the memorable winners.',
        'Judge a pattern by your journal\'s results over many trades, not by how clean the example looks.',
        'Change thresholds only at the monthly review (rule 11).')),
      callout('key', 'lightbulb', 'The fact that patterns fail often is not only a weakness. When many traders act on the same obvious pattern and it fails, they are wrong at the same time. That is the idea your strategy is built on, developed in the Chart Patterns & Failed Signals guide.')) },

    { id: 'mapping', title: 'Mapping it to your trading', body: () => h('div',
      h('h2', 'Mapping it to your trading'),
      P('Everything in this guide feeds one question your checklist asks at the start: is there an obvious level with orders beyond it, inside a range worth trading, at the edge rather than the middle?'),
      h('h3', 'C1: the obvious level'),
      P('C1 requires three or more touches on a 4h level and a visible liquidation cluster. The ranges and support-and-resistance sections are the toolbox for finding candidates; C1 is the filter. Touches are counted on the 4h because that is where a level becomes visible to many traders; the liquidation cluster is evidence that leveraged positions actually sit beyond it. Remember that liquidations run off the mark price, while your chart shows last price.'),
      h('h3', 'Rule 8: the range gates'),
      P('Rule 8 requires both gates to pass: range height at least 6x ATR and at least 4x the stop, and round-trip cost under 10% of risk. The range section explains why this matters. Three of your four setup targets are range-based (Spring to range high, Upthrust to range low, Failed retest to prior range), and the Position Planner\'s target is the opposite range boundary. A range that is small relative to ATR or to your stop does not leave room for the trade to pay.'),
      h('h3', 'Rule 9: the middle third'),
      P('Rule 9: middle third of the range, no trade. This is the practical form of the point that signals inside a range are noise. At the edges, the obvious orders sit just beyond the boundary; in the middle there is no nearby level for anyone to be trapped at.'),
      h('h3', 'The four setups in chart-reading terms'),
      tbl(['Setup', 'Chart structure', 'Pattern family', 'Default target'], [
        [B('Spring'), 'Range low (the floor of a range or double bottom)', 'Failed downside breakout', 'Range high'],
        [B('Upthrust'), 'Range high (the ceiling of a range or double top)', 'Failed upside breakout', 'Range low'],
        [B('Sweep'), 'Any obvious level', 'One-bar: a spike or reversal bar through the level that closes back inside, with OI dropping', 'Prior swing'],
        [B('Failed retest'), 'A broken level being retested from the other side', 'Role reversal that fails: the retest closes back through', 'Prior range']]),
      h('h3', 'Timeframes and regime'),
      P('The level and the regime come from the 4h; the trigger comes from the 15m. The app\'s 4h regime calls an uptrend on a higher high plus a higher low with a rising 50 EMA, and in a clean trend the playbook only traps in the trend direction. In a 4h uptrend that means long-side traps (a Spring, or a long-side Sweep or Failed retest), not Upthrusts.'),
      h('h3', 'Chart type and execution'),
      UL(['Use real candles or bars on the venue you trade. Rule 5 enters on the decisive close back inside, never the wick; rule 2 puts the stop a few ticks beyond the trap\'s extreme wick. A line chart shows the first and hides the second; smoothed candles show neither.',
        'Check your stop\'s trigger price type, because the wick you measured is a last-price wick.',
        'Rule 3 (liquidation at least 3 stop widths away) is about a mark-price event, which is another reason the gap between mark and last matters.',
        'C3 and rule 6 are candle counts on the 15m: a stall inside a 2 to 4 candle window, and breakeven exit if there is no expansion by candle four.']),
      callout('warnbox', 'triangle-alert', 'The patterns in this guide came from daily bars in session-based futures. Applying them to 15-minute, 24/7 perpetuals is an analogy. Your journal is what turns it into evidence.')) },
  ],
  quiz: [
    { q: 'Which chart type hides the exact information a Sweep depends on?', o: ['Candlestick', 'OHLC bar', 'Close-only line', 'None of them'], a: 2, why: 'A line joins closes only, so a wick through a level that closes back inside disappears.' },
    { q: 'How many 15-minute bars make one 4h bar?', o: ['4', '8', '12', '16'], a: 3, why: 'Four hours is 240 minutes, which is sixteen 15-minute bars.' },
    { q: 'What is the main weakness of a nearest-futures chart?', o: ['Artificial price jumps at each contract roll', 'Adjusted prices that never traded', 'It cannot show closes', 'It ignores volume'], a: 0, why: 'Switching to the next contract jumps the chart by the price difference between contracts, which no position holder experienced.' },
    { q: 'Why does a Bybit perpetual chart have no roll gaps?', o: ['It is spread-adjusted', 'It never expires, so nothing is rolled', 'Funding removes them', 'It uses mark price'], a: 1, why: 'A perpetual is one continuous instrument with no expiry. Funding keeps it near spot but has nothing to do with rolls.' },
    { q: 'Which price do exchanges use for liquidation on perpetuals?', o: ['Last price', 'Best bid', 'Mark price', 'Daily open'], a: 2, why: 'Mark price, derived from an index. The last-price chart can show wicks that the mark price never reached.' },
    { q: 'The best way to treat a range boundary is as…', o: ['A zone covering the cluster of turning points', 'The single most extreme wick', 'The average of all closes', 'A line that must be touched exactly'], a: 0, why: 'Turning points rarely share one tick; draw through the cluster and treat it as a band.' },
    { q: 'Why do trend-following signals whipsaw inside a range?', o: ['Volume is always low', 'ATR is too high', 'Each move toward a boundary tends to be followed by a move back', 'Funding is negative'], a: 2, why: 'The trend assumption (moves continue) is wrong by construction inside a range, most of all in the middle.' },
    { q: 'Broken support that stops a later rally from below is an example of…', o: ['A run bar', 'Role reversal', 'An island', 'A pennant'], a: 1, why: 'Once broken, support often acts as resistance, and vice versa.' },
    { q: 'Which one-bar pattern can only be identified after later bars print?', o: ['Thrust bar', 'Wide-ranging bar', 'Reversal bar', 'Run bar'], a: 3, why: 'A run bar\'s low must sit below the lows of the following bars, so it needs the future to be known.' },
    { q: 'A double bottom is confirmed when…', o: ['The second low prints', 'Price closes above the high between the two lows', 'OI rises', 'A round number is hit'], a: 1, why: 'Until then, two equal lows are just the floor of a range.' },
    { q: 'Price is in the middle third of a range that passes both rule 8 gates. The playbook says…', o: ['No trade', 'Trade with the 4h regime', 'Take half size', 'Wait for a Sweep'], a: 0, why: 'Rule 9: middle third of the range, no trade.' },
    { q: 'In a clean 4h uptrend, which setup does the playbook NOT take?', o: ['Spring', 'Long-side Sweep', 'Long-side Failed retest', 'Upthrust'], a: 3, why: 'In a clean trend the playbook only traps in the trend direction; an Upthrust is a short.' },
  ],
  cards: [
    ['What a chart stores', 'Where and when trades happened. Everything else is interpretation.'],
    ['Candle vs line', 'A candle keeps the high and low; a close-only line hides every wick.'],
    ['Point-and-figure', 'X and O columns by box size and reversal amount; ignores time.'],
    ['Smoothed candles', 'Averaged prices, not real ones. Never use them for closes or wicks.'],
    ['15m inside higher bars', '16 per 4h bar, 96 per day.'],
    ['Nearest vs continuous futures', 'Nearest: real prices, fake roll jumps. Continuous: true swings, adjusted prices.'],
    ['Mark vs last price', 'Last: most recent trade, what candles show. Mark: index-based, used for liquidation.'],
    ['Drawing a range', 'Through the cluster of turning points, as zones, wick or body consistently.'],
    ['Middle of a range', 'No edge for either side. Rule 9: no trade in the middle third.'],
    ['Sources of S/R', 'Prior highs and lows, congestion zones, role reversal, round numbers.'],
    ['Role reversal', 'Broken support becomes resistance; broken resistance becomes support.'],
    ['Reversal bar', 'New extreme, then a close the other way. Weak alone, useful at an obvious level.'],
    ['Flag vs pennant', 'Flag: short parallel channel after a pole. Pennant: short small triangle.'],
    ['Head-and-shoulders signal', 'A decisive break of the neckline.'],
    ['Limits of patterns', 'Hindsight, subjectivity, frequent failure, confirmation lag.'],
    ['C1 obvious level', '3+ touches on a 4h level plus a visible liquidation cluster.'],
  ],
};
