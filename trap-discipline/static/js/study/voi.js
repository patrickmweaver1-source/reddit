// Study guide: Volume and Open Interest. Interactive edition of Pat's Volume and
// Open Interest Trading Guide (the PDF is linked from the reader).
import { h, icon, svg, put } from '../ui.js';
import { candleFig, fromCloses, fig, arrows } from './diagrams.js';

const rng = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const wig = (i, a = 0.35) => Math.sin(i * 1.7) * a + Math.cos(i * 0.9) * a * 0.6;

function p1() { // confirmed breakout
  const c = [...rng(12, i => 99 + wig(i, 0.45)), 100.6, 102.1, 102.6, 101.6, 100.9, 100.5, 101.4, 102.4, 103.2, 103.9, 104.6, 105.1];
  const vol = [...rng(12, i => 1 + Math.abs(wig(i, 0.2))), 2.4, 2.8, 1.6, 1.0, 0.8, 0.7, 1.2, 1.5, 1.4, 1.3, 1.2, 1.1];
  const oi = [...rng(12, i => 100 + i * 0.1), 102, 104.5, 105, 104.8, 104.6, 104.5, 105.2, 106, 106.8, 107.2, 107.6, 108];
  return candleFig({ candles: fromCloses(c), vol, oi, lines: [{ y: 100, label: 'prior boundary' }], marks: [{ i: 13, y: 102.9, label: 'break + OI up' }, { i: 17, y: 100.2, label: 'retest holds', dir: 'down' }] });
}
function p2() { // short covering rally
  const c = [...rng(10, i => 104 - i * 0.5 + wig(i, 0.3)), 99.2, 99.6, 101.4, 103.8, 105.9, 106.4, 106.1, 105.6, 105.2, 104.9, 104.7, 104.6];
  const vol = [...rng(10, () => 1), 1.1, 1.3, 2.6, 3.2, 3.0, 1.8, 1.2, 1.0, 0.9, 0.8, 0.8, 0.7];
  const oi = [...rng(10, i => 110 + i * 0.4), 114, 113.6, 111, 107.5, 104, 102.5, 102.2, 102, 101.9, 101.8, 101.8, 101.7];
  return candleFig({ candles: fromCloses(c), vol, oi, marks: [{ i: 14, y: 106.4, label: 'shorts exit' }] });
}
function p3() { // long liquidation flush
  const c = [...rng(8, i => 106 + wig(i, 0.4)), 105.2, 103.4, 100.1, 97.2, 96.6, 97.4, 97.9, 97.3, 96.4, 97.8, 99.0, 100.2, 100.8, 101.3];
  const vol = [...rng(8, () => 1), 1.4, 2.2, 3.6, 4.1, 2.0, 1.2, 1.0, 1.1, 2.3, 1.6, 1.3, 1.1, 1.0, 0.9];
  const oi = [...rng(8, () => 120), 118, 114, 108, 103, 102, 102, 102.2, 102, 101.5, 101.6, 101.8, 102, 102.1, 102.2];
  return candleFig({ candles: fromCloses(c), vol, oi, lines: [{ y: 97.2, label: 'liquidation low' }], marks: [{ i: 16, y: 96.1, label: 'marginal new low', dir: 'down' }, { i: 19, y: 100.4, label: 'reclaim' }] });
}
function p4() { // failed breakout, trapped exposure
  const c = [...rng(11, i => 98.4 + wig(i, 0.55)), 101.1, 102.6, 101.8, 99.4, 99.8, 99.9, 98.7, 97.6, 96.9, 96.2, 95.6, 95.2];
  const vol = [...rng(11, () => 1), 2.2, 2.7, 1.6, 2.4, 1.1, 1.0, 1.9, 1.6, 1.3, 1.2, 1.0, 0.9];
  const oi = [...rng(11, i => 100 + i * 0.05), 103, 106, 106.2, 104.8, 104.5, 104.4, 104, 103, 102, 101.2, 100.6, 100.2];
  return candleFig({ candles: fromCloses(c), vol, oi, lines: [{ y: 100, label: 'resistance' }], marks: [{ i: 12, y: 103, label: 'new OI enters' }, { i: 14, y: 99.0, label: 'close back inside', dir: 'down' }, { i: 16, y: 100.3, label: 'retest fails' }] });
}
function p5() { // leveraged coil
  const c = rng(24, i => 100 + Math.sin(i * 0.9) * 0.45);
  const vol = rng(24, i => 0.7 + Math.abs(Math.sin(i)) * 0.25);
  const oi = rng(24, i => 100 + i * 0.55 + Math.sin(i) * 0.2);
  return candleFig({ candles: fromCloses(c, { wick: 0.25 }), vol, oi, lines: [{ y: 100.7, label: 'range high', color: '#36d7c7' }, { y: 99.3, label: 'range low', color: '#36d7c7' }] });
}
function p6() { // absorption
  const c = [...rng(10, i => 96 + i * 0.35 + wig(i, 0.2)), ...rng(14, i => 99.6 + Math.sin(i * 1.3) * 0.18)];
  const vol = [...rng(10, () => 1), ...rng(14, i => 2.6 + Math.abs(Math.sin(i)) * 0.9)];
  const oi = [...rng(10, i => 100 + i * 0.1), ...rng(14, i => 101 + i * 0.4)];
  return candleFig({ candles: fromCloses(c, { wick: 0.5 }), vol, oi, lines: [{ y: 100, label: 'resistance' }], shade: [{ i0: 10, i1: 23 }] });
}

