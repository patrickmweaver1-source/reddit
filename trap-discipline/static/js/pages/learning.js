// Learning: the app's report card on its own calls, your edge profile, the
// weekly review, and personal blocks you approve (stricter only).
import { api } from '../api.js';
import { h, icon, fmt, clear, put, toast } from '../ui.js';

let root = null; let D = null; let covCard = null;
const SRC = { ai: 'AI scan', checklist: 'Checklist' };
const OUTCOME = { target: 'Hit +2R target', stop: 'Stopped out', timeout: 'Closed at 8 hours', no_fill: 'Never triggered', invalidated: 'Broke the stop before the reclaim', gap: 'Set aside: missing candles', no_data: 'Set aside: no data', pending: 'Set aside' };
const DIM = { setup: 'Setup', symbol: 'Coin', direction: 'Side', session: 'Session', grade: 'Grade', trend: 'Trend', break: 'Rule break', 'setup+symbol': 'Setup on coin' };

let COV = null;

export async function render(el) {
  root = el;
  D = await api.get('/api/learning');
  draw();
  try { COV = await api.get('/api/learning/comovement'); drawCov(); } catch (e) { /* watchlist may still be loading candles */ }
}

async function act(fn, msg) {
  try { D = await fn(); draw(); if (msg) toast(msg[0], msg[1], 'good'); }
  catch (e) { toast('Could not do that', e.message, 'warn'); }
}

