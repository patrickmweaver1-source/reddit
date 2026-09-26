// Study guide: Chart-based objectives and exit criteria. An ORIGINAL guide written for this
// app, organized around topics covered in Jack D. Schwager, "Getting Started in Technical
// Analysis" (Wiley, 1999). Nothing here is quoted from the book. Read the book itself.
import { h, icon } from '../ui.js';
import { candleFig, fromCloses, fig } from './diagrams.js';

const rng = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const P = (...t) => h('p', ...t);
const B = (t) => h('b', t);
const UL = (...items) => h('ul', items.map(i => h('li', i)));
const callout = (kind, ic, ...t) => h(`div.callout.${kind}`, icon(ic), h('div', ...t));
const D = (opts, cap) => fig(candleFig({ height: 190, ...opts }), cap);
const tbl = (head, rows) => h('table.tbl', h('thead', h('tr', head.map(x => h('th', x)))),
  h('tbody', rows.map(r => h('tr', r.map(c => h('td', c))))));

const GOLD = '#f4c24f'; const TEAL = '#36d7c7'; const RED = '#ef4b4b';

// ---- diagrams (schematic, not market data) ---------------------------------------------------
const rangeProj = () => D({
  candles: fromCloses([...rng(12, i => 100 + Math.sin(i * 1.3) * 1.4), 102.4, 103.3, 103.0, 104.2, 105.1, 105.8, 106.1], { wick: 0.2 }),
  lines: [{ y: 101.7, label: 'range high', color: TEAL }, { y: 98.5, label: 'range low', color: TEAL }, { y: 104.9, label: 'objective', color: GOLD }],
  segs: [{ i0: 3, y0: 98.5, i1: 3, y1: 101.7, color: GOLD, label: 'H' }, { i0: 12, y0: 101.7, i1: 12, y1: 104.9, color: GOLD, dash: '4 3', label: '+H' }],
  marks: [{ i: 12, y: 102.4, label: 'breakout', dir: 'down' }],
}, 'Range projection: measure the range height (H) and add it to the broken boundary. A common convention, not a promise: here price runs past it.');

const hsTarget = () => D({
  candles: fromCloses([100, 102, 104, 103, 101.8, 103.5, 106.2, 108, 105.5, 102.3, 103.6, 105, 104, 102.5, 100.8, 99.2, 98, 97, 96.2, 95.8]),
  lines: [{ y: 101.9, label: 'neckline' }, { y: 94.8, label: 'objective', color: GOLD }],
  segs: [{ i0: 8, y0: 101.9, i1: 8, y1: 109, color: GOLD, label: 'H' }, { i0: 14, y0: 101.9, i1: 14, y1: 94.8, color: GOLD, dash: '4 3', label: '-H' }],
  marks: [{ i: 8, y: 109, label: 'head' }],
}, 'Head-and-shoulders top: the distance from the head to the neckline, projected down from the neckline break. Here price stalls just short of the objective.');

const flagProj = () => D({
  candles: fromCloses([100, 101.8, 103.9, 106.1, 108, 107.4, 106.9, 107.3, 106.6, 106.1, 106.5, 105.9, 107.8, 109.6, 111.2, 112.8, 113.6, 113.9]),
  lines: [{ y: 115, label: 'objective', color: GOLD }],
  segs: [{ i0: 0, y0: 100, i1: 4, y1: 108, color: TEAL, dash: '4 3' },
    { i0: 4, y0: 108.3, i1: 11, y1: 106.9, color: GOLD }, { i0: 5, y0: 106.9, i1: 11, y1: 105.5, color: GOLD },
    { i0: 12, y0: 107, i1: 12, y1: 115, color: GOLD, dash: '4 3', label: '+pole' }],
  marks: [{ i: 2, y: 103.9, label: 'pole', dir: 'down', color: TEAL }],
}, 'Flag: the length of the pole (the sharp move before the flag) projected from the breakout of the flag.');

