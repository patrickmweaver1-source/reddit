// Study guide: Trade variations. An ORIGINAL guide written for this app about the
// different ways to enter, add to, and manage the same trade idea. Organized partly around
// the midtrend entry and pyramiding topic in Jack D. Schwager, "Getting Started in Technical
// Analysis" (Wiley, 1999); the rest is standard practice. Nothing here is quoted from the book.
import { h, icon } from '../ui.js';
import { candleFig, fromCloses, fig } from './diagrams.js';

const P = (...t) => h('p', ...t);
const B = (t) => h('b', t);
const UL = (...items) => h('ul', items.map(i => h('li', i)));
const callout = (kind, ic, ...t) => h(`div.callout.${kind}`, icon(ic), h('div', ...t));
const tbl = (head, rows) => h('table.tbl', { style: { margin: '12px 0' } }, h('thead', h('tr', head.map(x => h('th', x)))),
  h('tbody', rows.map(r => h('tr', r.map(c => h('td', c))))));
const D = (opts, cap) => fig(candleFig({ height: 190, ...opts }), cap);

// ---- diagrams (schematic, not market data) ------------------------------------------------
// One shared range so the three entry styles can be compared on the same picture.
const RANGE = [100, 100.8, 101.3, 100.6, 99.6, 99.1, 99.8, 100.9, 101.2, 100.4, 99.7, 100.5, 101.1];

const breakoutEntry = () => D({ candles: fromCloses([...RANGE, 102.6, 103.4, 103.1, 104.2, 105]),
  lines: [{ y: 101.6, label: 'range high', color: '#36d7c7' }, { y: 100.1, label: 'stop' }],
  marks: [{ i: 13, y: 103, label: 'breakout close = entry' }] },
'Breakout entry: buy the close beyond the boundary. You are in if the move runs, but the logical stop sits back inside the range, so the stop is wide and you pay up for the fill.');

const pullbackEntry = () => D({ candles: fromCloses([...RANGE, 102.6, 103.4, 102.5, 101.9, 102.6, 103.7, 104.6]),
  lines: [{ y: 101.6, label: 'range high', color: '#36d7c7' }],
  marks: [{ i: 13, y: 103, label: 'breakout' }, { i: 16, y: 101.7, label: 'retest entry', dir: 'down' }] },
'Pullback (retest) entry: wait for price to come back toward the broken level and hold. Better price and a tighter stop, but some of the strongest moves never come back.');

const trapEntry = () => D({ candles: fromCloses([...RANGE, 102.6, 100.7, 99.8, 99.0, 98.4, 97.9]),
  lines: [{ y: 103.1, label: 'trap stop' }, { y: 101.6, label: 'range high', color: '#36d7c7' }],
  marks: [{ i: 13, y: 103, label: 'breakout fails', color: '#ef4b4b' }, { i: 14, y: 100.7, label: 'close back inside = entry', dir: 'down' }] },
'Failed-signal (trap) entry: the same breakout, traded the other way once it closes back inside. The stop goes a few ticks beyond the failed wick. This is your Upthrust; the mirror at the low is your Spring.');

const retrace = () => D({ candles: fromCloses([100, 101.3, 102.8, 104.4, 105.9, 107.3, 108, 107.1, 106, 105, 104.1, 104.6, 105.8, 107.2, 108.6, 110]),
  lines: [{ y: 108.3, label: 'swing high' }, { y: 103.95, label: '50%', color: '#f4c24f' }, { y: 99.6, label: 'swing low' }],
  marks: [{ i: 10, y: 103.9, label: 'retracement zone', dir: 'down' }, { i: 12, y: 106.3, label: 'reaction reverses' }] },
'Midtrend entry, two ways on one picture: a percentage retracement (buy near a set fraction of the prior swing, here 50%) and the reversal of a minor reaction (wait for the pullback to turn back up, then enter).');

const neverComes = () => D({ candles: fromCloses([100, 101.4, 102.9, 102.5, 103.8, 105.1, 104.8, 106.2, 107.5, 107.1, 108.6, 110, 109.7, 111.2, 112.4]),
  lines: [{ y: 101.4, label: '50% zone', color: '#f4c24f' }],
  marks: [{ i: 3, y: 102.3, label: 'shallow dip', dir: 'down' }, { i: 14, y: 112.4, label: 'still waiting', color: '#ef4b4b' }] },
'The pullback that never comes. Every dip is shallow, the planned retracement level is never touched, and the trader who insisted on it watches the whole move from the sidelines.');