function matrixTable() {
  const rows = [
    [1, 1, 'New positions entering during an advance', 'New shorts also exist; continuation is not guaranteed'],
    [1, -1, 'Position-closing, often short covering', 'Rally may lose fuel after shorts exit'],
    [-1, 1, 'New positions entering during a decline', 'Could include trapped longs or new shorts'],
    [-1, -1, 'Position-closing, often long liquidation', 'Bearish first; later may become exhaustion'],
    [0, 1, 'Leverage accumulating without resolution', 'Predicts instability, not direction'],
    [0, -1, 'Quiet deleveraging, reduced participation', 'May produce low-quality signals'],
  ];
  return h('table.tbl', h('thead', h('tr', h('th', 'Price'), h('th', 'OI'), h('th', 'Typical interpretation'), h('th', 'Main caution'))),
    h('tbody', rows.map(([p, o, a, b]) => h('tr', h('td', arrowTxt(p)), h('td', arrowTxt(o)), h('td', a), h('td.muted', b)))));
}
const arrowTxt = (d) => h('b', { style: { color: d > 0 ? '#199e70' : d < 0 ? '#e66767' : '#a9b3c2' } }, d > 0 ? '▲ Rising' : d < 0 ? '▼ Falling' : '■ Flat');

function creationCalc() {
  const st = { dOI: 18000, vol: 100000 };
  const out = h('b.mono', { style: { fontSize: '22px' } });
  const read = h('div.dim');
  const upd = () => {
    const r = st.dOI / st.vol; out.textContent = (r >= 0 ? '+' : '') + r.toFixed(3);
    read.textContent = r > 0.1 ? 'Strongly positive: a meaningful share of trading created new exposure.' : r < -0.1 ? 'Strongly negative: positions are being destroyed (closing or liquidation).' : 'Near zero: churn, transfer, or balanced opening and closing.';
  };
  const inp = (k, lbl) => h('div.f', lbl, h('input.input.num', { type: 'number', value: st[k], oninput: (e) => { st[k] = +e.target.value || 0; upd(); } }));
  upd();
  return h('div.fig', h('div.eyebrow', 'Try it: OI creation ratio'), h('div.grid.g3', { style: { gap: '12px', marginTop: '10px', alignItems: 'end' } }, inp('dOI', 'Change in OI (contracts)'), inp('vol', 'Volume traded (contracts)'), h('div', h('div.muted', { style: { fontSize: '12px' } }, 'Creation ratio'), out)), h('div', { style: { marginTop: '8px' } }, read));
}