const dtopTarget = () => D({
  candles: fromCloses([100, 102, 104.5, 106.8, 108, 106.4, 104.6, 105.8, 107.4, 107.9, 106, 104, 102.8, 101.5, 100.4, 100.9, 99.6, 99.3]),
  lines: [{ y: 104, label: 'valley low' }, { y: 99.7, label: 'objective', color: GOLD }],
  segs: [{ i0: 5, y0: 104, i1: 5, y1: 108.3, color: GOLD, label: 'H' }, { i0: 12, y0: 104, i1: 12, y1: 99.7, color: GOLD, dash: '4 3', label: '-H' }],
  marks: [{ i: 17, y: 99.2, label: 'overshoot', dir: 'down', color: RED }],
}, 'Double top: peak-to-valley height projected down from the break of the valley low. Here price overshoots the objective, which is common.');

const measured = () => D({
  candles: fromCloses([100, 101.5, 103, 104.6, 106.2, 108, 107.2, 106.1, 105, 104.2, 104.8, 106, 107.5, 109, 110.4, 111.5, 112.1]),
  lines: [{ y: 112.2, label: 'B = A', color: GOLD }],
  segs: [{ i0: 0, y0: 100, i1: 5, y1: 108, color: TEAL, label: 'A' }, { i0: 9, y0: 104.2, i1: 16, y1: 112.2, color: GOLD, dash: '5 4' }],
  marks: [{ i: 9, y: 104.1, label: 'correction', dir: 'down' }],
}, 'Measured move: the second leg is assumed to roughly equal the first. Leg A (8 points) added to the correction low gives the objective.');

const retrace = () => D({
  candles: fromCloses([100, 101.4, 102.9, 104.5, 106.1, 107.8, 109.2, 110, 109.1, 108, 106.9, 105.8, 105.1, 105.6, 106.8, 108.2, 109.5]),
  zones: [{ y0: 103.3, y1: 106.7, color: 'rgba(54,215,199,.10)' }],
  lines: [{ y: 106.18, label: '38.2%', color: GOLD }, { y: 105, label: '50%', color: GOLD }, { y: 103.82, label: '61.8%', color: GOLD }],
  marks: [{ i: 7, y: 110.2, label: 'swing high' }, { i: 12, y: 105, label: 'pullback', dir: 'down' }],
}, 'Retracement levels of a 100 to 110 advance. The shaded band is the 33% to 67% zone. These are reference zones where a correction may pause, not levels the market must respect.');

const springTarget = () => D({
  candles: fromCloses([...rng(12, i => 102 + Math.sin(i * 1.2) * 1.5), 101.0, 99.9, 100.6, 101.4, 102.3, 103.0, 103.7, 103.9],
    { wick: 0.2, special: { 13: { l: 99.7 } } }),
  zones: [{ y0: 101.33, y1: 102.67, color: 'rgba(239,75,75,.08)' }],
  lines: [{ y: 104, label: 'objective', color: GOLD }, { y: 100, label: 'range low', color: TEAL }],
  marks: [{ i: 13, y: 99.6, label: 'stop', dir: 'down', color: RED }, { i: 14, y: 100.6, label: 'entry' }],
}, 'Spring: entry on the close back inside (100.6), stop a few ticks under the wick (99.6), objective at the range high (104). The red band is the middle third, where rule 9 says no trade.');

const trail = () => D({
  candles: fromCloses([100, 101.5, 103, 102, 101.2, 102.6, 104.4, 106, 105, 104.2, 105.8, 107.6, 109.2, 108.1, 107.3, 109, 111, 110.2, 108.4, 107],
    { special: { 19: { l: 106.5 } } }),
  segs: [{ i0: 4, y0: 100.5, i1: 9, y1: 100.5, color: GOLD }, { i0: 9, y0: 103.7, i1: 14, y1: 103.7, color: GOLD },
    { i0: 14, y0: 106.6, i1: 19, y1: 106.6, color: GOLD, label: 'trail' }],
  marks: [{ i: 19, y: 106.6, label: 'stopped', dir: 'down', color: RED }],
}, 'Swing-based trailing stop: after each new higher low forms, the stop steps up under it. It only moves toward the trade, never away (your rule 7).');

