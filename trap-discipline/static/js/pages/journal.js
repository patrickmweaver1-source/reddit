// Trade journal: interactive cards modeled on the Trap Journal workbook, auto-filled from Bybit.
import { api } from '../api.js';
import { etParts, etToUtcMs } from '../ui.js';
import { h, icon, fmt, clear, rpill, dirChip, gradeChip, modal, segmented, numInput, field, toast, sound, confetti, confirmBox, svg, put } from '../ui.js';
import { setupDiagram } from './checklist.js';

/* When a trade happened, in Eastern Time (the journal stores UTC). */
function whenMs(t) { return t.opened_at || (t.date ? Date.parse(`${t.date}T${t.time_utc || '00:00'}:00Z`) : null); }
function whenET(t) { const ms = whenMs(t); return ms ? `${fmt.et(ms, true)} ${fmt.tz(ms)}` : ''; }

let root = null; let ctxRef = null; let trades = []; let view = 'cards';
let F = { symbol: 'all', kind: 'all', setup: 'all', grade: 'all', q: '' };
let tick = null;

export async function render(el, ctx) {
  root = el; ctxRef = ctx;
  await load();
  draw();
  const p = ctx.params[0];
  if (p === 'new-skip') openSkip();
  else if (p === 'new-trade') openManual();
  else if (p && /^\d+$/.test(p)) openTrade(+p);
  clearInterval(tick);
  tick = setInterval(timers, 1000);
}
export function destroy() { clearInterval(tick); }
export function onEvent(msg) { if (msg.kind === 'trade') { load().then(draw); } }

async function load() { trades = await api.get('/api/trades'); }

function filtered() {
  return trades.filter(t => (F.symbol === 'all' || t.symbol === F.symbol) &&
    (F.kind === 'all' || (F.kind === 'taken' && t.taken) || (F.kind === 'skipped' && !t.taken) || (F.kind === 'review' && t.taken && t.status === 'closed' && !t.reviewed_at) || (F.kind === 'open' && t.status === 'open')) &&
    (F.setup === 'all' || t.setup === F.setup) && (F.grade === 'all' || t.grade === F.grade) &&
    (!F.q || `${t.symbol} ${t.note} ${t.setup}`.toLowerCase().includes(F.q.toLowerCase())));
}

function draw() {
  clear(root);
  const taken = trades.filter(t => t.taken && t.r !== null && t.r !== undefined);
  const calib = taken.filter(t => t.pen_atr !== null && t.candles_to_reclaim !== null && t.oi_confirmed).length;
  const unrev = trades.filter(t => t.taken && t.status === 'closed' && !t.reviewed_at).length;
  const syms = [...new Set(trades.map(t => t.symbol))];
  put(root, 
    h('div.page-head',
      h('div', h('div.eyebrow', 'Trade journal'), h('h1', 'One row per opportunity, taken or not'),
        h('div.sub', 'Exchange facts fill themselves in. Your job: setup, grade, and the three orange calibration fields. Log within ten minutes, win or lose.')),
      h('div.actions',
        h('button.btn', { onclick: () => api.download('/api/export.xlsx') }, icon('file-spreadsheet', 'sm'), 'Export to Trap Journal.xlsx'),
        h('button.btn', { onclick: openManual }, icon('plus', 'sm'), 'Manual trade'),
        h('button.btn.xp', { onclick: openSkip }, icon('hand', 'sm'), 'Log a skipped setup'))),
    h('div.grid.g4', { style: { marginBottom: '16px' } },
      statTile('target', 'To 30 trades', Math.max(0, 30 - taken.length), `${taken.length} taken trades scored`, Math.min(1, taken.length / 30)),
      statTile('gauge', 'Calibrated', calib, 'rows with all three orange fields', taken.length ? calib / taken.length : 0),
      statTile('notebook-pen', 'Needs review', unrev, unrev ? 'log these for XP' : 'all caught up', unrev ? 1 : 0, unrev ? 'warn' : 'good'),
      statTile('hand', 'Skipped setups', trades.filter(t => !t.taken).length, 'passes logged', null)),
    h('div.card.pad-s', { style: { marginBottom: '14px' } }, h('div.row.wrap', { style: { gap: '10px' } },
      segmented([['all', 'All'], ['review', 'Needs review'], ['open', 'Open'], ['taken', 'Taken'], ['skipped', 'Skipped']], F.kind, (v) => { F.kind = v; draw(); }),
      h('select.input', { style: { width: 'auto' }, onchange: (e) => { F.symbol = e.target.value; draw(); } }, h('option', { value: 'all' }, 'All symbols'), syms.map(s => h('option', { value: s, selected: F.symbol === s }, s))),
      h('select.input', { style: { width: 'auto' }, onchange: (e) => { F.setup = e.target.value; draw(); } }, h('option', { value: 'all' }, 'All setups'), ['Spring', 'Upthrust', 'Sweep', 'Failed retest'].map(s => h('option', { value: s, selected: F.setup === s }, s))),
      h('select.input', { style: { width: 'auto' }, onchange: (e) => { F.grade = e.target.value; draw(); } }, h('option', { value: 'all' }, 'All grades'), 'ABCD'.split('').map(s => h('option', { value: s, selected: F.grade === s }, `Grade ${s}`))),
      h('input.input', { placeholder: 'Search notes…', value: F.q, style: { width: '200px' }, oninput: (e) => { F.q = e.target.value; clearTimeout(window.__jq); window.__jq = setTimeout(draw, 250); } }),
      h('div', { style: { marginLeft: 'auto' } }, segmented([['cards', 'Cards'], ['table', 'Sheet']], view, (v) => { view = v; draw(); })))),
    view === 'cards' ? cards() : sheet());
  timers();
}
function statTile(ic, label, val, foot, pct, cls = 'accent') {
  return h('div.card.tile', h('div.lbl', icon(ic, 'sm'), label), h('div.val', val), h('div.foot', foot), pct !== null ? h(`div.bar.${cls}`, { style: { marginTop: '10px' } }, h('i', { style: { width: `${Math.round(pct * 100)}%` } })) : null);
}

