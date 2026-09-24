// Position planner: initial entry sized from the stop, plus the two add-ons.
import { api } from '../api.js';
import { h, icon, fmt, svg, clear, segmented, numInput, field, toast, put } from '../ui.js';
import { sizeSummary } from './checklist.js';

let P = null; let root = null; let ctxRef = null;

export async function render(el, ctx) {
  root = el; ctxRef = ctx;
  if (!P) P = { symbol: ctx.state.settings.watchlist[0], direction: 'Long', entry: null, stop: null, target: null, leverage: null, equity: null, res: null, snap: null };
  await loadSnap();
  draw();
}
async function loadSnap() {
  try { P.snap = await api.get(`/api/market/${P.symbol}`); } catch { P.snap = null; }
  if (P.snap && P.entry === null) P.entry = +P.snap.price.toPrecision(6);
}
async function calc() {
  if (!P.entry || !P.stop) { P.res = null; return; }
  try { P.res = (await api.post('/api/size', { symbol: P.symbol, direction: P.direction, entry: P.entry, stop: P.stop, target: P.target, leverage: P.leverage, equity: P.equity })).data; }
  catch (e) { P.res = { ok: false, errors: [e.message] }; }
}

function draw() {
  clear(root);
  const set = (k) => async (e) => { P[k] = e.target.value === '' ? null : +e.target.value; await calc(); draw(); };
  const sn = P.snap;
  put(root, 
    h('div.page-head', h('div', h('div.eyebrow', 'Position planner'), h('h1', 'Size comes from the stop'),
      h('div.sub', 'Invalidation, then stop distance, then size, then the cost check, then target and deadline. Never the other way round. If you start from a size, this page will not help you.'))),
    h('div.grid', { style: { gridTemplateColumns: 'minmax(300px, 380px) 1fr' } },
      h('div.card', h('div.card-h', h('h3', icon('sliders-horizontal'), 'Inputs')),
        h('div.col', { style: { gap: '12px' } },
          field('Symbol', segmented(ctxRef.state.settings.watchlist, P.symbol, async (v) => { P.symbol = v; P.entry = null; P.stop = null; P.target = null; await loadSnap(); await calc(); draw(); })),
          field('Direction', segmented(['Long', 'Short'], P.direction, async (v) => { P.direction = v; await calc(); draw(); })),
          field('Entry (the reclaim close)', numInput(P.entry, { onchange: set('entry') }), sn ? `Last price ${fmt.px(sn.price)}` : null),
          field('Invalidation / stop', numInput(P.stop, { onchange: set('stop') }), 'A few ticks beyond the trap\'s extreme wick, not beyond the level.'),
          field('Target (opposite range boundary)', numInput(P.target, { onchange: set('target') }), sn?.range?.high ? `Range ${fmt.px(sn.range.low)} to ${fmt.px(sn.range.high)}` : null),
          field('Leverage you plan to set (optional)', numInput(P.leverage, { onchange: set('leverage') }), 'Leave blank to see the minimum. Leverage never changes R; it moves liquidation.'),
          field('Equity override (optional)', numInput(P.equity, { onchange: set('equity') }), 'Defaults to your Bybit wallet equity, or starting equity plus journal P&L.'),
          sn ? h('div.kv', { style: { marginTop: '6px' } }, h('dt', 'Tick size'), h('dd', sn.tick ?? '—'), h('dt', 'Qty step'), h('dd', sn.qty_step ?? '—'), h('dt', 'Min qty'), h('dd', sn.min_qty ?? '—'), h('dt', 'ATR(14) 15m'), h('dd', fmt.px(sn.atr15))) : null)),
      h('div.col', { style: { gap: '16px' } },
        h('div.card', h('div.card-h', h('h3', icon('calculator'), 'Result'), P.res?.ok ? h('span.sub', `Equity ${fmt.usd(P.res.equity)} (${P.res.equity_source})`) : null,
          h('div.right', P.res?.ok ? h('button.btn.sm', { onclick: () => { navigator.clipboard?.writeText(`${P.symbol} ${P.direction} qty ${P.res.qty} entry ${P.entry} stop ${P.stop}`); toast('Copied', 'Plan copied to the clipboard.', 'good'); } }, icon('download', 'sm'), 'Copy plan') : null)),
          P.res ? sizeSummary(P.res) : h('div.empty', icon('calculator'), h('div', 'Enter entry and stop to size the trade.'))),
        P.res?.ok ? h('div.card', h('div.card-h', h('h3', icon('chart-column'), 'The ladder'), h('span.sub', 'Stop moves up before each add. Total risk never exceeds 1R.')), ladderSvg(P.res)) : null)));
}

