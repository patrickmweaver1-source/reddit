// Study guide: Choosing stop-loss points. An ORIGINAL guide written for this app,
// organized around a topic covered in Jack D. Schwager, "Getting Started in Technical
// Analysis" (Wiley, 1999). Nothing here is quoted from the book. Read the book itself.
// All worked numbers are hypothetical and chosen so the arithmetic can be checked.
import { h, icon } from '../ui.js';
import { candleFig, fromCloses, fig } from './diagrams.js';

const P = (...t) => h('p', ...t);
const B = (t) => h('b', t);
const UL = (...items) => h('ul', items.flat().map(i => h('li', i)));
const callout = (kind, ic, ...t) => h(`div.callout.${kind}`, icon(ic), h('div', ...t));
const tbl = (head, rows) => h('table.tbl', { style: { margin: '12px 0' } }, h('thead', h('tr', head.map(x => h('th', x)))),
  h('tbody', rows.map(r => h('tr', r.map(c => h('td', c))))));
const D = (opts, cap) => fig(candleFig({ height: 190, ...opts }), cap);
const GOOD = '#36d7c7'; const BAD = '#ef4b4b'; const LINE = '#f4c24f';

// ---- diagrams (schematic, not market data) -------------------------------------------------
const arbitrary = () => D({ candles: fromCloses([104, 103, 101.8, 100.6, 99.4, 98.8, 99.9, 100.9, 100.2, 99.6, 100.6, 101.8, 103, 104.2]),
  lines: [{ y: 99.9, label: 'fixed % stop', color: BAD }, { y: 98.2, label: 'chart stop', color: GOOD }],
  marks: [{ i: 6, y: 98.44, label: 'swing low', dir: 'down' }, { i: 7, y: 100.9, label: 'entry' }, { i: 9, y: 99.5, label: 'stopped', dir: 'down', color: BAD }] },
'A stop set a fixed percentage below entry lands wherever the arithmetic puts it, here inside an ordinary pullback. A stop beyond the swing low sits where the long idea is actually wrong.');

const trendStop = () => D({ candles: fromCloses([100, 101.2, 102.5, 101.8, 101.2, 102.6, 104, 105.3, 104.4, 103.8, 105.2, 106.6, 107.8, 107.1, 108.4]),
  segs: [{ i0: 1, y0: 98.46, i1: 14, y1: 105.74, color: LINE, label: 'trend line' }, { i0: 5, y0: 99.5, i1: 14, y1: 104.54, color: GOOD, dash: '4 4', label: 'stop' }],
  marks: [{ i: 5, y: 100.7, label: 'touch', dir: 'down' }, { i: 10, y: 103.5, label: 'touch', dir: 'down' }] },
'Trend-line stop: the stop sits a buffer beyond the line and rises with it. It moves every bar, and a redrawn line moves it too.');

const swingStop = () => D({ candles: fromCloses([106, 104.8, 103.4, 102.2, 101.4, 102.6, 103.9, 105, 104.1, 103.4, 104.6, 106, 107.3]),
  lines: [{ y: 102.85, label: 'swing stop', color: GOOD }],
  marks: [{ i: 5, y: 100.97, label: 'swing low', dir: 'down' }, { i: 10, y: 103.14, label: 'higher low', dir: 'down' }, { i: 11, y: 106, label: 'entry' }] },
'Swing stop: beyond the most recent swing low for a long (swing high for a short). If price takes out the higher low, the higher-low structure the trade relied on is gone.');

const flagStop = () => D({ candles: fromCloses([100, 101.8, 103.9, 106.1, 108, 107.4, 106.9, 107.3, 106.6, 106.1, 106.5, 105.9, 107.8, 109.6, 111.2], { wick: 0.25 }),
  segs: [{ i0: 4, y0: 108.4, i1: 11, y1: 106.8, color: LINE }, { i0: 5, y0: 106.85, i1: 11, y1: 105.6, color: LINE }],
  lines: [{ y: 105.3, label: 'flag stop', color: GOOD }],
  marks: [{ i: 12, y: 107.8, label: 'breakout entry' }] },
'Consolidation stop: after a breakout from a flag, pennant or tight range, the stop goes beyond the far side of the pattern. A move back through the whole pattern means the breakout failed.');

const wrbStop = () => D({ candles: fromCloses([108, 106.8, 105.5, 104.2, 103, 101.9, 104.6, 105.1, 104.7, 105.6, 106.4, 107.2], { special: { 6: { o: 101.9, h: 104.9, l: 99.8, c: 104.6 } } }),
  lines: [{ y: 99.5, label: 'stop', color: GOOD }],
  marks: [{ i: 6, y: 104.9, label: 'wide-ranging bar' }, { i: 6, y: 99.8, label: 'bar low', dir: 'down' }] },
'Wide-ranging bar stop: a very large bar that reverses a move makes its far extreme a reference. Trading back through it cancels the bar\'s message.');