function cards() {
  const rows = filtered();
  if (!rows.length) return h('div.card', h('div.empty', icon('notebook-pen'), h('div', 'Nothing here yet.'), h('div', { style: { fontSize: '12px' } }, 'Trades appear automatically once your read-only Bybit key is connected. You can also log skipped setups and manual trades.')));
  return h('div.jlist', rows.map(t => {
    const needs = t.taken && t.status === 'closed' && !t.reviewed_at;
    const kind = t.status === 'open' ? 'open' : !t.taken ? 'skip' : (t.r || 0) > 0 ? 'win' : 'loss';
    const viol = (t.violations || []).filter(v => !v.dismissed && v.severity !== 'note');
    return h(`div.jrow.${kind}${needs ? '.needs' : ''}`, { onclick: () => openTrade(t.id) },
      h('div.edge'),
      h('div', h('div.row', h('span.sym', t.symbol.replace('USDT', '')), dirChip(t.direction), t.source === 'bybit' ? h('span.chip', { title: 'Auto-recorded from Bybit' }, icon('radio', 'sm'), 'auto') : null),
        h('div.when', whenET(t))),
      h('div', h('div.row', t.setup ? h('span.chip', t.setup) : h('span.muted', 'setup?'), gradeChip(t.grade))),
      h('div', !t.taken ? h('span.chip.xp', 'Skipped') : t.status === 'open' ? h('span.chip', { style: { color: 'var(--accent)' } }, 'Open') : h('div.row', rpill(t.r), h('span.mono', { class: (t.net_pnl || 0) >= 0 ? 'good' : 'bad', style: { fontSize: '12.5px' } }, fmt.sUsd(t.net_pnl)))),
      h('div', h('div.muted', { style: { fontSize: '11px' } }, 'Calibration'), h('div.calib', { title: 'Pen. ATR · Candles to reclaim · OI confirmed' }, h(`i${t.pen_atr !== null && t.pen_atr !== undefined ? '.on' : ''}`), h(`i${t.candles_to_reclaim !== null && t.candles_to_reclaim !== undefined ? '.on' : ''}`), h(`i${t.oi_confirmed ? '.on' : ''}`))),
      h('div', t.process_score !== null && t.process_score !== undefined ? h('div', h('div.muted', { style: { fontSize: '11px' } }, 'Process'), h('b.mono', { class: t.process_score >= 85 ? 'good' : t.process_score >= 60 ? '' : 'bad' }, t.process_score)) : null),
      h('div', needs ? h('span.timerpill', { dataset: { logdeadline: t.closed_at + ctxRef.state.thresholds.log_within_minutes * 60000 } }, '') :
        viol.length ? h('span.chip.short', icon('shield-alert', 'sm'), `${viol.length} finding${viol.length > 1 ? 's' : ''}`) : t.taken && t.status === 'closed' ? h('span.chip.long', icon('shield-check', 'sm'), 'clean') : null),
      h('div', icon('chevron-right')));
  }));
}