function dollarTrap() {
  const W = 620; const H = 170;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}` });
  const bar = (x, hgt, col, lbl, v) => { put(s, svg('rect', { x, y: 140 - hgt, width: 90, height: hgt, rx: 6, fill: col })); put(s, svg('text', { x: x + 45, y: 160, 'text-anchor': 'middle', fill: '#a9b3c2', 'font-size': 12 }, lbl)); put(s, svg('text', { x: x + 45, y: 132 - hgt, 'text-anchor': 'middle', fill: '#edf2f8', 'font-size': 13, 'font-weight': 700 }, v)); };
  bar(40, 100, '#3987e5', 'ETH OI @ $2,000', '10,000 ETH'); bar(150, 100, '#3987e5', 'ETH OI @ $2,200', '10,000 ETH');
  bar(340, 91, '#c98500', '$ OI @ $2,000', '$20.0M'); bar(450, 100, '#c98500', '$ OI @ $2,200', '$22.0M');
  put(s, svg('text', { x: 135, y: 16, 'text-anchor': 'middle', fill: '#6f7a8b', 'font-size': 12 }, 'Base-coin OI: unchanged'));
  put(s, svg('text', { x: 435, y: 16, 'text-anchor': 'middle', fill: '#6f7a8b', 'font-size': 12 }, 'Dollar OI: "up 10%" with no new exposure'));
  return s;
}

const P = (...t) => h('p', ...t);
const callout = (kind, ic, ...t) => h(`div.callout.${kind}`, icon(ic), h('div', ...t));
const pattern = (title, tag, overview, list, example, warn, draw) => h('div',
  h('h3', title), h('div.tagrow', h('span.chip', tag)),
  fig(draw(), 'Schematic, not market data.'),
  P(overview), list ? h('ul', list.map(x => h('li', x))) : null,
  example ? callout('key', 'calculator', h('b', 'Worked example. '), example) : null,
  warn ? callout('warnbox', 'triangle-alert', warn) : null);

export const VOI = {
  id: 'voi',
  title: 'Volume and Open Interest',
  subtitle: 'Classify position creation, covering, liquidation, traps, leverage buildup and absorption',
  minutes: 35,
  pdf: '/static/study/Volume_and_Open_Interest_Trading_Guide.pdf',
  accent: '#3987e5',
  sections: [
    { id: 'foundations', title: 'What the numbers measure', body: () => h('div',
      h('h2', 'What volume and open interest actually measure'),
      P('Price shows what is happening. Volume measures trading effort. Open interest shows whether outstanding leveraged exposure is being created or destroyed. Funding helps identify which side may be paying to hold crowded exposure.'),
      callout('truth', 'scale', h('b', 'Non-negotiable truth. '), 'Rising OI does not mean there are more longs than shorts. Every derivative contract has one long and one short. OI is exposure, not directional headcount.'),
      h('h3', 'Volume'), P('The number of contracts traded in a period. A trade adds to volume whether it opens, closes, or transfers exposure. It answers: how much activity, urgency and disagreement happened here?'),
      h('ul', h('li', 'High volume can be initiation, closing, liquidation, absorption, or plain churn.'), h('li', 'A volume spike is not automatically bullish, bearish, continuation or reversal.'), h('li', 'Volume only means something at a price location and against a baseline.')),
      h('h3', 'Open interest'), P('The number of contracts still outstanding. It rises when new paired exposure is created and falls when existing exposure is closed.'),
      h('table.tbl', h('thead', h('tr', h('th', 'Buyer'), h('th', 'Seller'), h('th.num', 'Volume'), h('th.num', 'OI'), h('th', 'Mechanism'))), h('tbody',
        h('tr', h('td', 'Opens new long'), h('td', 'Opens new short'), h('td.num', '+1'), h('td.num.good', '+1'), h('td', 'New exposure created')),
        h('tr', h('td', 'Opens new long'), h('td', 'Closes old long'), h('td.num', '+1'), h('td.num', '0'), h('td', 'Exposure transferred')),
        h('tr', h('td', 'Closes old short'), h('td', 'Opens new short'), h('td.num', '+1'), h('td.num', '0'), h('td', 'Exposure transferred')),
        h('tr', h('td', 'Closes old short'), h('td', 'Closes old long'), h('td.num', '+1'), h('td.num.bad', '-1'), h('td', 'Exposure removed')))),
      callout('key', 'lightbulb', h('b', 'Stock versus flow. '), 'OI is a stock measured at a point in time. Volume is a flow measured over an interval. Heavy volume with little net OI change means churn, transfer, or offsetting opens and closes.')) },
    { id: 'matrix', title: 'The price x OI matrix', body: () => h('div',
      h('h2', 'The core price, volume and OI matrix'),
      P('Price supplies direction. OI says whether exposure is building or being removed. Volume measures the intensity. These are probabilistic classifications, not guarantees.'),
      matrixTable(),
      h('h3', 'Adding the volume layer'),
      h('table.tbl', h('thead', h('tr', h('th', 'Volume'), h('th', 'OI change'), h('th', 'Likely classification'))), h('tbody',
        h('tr', h('td', 'High'), h('td', 'Strongly positive'), h('td', 'Position initiation; meaningful new exposure')),
        h('tr', h('td', 'High'), h('td', 'Near zero'), h('td', 'Churn, transfer, or balanced opening and closing')),
        h('tr', h('td', 'High'), h('td', 'Strongly negative'), h('td', 'Position-closing, deleveraging, or liquidation')),
        h('tr', h('td', 'Low'), h('td', 'Positive'), h('td', 'Quiet leverage buildup; vulnerable if price stays compressed')),
        h('tr', h('td', 'Low'), h('td', 'Negative'), h('td', 'Participation fading without a major liquidation')))),
      callout('warnbox', 'triangle-alert', 'If price rises 4% while OI rises 6%, you know price rose and exposure increased. You do not yet know whether new longs caused it, whether new shorts are trapped, or whether it continues. Acceptance or rejection afterwards supplies that.')) },
    { id: 'breakout', title: 'Pattern 1 · Confirmed breakout', body: () => pattern('Confirmed breakout', 'PRICE UP · VOLUME UP · OI UP',
      'Price clears an established boundary while participation expands and OI rises: new exposure is entering, not just shorts closing.',
      ['A completed candle closes beyond the range.', 'Volume is meaningfully above its baseline.', 'OI rises during the break.', 'Price holds above the former boundary.', 'OI stays mostly elevated through the retest.', 'Funding is not already at an extreme positive percentile.'],
      'Resistance at $100. Price closes at $102 on 2.4 relative volume while OI rises 4.5%. The retest reaches $100.40 and OI slips only 0.5%. Most new exposure survived and price accepted the new area.',
      'The OI increase is not the entry signal. The tradable information is breakout plus participation plus acceptance.', p1) },
    { id: 'squeeze', title: 'Pattern 2 · Short covering', body: () => pattern('Short-covering rally', 'PRICE UP · VOLUME UP · OI DOWN',
      'Existing shorts buy to close. That lifts price, triggers stops and may liquidate other shorts. Violent, but every short that exits is one fewer forced buyer.',
      ['Watch whether price holds above the breakout rather than retracing.', 'Watch for OI to stop falling and start rebuilding.', 'New OI entering without losing the level is constructive.', 'Funding normalizing is healthier than instantly going extreme positive.'],
      'Price rises 7%, volume hits 3.2x normal, OI falls 11%, funding had been deeply negative. Consistent with a squeeze. Much of the forced-buying fuel is already spent.',
      'Do not assume the largest green candle is the best long entry.', p2) },
    { id: 'flush', title: 'Pattern 3 · Long liquidation', body: () => pattern('Long-liquidation flush', 'PRICE DOWN · VOLUME UP · OI DOWN',
      'Longs close, stops trigger, leveraged accounts are liquidated. Forced selling accelerates the decline while OI falls because exposure is being destroyed.',
      ['Initially: strong liquidation pressure.', 'Later: after a big OI purge, fewer vulnerable longs remain.', 'Exhaustion evidence: another volume burst makes only a marginal new low; price reclaims the liquidation low; OI stabilizes.'],
      'Price falls 9%, volume 4.1x, OI -15%. A later burst makes only a 0.5% new low, then price reclaims the first liquidation level. The reclaim, not the OI collapse, is the reversal evidence.',
      'An OI collapse proves leverage was removed. It does not prove price bottomed.', p3) },
    { id: 'trap', title: 'Pattern 4 · Failed breakout (your trap)', body: () => h('div', pattern('Failed breakout and trapped exposure', 'NEW OI + PRICE FAILURE',
      'New exposure enters on the breakout, but price cannot hold the area where those positions were opened. Late breakout traders become trapped, and their exits can fuel the reversal.',
      ['Price trades above resistance on expanding volume and OI.', 'Price closes back below resistance.', 'A retest from underneath fails.', 'Selling volume expands on the rejection.', 'OI stays above its pre-breakout level: trapped exposure is still present.'],
      'Resistance $100. Price reaches $103 as OI rises 6% on 2.7 relative volume, then closes at $99.40. The retest stops at $100 and OI stays 4% above its earlier level. More bearish than a failed break with an immediate OI collapse.',
      'Do not short merely because OI rises at resistance. The high-value event is new exposure entering, then price rejecting that entry area.', p4),
      callout('key', 'crosshair', h('b', 'This is your strategy. '), 'C2 of your checklist is "did the break recruit anyone?" (OI rising through the break). C4 is "were they forced out?" (OI dropping on the reclaim). The failed breakout pattern is the trap, drawn with volume and OI.')) },
    { id: 'coil', title: 'Pattern 5 · Leveraged coil', body: () => pattern('Leveraged coil', 'PRICE FLAT · OI UP · DIRECTION UNKNOWN',
      'Leverage accumulates without resolution. One of the best early warnings of expansion, because more positions are available to be stopped, trapped or liquidated. It predicts instability, not direction.',
      ['Mark the range high and low.', 'Set alerts at both boundaries.', 'Do not predict the breakout direction.', 'Wait for a completed candle outside the range.', 'Then evaluate the break\'s volume and OI.', 'Prefer acceptance or a retest over an isolated wick.'],
      'Price holds a 1.2% range for six hours while OI rises 13%, volume stays below median, funding climbs. Longs may be crowded, but shorting before the breakdown is still guessing.',
      null, p5) },
    { id: 'absorb', title: 'Pattern 6 · Absorption', body: () => pattern('Absorption or stalemate', 'HIGH EFFORT · LIMITED RESULT',
      'At resistance, aggressive buyers may be trading into large passive sellers (and the reverse at support). The resting side is absorbing the flow.',
      ['Establishes: major disagreement at the boundary, large exposure being created, a decision point approaching.', 'Does not establish: which side wins. The absorber can run out of supply and let price break the other way.'],
      'Volume 3.5x normal, OI +5%, yet price advances only 0.3% right under resistance. A big battle, not yet a trade.',
      'High volume with little progress is a decision-point warning, not an automatic reversal signal.', p6) },
    { id: 'calcs', title: 'Three calculations', body: () => h('div',
      h('h2', 'Three calculations worth monitoring'),
      h('h3', 'A. Relative volume (RVOL)'), h('div.math', 'RVOL = completed-bar volume / median volume of comparable bars (same time of day)'),
      P('Use completed candles and compare like hours: crypto has intraday rhythms. The median beats the mean because liquidation spikes distort averages. The Market Monitor computes it this way.'),
      h('table.tbl', h('tbody', h('tr', h('td', 'Below 0.7'), h('td', 'Unusually quiet')), h('tr', h('td', '0.7 to 1.3'), h('td', 'Ordinary')), h('tr', h('td', '1.3 to 2.0'), h('td', 'Active')), h('tr', h('td', 'Above 2.0'), h('td', 'Exceptional: investigate the mechanism')), h('tr', h('td', 'Above 3.0'), h('td', 'Possible news, breakout, absorption, or liquidation')))),
      h('h3', 'B. OI change %'), h('div.math', 'OI change % = (current OI - prior OI) / prior OI x 100'),
      P('Measure it over an entry horizon, a setup horizon and a structural horizon (the monitor shows 1h, 4h and 24h). A 2% change can be extraordinary for one market and routine for another: percentiles beat fixed thresholds.'),
      h('h3', 'C. OI creation ratio'), h('div.math', 'Creation ratio = change in OI / traded volume'),
      creationCalc()) },
    { id: 'funding', title: 'Funding and data traps', body: () => h('div',
      h('h2', 'Funding, and the dollar-OI trap'),
      h('h3', 'Dollar OI can rise without new positions'), fig(dollarTrap(), 'If OI is shown in dollars, price appreciation inflates it. Prefer contract or base-coin OI. Bybit reports linear OI in the base coin, which is what this app uses.'),
      h('h3', 'Funding: the one recommended addition'),
      P('Funding is a periodic transfer between long and short perpetual holders that keeps the perp near the index. Positive generally means longs pay shorts; negative means shorts pay longs.'),
      h('table.tbl', h('thead', h('tr', h('th', 'OI'), h('th', 'Funding'), h('th', 'Price'), h('th', 'Interpretation'))), h('tbody',
        h('tr', h('td', 'Rising'), h('td', 'Strong +'), h('td', 'Rising'), h('td', 'Long side increasingly crowded')),
        h('tr', h('td', 'Rising'), h('td', 'Strong -'), h('td', 'Falling'), h('td', 'Short side increasingly crowded')),
        h('tr', h('td', 'Rising'), h('td', 'Neutral'), h('td', 'Trending'), h('td', 'Healthier participation')),
        h('tr', h('td', 'Falling'), h('td', 'Positive'), h('td', 'Falling'), h('td', 'Longs likely being flushed')),
        h('tr', h('td', 'Falling'), h('td', 'Negative'), h('td', 'Rising'), h('td', 'Shorts likely being squeezed')),
        h('tr', h('td', 'Very high'), h('td', 'Extreme'), h('td', 'Flat'), h('td', 'Crowded coil, squeeze vulnerability')))),
      callout('key', 'percent', h('b', 'Normalize it. '), 'Do not define one number as "high". Use each symbol\'s own history: above the 90th percentile is unusually positive, below the 10th unusually negative. The monitor\'s funding ring shows exactly this percentile.'),
      callout('warnbox', 'triangle-alert', 'Funding is a crowding and vulnerability filter, not an automatic contrarian entry. Strong trends can stay crowded for a long time.')) },
    { id: 'process', title: 'The decision process', body: () => h('div',
      h('h2', 'A complete decision process'),
      h('ol', { style: { lineHeight: 1.9 } },
        h('li', h('b', 'Establish price location. '), 'Range, swing points, the breakout or breakdown boundary. Trending, ranging, or failing at a level?'),
        h('li', h('b', 'Classify volume. '), 'Ordinary, expanding, or climactic? Compare effort with the progress it bought.'),
        h('li', h('b', 'Classify OI. '), 'Building, stable, or contracting? Is the change exceptional for this symbol? What unit is it in?'),
        h('li', h('b', 'Name the mechanism. '), 'New-position trend, short covering, long liquidation, leveraged coil, failed breakout, absorption, or indeterminate.'),
        h('li', h('b', 'Require a price trigger. '), 'Completed breakout, successful retest, failed retest, post-liquidation reclaim, or loss of a stabilization level.'),
        h('li', h('b', 'Define invalidation. '), 'The stop goes where the market proves the classification wrong. Then size from that distance.')),
      callout('truth', 'shield-check', h('b', 'The rule. '), 'If you cannot name the mechanism and the price event that invalidates it, there is no trade under this framework.'),
      h('h3', 'Ten-question entry checklist'),
      h('ol', ['Where is price relative to the range or decision level?', 'Is volume ordinary, expanding, or climactic?', 'Is OI building, stable, or purging?', 'Does the activity look like opening, closing, or churn?', 'What does funding say about crowding?', 'Which named pattern best fits?', 'What has price actually confirmed?', 'What exact event proves the interpretation wrong?', 'Was size calculated from that invalidation?', 'Am I responding to evidence or guessing direction?'].map(x => h('li', x)))) },
    { id: 'mistakes', title: 'Rules and common errors', body: () => h('div',
      h('h2', 'Rules that prevent common mistakes'),
      h('ol', ['Never interpret OI without price. OI has no independent direction.', 'Never interpret volume without location.', 'Use completed candles. An unfinished bar has incomplete volume.', 'Compare like with like: symbol, exchange, contract type, unit, timeframe.', 'Keep spot volume and perp volume separate.', 'A volume spike can be initiation, absorption, liquidation, closing, or climax.', 'An OI collapse proves exposure left; it does not create an immediate reversal.', 'Do not fade extreme funding without price confirmation.', 'Be careful with thin or fragmented coins: OI can be concentrated and volume less trustworthy.', 'Treat aggregated crypto OI as approximate.'].map(x => h('li', x))),
      h('h3', 'Quick reference'),
      h('div.grid.g3', { style: { gap: '10px' } }, [
        ['Confirmed upside break', 1, 1, 1], ['Short-covering rally', 1, 1, -1], ['Long-liquidation flush', -1, 1, -1],
        ['Failed upside break', -1, 1, 1], ['Leveraged coil', 0, 0, 1], ['Absorption', 0, 1, 1]].map(([n, p, v, o]) => h('div.fig', { style: { margin: 0 } }, h('b', n), h('div', { style: { marginTop: '8px' } }, arrows(p, v, o))))),
      callout('key', 'waves', 'Rising OI adds fuel. Falling OI removes fuel. Volume shows the force being used. Price determines which side is winning. Funding shows which side may be overcrowded.')) },
  ],
  quiz: [
    { q: 'OI rises 5% on a breakout. What does that prove about longs versus shorts?', o: ['There are more longs than shorts', 'Nothing: every contract has one long and one short', 'Shorts are trapped', 'The breakout will continue'], a: 1, why: 'OI is exposure, not directional headcount. Each contract has a long and a short.' },
    { q: 'Price up, volume up, OI down most likely means…', o: ['New longs entering', 'Short covering', 'Leveraged coil', 'Absorption'], a: 1, why: 'Exposure is being removed while price rises: shorts are closing.' },
    { q: 'In your trap strategy, C2 requires open interest to…', o: ['Fall through the break', 'Rise through the break', 'Stay flat', 'Match funding'], a: 1, why: 'If nobody entered on the break, nobody is trapped and there is no fuel.' },
    { q: 'On the C4 reclaim, what OI behavior confirms the trap?', o: ['OI rising sharply', 'OI dropping sharply', 'OI unchanged', 'OI irrelevant'], a: 1, why: 'A sharp drop shows the trapped side was forced out.' },
    { q: 'Price flat for hours, OI up 13%, volume below median. This is…', o: ['A short signal', 'A leveraged coil: instability, direction unknown', 'Absorption', 'Deleveraging'], a: 1, why: 'Stored leverage predicts a bigger move, not its direction. Wait for a completed candle outside the range.' },
    { q: 'Why does RVOL use the median of same-time-of-day bars?', o: ['It is faster to compute', 'Crypto has intraday rhythms and liquidation spikes distort the mean', 'Bybit requires it', 'It makes RVOL larger'], a: 1, why: 'Compare like hours, and use the median so outliers do not skew the baseline.' },
    { q: 'OI change 18,000 contracts on 100,000 contracts of volume. The creation ratio is…', o: ['+0.018', '+0.18', '+1.8', '-0.18'], a: 1, why: '18,000 / 100,000 = 0.18: meaningful position-building.' },
    { q: 'Dollar OI rose 10% while ETH price rose 10%. New exposure created?', o: ['Yes, 10%', 'Not necessarily: the base-coin OI may be unchanged', 'Yes, 20%', 'Only if funding rose'], a: 1, why: 'Price appreciation inflates dollar OI mechanically. Use base-coin OI.' },
    { q: 'Funding sits at its 95th percentile for this symbol. The right use is…', o: ['Short immediately', 'Treat it as a crowding filter and wait for price confirmation', 'Ignore it', 'Double the size'], a: 1, why: 'Funding flags vulnerability, not an entry. Trends can stay crowded.' },
    { q: 'An OI collapse during a sell-off proves…', o: ['Price has bottomed', 'Leverage was removed', 'Longs are trapped', 'A squeeze is next'], a: 1, why: 'It proves exposure left. The reclaim, not the purge, is the reversal evidence.' },
  ],
  cards: [
    ['OI is…', 'Exposure outstanding (a stock). Every contract has one long and one short.'],
    ['Volume is…', 'Trading effort over an interval (a flow).'],
    ['Price up, OI up', 'New positions entering during an advance.'],
    ['Price up, OI down', 'Short covering.'],
    ['Price down, OI down', 'Long liquidation.'],
    ['Price flat, OI up', 'Leveraged coil: instability, no direction.'],
    ['High volume, little progress, OI up', 'Absorption: a decision point.'],
    ['New OI + price rejection', 'Failed breakout: trapped exposure. Your trap.'],
    ['RVOL formula', 'Completed-bar volume / median of comparable bars.'],
    ['Creation ratio', 'Change in OI / volume. Positive = building, near zero = churn, negative = destruction.'],
    ['Funding normalization', 'Use the symbol\'s own percentile: >90th crowded long, <10th crowded short.'],
    ['No trade when…', 'You cannot name the mechanism and the event that invalidates it.'],
  ],
};
