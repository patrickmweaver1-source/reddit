// Dashboard: the workbook's KPIs and Diagnostics, made interactive, plus process-over-outcome views.
import { api } from '../api.js';
import { h, icon, fmt, clear, tween, segmented, put } from '../ui.js';
import { lineChart, barChart, diagBars } from '../charts.js';

let root = null; let ctxRef = null; let D = null; let curveMode = 'equity';

export async function render(el, ctx) {
  root = el; ctxRef = ctx;
  D = await api.get('/api/stats');
  draw();
}
export function onEvent(msg) { if (msg.kind === 'trade' && root) api.get('/api/stats').then(d => { D = d; draw(); }); }

function draw() {
  clear(root);
  const k = D.kpis; const n = k.trades_taken;
  put(root, 
    h('div.page-head', h('div', h('div.eyebrow', 'Dashboard'), h('h1', 'Grade the process'),
      h('div.sub', 'Every threshold in the checklist is a guess until the Diagnostics say otherwise. Read them after 30 trades, not before.')),
      h('div.actions', n < 30 ? h('span.chip', { style: { color: 'var(--warn)' } }, icon('info', 'sm'), `${30 - n} trade${30 - n === 1 ? '' : 's'} until diagnostics mean anything`) : h('span.chip.long', icon('check', 'sm'), 'Enough trades to calibrate'))),
    h('div.grid.g5',
      kpi('Expectancy', k.expectancy_r, (v) => fmt.r(v), 'average R per taken trade', k.expectancy_r >= 0 ? 'good' : 'bad'),
      kpi('Net P&L', k.net_pnl, (v) => fmt.usd(v, 0), `fees ${fmt.usd(k.fees, 0)} · funding ${fmt.usd(k.funding, 0)}`, k.net_pnl >= 0 ? 'good' : 'bad'),
      kpi('Win rate', k.win_rate * 100, (v) => `${v.toFixed(1)}%`, `avg win ${fmt.r(k.avg_win_r)} · avg loss ${fmt.r(k.avg_loss_r)}`),
      kpi('Profit factor', k.profit_factor ?? NaN, (v) => Number.isFinite(v) ? v.toFixed(2) : '—', 'gross wins / gross losses'),
      kpi('Rule adherence', k.rule_adherence * 100, (v) => `${v.toFixed(0)}%`, 'taken trades with the plan followed', k.rule_adherence >= 0.8 ? 'good' : k.rule_adherence >= 0.6 ? '' : 'bad'),
      kpi('Trades taken', n, (v) => v.toFixed(0), `median ${fmt.r(k.median_r)} · best ${fmt.r(k.best_r)}`),
      kpi('Skipped', k.skipped, (v) => v.toFixed(0), 'passes logged'),
      kpi('Avg leverage', k.avg_leverage, (v) => `${v.toFixed(1)}x`, 'leverage never changes R'),
      kpi('Liq buffer < 3x', k.liq_buffer_lt3, (v) => v.toFixed(0), 'trades with liquidation too close', k.liq_buffer_lt3 ? 'bad' : 'good'),
      kpi('To 30 trades', k.to_30, (v) => v.toFixed(0), 'until calibration', k.to_30 ? '' : 'good')),
    h('div.grid', { style: { gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', marginTop: '16px' } },
      h('div.card', h('div.card-h', h('h3', icon('chart-line'), curveMode === 'equity' ? 'Equity curve' : 'Cumulative R'), h('div.right', segmented([['equity', 'Equity $'], ['r', 'Cumulative R']], curveMode, (v) => { curveMode = v; draw(); }))),
        curveMode === 'equity'
          ? lineChart([{ name: 'Equity', color: 'var(--s1)', area: true, points: D.equity.map(p => ({ x: p.i, y: p.equity, t: p.t, sym: p.symbol, r: p.r })) }], { height: 260, yFmt: (v) => fmt.usd(v, 0), xFmt: (v) => `#${v}`, tipFmt: (p) => p.x ? `Trade #${p.x} ${p.sym || ''} ${p.r !== undefined && p.r !== null ? fmt.r(p.r) : ''}` : 'Start' })
          : lineChart([{ name: 'Cumulative R', color: 'var(--s7)', area: true, points: D.equity.map(p => ({ x: p.i, y: p.cum_r })) }], { height: 260, yFmt: (v) => `${v.toFixed(1)}R`, xFmt: (v) => `#${v}`, zero: true })),
      h('div.card', h('div.card-h', h('h3', icon('grid-3x3'), 'Process vs outcome')), matrix(D.matrix),
        h('div.help', { style: { marginTop: '10px' } }, 'A losing trade with perfect execution is a good trade. The bottom-left box (broke plan, still won) is the dangerous one: it teaches the wrong lesson.'))),
    h('div.grid.g2', { style: { marginTop: '16px' } },
      h('div.card', h('div.card-h', h('h3', icon('activity'), 'Rolling 10-trade discipline'), h('span.sub', 'process score and plan adherence, %')),
        lineChart([
          { name: 'Process score', color: 'var(--s3)', points: D.rolling.map(r => ({ x: r.i, y: r.process })) },
          { name: 'Plan adherence', color: 'var(--s1)', points: D.rolling.map(r => ({ x: r.i, y: r.adherence * 100 })) }], { height: 220, yFmt: (v) => `${v.toFixed(0)}`, xFmt: (v) => `#${v}` })),
      h('div.card', h('div.card-h', h('h3', icon('chart-column'), 'R distribution'), h('span.sub', 'taken trades, 0.5R buckets')),
        barChart(D.histogram.map(b => ({ label: `${b.from}`, value: b.n, color: b.from < 0 ? 'var(--s8)' : 'var(--s3)', tip: `${b.from}R to ${b.to}R: ` })), { height: 220, yFmt: (v) => v.toFixed(0) }))),
    h('h2', { style: { margin: '26px 0 6px' } }, 'Diagnostics'), h('div.dim', { style: { marginBottom: '14px' } }, 'The questions your log exists to answer. Below 10 trades per bucket this is noise.'),
    h('div.grid.g3',
      diagCard('1. Does the grade mean anything?', 'If A and C grades produce the same avg R, the rubric measures nothing.', 'ABCD'.split('').map(g => ({ label: `Grade ${g}`, ...D.diagnostics.grade[g] })), D.diagnostics.verdicts.grade),
      diagCard('2. Which setup actually works?', 'Expect one or two to carry the book. Stop trading the ones that do not.', Object.entries(D.diagnostics.setup).map(([k, v]) => ({ label: k, ...v })), D.diagnostics.verdicts.setup),
      diagCard('3. Are the thin hours costing you?', '11 PM to 3 AM Eastern (10 PM to 2 AM in winter) produces sweeps that reverse and then continue.', Object.entries(D.diagnostics.thin).map(([k, v]) => ({ label: k, ...v })), D.diagnostics.verdicts.thin),
      diagCard('4. Is the penetration floor right?', `Floor ${D.diagnostics.edges.pen_floor} ATR, abandon ${D.diagnostics.edges.pen_abandon} (live from the playbook).`, Object.entries(D.diagnostics.pen).map(([k, v]) => ({ label: k, ...v })), D.diagnostics.verdicts.pen),
      diagCard(`5. Is the ${D.diagnostics.edges.window_min} to ${D.diagnostics.edges.window_max} candle window right?`, 'Candles from break to reclaim (edges live from the playbook).', Object.entries(D.diagnostics.candles).map(([k, v]) => ({ label: k, ...v })), D.diagnostics.verdicts.candles),
      diagCard('6. Does OI confirmation matter?', 'The C2/C4 hard check, tested on your own trades.', Object.entries(D.diagnostics.oi).map(([k, v]) => ({ label: k, ...v })), 'If confirmed and unconfirmed trades look the same, the OI check is not earning its place.'),
      diagCard('7. By symbol', 'Blended expectancy across ETH and a memecoin describes neither.', Object.entries(D.diagnostics.symbol).map(([k, v]) => ({ label: k.replace('USDT', ''), ...v })), null),
      diagCard('8. Long vs short', null, Object.entries(D.diagnostics.direction).map(([k, v]) => ({ label: k, ...v })), null),
      diagCard('9. Followed plan vs broke plan', 'The cost of indiscipline, in R.', Object.entries(D.diagnostics.plan).map(([k, v]) => ({ label: k, ...v })), null),
      diagCard('10. Which entry mechanism pays?', 'Price/volume/OI mechanism auto-classified from Bybit at the moment of entry. Trades from before context capture are excluded.',
        Object.keys(D.diagnostics.mechanism).length ? Object.entries(D.diagnostics.mechanism).map(([k, v]) => ({ label: k, ...v })) : [{ label: 'No captures yet', n: 0, avg_r: 0, net: 0 }],
        D.diagnostics.n_with_context ? `${D.diagnostics.n_with_context} trades carry an entry snapshot.` : 'New trades record the market snapshot automatically from now on.')),
    h('div.grid', { style: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', marginTop: '16px' } },
      h('div.card', h('div.card-h', h('h3', icon('calendar-days'), 'Last 35 days'), h('span.sub', 'net R per exchange day (ends 8 PM ET); ring = all trades clean')), calendar(D.calendar)),
      h('div.card', h('div.card-h', h('h3', icon('shield-alert'), 'Rule findings by rule'), h('span.sub', 'count and R of the losing trades they touched')), violations(D.violations, D.rules))));
}

function kpi(label, v, f, foot, cls = '') {
  const val = h('div.val', { class: cls }, '');
  setTimeout(() => tween(val, Number.isFinite(v) ? v : NaN, { format: f }), 30);
  if (!Number.isFinite(v)) val.textContent = '—';
  return h('div.card.tile', h('div.lbl', label), val, h('div.foot', foot));
}
function diagCard(title, sub, rows, verdict) {
  const maxN = Math.max(...rows.map(r => r.n));
  return h('div.card', h('h3', title), sub ? h('div.muted', { style: { fontSize: '12px', margin: '4px 0 12px' } }, sub) : h('div', { style: { height: '10px' } }),
    diagBars(rows),
    maxN < 10 ? h('div.noise', { style: { marginTop: '6px' } }, icon('info', 'sm'), ' Below 10 trades per bucket: noise.') : null,
    verdict ? h('div.verdict', verdict) : null);
}
function matrix(m) {
  const tot = m.good_win + m.good_loss + m.bad_win + m.bad_loss || 1;
  const cell = (n, lbl, bg) => h('div.cell', { style: { background: bg } }, h('b', n), h('span', lbl), h('div.muted', { style: { fontSize: '11px' } }, `${Math.round(n / tot * 100)}%`));
  return h('div.matrix',
    h('div'), h('div.eyebrow', { style: { textAlign: 'center' } }, 'Won'), h('div.eyebrow', { style: { textAlign: 'center' } }, 'Lost'),
    h('div.eyebrow', { style: { alignSelf: 'center' } }, 'Followed plan'), cell(m.good_win, 'Earned win', 'rgba(34,197,94,.14)'), cell(m.good_loss, 'Good loss', 'rgba(54,215,199,.10)'),
    h('div.eyebrow', { style: { alignSelf: 'center' } }, 'Broke plan'), cell(m.bad_win, 'Lucky win', 'rgba(250,178,25,.14)'), cell(m.bad_loss, 'Earned loss', 'rgba(239,75,75,.14)'));
}
function calendar(days) {
  const map = Object.fromEntries(days.map(d => [d.day, d]));
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today); start.setUTCDate(start.getUTCDate() - 34 - ((today.getUTCDay() + 6) % 7));
  const cells = [];
  for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10); const e = map[key];
    let bg = 'rgba(15,23,42,0.0315)';
    if (e && e.n) { const a = Math.min(1, Math.abs(e.r) / 3) * 0.75 + 0.15; bg = e.r >= 0 ? `rgba(25,158,112,${a})` : `rgba(230,103,103,${a})`; }
    else if (e && e.skipped) bg = 'rgba(139,123,255,.18)';
    const clean = e && e.n && e.clean === e.n;
    cells.push(h(`div.d${key === today.toISOString().slice(0, 10) ? '.today' : ''}`, { style: { background: bg, boxShadow: clean ? 'inset 0 0 0 2px rgba(15,23,42,0.495)' : undefined }, title: e ? `${key}: ${e.n} trades, ${fmt.r(e.r)}, ${e.clean}/${e.n} clean, ${e.skipped} skipped` : key }, h('span', d.getUTCDate())));
  }
  return h('div', h('div.heat', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => h('div.muted', { style: { fontSize: '11px', textAlign: 'center' } }, x)), cells),
    h('div.legend', { style: { marginTop: '10px' } }, h('span', h('i', { style: { background: 'rgba(25,158,112,.7)' } }), 'positive R'), h('span', h('i', { style: { background: 'rgba(230,103,103,.7)' } }), 'negative R'), h('span', h('i', { style: { background: 'rgba(139,123,255,.3)' } }), 'passes only')));
}
function violations(list, rules) {
  if (!list.length) return h('div.empty', icon('shield-check'), h('div', 'No rule findings. Keep it that way.'));
  const mx = Math.max(...list.map(v => v.n));
  return h('div.col', list.slice(0, 10).map(v => h('div', h('div.row', v.rule ? h('span.ruleno', `R${v.rule}`) : h('span.ruleno', 'S'), h('b', rules[v.rule] || v.code.replace(/_/g, ' ')), h('span.muted.mono', { style: { marginLeft: 'auto', fontSize: '12px' } }, `${v.n}x · ${fmt.r(v.r_cost)}`)),
    h('div.bar.crit', { style: { marginTop: '6px' } }, h('i', { style: { width: `${v.n / mx * 100}%` } })))));
}