function sheet() {
  const rows = filtered();
  const cols = ['Date', 'Time', 'Symbol', 'Setup', 'Grade', 'Dir', 'Taken?', 'Entry', 'Stop', 'Exit', 'Qty', 'Lev', 'Followed plan?', 'Pen. ATR', 'Candles', 'OI conf.', 'Risk $', 'Net P&L', 'R', 'Liq buf'];
  const orange = new Set(['Pen. ATR', 'Candles', 'OI conf.']);
  return h('div.card', { style: { padding: 0, overflow: 'auto', maxHeight: '70vh' } },
    h('table.tbl', h('thead', h('tr', cols.map(c => h(`th${orange.has(c) ? '.orange' : ''}${['Entry', 'Stop', 'Exit', 'Qty', 'Lev', 'Risk $', 'Net P&L', 'R', 'Liq buf', 'Pen. ATR', 'Candles'].includes(c) ? '.num' : ''}`, c)))),
      h('tbody', rows.map(t => h('tr', { style: { cursor: 'pointer' }, onclick: () => openTrade(t.id) },
        h('td.mono', whenMs(t) ? etParts(whenMs(t)).date : ''), h('td.mono', whenMs(t) ? fmt.et(whenMs(t)) : ''), h('td', t.symbol), h('td', t.setup || ''), h('td', t.grade || ''), h('td', t.direction || ''), h('td', t.taken ? 'Yes' : 'No'),
        h('td.num', fmt.px(t.entry)), h('td.num', fmt.px(t.stop)), h('td.num', fmt.px(t.exit)), h('td.num', fmt.qty(t.initial_qty || t.qty)), h('td.num', t.leverage ?? ''),
        h('td', t.followed_plan || ''), h('td.num', t.pen_atr ?? ''), h('td.num', t.candles_to_reclaim ?? ''), h('td', t.oi_confirmed || ''),
        h('td.num', fmt.num(t.risk_usd)), h('td.num', { class: (t.net_pnl || 0) >= 0 ? 'good' : 'bad' }, fmt.num(t.net_pnl)), h('td.num', t.r !== null && t.r !== undefined ? t.r.toFixed(2) : ''),
        h('td.num', { class: t.liq_buffer !== null && t.liq_buffer < 3 ? 'bad' : '' }, t.liq_buffer !== null && t.liq_buffer !== undefined ? t.liq_buffer.toFixed(1) : ''))))));
}

function timers() {
  const now = Date.now();
  document.querySelectorAll('[data-logdeadline]').forEach(el => {
    const left = +el.dataset.logdeadline - now;
    if (left > 0) { el.textContent = `${fmt.dur(left)} for +30 XP`; el.classList.remove('late'); }
    else { el.textContent = 'log it anyway'; el.classList.add('late'); }
  });
}