function draw() {
  clear(root);
  const p = D.profile; const card = D.scorecard; const rev = D.review;
  put(root,
    h('div.page-head', h('div', h('div.eyebrow', 'Learning'), h('h1', 'What your trades and the app\'s calls are teaching'),
      h('div.sub', 'Everything here is worked out on your laptop. The AI scan gets only a short summary of these patterns, in R and counts, never balances, sizes, dollars or a trade list.')),
      h('div.actions', h('button.btn.primary', { onclick: () => act(() => api.post('/api/learning/review').then(r => r.data), ['Review updated', 'Scroll down for this week\'s review.']) }, icon('refresh-cw', 'sm'), 'Run the review now'))),

    D.proposals.length ? h('div.card', { style: { borderColor: 'var(--s1)', marginBottom: '16px' } },
      h('div.card-h', h('h3', icon('gavel'), 'Proposed personal blocks')),
      h('div.help', { style: { marginBottom: '8px' } }, 'Each one only makes your rules stricter. Nothing applies until you approve it, and you can remove it any time.'),
      D.proposals.map(r => h('div.row', { style: { padding: '10px 0', borderTop: '1px solid var(--line)', gap: '10px', flexWrap: 'wrap' } },
        icon('ban'), h('div', { style: { flex: 1, minWidth: '200px' } }, h('b', `Stop taking ${r.label}`), h('div.muted', { style: { fontSize: '12px' } }, r.reason)),
        h('button.btn.sm', { onclick: () => act(() => api.post(`/api/learning/restrictions/${r.id}/approve`).then(x => x.data), ['Block approved', 'The checklist and AI scan will now say NO TRADE for this pattern.']) }, icon('check', 'sm'), 'Approve'),
        h('button.btn.sm.ghost', { onclick: () => act(() => api.post(`/api/learning/restrictions/${r.id}/dismiss`).then(x => x.data)) }, 'Not now')))) : null,

    h('div.learn-grid',
      h('div.card', h('div.card-h', h('h3', icon('stamp'), 'Report card: the app\'s own calls')),
        h('div.help', `Each AI scan and checklist verdict is replayed on the candles that followed: +${D.thresholds.target_r}R target, -1R stop, or the price after ${D.thresholds.hold_hours} hours, after fees. ${card.pending} call(s) still waiting on the market.`),
        card.lines.length ? h('ul', { style: { margin: '10px 0 0', paddingLeft: '18px' } }, card.lines.map(l => h('li', { style: { marginBottom: '6px' } }, l)))
          : h('div.muted', { style: { marginTop: '10px' } }, 'Needs at least 3 scored calls of one kind. Run the checklist or AI scan and check back after about 10 hours.'),
        card.rows.length ? h('table.tbl', { style: { marginTop: '12px' } }, h('thead', h('tr', h('th', 'Call'), h('th.num', 'Scored'), h('th.num', 'Never triggered'), h('th.num', 'Avg'), h('th.num', 'Hit target'))),
          h('tbody', card.rows.map(r => h('tr', h('td', `${SRC[r.source]}: ${r.verdict}`), h('td.num', r.n), h('td.num', r.never_triggered),
            h('td.num', { class: r.avg_r > 0 ? 'good' : r.avg_r < 0 ? 'bad' : '' }, fmt.r(r.avg_r)), h('td.num', r.target_rate == null ? '—' : `${Math.round(r.target_rate * 100)}%`))))) : null),

      h('div.card', h('div.card-h', h('h3', icon('brain'), 'Your edge profile')),
        h('div.help', `From ${p.trades} closed trade(s), overall ${fmt.r(p.overall.avg_r)} per trade. Each pattern is graded by how much evidence stands behind it: an observation is an early signal, a candidate has survived a correction for the many patterns checked, and a validated pattern also held up on trades set aside after it was spotted.`),
        p.counts ? evidenceLedger(p.counts) : null,
        section('Leaks (costing you)', p.leaks, 'bad'),
        section('Edges', p.edges, 'good'),
        (!p.leaks.length && !p.edges.length) ? h('div.muted', { style: { marginTop: '10px' } }, 'No clear pattern yet. That usually takes a few dozen journaled trades.') : null)),

    registryCard(D.registry),
    stabilityCard(D.stability),
    ablationCard(D.ablation),
    executionCard(D.execution),

    rev ? h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('h3', icon('calendar-days'), `Weekly review, ${rev.week}`), h('span.muted', { style: { marginLeft: 'auto', fontSize: '12px' } }, fmt.local(rev.created_at))),
      h('div.grid.g4', { style: { gap: '10px', marginBottom: '12px' } },
        tile('Trades this week', rev.this_week.trades), tile('Average', fmt.r(rev.this_week.avg_r)),
        tile('Winners', rev.this_week.win_rate == null ? '—' : `${Math.round(rev.this_week.win_rate * 100)}%`), tile('Rule breaks', rev.this_week.rule_breaks)),
      h('div.callout', { style: { padding: '12px 14px', borderRadius: '12px', background: 'rgba(139,123,255,.10)', border: '1px solid var(--line)', marginBottom: '10px' } },
        h('div.eyebrow', 'The one change'), h('div', { style: { marginTop: '4px', fontWeight: 600 } }, rev.one_change)),
      list('What worked', rev.what_worked), list('What is leaking', rev.leaking), list('Report card', rev.report_card))
      : h('div.card', { style: { marginTop: '16px' } }, h('div.muted', 'The weekly review writes itself every Sunday. Press "Run the review now" to see it today.')),

    (covCard = h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('h3', icon('scale'), 'Coin relationships')),
      h('div.muted', { style: { marginTop: '10px' } }, 'Working this out from your watchlist’s recent 15-minute candles…'))),

    h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('h3', icon('shield-check'), 'Personal blocks in force')),
      D.restrictions.length ? D.restrictions.map(r => h('div.row', { style: { padding: '8px 0', borderTop: '1px solid var(--line)', gap: '10px' } },
        icon('ban'), h('div', { style: { flex: 1 } }, h('b', `No ${r.label}`), h('div.muted', { style: { fontSize: '12px' } }, `${r.reason}. Approved ${fmt.local(r.approved_at)}.`)),
        h('button.btn.sm.ghost', { onclick: () => act(() => api.post(`/api/learning/restrictions/${r.id}/remove`).then(x => x.data), ['Block removed', '']) }, icon('trash-2', 'sm'), 'Remove')))
        : h('div.muted', 'None. Approved proposals show up here and make the checklist and AI scan say NO TRADE for that pattern.')),

    h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('h3', icon('activity'), 'Recent calls')),
      D.recent_calls.length ? h('div', { style: { overflowX: 'auto' } }, h('table.tbl', h('thead', h('tr', h('th', 'When'), h('th', 'From'), h('th', 'Coin'), h('th', 'Call'), h('th', 'Setup'), h('th', 'Result'), h('th.num', 'R'))),
        h('tbody', D.recent_calls.map(c => h('tr', h('td.mono', fmt.local(c.at)), h('td', SRC[c.source]), h('td', c.symbol), h('td', c.verdict),
          h('td', [c.setup, c.direction].filter(Boolean).join(' ') || '—'),
          h('td', c.status === 'open' ? 'Waiting on the market' : OUTCOME[c.outcome] || 'Not scorable (no entry and stop)'),
          h('td.num', { class: c.outcome_r > 0 ? 'good' : c.outcome_r < 0 ? 'bad' : '' }, c.outcome_r == null ? '—' : fmt.r(c.outcome_r)))))))
        : h('div.muted', 'No calls yet.')));
  if (COV) drawCov();
}