const trapStop = () => D({ candles: fromCloses([101, 102.6, 103.4, 102.1, 101.3, 102.5, 103.6, 102.8, 101.9, 102.7, 103.5, 104.6, 103.2, 102.1, 101, 100.2], { wick: 0.3, special: { 11: { h: 105.3 } } }),
  lines: [{ y: 103.8, label: 'range high' }, { y: 105.55, label: 'stop', color: GOOD }],
  marks: [{ i: 11, y: 105.3, label: 'extreme wick', color: BAD }, { i: 12, y: 103.2, label: 'entry: close inside', dir: 'down' }] },
'Upthrust: the stop sits a few ticks beyond the trap\'s extreme wick (rule 2), not just beyond the range high. Price back above that wick means the trap did not trap anyone.');

const noiseStop = () => D({ candles: fromCloses([100, 100.8, 101.6, 101.1, 101.7, 101.2, 100.9, 101.5, 102.4, 103.2, 104.1, 104.8], { wick: 0.5 }),
  shade: [{ i0: 3, i1: 7, color: 'rgba(239,75,75,.08)' }],
  lines: [{ y: 101.0, label: 'tight stop', color: BAD }, { y: 100.3, label: 'outside noise', color: GOOD }],
  marks: [{ i: 2, y: 101.6, label: 'entry' }, { i: 3, y: 100.88, label: 'hit', dir: 'down', color: BAD }] },
'A stop placed inside the normal bar-to-bar wiggle (shaded) gets hit by noise, even when the idea was right. The stop outside the noise survives the same path.');

const trailStop = () => D({ candles: fromCloses([100, 101.4, 102.7, 102.0, 101.6, 102.9, 104.3, 103.6, 103.2, 104.7, 106.1, 105.4, 105.0, 106.6, 108, 109.1]),
  segs: [{ i0: 1, y0: 99.3, i1: 5, y1: 99.3, color: GOOD }, { i0: 6, y0: 100.9, i1: 9, y1: 100.9, color: GOOD }, { i0: 10, y0: 102.7, i1: 13, y1: 102.7, color: GOOD }, { i0: 14, y0: 104.2, i1: 15, y1: 104.2, color: GOOD, label: 'trail' }],
  marks: [{ i: 5, y: 101.14, label: 'HL', dir: 'down' }, { i: 9, y: 102.96, label: 'HL', dir: 'down' }, { i: 13, y: 104.43, label: 'HL', dir: 'down' }] },
'Structure trail: the stop steps up beneath each new higher low, and only after price has made a new high that confirms that low. It only ever moves toward the trade.');

const huntStop = () => D({ candles: fromCloses([102.4, 101.3, 100.5, 101.5, 102.6, 101.6, 100.5, 101.4, 102.5, 101.7, 100.6, 100.4, 101.6, 102.8, 103.9], { wick: 0.3, special: { 11: { l: 99.1 } } }),
  zones: [{ y0: 99.4, y1: 100.3, color: 'rgba(239,75,75,.10)' }],
  lines: [{ y: 100.3, label: 'obvious low' }, { y: 99.85, label: 'crowd stops', color: BAD }, { y: 98.85, label: 'beyond wick', color: GOOD }],
  marks: [{ i: 2, y: 100.37, label: '1', dir: 'down' }, { i: 6, y: 100.19, label: '2', dir: 'down' }, { i: 10, y: 100.4, label: '3', dir: 'down' }, { i: 11, y: 99.1, label: 'sweep', dir: 'down', color: BAD }] },
'Three touches make the low obvious, so stops pile up just under it (shaded). The sweep runs those stops and closes back inside. A stop at the level is part of the fuel; a stop beyond the extreme wick is not.');