// ---------------------------------------------------------------- trade detail and review
async function openTrade(id) {
  let t;
  try { t = await api.get(`/api/trades/${id}`); } catch (e) { toast('Not found', e.message, 'warn'); return; }
  const cx = t.context || {};
  const sug = cx.suggest || {};
  const suggested = [];
  const form = { setup: t.setup, grade: t.grade, followed_plan: t.followed_plan, pen_atr: t.pen_atr, candles_to_reclaim: t.candles_to_reclaim, oi_confirmed: t.oi_confirmed, note: t.note || '', emotion: t.emotion, stop: t.stop };
  if (!t.reviewed_at) {
    // prefill the calibration fields from the market snapshot captured at entry
    if (form.pen_atr == null && sug.pen_atr != null) { form.pen_atr = sug.pen_atr; suggested.push('Pen. ATR'); }
    if (form.candles_to_reclaim == null && sug.candles_to_reclaim != null) { form.candles_to_reclaim = sug.candles_to_reclaim; suggested.push('Candles'); }
    if (!form.oi_confirmed && sug.oi_confirmed) { form.oi_confirmed = sug.oi_confirmed; suggested.push('OI confirmed'); }
    if (!form.setup && cx.level && cx.level.setup) { form.setup = cx.level.setup; suggested.push('Setup'); }
  }
  const needsStop = !t.stop && t.taken;
  const closed = t.status === 'closed';
  const legs = t.legs || [];
  const viol = t.violations || [];
  const m = modal({
    wide: true, icon: t.taken ? 'notebook-pen' : 'hand',
    title: `${t.symbol} · ${t.taken ? (t.direction || '') : 'Skipped setup'} · ${whenET(t)}`,
    body: h('div.grid', { style: { gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)', gap: '20px' } },
      h('div.col', { style: { gap: '14px' } },
        t.taken ? dualScore(t, viol) : null,
        t.candles && t.candles.length ? tradeChart(t) : null,
        cx.price ? h('div', h('div.eyebrow', { style: { marginBottom: '6px' } }, 'Market at entry (captured live)'),
          h('div.row.wrap', { style: { gap: '6px' } },
            cx.mechanism ? h('span.chip', icon('waves', 'sm'), cx.mechanism) : null,
            cx.regime ? h('span.chip', `4h ${cx.regime}`) : null,
            cx.funding_pctile != null ? h('span.chip', { class: cx.funding_pctile >= 90 || cx.funding_pctile <= 10 ? 'warn' : '' }, `funding p${Math.round(cx.funding_pctile)}`) : null,
            cx.oi_chg_1h != null ? h('span.chip', `OI 1h ${fmt.pct(cx.oi_chg_1h, 2, true)}`) : null,
            cx.rvol != null ? h('span.chip', `RVOL ${fmt.num(cx.rvol, 2)}x`) : null,
            cx.atr_pct != null ? h('span.chip', `ATR ${fmt.num(cx.atr_pct, 2)}%`) : null,
            cx.third ? h('span.chip', { class: cx.third === 'middle' ? 'short' : '' }, `${cx.third} third`) : null,
            cx.level ? h('span.chip', `level ${fmt.px(cx.level.price)} ${cx.level.state || ''}`) : null)) : null,
        t.taken ? h('div.kv', { style: { gridTemplateColumns: 'auto 1fr auto 1fr', columnGap: '18px' } },
          h('dt', 'Entry'), h('dd', fmt.px(t.entry)), h('dt', 'Exit'), h('dd', fmt.px(t.exit)),
          h('dt', 'Stop'), h('dd', fmt.px(t.stop)), h('dt', 'Qty (max)'), h('dd', fmt.qty(t.qty)),
          h('dt', 'Leverage'), h('dd', t.leverage ? `${t.leverage}x` : '—'), h('dt', 'Liq buffer'), h('dd', { class: t.liq_buffer !== null && t.liq_buffer < 3 ? 'bad' : '' }, t.liq_buffer !== null && t.liq_buffer !== undefined ? `${fmt.num(t.liq_buffer, 2)} stops` : '—'),
          h('dt', 'Fees'), h('dd', fmt.usd(t.fees)), h('dt', 'Funding'), h('dd', fmt.usd(t.funding)),
          h('dt', 'Best / worst'), h('dd', `${fmt.r(t.max_fav_r)} / ${fmt.r(t.max_adv_r)}`), h('dt', 'Held'), h('dd', t.closed_at && t.opened_at ? fmt.dur(t.closed_at - t.opened_at) : '—')) : null,
        legs.length ? h('div', h('div.eyebrow', { style: { marginBottom: '6px' } }, 'Legs'), h('table.tbl', h('tbody', legs.map(l => h('tr', h('td', h(`span.chip.${l.kind === 'entry' ? 'long' : 'short'}`, l.name)), h('td.mono', fmt.utc(l.t, true)), h('td.num', fmt.px(l.price)), h('td.num', fmt.qty(l.qty)), h('td.num.muted', l.fee ? fmt.usd(l.fee, 4) : ''), h('td.muted', l.order_type || '')))))) : null,
        viol.length ? h('div', h('div.eyebrow', { style: { marginBottom: '6px' } }, 'Rule findings'),
          viol.map(v => h(`div.viol.${v.severity}${v.dismissed ? '.dismissed' : ''}`, v.rule ? h('span.ruleno', `R${v.rule}`) : h('span.ruleno', 'S'),
            h('div', { style: { flex: 1 } }, v.text, v.dismissed ? h('div.muted', { style: { fontSize: '12px', textDecoration: 'none' } }, `Dismissed: ${v.dismiss_reason}`) : null),
            h('button.btn.sm.ghost', { onclick: () => dismiss(t, v, m) }, v.dismissed ? 'Restore' : 'Not right?')))) :
          t.taken && closed ? h('div.viol.note', { style: { background: 'var(--good-soft)', borderColor: 'rgba(34,197,94,.3)' } }, icon('shield-check', 'sm'), 'No rule findings. Clean execution.') : null,
        t.plan ? h('div', h('div.eyebrow', { style: { marginBottom: '6px' } }, 'Matched checklist'), h('div.row.wrap', h(`span.chip${t.plan.verdict === 'GO' ? '.long' : '.short'}`, t.plan.verdict), gradeChip(t.plan.grade), h('span.muted', { style: { fontSize: '12px' } }, `${fmt.local(t.plan.created_at)} · planned stop ${fmt.px(t.plan.stop)} · planned qty ${fmt.qty(t.plan.qty)}`))) : null),
      h('div.col', { style: { gap: '14px' } },
        h('div.eyebrow', 'Your review'),
        h('div', h('div.muted', { style: { fontSize: '12px', marginBottom: '6px' } }, 'Setup'), h('div.setup-cards', { style: { gridTemplateColumns: 'repeat(4,1fr)' } }, ['Spring', 'Upthrust', 'Sweep', 'Failed retest'].map(s => {
          const c = h(`div.setup-card${form.setup === s ? '.on' : ''}`, { style: { padding: '8px' }, onclick: () => { form.setup = s; c.parentNode.querySelectorAll('.setup-card').forEach(x => x.classList.remove('on')); c.classList.add('on'); } }, setupDiagram(s), h('div.n', { style: { fontSize: '12px' } }, s));
          return c;
        }))),
        h('div.row.wrap', { style: { gap: '18px' } },
          field('Grade', segmented('ABCD'.split(''), form.grade, (v) => { form.grade = v; }, 'grade')),
          t.taken ? field('Followed plan?', segmented(['Yes', 'No'], form.followed_plan, (v) => { form.followed_plan = v; }, 'yn')) : null),
        viol.some(v => v.severity === 'major' && !v.dismissed) ? h('div.help', { style: { color: 'var(--crit)' } }, 'A major rule finding sets "Followed plan" to No. If a finding is wrong, dismiss it with a reason.') : null,
        h('div', { style: { padding: '12px', borderRadius: '12px', border: '1px solid rgba(245,158,11,.35)', background: 'rgba(245,158,11,.05)' } },
          h('div.row', h('b', { style: { color: '#f59e0b' } }, 'The three orange fields'), h('span.muted', { style: { fontSize: '12px' } }, 'the entire reason this log exists')),
          suggested.length ? h('div.help', { style: { marginTop: '4px' } }, icon('sparkles', 'sm'), ` Prefilled from the entry snapshot: ${suggested.join(', ')}. Check them against the chart before saving.`) : null,
          h('div.grid.g3', { style: { gap: '10px', marginTop: '10px' } },
            field('Pen. ATR', numInput(form.pen_atr, { class: 'input num orange', placeholder: 'e.g. 0.42', onchange: (e) => { form.pen_atr = e.target.value; } })),
            field('Candles to reclaim', numInput(form.candles_to_reclaim, { class: 'input num orange', step: 1, placeholder: 'e.g. 2', onchange: (e) => { form.candles_to_reclaim = e.target.value; } })),
            field('OI confirmed?', segmented(['Yes', 'No'], form.oi_confirmed, (v) => { form.oi_confirmed = v; }, 'yn')))),
        needsStop ? field('Stop (not found on the exchange; needed for R)', numInput(form.stop, { onchange: (e) => { form.stop = e.target.value; } })) : null,
        t.taken ? field('How did it feel?', h('div.emo', ['Calm', 'Confident', 'FOMO', 'Fear', 'Revenge', 'Bored', 'Impatient'].map(e => {
          const b = h(`button${form.emotion === e ? '.on' : ''}`, { type: 'button', onclick: () => { form.emotion = e; b.parentNode.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); } }, e); return b;
        }))) : null,
        field(t.taken ? 'Note' : 'Why skipped', h('textarea.input', { oninput: (e) => { form.note = e.target.value; } }, form.note)),
        h('div.help', t.reviewed_at ? `Reviewed ${fmt.local(t.reviewed_at)}.` : closed || !t.taken ? 'Saving marks this row reviewed and pays XP: +40 logged, +30 if within 10 minutes of the close, +20 when the three orange fields are filled, +40 clean.' : 'Trade is still open. You can save notes now; review pays out after the close.'))),
    foot: [
      t.source !== 'bybit' ? h('button.btn.danger', { style: { marginRight: 'auto' }, onclick: async () => { if (await confirmBox('Delete this row?', 'This removes the row and any XP it earned.', 'Delete', true)) { await api.del(`/api/trades/${t.id}`); m.close(); await load(); draw(); ctxRef.refresh(); } } }, icon('trash-2', 'sm'), 'Delete') : null,
      h('button.btn.ghost', { onclick: () => m.close() }, 'Close'),
      h('button.btn.primary', { onclick: async (e) => {
        const body = { ...form, mark_reviewed: closed || !t.taken };
        try {
          const r = await api.patch(`/api/trades/${t.id}`, body);
          if (r.xp_gained > 0) { ctxRef.celebrateXP(r.xp_gained, e.target); confetti({ particleCount: 50 + Math.min(100, r.xp_gained), spread: 70 }); }
          else sound('tick');
          toast(r.xp_gained > 0 ? `Logged. +${r.xp_gained} XP` : 'Saved', r.data.followed_plan === 'Yes' ? 'Process: clean. That is the only scoreboard that matters here.' : 'Saved. Grade the process honestly; that is how the diagnostics get useful.', r.xp_gained > 0 ? 'xp' : 'good');
          m.close(); await load(); draw(); ctxRef.refresh();
          if (ctxRef.params[0]) history.replaceState(null, '', '#/journal');
        } catch (err) { toast('Could not save', err.message, 'alert'); }
      } }, icon('check', 'sm'), closed || !t.taken ? (t.reviewed_at ? 'Save' : 'Save & review') : 'Save notes')],
    onClose: () => { if (ctxRef.params[0]) history.replaceState(null, '', '#/journal'); },
  });
}
function miniKV(label, val, cls = '') { return h('div', { style: { padding: '10px 12px', borderRadius: '11px', background: 'var(--panel-2)', border: '1px solid var(--line)' } }, h('div.eyebrow', label), h('div', { class: cls, style: { fontFamily: 'var(--display)', fontSize: '20px', fontWeight: 700 } }, val)); }