function drawCov() {
  if (!covCard) return;
  const head = h('div.card-h', h('h3', icon('scale'), 'Coin relationships'));
  const hist = COV.history || { checks: 0, min_checks_for_trend: 5, pairs: [] };
  const byPair = {};
  hist.pairs.forEach(x => { byPair[`${x.a}|${x.b}`] = x; });
  const help = h('div.help', { style: { marginBottom: '4px' } },
    `Worked out purely from your watchlist’s 15-minute candles. Two coins nearly always move together, so a real lead-lag has to add predictive power beyond that shared movement: each candidate lag (up to ${COV.max_lag_candles} candles) is fit as a regression and kept only if the lag term keeps helping across rolling out-of-sample blocks (walk-forward), never one global fit. `
    + `A pair needs at least ${COV.min_samples} matching candles behind it. `
    + `A snapshot is saved once a day automatically, so this builds a track record over time: ${hist.checks} day(s) tracked so far` + (hist.checks < hist.min_checks_for_trend ? ` (needs ${hist.min_checks_for_trend}+ before calling a pair reliable).` : '.'));
  if (!COV.pairs || !COV.pairs.length) {
    covCard.replaceChildren(head, help, h('div.muted', { style: { marginTop: '8px' } },
      COV.symbols_checked && COV.symbols_checked.length < 2
        ? 'Add a second coin to your watchlist to compare price movement between coins.'
        : 'No solid relationship yet today. That usually needs a few days of candles once your watchlist coins have enough history in common.'));
    return;
  }
  covCard.replaceChildren(head, help,
    h('div', { style: { marginTop: '10px' } }, COV.pairs.map(p => {
      const hp = byPair[`${p.a}|${p.b}`];
      let track;
      if (!hp || hp.checks < hist.min_checks_for_trend) {
        track = `Tracked on ${hp ? hp.hits : 1} of ${hist.checks || 1} day(s) so far — check back after a few more days to see if this holds up.`;
      } else {
        track = `Held on ${hp.hits} of the last ${hp.checks} daily checks (${Math.round(hp.direction_agreement * 100)}% same direction, ${Math.round(hp.lag_agreement * 100)}% same lag)`
          + (hp.established ? ', a track record established over time.' : '.');
      }
      const stat = p.lead_lag
        ? `lead-lag adds ${(p.lead_lag.incr_r2 * 100).toFixed(2)}% out-of-sample, helped in ${p.lead_lag.folds_improved}/${p.lead_lag.folds} blocks · co-move r = ${p.r}, ${p.n} candles`
        : `co-move r = ${p.r}, ${p.n} candles`;
      return h('div.row', { style: { padding: '8px 0', borderTop: '1px solid var(--line)', gap: '10px' } },
        icon(p.lead_lag ? 'arrow-right' : p.direction === 'same' ? 'arrow-up-right' : 'arrow-down-right', 'sm'),
        h('div', { style: { flex: 1 } }, h('div', p.text),
          h('div.muted', { style: { fontSize: '12px', marginTop: '2px' } }, stat),
          h('div.muted', { style: { fontSize: '12px', marginTop: '2px' } }, track)));
    })));
}