const candleFour = () => D({
  candles: fromCloses([102.2, 101.6, 101.1, 100.5, 99.8, 100.6, 100.8, 100.5, 100.9, 100.6, 100.4], { wick: 0.3 }),
  shade: [{ i0: 6, i1: 9, color: 'rgba(244,194,79,.10)' }],
  lines: [{ y: 100.6, label: 'breakeven', color: GOLD }],
  marks: [{ i: 5, y: 100.9, label: 'entry' }, { i: 9, y: 100.6, label: 'exit at BE', dir: 'down', color: RED }],
}, 'Time-based exit: four candles after entry (shaded) and still no expansion. Rule 6 takes you out at breakeven whatever the target says.');

// ---- guide -----------------------------------------------------------------------------------
export const OBJECTIVES = {
  id: 'objectives',
  title: 'Chart-Based Objectives',
  subtitle: 'Setting price targets and exit criteria from the chart, and knowing how far to trust them',
  minutes: 40,
  accent: '#199e70',
  sections: [
    { id: 'why', title: 'Why objectives matter', body: () => h('div',
      h('h2', 'Why objectives matter'),
      P('An entry and a stop tell you what you can lose. They say nothing about what you might make. A price objective fills that gap: it is the chart-based estimate of where the move you are betting on is likely to run out of room. Without one, you cannot state the reward-to-risk ratio of a trade before you take it, and a trade whose reward you cannot estimate is a trade you cannot compare with the one you skip.'),
      P('Your workflow already assumes an objective exists. The Position Planner has a target field, the default playbook names a target for each of the four setups, and rule 8 checks that the range is tall enough relative to the stop before you trade. Every one of those pieces needs a number at a place on the chart.'),
      callout('warnbox', 'book-open-text', B('Source note. '), 'Written in original words for this app, organized around topics covered in Jack D. Schwager, ', h('i', 'Getting Started in Technical Analysis'), ' (Wiley, 1999), which includes a discussion of chart-based price objectives. This guide quotes nothing from the book and is not a summary of its text. Most of the techniques below are standard technical-analysis conventions described in many sources. Read the book for his full treatment and charts.'),
      callout('key', 'crosshair', B('Adaptation. '), 'The classic measuring rules were described on daily bars of exchange-traded futures. You trade 15-minute candles on a 24/7 perpetual. Whether these projections behave the same way at your timeframe is a hypothesis. Your journal, not this guide, is what will confirm or reject it.'),
      h('h3', 'What an objective is for'),
      UL([B('Before entry: '), 'to compute reward-to-risk and decide whether the trade is worth taking at all.'],
        [B('During the trade: '), 'to know where profit-taking is planned, so you are not deciding under pressure.'],
        [B('After the trade: '), 'to measure in the journal whether your objectives were realistic, too timid, or too greedy.'])) },

    { id: 'limits', title: 'What objectives can and cannot do', body: () => h('div',
      h('h2', 'Objectives are estimates'),
      P('A price objective is not a forecast in the scientific sense. It is a rule of thumb that points to a plausible area. Markets routinely stop short of a textbook objective, and just as routinely blow straight through it. A strong trend can travel several times the measured distance; a weak one can stall halfway.'),
      callout('truth', 'shield-check', B('The honest summary. '), 'Objectives are most useful for filtering trades before entry (is there enough room?) and least useful as a reason to hold a losing position or to close a winner that is still behaving well. Treat them as reference points, not as destinations the market owes you.'),
      h('h3', 'Two ways objectives go wrong'),
      tbl(['Failure', 'What happens', 'Cost'], [
        ['Market falls short', 'Price reverses before reaching the target; the order never fills.', 'A paper winner turns into a scratch or a loss.'],
        ['Market overshoots', 'Price hits the target and keeps going.', 'You capture the planned R but miss the rest of the move.'],
      ]),
      P('Neither failure is fixed by finding a "better" measuring rule. They are managed by the exit plan around the objective: partial exits, trailing stops, and time limits, covered later in this guide.'),
      h('h3', 'Several estimates beat one'),
      P('When a pattern measurement, a prior swing and a round number all fall close together, that cluster is a more credible objective than any one of them alone. When they disagree widely, the honest answer is that the chart does not give a clean objective, and the nearest credible obstacle is the conservative choice.'),
      callout('warnbox', 'triangle-alert', 'Nothing in this guide gives a hit rate for any measuring rule. Such figures vary by market, timeframe and definition, and any number quoted without your own data behind it would be invented.')) },

    { id: 'patterns', title: 'Pattern measuring rules', body: () => h('div',
      h('h2', 'Pattern measuring rules'),
      P('Most classic chart patterns come with a conventional way to project an objective. They share one idea: measure the height of the pattern and project that distance from the breakout point in the direction of the break.'),
      h('h3', 'Trading range'), rangeProj(),
      P('Measure from the range floor to the range ceiling, then add that height to the breakout level (or subtract it from a downside break).'),
      h('h3', 'Head-and-shoulders'), hsTarget(),
      P('Measure from the top of the head down to the neckline, then project that distance from the point where the neckline breaks. The same logic is flipped for an inverse head-and-shoulders bottom.'),
      h('h3', 'Flags and pennants'), flagProj(),
      P('Measure the pole, the sharp move that came before the flag, and project it from the flag breakout. The implied idea is that the flag sits roughly halfway through the whole move, which is why it is sometimes called a half-mast pattern.'),
      h('h3', 'Triangles'),
      P('A common convention measures the vertical height of the triangle at its widest point (its base) and projects that distance from the breakout. Because triangles are drawn with some judgment about which highs and lows count, two analysts can get different objectives from the same chart.'),
      h('h3', 'Double tops and bottoms'), dtopTarget(),
      P('Measure from the peaks down to the valley low between them and project that distance below the valley low once it breaks (mirror image for a double bottom).'),
      tbl(['Pattern', 'What to measure', 'Project from'], [
        ['Range', 'Floor to ceiling', 'The broken boundary'],
        ['Head-and-shoulders', 'Head to neckline', 'The neckline break'],
        ['Flag / pennant', 'Length of the pole', 'The flag breakout'],
        ['Triangle', 'Height of the base (widest part)', 'The breakout'],
        ['Double top / bottom', 'Peaks (or troughs) to the middle valley (or peak)', 'The valley (or peak) break'],
      ]),
      callout('key', 'lightbulb', B('Why this matters to a trap trader. '), 'Your setups are failed versions of these very breakouts. When a range breakout fails, the traders who bought it were aiming at the measured objective above. When it falls back inside, the natural objective flips to the other side of the range.')) },

    { id: 'measured', title: 'Measured moves and equal legs', body: () => h('div',
      h('h2', 'Measured moves'),
      measured(),
      P('A measured move assumes that a trend unfolds in two roughly equal legs separated by a correction. Measure the first leg, add it to the low of the correction (or subtract it from the high of a bounce in a downtrend), and you have an objective for the second leg.'),
      P('Schwager discusses the measured move among his chart-based objective methods. The general idea is widely used under other names too: equal legs, AB = CD, or leg-for-leg projections.'),
      h('h3', 'Using it well'),
      UL('The first leg should be clean and obvious. If you have to argue about where it started, the projection is weak.',
        'The correction should be a real pause, not a single-candle wobble.',
        'Equal legs are a tendency, not a law. The second leg is often shorter or longer; check whether other objectives (a prior swing, a round number) sit nearby.'),
      h('h3', 'The Rule of Seven'),
      P('Schwager also describes a method known as the Rule of Seven among the ways of deriving price objectives. This guide does not reproduce the method: see the book for how it works and how he suggests using it.'),
      callout('warnbox', 'info', 'On a 15-minute perpetual, "legs" are often driven by liquidation cascades that do not care about symmetry. Treat equal-leg projections as a secondary reference behind the obvious levels your C1 is already built on.')) },

    { id: 'sr', title: 'Support and resistance as objectives', body: () => h('div',
      h('h2', 'Support and resistance as objectives'),
      P('Pattern projections tell you where a move might go. Support and resistance tell you where it is likely to meet opposition. For most trades the second question is the more practical one: an objective sitting just beyond a major obstacle is optimistic, and one sitting just in front of it is conservative.'),
      springTarget(),
      h('h3', 'The common reference levels'),
      UL([B('Opposite range boundary: '), 'after a failed break of one side of a range, the other side is the first obvious place where the move can meet sellers (or buyers).'],
        [B('Prior swing high or low: '), 'the most recent significant turning point in the direction of the trade.'],
        [B('Prior range: '), 'a zone where price spent time before. Traders who are trapped in it may exit when price returns, so it can act as a magnet and then as a wall.'],
        [B('Round numbers: '), 'psychological levels where orders, alerts and liquidations tend to cluster. In crypto they are especially visible because so many participants anchor to them.']),
      P('Many analysts place the objective slightly in front of the level rather than on it, since resting orders at a level tend to be filled by the crowd that also aimed at it.'),
      callout('key', 'layers', 'The same logic that makes a level "obvious" for C1 makes the opposite obvious level a natural objective. If three other traders would draw it, it is also where some of them will take profit.'),
      callout('warnbox', 'triangle-alert', 'A support or resistance level is a zone, not a line. On 15-minute candles, wicks will often poke a few ticks beyond it. Plan for the objective as an area.')) },

    { id: 'retrace', title: 'Percentage retracements', body: () => h('div',
      h('h2', 'Percentage retracements'),
      retrace(),
      P('After a strong move, a correction often retraces part of it before the trend resumes. Chart analysts commonly mark reference levels at fixed fractions of the prior move:'),
      tbl(['Convention', 'Levels', 'Where it comes from'], [
        ['Thirds and halves', '33%, 50%, 67% (about one third, one half, two thirds)', 'Long-standing chart convention'],
        ['Fibonacci-style', '38.2%, 61.8% (often alongside 50%)', 'Ratios derived from the Fibonacci sequence'],
      ]),
      P('Two ways to use them: as a zone where a counter-trend correction may run out of steam (a place to watch for trend resumption), and as objectives for a counter-trend trade that aims only to capture part of the prior move.'),
      h('h3', 'Worked arithmetic'),
      P('A move runs from 100 to 110, a height of 10. The 50% retracement is 110 minus 5, or 105. The 38.2% level is 110 minus 3.82, or 106.18. The 61.8% level is 110 minus 6.18, or 103.82.'),
      callout('warnbox', 'triangle-alert', B('Caution. '), 'Retracement levels are reference zones, not laws. With enough lines drawn, price will always be near one of them, which makes them look more reliable in hindsight than they are in real time. They carry more weight when they line up with a real level (a prior swing, a range boundary, a round number).')) },

    { id: 'exits', title: 'Exit criteria beyond the target', body: () => h('div',
      h('h2', 'Exit criteria beyond the target'),
      P('A target is only one way out of a trade. Because objectives are estimates, most traders also define other conditions that end a trade, whether the target has been reached or not.'),
      h('h3', 'Trailing stops'), trail(),
      P('A trailing stop follows price in the direction of the trade: under each new higher low in a long, over each new lower high in a short, or at a fixed distance such as a multiple of ATR. It lets a winner run past a timid objective while locking in part of the gain. The price of that flexibility is giving back some profit when the stop is finally hit.'),
      h('h3', 'Time-based exits'), candleFour(),
      P('If a trade does not do what it was supposed to do within a set time, the reason for taking it has weakened. A time stop ends the trade even though neither the stop nor the target has been hit.'),
      h('h3', 'Change in market opinion'),
      P('Every trade rests on a reason. If that reason disappears (the level you traded is reclaimed against you, the regime flips, the pattern you expected to fail succeeds instead), there is a case for exiting before the stop does it for you. The discipline here is to define in advance what would count as the reason disappearing, so this does not turn into an excuse to exit every trade early.'),
      h('h3', 'Counter-trend signals'),
      P('A signal pointing the other way, such as a failed breakout against your position or a reversal pattern at your objective, is a reason to take profit or tighten the stop. Given that your whole strategy is built on failed signals, respecting one that goes against you is consistent with the rest of your playbook.'),
      h('h3', 'Overbought and oversold readings'),
      P('Oscillators that flag a market as overbought or oversold are often used as a signal to take profits. Use them with care: in a strong trend a market can stay overbought for a long time while continuing higher, so exiting purely on the reading can cut the best trades short. They are more useful as a reason to tighten a stop than as a reason to exit outright.'),
      callout('key', 'lightbulb', 'Pick your exit criteria before entry and write them in the plan. An exit rule invented mid-trade is usually fear or greed dressed up as analysis.')) },

    { id: 'rr', title: 'Risk, reward and partial exits', body: () => h('div',
      h('h2', 'Reward-to-risk with real numbers'),
      P('R is the amount you risk on the trade. With your rule 1, that is 1% of equity. Reward-to-risk is the distance to the objective divided by the distance to the stop.'),
      h('h3', 'Worked example: the Spring above'),
      tbl(['Item', 'Value', 'How'], [
        ['Equity', '10,000', 'Illustrative account'],
        ['Risk (1R)', '100', '1% of 10,000 (rule 1)'],
        ['Entry', '100.6', 'Decisive close back inside (rule 5)'],
        ['Stop', '99.6', 'A few ticks under the trap wick at 99.7 (rule 2)'],
        ['Stop distance', '1.0', '100.6 minus 99.6'],
        ['Size', '100 units', '100 risk divided by 1.0 per unit'],
        ['Objective', '104.0', 'Range high (Spring default target)'],
        ['Reward per unit', '3.4', '104.0 minus 100.6'],
        ['Reward', '340 = 3.4R', '100 units times 3.4'],
        ['Break-even win rate', 'about 22.7%', '1 divided by (1 + 3.4)'],
      ]),
      P('The notional is 100 units at 100.6, about 10,060, so the leverage actually needed is roughly 1x. That matches rule 4: risk% divided by stop%, here 1% divided by about 0.99%.'),
      P('Rule 8 check: the range is 100 to 104, a height of 4.0, which is exactly 4 times the 1.0 stop, so the stop gate passes (the ATR and cost gates need their own numbers). Suppose, for illustration, that the round-trip cost of this trade is 8: that is 8% of the 100 risk, under the 10% limit.'),
      h('h2', 'Expectancy'),
      P('Expectancy is the average result per trade, in R:'),
      callout('key', 'calculator', B('Expectancy = (win% x average win) - (loss% x average loss)'), ', with wins and losses both measured in R. A trade system is only worth running if this is positive after costs.'),
      h('h3', 'Partial exits vs all-or-nothing'),
      P('A partial exit takes some of the position off at a nearer level and leaves the rest for the full objective. All-or-nothing keeps the whole position until the target or the stop. Which is better depends entirely on how your trades actually move, as two hypothetical distributions show. In both plans the stop moves to breakeven once price reaches +1.5R. These numbers are invented to show the arithmetic and are not statistics about any strategy.'),
      tbl(['Distribution 1', 'Share', 'All-or-nothing at 3R', 'Half at 1.5R, half at 3R'], [
        ['Runs to 3R', '35%', '+3.0R', '+2.25R (0.5 x 1.5 + 0.5 x 3)'],
        ['Reaches 1.5R, back to BE', '15%', '0R', '+0.75R (0.5 x 1.5 + 0)'],
        ['Stopped at -1R', '50%', '-1R', '-1R'],
        [B('Expectancy'), '', B('0.35 x 3 - 0.50 x 1 = +0.55R'), B('0.35 x 2.25 + 0.15 x 0.75 - 0.50 x 1 = +0.40R')],
      ]),
      tbl(['Distribution 2', 'Share', 'All-or-nothing at 3R', 'Half at 1.5R, half at 3R'], [
        ['Runs to 3R', '15%', '+3.0R', '+2.25R'],
        ['Reaches 1.5R, back to BE', '35%', '0R', '+0.75R'],
        ['Stopped at -1R', '50%', '-1R', '-1R'],
        [B('Expectancy'), '', B('0.15 x 3 - 0.50 x 1 = -0.05R'), B('0.15 x 2.25 + 0.35 x 0.75 - 0.50 x 1 = +0.10R')],
      ]),
      P('When many trades run all the way, partials cost you expectancy because they cut the size of your best outcomes. When many trades stall halfway, partials rescue some of that stalled profit. Partials also smooth the equity curve, which matters for discipline even when it does not raise the average.'),
      callout('truth', 'shield-check', 'Which distribution you trade is an empirical question. Your journal records how far each trade went before it ended. Thirty or more logged trades per setup is the minimum before choosing between these plans with any confidence.')) },

    { id: 'mapping', title: 'Mapping it to your trading', body: () => h('div',
      h('h2', 'Mapping it to your trading'),
      h('h3', 'Setup targets in the default playbook'),
      tbl(['Setup', 'Default target', 'Why that level'], [
        [B('Spring'), 'Range high', 'The failed break of the low flips the natural objective to the opposite boundary.'],
        [B('Upthrust'), 'Range low', 'Mirror image: the failed break of the high points at the range floor.'],
        [B('Sweep'), 'Prior swing', 'A one-candle sweep is a local event; the nearest significant swing is the first obstacle.'],
        [B('Failed retest'), 'Prior range', 'Once the retest fails, price is heading back toward the range the level came from.'],
      ]),
      P('The Position Planner\'s target field is "opposite range boundary". That is a support-and-resistance objective, not a pattern projection: the conservative choice this guide recommends when you need one number.'),
      h('h3', 'Rule 8: the range gate'),
      P('Rule 8 requires a range height of at least 6x ATR and 4x the stop (plus round-trip cost under 10% of risk). The 4x-stop part is an objective check in disguise. Entering near one boundary with the target at the other, a range four stops tall leaves room for a multi-R target even after allowing for entry a little inside the boundary and a target set slightly in front of the far side.'),
      h('h3', 'Rule 9: the middle third'),
      P('Rule 9 forbids trades in the middle third of the range. From the middle, the opposite boundary is at most about two thirds of the range away and often less, so the reward-to-risk shrinks; and nobody is trapped in the middle of a range, so there is no setup to begin with.'),
      h('h3', 'Rule 6: candle four'),
      P('No expansion by candle four means exit at breakeven. That is a time-based exit and a change-of-opinion exit in one: a genuine trap should release trapped traders quickly, so a stall says the reason for the trade has weakened. It overrides the target.'),
      h('h3', 'Rule 13: add-ons, the opposite of partials'),
      P('Partial exits scale out; rule 13 scales in. Add-ons come only after candle-four expansion, at +1R and +2R (half size each by default), and only after the stop is moved so total risk never exceeds the original 1R. Adding makes the objective matter more, since the extra size only pays if price travels well beyond the first rung. Any partial-exit plan you test would be a playbook change, made at the monthly review (rule 11), not mid-session.'),
      h('h3', 'What to log'),
      UL('Whether the objective was reached, fell short, or was overshot.',
        'How far price went in your favor before the exit, and whether a trailing stop or partial would have done better.',
        'Whether rule 6 fired, and what price did after you scratched.'),
      callout('warnbox', 'triangle-alert', 'The measuring rules in this guide came from daily-bar markets. Whether range projections, equal legs or retracement zones mean anything on 15-minute perpetuals is a hypothesis. Only your journal can confirm it.')) },
  ],
  quiz: [
    { q: 'Why set a price objective before entry?', o: ['To guarantee the trade wins', 'To compute reward-to-risk and decide whether the trade is worth taking', 'To avoid needing a stop', 'Because the exchange requires it'], a: 1, why: 'Without an objective you can state the risk but not the reward, so you cannot judge the trade.' },
    { q: 'A range runs from 98 to 102 and breaks upward. The conventional range projection is…', o: ['104', '100', '106', '110'], a: 2, why: 'Height 4, added to the 102 breakout: 106.' },
    { q: 'The head-and-shoulders objective is measured from…', o: ['The left shoulder to the right shoulder', 'The head to the neckline, projected from the neckline break', 'The neckline to the prior low', 'The right shoulder to the target'], a: 1, why: 'Head-to-neckline height, projected from where the neckline breaks.' },
    { q: 'In a flag, the distance projected from the flag breakout is…', o: ['The flag\'s width', 'The length of the pole', 'Half the flag', 'One ATR'], a: 1, why: 'The pole (the sharp move before the flag) is projected from the breakout.' },
    { q: 'A move runs from 100 to 110. The 61.8% retracement level is…', o: ['106.18', '105', '103.82', '101.8'], a: 2, why: '10 x 0.618 = 6.18; 110 - 6.18 = 103.82.' },
    { q: 'Which statement about retracement levels is most accurate?', o: ['Price must stop at 61.8%', 'They are reference zones, stronger when they coincide with real levels', 'Fibonacci levels are more reliable than any other level', 'They only work on daily charts'], a: 1, why: 'They are conventions; with enough lines drawn, price is always near one.' },
    { q: 'Entry 100.6, stop 99.6, target 104.0. Reward-to-risk?', o: ['2.4R', '4.0R', '3.4R', '1.6R'], a: 2, why: '(104.0 - 100.6) / (100.6 - 99.6) = 3.4 / 1.0 = 3.4R.' },
    { q: 'Win rate 40%, average win 2R, average loss 1R. Expectancy?', o: ['+0.2R', '+0.8R', '+1.0R', '-0.2R'], a: 0, why: '0.40 x 2 - 0.60 x 1 = 0.8 - 0.6 = +0.2R.' },
    { q: 'When do partial exits tend to raise expectancy compared with all-or-nothing?', o: ['Always', 'Never', 'When many trades reach the partial level and then stall or reverse', 'When most trades run to the full target'], a: 2, why: 'Partials bank stalled profit; when most trades run all the way, they cut the biggest wins.' },
    { q: 'No expansion by candle four. What does rule 6 say?', o: ['Hold to target', 'Add at +1R', 'Move the stop wider', 'Exit at breakeven'], a: 3, why: 'Rule 6 is a time-based exit: a rule, not a judgment.' },
    { q: 'Why does rule 9 forbid trades in the middle third of a range?', o: ['Funding is higher there', 'Reward-to-risk shrinks and nobody is trapped there', 'ATR is lower there', 'The planner cannot compute size'], a: 1, why: 'The opposite boundary is too close for a multi-R target and there is no trap in the middle.' },
    { q: 'What is the Position Planner\'s default target field?', o: ['Measured move', '61.8% retracement', 'Opposite range boundary', 'Rule of Seven'], a: 2, why: 'The planner uses the opposite range boundary: a support and resistance objective.' },
  ],
  cards: [
    ['Price objective', 'A chart-based estimate of where a move may run out of room. An estimate, not a promise.'],
    ['Range projection', 'Range height added to the breakout point.'],
    ['Head-and-shoulders objective', 'Head-to-neckline height, projected from the neckline break.'],
    ['Flag objective', 'Pole length, projected from the flag breakout.'],
    ['Triangle objective', 'Height of the base (widest part), projected from the breakout.'],
    ['Double top objective', 'Peak-to-valley height, projected below the valley low.'],
    ['Measured move', 'Second leg roughly equals the first, measured from the correction.'],
    ['Rule of Seven', 'A named objective method in Schwager\'s book. See the book for how it works.'],
    ['Retracement conventions', '33/50/67% and 38.2/61.8%. Reference zones, not laws.'],
    ['Trailing stop', 'Follows price toward the trade, never away (rule 7).'],
    ['Time stop', 'Exit if the trade does not work in time. Your rule 6: candle four, breakeven.'],
    ['Expectancy', 'Win% x average win - loss% x average loss, in R.'],
    ['Break-even win rate', '1 / (1 + R:R). At 3.4R, about 22.7%.'],
    ['Partial exits', 'Help when trades stall midway; cost expectancy when trades run to target.'],
    ['Setup targets', 'Spring: range high. Upthrust: range low. Sweep: prior swing. Failed retest: prior range.'],
    ['Rule 8 range gate', 'Range at least 4x the stop leaves room for a multi-R target.'],
  ],
};