// Two scoreboards, kept deliberately apart: how well the trade was EXECUTED
// (process, the only thing you controlled) and how it turned OUT (R, mostly
// luck on any single trade). A clean process can lose and a sloppy one can win;
// judging them together is the outcome bias the journal exists to fight.
function dualScore(t, viol) {
  const ps = t.process_score;
  const majors = (viol || []).filter(v => v.severity === 'major').length;
  const pcls = ps == null ? '' : ps >= 85 ? 'good' : ps >= 60 ? '' : 'bad';
  const scoreboard = (accent, title, rows, note) => h('div', { style: { flex: 1, minWidth: '190px', padding: '12px 14px', borderRadius: '12px', background: 'var(--panel-2)', border: `1px solid ${accent}` } },
    h('div.eyebrow', title), h('div.row', { style: { gap: '14px', alignItems: 'baseline', marginTop: '4px', flexWrap: 'wrap' } }, ...rows),
    note ? h('div.muted', { style: { fontSize: '11px', marginTop: '6px' } }, note) : null);
  const big = (val, cls) => h('div', { class: cls, style: { fontFamily: 'var(--display)', fontSize: '26px', fontWeight: 700 } }, val);
  const sub = (label, val, cls = '') => h('div', h('div.muted', { style: { fontSize: '11px' } }, label), h('b.mono', { class: cls }, val));
  return h('div', { style: { marginBottom: '2px' } },
    h('div.row.wrap', { style: { gap: '10px' } },
      scoreboard('rgba(139,123,255,.4)', 'Process (what you controlled)',
        [big(ps == null ? '—' : `${ps}`, pcls), sub('out of 100', t.followed_plan === 'Yes' ? 'followed plan' : t.followed_plan === 'No' ? 'broke the plan' : '—'),
         sub('major breaks', `${majors}`, majors ? 'bad' : 'good')],
        'The only scoreboard you own. Grade it honestly whether you won or lost.'),
      scoreboard('rgba(54,215,199,.35)', 'Outcome (mostly luck on one trade)',
        [big(fmt.r(t.r), (t.r || 0) >= 0 ? 'good' : 'bad'), sub('net P&L', fmt.sUsd(t.net_pnl), (t.net_pnl || 0) >= 0 ? 'good' : 'bad'), sub('risk (1R)', fmt.usd(t.risk_usd))],
        'One result tells you almost nothing. Read outcome only across many trades.')),
    h('div.muted', { style: { fontSize: '11px', marginTop: '6px', textAlign: 'center' } }, 'These are scored separately on purpose. A good decision can lose and a bad one can win.'));
}