const TIER_CHIP = { validated: ['confirmed', 'long'], candidate: ['candidate', ''], observation: ['early signal', 'short'] };
function tierChip(tier) {
  const t = TIER_CHIP[tier]; if (!t) return null;
  return h(`span.chip${t[1] ? '.' + t[1] : ''}`, { style: { marginLeft: '6px' } }, t[0]);
}
function section(title, rows, cls) {
  if (!rows.length) return null;
  return h('div', { style: { marginTop: '12px' } }, h('div.eyebrow', title),
    h('table.tbl', h('tbody', rows.slice(0, 6).map(b => h('tr',
      h('td', h('span.chip', { style: { marginRight: '6px' } }, DIM[b.dim] || b.dim), b.label, tierChip(b.tier)),
      h('td.num', `${b.n}`), h(`td.num.${cls}`, fmt.r(b.avg_r)), h('td.num.muted', `${Math.round(b.win_rate * 100)}%`))))));
}
function evidenceLedger(c) {
  const cell = (label, val, note) => h('div', { style: { padding: '8px 10px', borderRadius: '10px', background: 'rgba(var(--ov),0.027)', border: '1px solid var(--line)' } },
    h('div.eyebrow', label), h('div', { style: { fontFamily: 'var(--display)', fontSize: '20px', fontWeight: 700 } }, `${val}`), note ? h('div.muted', { style: { fontSize: '11px' } }, note) : null);
  return h('div', { style: { marginTop: '10px' } },
    h('div.grid.g4', { style: { gap: '8px' } },
      cell('Patterns tested', c.tested, 'groups with enough trades'),
      cell('Early signals', c.observations, 'noticed, not confirmed'),
      cell('Candidates', c.candidates, `survived the ${Math.round(c.fdr_q * 100)}% false-discovery correction`),
      cell('Validated', c.validated, 'confirmed on set-aside trades')),
    h('div.help', { style: { marginTop: '6px' } }, `Because ${c.tested} patterns were checked at once, a few will look good by luck. Only the ${c.candidates} candidate(s) survived a correction for that, and only ${c.validated} has been confirmed on trades set aside after it was spotted.`));
}
function list(title, items) {
  if (!items || !items.length) return null;
  return h('div', { style: { marginTop: '8px' } }, h('div.eyebrow', title), h('ul', { style: { margin: '4px 0 0', paddingLeft: '18px' } }, items.map(x => h('li', x))));
}
function tile(label, val) {
  return h('div', { style: { padding: '10px 12px', borderRadius: '12px', background: 'rgba(var(--ov),0.027)', border: '1px solid var(--line)' } },
    h('div.eyebrow', label), h('div', { style: { fontFamily: 'var(--display)', fontSize: '22px', fontWeight: 700, marginTop: '2px' } }, val));
}
function ablationCard(ab) {
  if (!ab) return null;
  const head = h('div.card-h', h('h3', icon('layers'), 'Which checklist signals actually help'));
  if (!ab.signals || !ab.signals.length) return h('div.card', { style: { marginTop: '16px' } }, head, h('div.muted', ab.note));
  return h('div.card', { style: { marginTop: '16px' } }, head,
    h('div.help', { style: { marginBottom: '8px' } }, ab.note),
    h('div', { style: { overflowX: 'auto' } }, h('table.tbl',
      h('thead', h('tr', h('th', 'Signal'), h('th.num', 'With'), h('th.num', 'Without'), h('th.num', 'Lift'), h('th.num', 'On A/B setups'))),
      h('tbody', ab.signals.map(s => h('tr',
        h('td', s.name, s.redundant ? h('span.chip.short', { style: { marginLeft: '6px' } }, 'redundant') : null),
        h('td.num', { class: s.with_avg > 0 ? 'good' : 'bad' }, `${fmt.r(s.with_avg)} (${s.with_n})`),
        h('td.num', { class: s.without_avg > 0 ? 'good' : 'bad' }, `${fmt.r(s.without_avg)} (${s.without_n})`),
        h('td.num', { class: s.lift > 0 ? 'good' : s.lift < 0 ? 'bad' : '' }, fmt.r(s.lift)),
        h('td.num', s.conditional ? h('span', { class: s.conditional.lift > 0 ? 'good' : 'bad' }, `${fmt.r(s.conditional.lift)}`) : h('span.muted', '—'))))))));
}
function stabilityCard(mat) {
  if (!mat || !mat.length) return null;
  return h('div.card', { style: { marginTop: '16px' } },
    h('div.card-h', h('h3', icon('scale'), 'Regime-stability matrix')),
    h('div.help', { style: { marginBottom: '8px' } }, 'For each pattern strong enough to matter, does it hold up across conditions, or only in the one it was found in? A split that flips from win to loss means the pattern is fragile, whatever its overall average says.'),
    mat.map(p => h('div', { style: { padding: '10px 0', borderTop: '1px solid var(--line)' } },
      h('div.row', { style: { gap: '6px', alignItems: 'center', marginBottom: '6px' } },
        h('b', p.label), tierChip(p.tier), h(`span.chip${p.kind === 'leak' ? '.short' : '.long'}`, p.kind)),
      h('div', { style: { overflowX: 'auto' } }, h('table.tbl', h('tbody', p.splits.map(s => h('tr',
        h('td', s.name),
        h('td', `${s.a_label}: `, h('span.mono', { class: s.a_avg > 0 ? 'good' : 'bad' }, fmt.r(s.a_avg)), h('span.muted', ` (${s.a_n})`)),
        h('td', `${s.b_label}: `, h('span.mono', { class: s.b_avg > 0 ? 'good' : 'bad' }, fmt.r(s.b_avg)), h('span.muted', ` (${s.b_n})`)),
        h('td', s.held ? h('span.chip.long', 'held') : h('span.chip.short', 'flips'))))))))));
}
function executionCard(ex) {
  if (!ex) return null;
  const head = h('div.card-h', h('h3', icon('crosshair'), 'Execution quality'));
  if (!ex.n) return h('div.card', { style: { marginTop: '16px' } }, head, h('div.muted', ex.note));
  const cmp = (real, model) => real == null ? '—' : `${real} bps realized vs ${model} bps assumed`;
  return h('div.card', { style: { marginTop: '16px' } }, head,
    h('div.help', { style: { marginBottom: '8px' } }, 'How far your actual fills landed from where each trade was meant to enter (its checklist plan, or the price captured at entry). Read-only - measured from fills already recorded.'),
    h('div.grid.g4', { style: { gap: '8px' } },
      tile('Median drag', `${ex.median_drag_bps} bps`), tile('Median drag (R)', fmt.r(ex.median_drag_r)),
      tile('Worst (R)', fmt.r(ex.worst_drag_r)), tile('Trades measured', ex.n)),
    h('div.grid.g2', { style: { gap: '8px', marginTop: '8px' } },
      h('div', { style: { padding: '8px 10px', borderRadius: '10px', background: 'rgba(var(--ov),0.027)', border: '1px solid var(--line)' } },
        h('div.eyebrow', 'Majors'), h('div.mono', { style: { fontSize: '13px' } }, cmp(ex.realized_bps.major, ex.modeled_bps.major))),
      h('div', { style: { padding: '8px 10px', borderRadius: '10px', background: 'rgba(var(--ov),0.027)', border: '1px solid var(--line)' } },
        h('div.eyebrow', 'Thin assets'), h('div.mono', { style: { fontSize: '13px' } }, cmp(ex.realized_bps.thin, ex.modeled_bps.thin)))),
    h('div.help', { style: { marginTop: '8px' } }, ex.note));
}
const REG_STATUS = { watching: ['watching', ''], confirmed: ['confirmed', 'long'], failed: ['did not hold up', 'short'] };
function registryCard(reg) {
  if (!reg) return null;
  const rows = reg.rows || [];
  return h('div.card', { style: { marginTop: '16px' } },
    h('div.card-h', h('h3', icon('shield-check'), 'Prospective edge registry')),
    h('div.help', { style: { marginBottom: '8px' } }, `When a pattern first looks real, it is frozen here and judged only on the next ${reg.reserve_n} matching trades, which happen after it was spotted, so it cannot be a pattern found by luck in old data. Only a confirmed row counts as a real edge or leak.`),
    rows.length ? h('table.tbl', h('thead', h('tr', h('th', 'Pattern'), h('th', 'Found as'), h('th.num', 'At discovery'), h('th.num', 'Set-aside trades'), h('th', 'Status'))),
      h('tbody', rows.map(r => {
        const st = REG_STATUS[r.status] || [r.status, ''];
        const prog = r.status === 'watching' ? `${r.reserved_so_far || 0} / ${reg.reserve_n}` : `${r.confirm_n != null ? r.confirm_n : '—'}${r.confirm_avg_r != null ? ` (${fmt.r(r.confirm_avg_r)})` : ''}`;
        return h('tr', h('td', r.label), h('td', h(`span.chip${r.kind === 'leak' ? '.short' : '.long'}`, r.kind)),
          h('td.num', { class: r.discovery_avg_r > 0 ? 'good' : 'bad' }, fmt.r(r.discovery_avg_r)),
          h('td.num', prog), h('td', h(`span.chip${st[1] ? '.' + st[1] : ''}`, st[0])));
      })))
      : h('div.muted', 'Nothing frozen yet. A pattern is registered here once it reaches the candidate tier above.'));
}