function ladderSvg(r) {
  const long = r.direction === 'Long';
  const pts = [r.ladder[0] ? r.ladder[0].stop_moved_from : null, P.entry, ...r.ladder.map(l => l.trigger), ...r.ladder.map(l => l.move_stop_to), P.target].filter(v => v !== null && v !== undefined);
  const lo = Math.min(...pts); const hi = Math.max(...pts); const pad = (hi - lo) * 0.08 || 1;
  const W = 820; const H = 360; const Y = (v) => 20 + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 40);
  const cols = [120, 330, 540, 750];
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' });
  const hline = (y, color, dash) => svg('line', { x1: 60, x2: W - 10, y1: y, y2: y, stroke: color, 'stroke-width': 1, 'stroke-dasharray': dash || '' });
  if (P.target) { put(s, hline(Y(P.target), 'var(--s3)', '5 4'), svg('text', { x: 60, y: Y(P.target) - 6, fill: 'var(--s3)', 'font-size': 12 }, `target ${fmt.px(P.target)}`)); }
  put(s, hline(Y(P.entry), 'var(--ink-3)', '2 3'), svg('text', { x: 60, y: Y(P.entry) - 6, fill: 'var(--ink-2)', 'font-size': 12 }, `entry ${fmt.px(P.entry)}`));
  const legs = [{ name: 'Initial', trigger: P.entry, stop: r.ladder[0]?.stop_moved_from ?? P.stop, qty: r.qty, worst: -1 },
    ...r.ladder.map(l => ({ name: l.name, trigger: l.trigger, stop: l.move_stop_to, qty: l.total_qty, worst: l.worst_case_r, viable: l.viable }))];
  legs.forEach((l, i) => {
    const x = cols[i];
    put(s, svg('text', { x, y: 16, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-size': 13, 'font-weight': 700 }, l.name));
    put(s, svg('rect', { x: x - 34, y: Math.min(Y(l.trigger), Y(l.stop)), width: 68, height: Math.abs(Y(l.trigger) - Y(l.stop)), rx: 6, fill: 'rgba(239,75,75,.12)', stroke: 'rgba(239,75,75,.4)' }));
    put(s, svg('line', { x1: x - 44, x2: x + 44, y1: Y(l.trigger), y2: Y(l.trigger), stroke: 'var(--accent)', 'stroke-width': 3, 'stroke-linecap': 'round' }));
    put(s, svg('line', { x1: x - 44, x2: x + 44, y1: Y(l.stop), y2: Y(l.stop), stroke: 'var(--crit)', 'stroke-width': 3, 'stroke-linecap': 'round' }));
    put(s, svg('text', { x: x + 50, y: Y(l.trigger) + 4, fill: 'var(--accent)', 'font-size': 11, 'font-family': 'var(--mono)' }, fmt.px(l.trigger)));
    put(s, svg('text', { x: x + 50, y: Y(l.stop) + 4, fill: '#ff8a8a', 'font-size': 11, 'font-family': 'var(--mono)' }, fmt.px(l.stop)));
    put(s, svg('text', { x, y: H - 6, 'text-anchor': 'middle', fill: 'var(--ink-3)', 'font-size': 11, 'font-family': 'var(--mono)' }, `qty ${fmt.qty(l.qty)} · worst ${fmt.r(l.worst)}`));
    if (i > 0) {
      const px = cols[i - 1];
      put(s, svg('path', { d: `M${px + 44},${Y(legs[i - 1].stop)} C${(px + x) / 2},${Y(legs[i - 1].stop)} ${(px + x) / 2},${Y(l.stop)} ${x - 44},${Y(l.stop)}`, fill: 'none', stroke: 'rgba(239,75,75,.55)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
    }
  });
  return h('div.ladder', s, h('div.legend', { style: { marginTop: '8px' } }, h('span', h('i', { style: { background: 'var(--accent)' } }), 'Entry / add price'), h('span', h('i', { style: { background: 'var(--crit)' } }), 'Protective stop for the whole position'), h('span', h('i', { style: { background: 'var(--s3)' } }), 'Target')),
    h('div.help', { style: { marginTop: '6px' } }, long ? 'Long: each add sits above the last, and the stop only ever moves up.' : 'Short: each add sits below the last, and the stop only ever moves down.'));
}