function dismiss(t, v, m) {
  let reason = '';
  m.close();
  const d = modal({ title: v.dismissed ? 'Restore this finding' : 'Dismiss a rule finding', icon: 'shield-alert',
    body: h('div.col', { style: { gap: '12px' } },
      h(`div.viol.${v.severity}`, v.rule ? h('span.ruleno', `R${v.rule}`) : null, v.text),
      h('p.dim', v.dismissed ? 'The finding will count again in your stats and process score.' : 'Only dismiss a finding the data got wrong (for example, a stop you placed on a different order type). Do not dismiss one you simply disagree with; that is a rule change, and rule changes belong in the monthly review.'),
      field('Reason (kept on record)', h('textarea.input', { oninput: (e) => { reason = e.target.value; } }))),
    foot: [h('button.btn.ghost', { onclick: () => { d.close(); openTrade(t.id); } }, 'Cancel'),
      h('button.btn.primary', { onclick: async () => {
        try { await api.post(`/api/trades/${t.id}/dismiss`, { code: v.code, reason, undo: !!v.dismissed }); d.close(); await load(); draw(); openTrade(t.id); }
        catch (e) { toast('Not saved', e.message, 'warn'); }
      } }, v.dismissed ? 'Restore' : 'Dismiss')] });
}

function tradeChart(t) {
  const cs = t.candles; const W = 720; const H = 230; const pad = 8;
  const px = [...cs.flatMap(k => [k.h, k.l]), t.entry, t.stop, t.exit].filter(v => v);
  const lo = Math.min(...px); const hi = Math.max(...px); const rg = (hi - lo) || 1;
  const Y = (v) => pad + (1 - (v - lo) / rg) * (H - 2 * pad);
  const RIGHT_PAD_BARS = 2.5; // breathing room between the last candle and the price labels
  const bw = (W - 110) / (cs.length + RIGHT_PAD_BARS);
  const X = (i) => 10 + i * bw + bw / 2;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' });
  // reference lines carry their price; label rows are nudged apart so they never overlap
  const gutter = 96;
  const labelYs = [];
  const line = (v, c, lbl, dash) => {
    if (!v) return;
    let ty = Y(v) + 4;
    for (const prev of labelYs) if (Math.abs(ty - prev) < 12) ty = prev + 12;
    ty = Math.min(H - 4, Math.max(10, ty)); labelYs.push(ty);
    put(s, svg('line', { x1: 0, x2: W - gutter, y1: Y(v), y2: Y(v), stroke: c, 'stroke-width': 1.2, 'stroke-dasharray': dash || '' }),
      svg('text', { x: W - gutter + 4, y: ty, fill: c, 'font-size': 11, 'font-family': 'var(--mono)' }, `${lbl} ${fmt.px(v)}`));
  };
  cs.forEach((k, i) => {
    const up = k.c >= k.o; const c = up ? '#199e70' : '#e66767';
    put(s, svg('line', { x1: X(i), x2: X(i), y1: Y(k.h), y2: Y(k.l), stroke: c, 'stroke-width': 1 }));
    put(s, svg('rect', { x: X(i) - Math.max(1, bw * 0.35), y: Y(Math.max(k.o, k.c)), width: Math.max(2, bw * 0.7), height: Math.max(1, Math.abs(Y(k.o) - Y(k.c))), fill: c }));
  });
  if (t.opened_at) {
    const i0 = cs.findIndex(k => k.t + 900000 > t.opened_at); const i1 = t.closed_at ? cs.findIndex(k => k.t + 900000 > t.closed_at) : cs.length - 1;
    if (i0 >= 0) s.insertBefore(svg('rect', { x: X(i0) - bw / 2, y: 0, width: Math.max(bw, (i1 - i0 + 1) * bw), height: H, fill: 'rgba(54,215,199,.06)' }), s.firstChild);
    // candle-four marker
    if (i0 >= 0 && i0 + 5 < cs.length) put(s, svg('line', { x1: X(i0 + 4) + bw / 2, x2: X(i0 + 4) + bw / 2, y1: 0, y2: H, stroke: 'rgba(250,178,25,.5)', 'stroke-dasharray': '3 3' }), svg('text', { x: X(i0 + 4) + bw / 2 + 3, y: 12, fill: 'var(--warn)', 'font-size': 10 }, 'candle 4'));
  }
  line(t.entry, '#e9eef5', 'entry', '4 3'); line(t.stop, '#ef4b4b', 'stop'); line(t.exit, '#36d7c7', 'exit', '2 2');
  (t.legs || []).forEach(l => {
    const i = cs.findIndex(k => k.t + 900000 > l.t); if (i < 0) return;
    put(s, svg('circle', { cx: X(i), cy: Y(l.price), r: 5, fill: l.kind === 'entry' ? '#36d7c7' : '#f4c24f', stroke: '#0a0f16', 'stroke-width': 2 }));
  });
  return h('div.dark-zone', { style: { border: '1px solid var(--line)', borderRadius: '12px', padding: '8px', background: '#0a0f16' } }, s,
    h('div.legend', { style: { fontSize: '11px' } }, h('span', h('i', { style: { background: '#36d7c7' } }), 'entry / add'), h('span', h('i', { style: { background: '#f4c24f' } }), 'exit fills'), h('span', h('i', { style: { background: 'var(--warn)' } }), 'candle-four deadline')));
}