const contBreak = () => D({ candles: fromCloses([100, 101.6, 103.3, 105, 106.6, 106.1, 106.5, 105.9, 106.4, 106.0, 106.5, 107.9, 109.2, 110.4]),
  lines: [{ y: 106.95, label: 'pause high' }, { y: 105.6, label: 'pause low' }],
  shade: [{ i0: 5, i1: 10, color: 'rgba(244,194,79,.10)' }],
  marks: [{ i: 11, y: 108.1, label: 'breakout from the pause' }] },
'Breakout from a continuation pattern: after a strong leg, price moves sideways in a tight pause, then closes beyond it in the trend direction. The pause gives a defined stop (the other side of the pause).');

const pyramid = () => D({ candles: fromCloses([101, 100.2, 99.3, 98.6, 100.0, 100.7, 100.4, 101.2, 101.8, 102.5, 102.1, 103.0, 103.7, 104.4, 105.2, 106.1, 107.0, 108.1], { special: { 3: { l: 98.25 }, 4: { l: 98.3 } } }),
  lines: [{ y: 108, label: 'target', color: '#36d7c7' }],
  segs: [{ i0: 4, y0: 98, i1: 9, y1: 98, color: '#ef4b4b', dash: '4 3' }, { i0: 9, y0: 99.4, i1: 13, y1: 99.4, color: '#ef4b4b', dash: '4 3' },
    { i0: 13, y0: 100.6, i1: 17, y1: 100.6, color: '#ef4b4b', dash: '4 3' }],
  marks: [{ i: 4, y: 100, label: 'entry 100' }, { i: 9, y: 102, label: '+1R add', color: '#f4c24f' }, { i: 13, y: 104, label: '+2R add', color: '#f4c24f' }] },
'The worked pyramid below, drawn. Dashed red: the protective stop for the WHOLE position, stepped up before each add (98, then 99.40, then 100.60). Each add is half the base size, and the worst case never exceeds 1R.');

const reentry = () => D({ candles: fromCloses([102.5, 101.6, 100.8, 100.3, 99.4, 100.4, 100.6, 100.2, 100.5, 100.3, 99.8, 99.2, 100.5, 101.4, 102.3, 103.1, 103.8]),
  lines: [{ y: 99.9, label: 'range low', color: '#36d7c7' }],
  shade: [{ i0: 6, i1: 9, color: 'rgba(239,75,75,.08)' }],
  marks: [{ i: 5, y: 100.8, label: 'entry' }, { i: 9, y: 100.3, label: 'candle four: exit BE', dir: 'down', color: '#ef4b4b' }, { i: 12, y: 100.9, label: 're-entry' }] },
'Re-entry after a scratch. The first Spring stalls, so rule 6 takes you out at breakeven on candle four. Later a fresh sweep of the low closes back inside: a new trade with its own checklist, its own stop beyond the new wick, and its own 1R.');

const reversal = () => D({ candles: fromCloses([101.5, 100.9, 100.4, 99.3, 100.4, 100.1, 98.8, 98.2, 97.8, 98.5, 99.3, 99.1, 98.3, 97.5, 96.9], { special: { 11: { h: 100.5 } } }),
  lines: [{ y: 100, label: 'range low', color: '#36d7c7' }, { y: 98.9, label: 'long stop' }],
  marks: [{ i: 4, y: 100.6, label: 'Spring long' }, { i: 6, y: 98.8, label: 'stop hit', dir: 'down', color: '#ef4b4b' }, { i: 11, y: 100.4, label: 'Sweep short?' }] },
'Reversing, the disciplined way. The Spring fails and the stop takes you out. Only later, when price wicks back above the old range low and closes below it, is there a short: a new Sweep that must pass C1 to C4, the gates and the regime filter on its own.');