// ---- guide --------------------------------------------------------------------------------
export const STOPS = {
  id: 'stops',
  title: 'Choosing Stop-Loss Points',
  subtitle: 'Where the trade idea is wrong: chart-based stops, volatility buffers, sizing from the stop, and how stops actually fill on a perpetual',
  minutes: 40,
  accent: '#e66767',
  sections: [
    { id: 'purpose', title: 'What a stop is for', body: () => h('div',
      h('h2', 'What a stop is for'),
      P('A stop is not a measure of how much pain you can stand. It is the price at which the reason you entered no longer holds. Every trade is a small hypothesis ("this break failed and the trapped traders will have to get out"), and the stop is the price that would prove that hypothesis false.'),
      P('Thinking of it that way changes the order of decisions. You do not decide how much you are willing to lose and then look for somewhere to put the stop. You find where the idea is wrong on the chart, and only then work out how big a position lets that stop cost exactly the amount you have decided to risk.'),
      callout('warnbox', 'book-open-text', B('Source note. '), 'Written in original words for this app, organized around the stop-placement topics covered in Jack D. Schwager, ', h('i', 'Getting Started in Technical Analysis'), ' (Wiley, 1999). It quotes nothing and is not a summary of the book\'s text. Where an idea below is standard technical-analysis practice, it is presented as such, not as Schwager\'s. Read the book for his full treatment and charts.'),
      h('h3', 'Two questions, answered separately'),
      UL([B('Where is the idea wrong? '), 'A chart question. The answer is a price.'],
        [B('How much can this trade cost? '), 'A money question. Your answer is fixed in advance: rule 1, risk 1% of equity per trade.']),
      P('Position size is what connects the two. Mixing them up (moving the stop to make the size feel right, or the size to make the stop feel comfortable) is the root of most stop mistakes.'),
      callout('truth', 'shield-check', B('The one idea to keep. '), 'Size comes from the stop, never the other way round (rule 1). A stop placed for money reasons is a guess about where noise ends; a stop placed for chart reasons is a statement about where the trade is wrong.')) },

    { id: 'chart', title: 'Chart points, not dollar amounts', body: () => h('div',
      h('h2', 'Chart points, not dollar amounts'), arbitrary(),
      P('A common beginner method is the money or percentage stop: "I will get out if it goes against me by $200" or "by 1%". The problem is that the market does not know your account size. A fixed distance lands at a random place on the chart: sometimes beyond a meaningful level, often in the middle of ordinary back-and-forth, where it gets hit for reasons unrelated to whether the trade was right.'),
      P('Schwager\'s discussion of stops argues for placing them at chart points that are meaningful rather than at arbitrary amounts, and he describes several chart-based ways to find such points. The methods in the next section are the ones chart analysts commonly use; the book\'s exact definitions and preferences may differ from the standard versions given here.'),
      tbl(['', 'Money / percentage stop', 'Chart-point stop'], [
        ['Where it comes from', 'Your account or your comfort', 'The structure the trade depends on'],
        ['What being hit tells you', 'Only that price moved a set distance', 'That the reason for the trade is gone'],
        ['Position size', 'Often fixed, so risk varies with the stop', 'Derived from the stop, so risk stays fixed'],
        ['Typical failure', 'Hit by noise inside a valid trade', 'Too far away to fit the risk budget (so skip the trade)']]),
      callout('key', 'lightbulb', 'The honest answer when the chart stop is too far away is not a closer stop. It is a smaller position, or no trade. Rule 8 already encodes this: the range must be at least 4x the stop, so a stop too wide for the range is a NO TRADE.')) },

    { id: 'methods', title: 'Chart-point stop methods', body: () => h('div',
      h('h2', 'Chart-point stop methods'),
      P('Each method below answers the same question in a different setting: which price, if traded, would mean the pattern you acted on has failed? These are widely used conventions among chart analysts, drawn here on schematic candles.'),
      h('h3', '1. Trend-line stop'), trendStop(),
      P('For a trade taken in the direction of a trend line, the stop goes a buffer beyond the line. Two cautions: trend lines are subjective and frequently redrawn, and a line-based stop moves every bar, so it behaves like a trailing stop whether you intend it or not.'),
      h('h3', '2. Swing (relative high/low) stop'), swingStop(),
      P('The stop goes beyond the most recent swing low (long) or swing high (short). A mechanical cousin is the relative-low stop: beyond the lowest low of the last N bars. The swing version is the most direct expression of trend structure: an uptrend is higher lows, so losing the latest higher low is a structural failure.'),
      h('h3', '3. Consolidation, flag or pennant stop'), flagStop(),
      P('After a breakout from a tight pattern, the stop goes beyond the opposite side of that pattern. The logic is the failed-signal logic from the Chart Patterns guide: price travelling back through the whole consolidation means the breakout did not hold. Some traders use the midpoint of a wide consolidation instead, accepting more stop-outs for a smaller R.'),
      h('h3', '4. Wide-ranging bar stop'), wrbStop(),
      P('A bar with a range far larger than recent bars, closing strongly in one direction, becomes a reference: its far extreme is where its message would be cancelled. The stop goes just beyond that extreme. The weakness is size: by definition the bar is wide, so the stop often is too.'),
      h('h3', '5. Trap or spike wick stop'), trapStop(),
      P('For a failed breakout, the most meaningful price on the chart is the extreme of the failed move: the tip of the wick that recruited traders and then reversed. If price trades beyond that extreme again, the break was not a trap after all; it was a pause. This is the stop your playbook uses (rule 2: a few ticks beyond the trap\'s extreme wick, not beyond the level).'),
      tbl(['Method', 'Stop goes beyond', 'Main weakness'], [
        ['Trend line', 'The line, plus a buffer', 'Subjective; moves every bar'],
        ['Swing / relative extreme', 'The latest swing low or high', 'Obvious to everyone (stop clustering)'],
        ['Consolidation / flag / pennant', 'The far side of the pattern', 'Can be wide for a loose pattern'],
        ['Wide-ranging bar', 'The bar\'s far extreme', 'Usually a wide stop'],
        ['Trap / spike wick', 'The extreme wick of the failed move', 'Needs a buffer for a second probe']])) },

    { id: 'noise', title: 'Volatility and the ATR buffer', body: () => h('div',
      h('h2', 'Volatility: why a stop inside the noise gets hit'), noiseStop(),
      P('Every market wiggles by some typical amount per bar. A stop that sits inside that normal wiggle will be touched often, including on trades whose idea was correct. The standard yardstick is the Average True Range (ATR): the average of each bar\'s true range (high to low, extended to include any gap from the prior close) over a lookback period, commonly 14 bars.'),
      h('h3', 'ATR as a buffer, not as the stop'),
      P('A common convention is to find the chart point first and then add a volatility buffer beyond it, expressed as a fraction of ATR. The chart point says where the idea is wrong; the buffer allows for the fact that price can poke slightly past a level without the idea being wrong. Pure ATR stops (for example "2 ATR from entry") are also common, but they are a volatility stop, not a chart stop: they ignore where the structure is.'),
      UL(['A stop closer to entry than the market\'s normal one-bar range is a coin flip on noise alone.',
        'ATR changes with conditions. The same dollar distance can be generous in a quiet hour and tight in a volatile one.',
        'A buffer that is too large turns into a wider stop, which (at fixed risk) means a smaller position.']),
      callout('key', 'crosshair', B('How your checklist already uses ATR. '), 'C2 measures the break in ATR terms: penetration of at least 0.25 ATR, and abandon if it runs more than 1.0 ATR beyond. The app judges that penetration by the deepest close beyond the level, so the trap\'s extreme wick is at least 0.25 ATR past the level (and can reach further than the closes do), and rule 2 puts the stop a few ticks beyond that wick. The distance from the level to your stop is built from the market\'s own noise.'),
      callout('warnbox', 'triangle-alert', B('Adaptation, not proof. '), 'Chart-point stops were developed and taught mostly on daily bars in exchange-traded futures with a daily close. On 24/7 15-minute perpetuals, wicks are sharper, a second probe of the same extreme is common, and a "few ticks" buffer may or may not be enough. Whether an ATR-based buffer beyond the wick would improve your results is a hypothesis for your journal. If the evidence says change rule 2, change it at the monthly review (rule 11), never mid-session.')) },

    { id: 'sizing', title: 'Tight vs wide: sizing from the stop', body: () => h('div',
      h('h2', 'The tight-versus-wide tradeoff'),
      P('Stop distance does not change how much you lose when you are wrong, if you size correctly. It changes three other things at once:'),
      UL([B('Hit rate. '), 'A tighter stop gets hit more often, including by noise.'],
        [B('R size. '), 'R is the distance from entry to stop. A tighter stop makes 1R smaller, so the same target is worth more R.'],
        [B('Position size. '), 'At fixed risk, a tighter stop means a bigger position, more notional, and higher costs per trade.']),
      P('None of these is free. Traders who shrink stops to make the reward-to-risk ratio look better often find the extra stop-outs cancel the gain. Only a record of real trades tells you which stop placement works for a given setup.'),
      h('h3', 'The two formulas'),
      callout('key', 'calculator', B('Quantity = risk $ / stop distance. '), 'Leverage needed = risk % / stop %. Stop % is the stop distance divided by the entry price. Anything above that leverage is unused risk (rule 4).'),
      h('h3', 'Worked example (hypothetical numbers)'),
      P('Equity $10,000. Rule 1 risk: 1% = $100. A Spring on a BTC perpetual: the range low is 59,700, the break wicks to 59,500.4, and the decisive close back inside (rule 5) is 60,000. Assume a 0.1 tick, so a stop a few ticks beyond the wick is 59,500.0 (rule 2).'),
      tbl(['Step', 'Calculation', 'Result'], [
        ['Stop distance', '60,000 - 59,500', '500'],
        ['Stop %', '500 / 60,000', '0.8333%'],
        ['Quantity', '$100 / 500', '0.2 BTC'],
        ['Notional', '0.2 x 60,000', '$12,000'],
        ['Leverage needed', '1% / 0.8333%  (same as 12,000 / 10,000)', '1.2x'],
        ['Loss if stopped (before fees and slippage)', '0.2 x 500', '$100 = 1R']]),
      P('Now check the gates (rule 8). Say the range high is 62,000 and the 15-minute ATR is 300. Range height is 62,000 - 59,700 = 2,300. That clears 4x the stop (2,000) and 6x ATR (1,800). The wick went 199.6 beyond the level, about 0.67 ATR. C2 judges penetration by the deepest close beyond the level, so the deepest close below 59,700 must be at least 75 (0.25 ATR) beyond it and less than 300 (1.0 ATR) beyond it. The Spring target (range high) is 2,000 above entry: 4R. The cost gate needs the round trip under 10% of risk, so under $10: on $12,000 of notional that is about 0.083%, so check it against your actual fee tier and expected slippage.'),
      h('h3', 'Same trade, three stop distances'),
      tbl(['Stop distance', 'Stop %', 'Quantity', 'Notional', 'Leverage needed', 'Range needed (4x stop)', 'Cost budget as % of notional'], [
        ['250', '0.4167%', '0.4 BTC', '$24,000', '2.4x', '1,000', '0.0417%'],
        ['500', '0.8333%', '0.2 BTC', '$12,000', '1.2x', '2,000', '0.0833%'],
        ['1,000', '1.6667%', '0.1 BTC', '$6,000', '0.6x', '4,000', '0.1667%']]),
      P('Every row risks exactly $100. The tight stop needs less room in the range but doubles the notional, which halves the cost budget as a share of the trade; the wide stop is easy on costs but needs a much bigger range to pass rule 8. The stop sets the terms of the whole trade.'),
      callout('truth', 'scale', 'A position sized from the stop is what lets you take the chart stop wherever it truly is. Without it, you would feel pressure to drag the stop to wherever the money feels comfortable.')) },

    { id: 'managing', title: 'Time stops, trailing and breakeven', body: () => h('div',
      h('h2', 'Time stops'),
      P('Price is not the only way to be wrong. A trade that was supposed to move quickly and does nothing is also telling you something. A time stop exits a position that has not done what it should within a set number of bars, regardless of price.'),
      P('Your playbook has one: rule 6, no expansion by candle four: exit at breakeven. Rule, not judgment. A trap works because trapped traders are forced out; if that pressure has not shown up within four candles, the premise is weakening, and waiting for the price stop only adds a chance of a full 1R loss.'),
      h('h2', 'Trailing stops'), trailStop(),
      P('A trailing stop moves toward the trade as it progresses, locking in more of the move. Common chart versions step the stop behind each new swing low (or high), behind a trend line, or behind a consolidation once price breaks out of it. Mechanical versions trail by a multiple of ATR from the extreme.'),
      UL(['The stop moves in one direction only: toward the trade.',
        'Move it on structure (a confirmed higher low), not on every tick of profit.',
        'Tight trails capture less of big moves; loose trails give back more. There is no free setting.']),
      h('h2', 'Breakeven moves and their cost'),
      P('Moving the stop to entry feels like removing risk. What it actually does is trade outcomes: some would-be losers become scratches, and some would-be winners become scratches too, because a normal retest of the entry area now takes you out. Move to breakeven too early and you can turn a profitable setup into a flat one.'),
      P('Note the difference with rule 6: rule 6 is an exit (you close the trade near entry because it failed to expand), not a stop moved to entry while you wait. Whether an early breakeven stop helps your traps is a question for the journal, not for the moment.'),
      h('h3', 'Stops and add-ons (rule 13)'),
      P('Add-ons only after candle-four expansion, at +1R and +2R, half size each by default, and only after the stop is moved so total risk never exceeds the original 1R. Continuing the worked example (entry 60,000, stop 59,500, 0.2 BTC, 1R = 500 = $100):'),
      tbl(['Rung', 'Position after add', 'Blended entry', 'Stop must be at least', 'Check at that stop'], [
        ['+1R: add 0.1 at 60,500', '0.3 BTC', '(12,000 + 6,050) / 0.3 = 60,166.67', '60,166.67 - 100 / 0.3 = 59,833.33', '0.2 x 166.67 + 0.1 x 666.67 = $100'],
        ['+2R: add 0.1 at 61,000', '0.4 BTC', '(18,050 + 6,100) / 0.4 = 60,375', '60,375 - 100 / 0.4 = 60,125', '0.1 x 375 + 0.1 x 875 - 0.2 x 125 = $100']]),
      P('The general formula: new stop = blended entry - (1R $ / total quantity), rounded toward the trade. Any stop closer to the trade than that is fine; one further away breaks rule 13. The Position Planner shows each rung and the stop move it requires.')) },

    { id: 'never', title: 'Never widen a stop', body: () => h('div',
      h('h2', 'Never move a stop away from entry'),
      P('Rule 7 is short because the logic is short. The stop was placed where the idea is wrong. If price is approaching it, the idea is closer to being proven wrong, which is not new information in favor of the trade. Widening the stop at that moment changes the risk after the size was fixed, so a 1R trade silently becomes a 1.5R or 2R trade.'),
      UL(['Widening converts a planned, affordable loss into an unplanned one.',
        'It is almost always done under pressure, which is exactly when judgment is worst.',
        'It breaks the link that rule 1 depends on: size came from that stop.',
        'Tightening (toward the trade) is allowed; loosening never is.']),
      callout('key', 'lightbulb', 'If you find yourself wanting to widen, the stop was probably wrong before entry. Note it in the journal and fix it in planning next time: a wider stop with a smaller position, decided before the order goes in.'),
      callout('truth', 'shield-alert', 'The coach flags a widened stop against rule 7, and a missing stop on the exchange. Place the stop on Bybit before anything else.')) },

    { id: 'mechanics', title: 'How stops actually fill on a perpetual', body: () => h('div',
      h('h2', 'Stop-order mechanics on a perpetual'),
      P('A stop on the chart is a price. A stop on the exchange is an order that is triggered at a price, and what happens after the trigger depends on the order type and the market at that moment.'),
      h('h3', 'Stop-market vs stop-limit'),
      tbl(['', 'Stop-market', 'Stop-limit'], [
        ['After trigger', 'Sends a market order', 'Sends a limit order at your limit price'],
        ['Fill', 'Near-certain, price not guaranteed', 'Price capped, fill not guaranteed'],
        ['Worst case', 'Slippage beyond the stop in a fast move', 'Price runs through the limit; you stay in the position with no protection']]),
      P('For a protective stop, the usual priority is getting out. A stop-limit that does not fill leaves the loss open-ended, which is the one outcome a stop exists to prevent. Bybit lets you choose market or limit execution for conditional orders; for protection, most traders choose market and accept slippage.'),
      h('h3', 'Slippage and gaps through stops'),
      P('Perpetuals trade 24/7 so true session gaps are rare, but fast moves, thin books and liquidation cascades can jump through several price levels between fills. In the example, a stop-market triggered at 59,500 that fills at 59,420 costs an extra 80 x 0.2 = $16: the loss is $116, or 1.16R, before fees. Your journal records the actual fills, so the gap between planned R and realized R is measurable.'),
      h('h3', 'Mark price vs last price triggers'),
      P('On Bybit, conditional orders and position TP/SL can be triggered by last traded price, mark price or index price. Last price is what your candle chart shows, so a wick you see on the chart is a last-price wick. Mark price is derived from an index of spot prices across venues and is smoother, so a brief spike on Bybit alone may not touch it. Each has a cost:'),
      UL([B('Last price: '), 'triggers exactly where the chart shows it, including on a single sharp wick.'],
        [B('Mark price: '), 'less sensitive to one-venue spikes, but can trigger at a different moment than the chart suggests, and the fill still happens at the traded price.']),
      P('Rule 2 is defined on the chart, so the stop is measured from a last-price wick. Which trigger serves your traps better is an open question for your journal.'),
      h('h3', 'Liquidation price vs stop price'),
      P('Liquidation is the exchange closing your position because margin is exhausted; on Bybit it is based on mark price. It is not a stop. It happens after your planned loss has been exceeded, and it carries its own fees. It must never be the thing that ends a trade.'),
      P('Rule 3: liquidation must sit at least 3 stop widths away. In the example the stop is 500 away, so liquidation must be at least 1,500 away (at or below 58,500). As a rough illustration only, for isolated margin the liquidation distance is about 1 / leverage minus the maintenance margin rate. Assuming a 0.5% maintenance rate:'),
      tbl(['Margin leverage set', 'Rough liquidation distance', 'In stop widths (500)', 'Rule 3'], [
        ['1.2x (what rule 4 says is needed)', 'far below any realistic move', 'many', 'Passes'],
        ['20x', '5% - 0.5% = 4.5% of 60,000 = 2,700', '5.4', 'Passes'],
        ['50x', '2% - 0.5% = 1.5% of 60,000 = 900', '1.8', 'Fails']]),
      P('The actual liquidation price depends on Bybit\'s maintenance margin tiers, fees and your margin mode (cross margin uses your whole account balance), so read it from Bybit or the Position Planner rather than from this table. Rule 4 explains why extra leverage is pointless: the position size is the same either way; higher leverage only pulls liquidation closer, which matters only when your stop has already failed.'),
      callout('warnbox', 'triangle-alert', 'The planned loss is the stop distance times quantity. The realized loss is that plus slippage plus fees. Liquidation is a failure of the whole system, not a larger stop.')) },

    { id: 'hunts', title: 'Stop hunts and obvious levels', body: () => h('div',
      h('h2', 'Stop hunts: where the crowd\'s stops sit'), huntStop(),
      P('Stops cluster at obvious places: just beyond a low with several touches, just beyond a swing high, at round numbers. That concentration is liquidity. A push into it triggers the resting stops (market sells below a low, market buys above a high), and for a moment there is a burst of forced orders that larger traders can trade against. Whether any given sweep was deliberate is unknowable; the mechanics work the same either way.'),
      P('Your whole strategy is built on this: C1 wants a level that is obvious to everyone, with a visible liquidation cluster, precisely because obvious levels collect stops and trapped traders. The same logic applies to your own stop. If you put it at the obvious place, you are part of the fuel.'),
      h('h3', 'Placing your stop'),
      UL(['Not at the level: the level is where everyone else\'s stops are.',
        'Not at the round number: round numbers attract resting orders.',
        'Beyond the extreme wick of the sweep, by a few ticks (rule 2). The wick is where forced orders ran out; trading beyond it again means new selling (or buying) has arrived, which is a genuinely different situation.',
        'If the wick is so far away that the stop fails rule 8 (range at least 4x the stop), the answer is NO TRADE, not a stop inside the wick.']),
      callout('key', 'crosshair', 'A useful self-check: if you can imagine a hundred other traders placing their stop at the same price, move yours beyond the reason they are there.')) },

    { id: 'mapping', title: 'Mapping it to your trading', body: () => h('div',
      h('h2', 'Mapping it to your trading'),
      tbl(['Concept', 'Where it lives in your playbook and app'], [
        ['The stop marks where the idea is wrong', 'Rule 2: a few ticks beyond the trap\'s extreme wick, not beyond the level. Same for Spring, Upthrust, Sweep and Failed retest.'],
        ['Size from the stop', 'Rule 1: risk 1% of equity per trade. The Position Planner takes entry and invalidation and returns the quantity.'],
        ['Leverage', 'Rule 4: leverage = risk% / stop%. The Planner shows the leverage actually needed.'],
        ['Liquidation far beyond the stop', 'Rule 3: at least 3 stop widths away. The Planner shows where liquidation would sit.'],
        ['Time stop', 'Rule 6: no expansion by candle four, exit at breakeven. The Command Center shows the candle-four countdown.'],
        ['Never widen', 'Rule 7. The coach flags a widened stop and a missing stop.'],
        ['Trailing to fund add-ons', 'Rule 13: add at +1R and +2R only after the stop is moved so total risk stays at 1R. The Planner shows each rung and the stop move it requires.'],
        ['Stop too wide for the range', 'Rule 8: range at least 4x the stop, or no trade.']]),
      h('h3', 'What the app does and does not do'),
      UL(['TRAP is read-only on Bybit. You place the entry and the stop on the exchange yourself; the app does not move or trail your stop.',
        'The journal records your fills and stop history, which is how slippage and stop changes become visible.',
        'The Planner does the arithmetic. It does not choose the stop price: that is your chart read of the extreme wick.']),
      h('h3', 'Questions for your journal'),
      UL(['How often does price come back to within a few ticks of the extreme wick before the trade works? If often, the buffer may be too small.',
        'How much does realized loss exceed 1R on stopped trades (slippage)? Does it differ by coin or time of day?',
        'How do trades that hit rule 6 compare with trades that would have been held to the price stop?',
        'Any change to rule 2, 6 or 13 happens at the monthly review (rule 11), with at least thirty calibrated trades behind it.']),
      callout('warnbox', 'triangle-alert', 'Educational material, not investment advice. The worked numbers are hypothetical, chosen to make the arithmetic checkable.')) },
  ],
  quiz: [
    { q: 'What is a stop-loss for?', o: ['Limiting loss to what feels tolerable', 'Marking the price at which the trade idea is wrong', 'Guaranteeing an exit price', 'Avoiding liquidation fees'], a: 1, why: 'The stop is where the reason for the trade no longer holds. Tolerance is handled by position size.' },
    { q: 'Equity $10,000, risk 1%, entry 60,000, stop 59,500. What is the quantity?', o: ['0.1 BTC', '0.5 BTC', '0.2 BTC', '2 BTC'], a: 2, why: '$100 / 500 = 0.2 BTC.' },
    { q: 'In the same trade, what leverage is actually needed?', o: ['1.2x', '10x', '0.83x', '5x'], a: 0, why: 'Risk % / stop % = 1% / 0.8333% = 1.2x (equivalently $12,000 notional / $10,000 equity).' },
    { q: 'Where does rule 2 put the stop on a Spring?', o: ['Just below the range low', 'At the nearest round number', 'A fixed 1% below entry', 'A few ticks beyond the trap\'s extreme wick'], a: 3, why: 'The level is where the crowd\'s stops sit; the extreme wick is where the failed move ended.' },
    { q: 'At fixed risk, halving the stop distance does what to the position?', o: ['Nothing', 'Doubles the quantity and notional', 'Halves the quantity', 'Halves the risk'], a: 1, why: 'Quantity = risk $ / stop distance, so half the distance means twice the quantity. Risk in dollars stays the same.' },
    { q: 'Which is the main danger of a stop-limit order as protection?', o: ['It always slips', 'It cannot be placed on perpetuals', 'Price can run through the limit, leaving you unprotected', 'It triggers on mark price only'], a: 2, why: 'A stop-limit caps the price but does not guarantee a fill.' },
    { q: 'Stop 500 away. Under rule 3, liquidation must be at least how far from entry?', o: ['500', '1,000', '3,000', '1,500'], a: 3, why: 'At least 3 stop widths: 3 x 500 = 1,500.' },
    { q: 'Price is approaching your stop and you feel sure it will turn. Rule 7 says:', o: ['Never move the stop away from entry', 'Widen by one ATR', 'Move it to the round number', 'Cancel it and watch'], a: 0, why: 'Widening changes the risk after size was fixed from the original stop.' },
    { q: 'What is rule 6?', o: ['A trailing stop', 'A time stop: no expansion by candle four, exit at breakeven', 'A liquidation rule', 'A cost gate'], a: 1, why: 'It exits a trap that has not produced the forced move it depends on.' },
    { q: 'After adding 0.1 BTC at 60,500 to 0.2 BTC from 60,000 (1R = $100), the stop must be at least:', o: ['59,500', '60,000', '59,833.33', '60,500'], a: 2, why: 'Blended entry 60,166.67 minus $100 / 0.3 = 59,833.33 keeps total risk at 1R (rule 13).' },
    { q: 'Why is a stop inside normal bar-to-bar noise a problem?', o: ['It is illegal on Bybit', 'It gets hit often even when the idea is right', 'It raises leverage', 'It moves liquidation'], a: 1, why: 'Stops within the typical range (ATR) get hit by ordinary wiggle.' },
    { q: 'The chart stop is so far away that the range is less than 4x the stop. The right response is:', o: ['Tighten the stop to fit', 'Use more leverage', 'No trade (rule 8 fails)', 'Use a mark-price trigger'], a: 2, why: 'A stop too wide for the range fails the gate. Moving it inside the wick would make it meaningless.' },
  ],
  cards: [
    ['Purpose of a stop', 'The price where the trade idea is wrong. Not a pain threshold.'],
    ['Quantity formula', 'Quantity = risk $ / stop distance.'],
    ['Leverage formula (rule 4)', 'Leverage = risk% / stop%. Anything above is unused risk.'],
    ['Rule 2', 'Stop a few ticks beyond the trap\'s extreme wick, not beyond the level.'],
    ['Rule 3', 'Liquidation at least 3 stop widths away.'],
    ['Money stop problem', 'A fixed distance lands at a random chart point, often inside noise.'],
    ['Chart-point stops', 'Trend line, swing high/low, far side of a consolidation or flag, wide-ranging bar extreme, trap wick.'],
    ['ATR buffer', 'A volatility allowance beyond the chart point, so a normal poke does not stop you out.'],
    ['Tight vs wide', 'Tight: more stop-outs, smaller R, bigger size and costs. Wide: fewer stop-outs, needs a bigger range.'],
    ['Time stop (rule 6)', 'No expansion by candle four: exit at breakeven.'],
    ['Rule 7', 'Never move a stop away from entry. Tightening is fine.'],
    ['Breakeven cost', 'Early breakeven stops scratch some winners, not only losers.'],
    ['Stop-market vs stop-limit', 'Market: fill likely, price not. Limit: price capped, fill not guaranteed.'],
    ['Mark vs last trigger', 'Last = the chart\'s wicks. Mark = smoother index-based price; liquidation uses mark.'],
    ['Stop hunts', 'Stops cluster at obvious levels and round numbers. Put yours beyond the extreme wick.'],
    ['Add-on stop (rule 13)', 'New stop = blended entry - 1R $ / total quantity, so total risk stays 1R.'],
  ],
};