// ---------------------------------------------------------------- quick logs
function openSkip() {
  const wl = ctxRef.state.settings.watchlist;
  const f = { symbol: wl[0], setup: null, grade: 'C', direction: null, note: '', taken: false };
  const m = modal({ title: 'Log a skipped setup', icon: 'hand',
    body: h('div.col', { style: { gap: '14px' } },
      h('p.dim', 'Five fields, fifteen seconds. Skipped trades are excluded from every statistic. In month one they tell you whether your problem is finding setups or pulling the trigger.'),
      field('Symbol', segmented(wl, f.symbol, (v) => { f.symbol = v; })),
      field('Setup', segmented(['Spring', 'Upthrust', 'Sweep', 'Failed retest'], f.setup, (v) => { f.setup = v; })),
      h('div.row.wrap', { style: { gap: '18px' } }, field('Grade', segmented('ABCD'.split(''), f.grade, (v) => { f.grade = v; }, 'grade')), field('Direction', segmented(['Long', 'Short'], f.direction, (v) => { f.direction = v; }))),
      field('Why skipped', h('textarea.input', { placeholder: 'e.g. Range gate failed at 4.1x ATR; OI flat on the break.', oninput: (e) => { f.note = e.target.value; } }))),
    foot: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), h('button.btn.xp', { onclick: async (e) => {
      if (!f.setup) { toast('Pick the setup', '', 'warn'); return; }
      await api.post('/api/trades', f); ctxRef.celebrateXP(25, e.target); toast('Pass logged', '+25 XP. Sitting still is a skill.', 'xp'); m.close(); await load(); draw(); ctxRef.refresh();
    } }, icon('check', 'sm'), 'Log it (+25 XP)')],
    onClose: () => { if (ctxRef.params[0]) history.replaceState(null, '', '#/journal'); } });
}