// ---- guide --------------------------------------------------------------------------------
export const VARIATIONS = {
  id: 'variations',
  title: 'Trade Variations',
  subtitle: 'Many ways to enter, add to, and manage the same trade idea, and how to find out which ones work for you',
  minutes: 40,
  accent: '#3f8fd8',
  sections: [
    { id: 'intro', title: 'One idea, many trades', body: () => h('div',
      h('h2', 'One idea, many trades'),
      P('Two traders can agree completely that a market is going up and still have opposite results. One buys the breakout and gets stopped on the retest; the other waits for the retest, gets a better price and rides the move. A third waits for a deeper pullback that never comes and makes nothing. The idea was the same. The ', B('variation'), ', meaning how the trade was entered, added to and exited, decided the outcome.'),
      P('This guide walks through the main variations: where to enter, how to enter a trend that is already running, which order type to use, whether and how to add to a winner, whether to scale in or out, and what to do after being stopped out. For each one it asks the same questions: what does it do to the fill, the stop distance and the odds of being right, and how does it fit your playbook?'),
      callout('warnbox', 'book-open-text', B('Source note. '), 'Written in original words for this app. Jack D. Schwager\'s ', h('i', 'Getting Started in Technical Analysis'), ' (Wiley, 1999) has a chapter on midtrend entry and pyramiding, and this guide is organized partly around that topic. It quotes nothing from the book, and the specific methods, numbers and examples here are standard technical-analysis practice or this app\'s own rules, not a summary of his text. Read the book for his full treatment.'),
      callout('key', 'crosshair', B('Adaptation. '), 'The classic discussion of entries and pyramiding grew up on daily futures bars with exchange sessions. You trade 15-minute Bybit perpetuals in a market that never closes, with funding, open interest and maker/taker fees. Treat every mapping below as a hypothesis that your journal has to confirm, not as something already proven for your market.')) },

    { id: 'three', title: 'Three ways into the same move', body: () => h('div',
      h('h2', 'Three ways into the same move'),
      P('Take one range and one breakout. There are three basic ways to trade it, and each trades one kind of risk for another.'),
      h('h3', '1. Breakout entry'), breakoutEntry(),
      UL([B('Fill quality: '), 'usually the worst of the three. You buy strength, often with a market order into a fast candle, so slippage and taker fees are highest.'],
        [B('Hit rate: '), 'chart analysts commonly observe that many breakouts from trading ranges fail and fall back inside, so the share of winners tends to be modest.'],
        [B('Stop distance: '), 'wide. The breakout is only disproven back inside the range, so the stop has to go there. Wider stop, smaller size at the same 1%.'],
        [B('Strength: '), 'you never miss a runaway move.']),
      h('h3', '2. Pullback (retracement) entry'), pullbackEntry(),
      UL([B('Fill quality: '), 'better. You buy weakness inside an up move, and a resting limit order can often be used.'],
        [B('Hit rate: '), 'the breakout has already shown it can hold, which filters some failures, but a retest can also turn into the failure itself.'],
        [B('Stop distance: '), 'tighter, just beyond the retest low.'],
        [B('Weakness: '), 'the strongest moves often do not pull back far enough to fill you. Missing the best trades is a real cost, covered in the next section.']),
      h('h3', '3. Failed-signal (trap) entry'), trapEntry(),
      UL([B('Fill quality: '), 'you enter after a violent candle has reversed, so price is moving fast; the close is a known price, but a market order still pays taker fees and some slippage.'],
        [B('Hit rate: '), 'unknown for your market until your journal says so. The idea is that trapped breakout traders must exit, and their exits push price your way.'],
        [B('Stop distance: '), 'usually the tightest of the three, a few ticks beyond the failed wick (rule 2), which is what makes large R multiples possible.'],
        [B('Weakness: '), 'you only trade breakouts that fail. When breakouts run, you have nothing (and the app correctly marks that level DEAD: ran).']),
      tbl(['', 'Breakout', 'Pullback', 'Trap (failed signal)'], [
        [B('Buys'), 'strength', 'weakness in an uptrend', 'the failure of strength'],
        [B('Fill'), 'worst, fast market', 'best, often a limit', 'known close, fast market'],
        [B('Stop'), 'wide (back in range)', 'medium to tight', 'tight (beyond the wick)'],
        [B('Misses'), 'nothing that runs', 'moves that never pull back', 'every breakout that holds'],
        [B('Main risk'), 'false breakouts', 'the retest becomes the failure', 'the failure itself fails']]),
      callout('truth', 'shield-check', 'Your playbook picked the third column. The breakout and pullback styles are not wrong, they are different strategies. Trading them occasionally "because it looked strong" is not a variation of your strategy; it is a second, unjournaled strategy running in the same account.')) },

    { id: 'midtrend', title: 'Midtrend entry', body: () => h('div',
      h('h2', 'Entering a trend that is already running'),
      P('A recurring problem: the trend is obvious, but it started without you. Schwager treats midtrend entry as a subject of its own, together with pyramiding. The three approaches below are standard ways chart analysts handle it; the specific parameters shown are common conventions, not rules from the book.'),
      h('h3', 'Percentage retracement'), retrace(),
      P('Measure the last swing and plan to buy when price gives back a set fraction of it. Round fractions such as a third, a half or about 60% are common choices. It gives the best price if it fills, and it is precise enough to use a limit order.'),
      h('h3', 'Reversal of a minor reaction'),
      P('Instead of guessing how deep the pullback will be, wait for it to end: the reaction makes a low, then price turns back in the trend direction (for example, a close above the prior candle\'s high, or a move back up by a set amount from the reaction low). You give up some price to get evidence that the dip is over.'),
      h('h3', 'Breakout from a continuation pattern'), contBreak(),
      P('Wait for the trend to pause in a flag, pennant, triangle or plain sideways box, and enter when it closes beyond the pause in the trend direction. The pause defines the stop. This is a breakout entry on a small scale, with the same strengths and weaknesses.'),
      h('h3', 'The pullback that never comes'), neverComes(),
      P('The retracement method has a hidden cost that does not show up in a trade log: the trades it never took. In a strong trend, dips can stay shallow for a long time. A trader who only buys at a 50% retracement can be right about the direction for the entire move and still make nothing, and the temptation afterwards is to chase at the worst possible price.'),
      callout('key', 'lightbulb', B('How to weigh it. '), 'A missed winner is a loss of opportunity, not a loss of money, so it is easy to ignore. Your journal can make it visible: log setups you skipped because the entry never filled (rule 12 covers skipped setups too), and compare them with the ones that did.'),
      callout('warnbox', 'info', B('Your version of midtrend entry. '), 'In a clean 4h trend your playbook only traps in the trend direction. A Spring during a 4h uptrend is, in effect, a midtrend entry by the "reversal of a minor reaction" route: the pullback dips through an obvious low, fails to follow through, and closes back inside. You do not need a separate midtrend method; the trap already is one.')) },

    { id: 'orders', title: 'Order types on Bybit perpetuals', body: () => h('div',
      h('h2', 'Limit, market or stop: how the entry is placed'),
      P('The same entry idea can be executed three ways, and on a perpetual the choice changes both the price you get and the fee you pay.'),
      tbl(['Order', 'How it fills', 'Fee side', 'Fits which entry'], [
        [B('Market'), 'Immediately at the best available prices. Certain fill, uncertain price (slippage).', 'Taker', 'Entering on a candle close when you must be in (rule 5).'],
        [B('Limit'), 'Only at your price or better. Certain price, uncertain fill. A resting limit adds liquidity; a post-only option makes sure it never takes.', 'Maker if it rests on the book', 'Retracement entries, and taking profit at a target.'],
        [B('Stop (conditional)'), 'Triggers when price reaches a level, then executes (usually as a market order).', 'Typically taker when it fires', 'Breakout entries, and every protective stop.']]),
      P('On Bybit, as on most venues, the taker fee is typically higher than the maker fee. Exact rates depend on your account tier and change over time, so check them in your account rather than relying on any number from a guide.'),
      h('h3', 'Why it matters for rule 8'),
      P('Rule 8\'s cost gate says the round-trip cost must be under 10% of the risk. Round trip means the entry fee, the exit fee and slippage on both. Two things follow:'),
      UL(['Your protective stop will almost always exit as a taker. The losing trades, which define your risk, pay the higher fee.',
        'The tighter your stop, the larger fees are as a share of it. Tight trap stops are exactly where the cost gate bites, so the order type is not a detail.']),
      callout('key', 'calculator', B('What the app assumes. '), 'The planner and checklist estimate round-trip cost with the taker fee on both sides plus a slippage allowance (using your account\'s live fee rate when Bybit is connected). That is the conservative case: a maker fill on entry or at the target can only make the real cost lower than the estimate, never higher.'),
      h('h3', 'The rule 5 trap in order form'),
      P('A resting buy limit placed at the range low before the candle closes looks like a clever way to save fees. It is not a variation of your entry; it is a different entry. It fills on the wick, before the decisive close exists, which is precisely what rule 5 forbids. If you want a maker fill, the honest version is a limit placed at or near the close price after the close prints. The cost of that choice is that a sharp reclaim can leave without you; the journal can tell you how often that happens.')) },

    { id: 'pyramid', title: 'Pyramiding: adding to winners', body: () => h('div',
      h('h2', 'Pyramiding'),
      P('Pyramiding means adding to a position that is already working, so that the biggest size is in the trades that are proving right. Schwager discusses it alongside midtrend entry. The principles below are the ones commonly taught; your rule 13 is a strict version of them.'),
      UL([B('Add only to winners. '), 'Never add to a losing position. Adding to a loser (averaging down) increases size exactly when the trade is being proven wrong.'],
        [B('Each add no larger than the base. '), 'The base position is the largest unit; each add is the same size or smaller. That keeps the average entry close to the good early price.'],
        [B('Move the stop before you add. '), 'The protective stop for the whole position steps in so that, if everything is stopped out, the total loss is no bigger than the original risk.'],
        [B('Add only on the trend\'s terms. '), 'Adds come at planned points after the trade has moved, not whenever it feels strong.']),
      h('h3', 'The danger of an inverted pyramid'),
      P('An inverted pyramid is the opposite shape: small base, larger adds. It feels natural (the trade is working, so bet more), but it moves the average entry up to near the current price. Then a normal pullback wipes out the whole open gain, or the stop has to be so close that ordinary noise hits it.'),
      tbl(['Same base: 50 units long at 100', 'Normal pyramid (add 25 at 102)', 'Inverted pyramid (add 100 at 102)'], [
        ['Total size', '75 units', '150 units'],
        ['Average entry', '7,550 / 75 = about 100.67', '15,200 / 150 = about 101.33'],
        ['Stop that caps total loss at 100 USD', '100.67 - 100/75 = about 99.33', '101.33 - 100/150 = about 100.67'],
        ['Room from the add price (102) to the stop', 'about 2.67 (more than the original 2.00)', 'about 1.33 (two thirds of the original 2.00)']]),
      P('With the same 1R cap, the inverted pyramid has half the breathing room. That is the arithmetic behind the rule "adds are no larger than the base".'),
      h('h3', 'Worked example: rule 13 by the numbers'), pyramid(),
      P('Equity 10,000 USD, so 1R = 1% = 100 USD (rule 1). Spring long, entry 100.00 on the decisive close, stop 98.00 beyond the trap wick. Stop distance 2.00, so size = 100 / 2.00 = 50 units. 1R in price is 2.00, so +1R = 102.00 and +2R = 104.00. Fees are left out to keep the numbers clean.'),
      tbl(['Step', 'Position', 'Stop (whole position)', 'Loss if stopped', 'Total risk'], [
        ['Initial entry at 100.00', '50 units', '98.00', '50 x 2.00 = 100', '1.00R'],
        ['Candle four shows expansion; price reaches 102.00 (+1R). First move the stop, then add 25 (half size).', '75 units, average about 100.67', '99.40', '50 x 0.60 + 25 x 2.60 = 30 + 65 = 95', '0.95R'],
        ['Price reaches 104.00 (+2R). Move the stop, then add 25 (half size).', '100 units, average 101.50', '100.60', '100 x (101.50 - 100.60) = 90 (base now +30, adds -35 and -85)', '0.90R'],
        ['Target 108.00 (range high) hit', '100 units', 'n/a', 'Profit: 50 x 8 + 25 x 6 + 25 x 4 = 400 + 150 + 100 = 650', '+6.5R (vs +4R unpyramided)']]),
      callout('truth', 'shield-check', B('What the example shows. '), 'At no point is more than 1R at risk, yet a full move pays 6.5R instead of 4R. The price of that is that the adds narrow the room: after the second add, a pullback of 3.40 from 104 to 100.60 (1.7 times the original stop distance) ends the whole trade at a 0.9R loss even though it was once 2R in profit. Pyramiding helps most in trades that trend cleanly and costs you in trades that run and then fully retrace.'),
      callout('warnbox', 'info', 'The Position Planner does this calculation for you and includes estimated fees, so its stop moves sit slightly tighter than these round numbers. If fees or stop room would push total risk above 1R, it marks that rung as not viable: skip it. Rule 7 still applies: a stop is only ever moved toward the market, never away from entry.')) },

    { id: 'scaling', title: 'Scaling in and scaling out', body: () => h('div',
      h('h2', 'Scaling in vs all at once'),
      P('Scaling in means splitting the initial position into pieces (for example, half on the signal and half on a retest) instead of taking it all at once. It is different from pyramiding: the pieces are part of the first position, not adds to a proven winner.'),
      tbl(['', 'All at once', 'Scaled in'], [
        [B('Average price'), 'the signal price', 'can be better if the second piece fills lower'],
        [B('Full size in the winners'), 'always', 'not if the trade leaves before the second piece fills'],
        [B('Risk if stopped'), 'exactly 1R', 'at most 1R if sized correctly, less if only part filled'],
        [B('Main danger'), 'none beyond the trade itself', 'the second piece turns into averaging down']]),
      P('The sizing rule does not change: rule 1 applies to the completed position. If you split the entry, the pieces together, at their planned prices and one common stop, must add up to 1R.'),
      callout('warnbox', 'triangle-alert', B('In your playbook. '), 'Your rules take the full position on the decisive close (rule 5) and allow extra size only as add-ons after candle-four expansion (rule 13). The journal treats every same-direction fill after the first as an add-on leg, and a leg at or worse than the entry price is flagged as a rule 13 finding (added to a losing position); one before +1R is flagged as an early add. Scaling in is therefore a rule change, not a technique, and rule changes happen at the monthly review (rule 11).'),
      h('h2', 'Scaling out vs a single exit'),
      P('Scaling out means taking partial profits on the way (for example, half at +2R and the rest at the target) instead of exiting everything at one price.'),
      tbl(['50 units, entry 100, stop 98 (1R = 100 USD)', 'Single exit at 108', 'Half at 104 (+2R), half at 108'], [
        ['Target is reached', '50 x 8 = 400 (+4R)', '25 x 4 + 25 x 8 = 100 + 200 = 300 (+3R)'],
        ['Price reaches 104, then falls back and the rest is stopped at the entry (stop already moved to 100)', '0 (scratch)', '25 x 4 + 0 = 100 (+1R)']]),
      P('Neither is free. Scaling out gives up part of the big winners to bank something on the ones that fade. Which is better depends entirely on how often your trades reach the target after touching +2R, a number only your own journal can supply. There is no general answer, and this guide will not invent one.'),
      callout('key', 'target', 'Your default playbook exits at the setup target (for a Spring, the range high; the planner\'s target field is the opposite range boundary). A partial-exit plan would be a playbook change: test it on your logged trades first, then decide at the monthly review.')) },

    { id: 'reentry', title: 'Re-entry vs revenge trading', body: () => h('div',
      h('h2', 'Re-entry after being stopped out'),
      P('Being stopped out, or scratched at breakeven, does not by itself mean the idea was wrong. Sometimes the level is still valid and the market simply took a second attempt. Chart analysts commonly allow a re-entry when the original reason for the trade is still intact and a fresh signal appears.'),
      reentry(),
      h('h3', 'What makes it a legitimate re-entry'),
      UL(['A new, complete signal: in your terms, a fresh break, no follow-through inside the window, and a new decisive close back inside with OI falling (C2 to C4 again).',
        'A new stop beyond the new extreme wick, a new size from that stop, and a fresh 1R (rules 1 and 2).',
        'It passes the checklist and both gates on its own. The first attempt earns it nothing.']),
      h('h3', 'What makes it revenge'),
      UL(['Re-entering because of the loss, not because of a new signal.',
        'Re-entering bigger "to make it back".',
        'Re-entering at a worse price with no new close, or on the wick (rule 5).',
        'Skipping the checklist because "it is the same trade".']),
      callout('truth', 'brain', B('The test. '), 'Would you take this trade if you had not just been stopped out? If the checklist says GO and the answer is yes, it is a re-entry. If you need the previous loss to justify it, it is revenge.'),
      callout('warnbox', 'info', 'The app has no daily loss limit, so nothing will stop a revenge sequence for you. Your defenses are the checklist (every trade must pass it), the size coming from the stop (so a revenge trade cannot be bigger without breaking rule 1), and logging each attempt as its own row within 10 minutes (rule 12) so the pattern shows up in your data.')) },

    { id: 'reverse', title: 'Reversing when a signal fails', body: () => h('div',
      h('h2', 'Reversing a position'),
      P('In the Chart Patterns & Failed Signals guide, "The most important rule" section explains the core idea: when a chart signal fails, get out, and consider the opposite direction. Your whole strategy is the second half of that sentence applied to other traders\' signals. It is natural to ask: what about when your own trap fails?'),
      reversal(),
      P('The first half of the rule is automatic: your stop is beyond the trap\'s extreme wick, so if the trap fails you are out at 1R. The second half, "consider the opposite direction", needs care. A stopped trap is not itself a trap setup. The fact that your long failed does not mean the short is good, and flipping on the spot means entering on a stop-out fill with no level, no recruitment test and no decisive close.'),
      callout('key', 'refresh-cw', B('In your app, a reversal is simply a new trap trade. '), 'It must be a real setup in its own right (here, a Sweep of the old range low from below), pass C1 to C4, both gates, rule 9 (not the middle third), and the regime filter. In a clean 4h uptrend the playbook only traps long, so the short in the picture would not be taken at all. The journal also treats a fill that flips the position as closing one trade and opening a new one, so the two trades are graded separately, as they should be.')) },

    { id: 'compare', title: 'The variations side by side', body: () => h('div',
      h('h2', 'Comparison of variations'),
      P('Every variation changes something. The table lists what it improves, what it costs, and where it stands in your current playbook.'),
      tbl(['Variation', 'Improves', 'Costs', 'Your playbook today'], [
        [B('Breakout entry'), 'never misses a runaway move', 'wide stop, poor fill, many false breakouts', 'Not used. A break that runs is DEAD: ran.'],
        [B('Pullback / retracement entry'), 'price and stop distance', 'misses moves that never pull back', 'Not a separate method; a trend-direction trap does this job.'],
        [B('Trap (failed-signal) entry'), 'tight stop, large R potential', 'only trades breakouts that fail', 'The strategy: Spring, Upthrust, Sweep, Failed retest.'],
        [B('Market order at the close'), 'certain fill, rule 5 compliant', 'taker fee and slippage', 'Default assumption in the cost gate.'],
        [B('Limit order after the close'), 'maker fee, better price', 'may miss fast reclaims', 'Allowed; a resting limit before the close is not (rule 5).'],
        [B('Pyramiding'), 'more size in the best trades', 'narrower room; hurts on full retracements', 'Rule 13: +1R and +2R, half size, stop moved first, total risk at most 1R.'],
        [B('Scaling in'), 'possibly better average price', 'partial fills, averaging-down risk', 'Not in the rules; would be flagged as rule 13 findings.'],
        [B('Scaling out'), 'banks profit on trades that fade', 'smaller big winners', 'Not in the rules; test before adopting (rule 11).'],
        [B('Re-entry'), 'second chance on a valid idea', 'extra fees, revenge risk', 'Allowed as a new trade that passes the checklist.'],
        [B('Reversal'), 'uses the failed-signal logic', 'easy to do impulsively', 'Only as a new trap trade that passes the checklist.']]),
      callout('truth', 'scale', 'No row here has a proven edge for your market. The only way to know which variations help you is to trade them consistently, log them, and compare.')) },

    { id: 'mapping', title: 'Mapping it to your trading', body: () => h('div',
      h('h2', 'Mapping it to your trading'),
      tbl(['Rule', 'What it says about variations'], [
        [B('1'), 'Risk 1% of equity per trade, size from the stop. This holds for every variation: a scaled entry, a re-entry and a full pyramid all cap at 1R.'],
        [B('5'), 'Entry is the decisive close back inside, never the wick. This rules out resting limit orders at the level and any entry before the close exists.'],
        [B('6'), 'No expansion by candle four: exit at breakeven. It decides when a trade can become a pyramid (only after expansion) and it is what creates most re-entry situations.'],
        [B('7'), 'Never move a stop away from entry. Stop moves for add-ons only ever tighten.'],
        [B('8'), 'The cost gate (round trip under 10% of risk) is where order type matters: stops exit as takers, and tight stops make fees a large share of risk.'],
        [B('12'), 'Log within 10 minutes, win or lose, taken or skipped. Every variation, including skipped setups whose entry never filled, gets a row.'],
        [B('13'), 'Add-ons only after candle-four expansion, at +1R and +2R, half size each by default, and only after the stop is moved so total risk never exceeds the original 1R.']]),
      h('h3', 'Let the journal decide'),
      P('The journal already records the fills for you: entry, add-on legs, exits, fees and the stop history. What it cannot know is which variation you intended. Use the note field consistently, with a short fixed tag such as "re-entry", "limit after close", "ladder skipped" or "reversal", so that after enough trades you can filter and compare.'),
      UL(['Compare trades where you ran the full ladder with those where you did not.',
        'Compare re-entries with first attempts at the same kind of level.',
        'Compare limit-after-close fills with market fills, including the reclaims you missed.',
        'Bring the comparison to the monthly review. Any change to entries, adds or exits happens there, never during a session (rule 11).']),
      callout('key', 'notebook-pen', B('The point of all this. '), 'A variation is only worth adopting if your own logged trades show it improves results after costs. Until then, the default playbook is the variation you trade.')) },
  ],
  quiz: [
    { q: 'Compared with a trap entry, a breakout entry on the same range usually has…', o: ['A wider stop, because the breakout is only disproven back inside the range', 'A tighter stop', 'No stop', 'The same stop'], a: 0, why: 'The breakout\'s invalidation is back inside the range; the trap\'s is just beyond the failed wick.' },
    { q: 'What is the main hidden cost of only buying at a deep retracement?', o: ['Higher fees', 'Wider stops', 'Rule 9 violations', 'Missing strong moves that never pull back that far'], a: 3, why: 'Missed winners do not appear as losses, but they are a real cost.' },
    { q: 'Which order type typically pays the maker fee on Bybit?', o: ['A market order', 'A stop that triggers', 'A limit order that rests on the book', 'Any order at the close'], a: 2, why: 'Resting limit orders add liquidity; market orders and triggered stops take it.' },
    { q: 'You place a resting buy limit at the range low before the candle closes. What is wrong?', o: ['Nothing, it saves fees', 'It fills on the wick, before the decisive close: a rule 5 violation', 'It breaks rule 3', 'It breaks rule 9'], a: 1, why: 'Rule 5: entry is the decisive close back inside, never the wick.' },
    { q: 'Why does the order type matter most for tight trap stops?', o: ['It does not', 'Tight stops cannot use market orders', 'Fees are a larger share of a small stop, so the rule 8 cost gate is easier to fail', 'Maker fees are higher'], a: 2, why: 'Round-trip cost is compared with the risk; the smaller the stop, the bigger the share.' },
    { q: 'An inverted pyramid is dangerous mainly because…', o: ['It pays more fees', 'Larger adds pull the average entry up near the current price, leaving little room at the same total risk', 'It needs more leverage', 'It breaks rule 9'], a: 1, why: 'At the same 1R cap, bigger adds shrink the distance from price to the stop.' },
    { q: 'In the worked example (50 units at 100, stop 98), after adding 25 at 102 the stop moves to 99.40. What is the total risk?', o: ['1.00R', '1.30R', '0.50R', '0.95R (30 + 65 = 95 USD)'], a: 3, why: 'Base loses 50 x 0.60 = 30, the add loses 25 x 2.60 = 65: 95 USD, under the 100 USD cap.' },
    { q: 'Under rule 13, when may you add to a position?', o: ['After candle-four expansion, at +1R and +2R, after moving the stop so total risk stays at or under 1R', 'Whenever the trade is red, to improve the average', 'Immediately after entry', 'Only at the target'], a: 0, why: 'Add-ons are for winners only, at set points, with the stop moved first.' },
    { q: 'You split your initial entry and the second half fills below your first price. How does the journal see it?', o: ['As a clean scaled entry', 'As an add-on leg added to a losing position, a rule 13 finding', 'As a separate trade', 'It ignores it'], a: 1, why: 'Same-direction fills after the first are add-on legs; one at a worse price is flagged as averaging down.' },
    { q: 'What separates a legitimate re-entry from revenge trading?', o: ['The time since the loss', 'Using a bigger size', 'A new complete signal that passes the checklist with its own stop and 1R', 'Using a market order'], a: 2, why: 'Ask whether you would take it had you not just been stopped out.' },
    { q: 'Your Spring long is stopped out. In your app, a short is allowed…', o: ['Immediately, at the stop fill', 'Only as a new trap setup that passes C1 to C4, the gates, rule 9 and the regime filter', 'Never under any circumstances', 'Only with double size'], a: 1, why: 'A reversal is simply a new trap trade; a stopped trap is not itself a setup.' },
    { q: 'Where should a switch to partial profit-taking be decided?', o: ['Mid-session after a big winner', 'At the monthly review, with journal data (rule 11)', 'After three losses in a row', 'Never'], a: 1, why: 'Rule changes happen at the monthly review, never during a session.' },
  ],
  cards: [
    ['Breakout entry', 'Buy the close beyond the boundary. Never misses a runner; wide stop, worst fill.'],
    ['Pullback entry', 'Buy the retest or retracement. Better price and stop; misses moves that never come back.'],
    ['Trap entry', 'Trade the failure of a breakout on the close back inside. Tight stop beyond the wick.'],
    ['Midtrend entry methods', 'Percentage retracement, reversal of a minor reaction, breakout from a continuation pattern.'],
    ['The pullback that never comes', 'A real cost: being right on direction and making nothing. Log skipped setups to see it.'],
    ['Maker vs taker', 'Resting limit = maker (typically cheaper). Market and triggered stops = taker.'],
    ['Rule 5 and limit orders', 'A resting limit at the level fills on the wick. Only a limit after the close is compliant.'],
    ['Cost gate assumption', 'The app estimates round-trip cost with taker fees on both sides plus slippage.'],
    ['Pyramiding principles', 'Add only to winners, adds no larger than the base, stop moved first, total risk capped.'],
    ['Inverted pyramid', 'Small base, bigger adds: average entry creeps up, room to the stop collapses.'],
    ['Rule 13 ladder', 'After candle-four expansion: +1R and +2R, half size each, stop moved so total risk never exceeds 1R.'],
    ['Worked pyramid', '50 @ 100 (stop 98), +25 @ 102 (stop 99.40, 0.95R), +25 @ 104 (stop 100.60, 0.90R); target 108 pays 6.5R.'],
    ['Scaling out trade-off', 'Banks profit on trades that fade, shrinks the big winners. Only your journal can say which wins.'],
    ['Re-entry test', 'Would you take it if you had not just been stopped out? New signal, new stop, new 1R.'],
    ['Reversal in your app', 'Simply a new trap trade that must pass the checklist, gates and regime filter.'],
    ['Journal the variation', 'Use a fixed tag in the note field so the stats can compare variations.'],
  ],
};