function openManual() {
  const now = new Date(); const p = (n) => String(n).padStart(2, '0');
  const e0 = etParts(now.getTime());
  const f = { symbol: ctxRef.state.settings.watchlist[0], date: e0.date, time_et: e0.time, direction: 'Long', taken: true };
  const inp = (k, attrs = {}) => h('input.input', { value: f[k] ?? '', oninput: (e) => { f[k] = e.target.value; }, ...attrs });
  const m = modal({ title: 'Manual trade', icon: 'pencil',
    body: h('div.col', { style: { gap: '12px' } },
      h('p.dim', 'For trades the exchange feed cannot see. Exchange trades record themselves; do not double-log them.'),
      h('div.grid.g3', { style: { gap: '10px' } }, field('Symbol', inp('symbol')), field('Date (Eastern)', inp('date', { placeholder: 'YYYY-MM-DD' })), field('Time (Eastern, 24h)', inp('time_et', { placeholder: 'HH:MM' })),
        field('Direction', segmented(['Long', 'Short'], f.direction, (v) => { f.direction = v; })), field('Entry', inp('entry', { class: 'input num' })), field('Stop', inp('stop', { class: 'input num' })),
        field('Exit', inp('exit', { class: 'input num' })), field('Qty', inp('qty', { class: 'input num' })), field('Leverage', inp('leverage', { class: 'input num' })))),
    foot: [h('button.btn.ghost', { onclick: () => m.close() }, 'Cancel'), h('button.btn.primary', { onclick: async () => {
      try {
        const ms = etToUtcMs(f.date, f.time_et); const u = new Date(ms); const p2 = (n) => String(n).padStart(2, '0');
        if (Number.isNaN(ms)) throw new Error('Date must look like 2026-09-23 and time like 21:30.');
        const { time_et, ...rest } = f;
        const r = await api.post('/api/trades', { ...rest, date: `${u.getUTCFullYear()}-${p2(u.getUTCMonth() + 1)}-${p2(u.getUTCDate())}`, time_utc: `${p2(u.getUTCHours())}:${p2(u.getUTCMinutes())}` }); m.close(); await load(); draw(); openTrade(r.data.id); } catch (e) { toast('Not saved', e.message, 'alert'); }
    } }, 'Create and review')],
    onClose: () => { if (ctxRef.params[0]) history.replaceState(null, '', '#/journal'); } });
}
