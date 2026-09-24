// Playbook & coach: the rules, the four setups, thresholds, the monthly review, and the coach log.
import { api } from '../api.js';
import { h, icon, fmt, clear, toast, confetti, confirmBox, numInput, put, toggle } from '../ui.js';
import { diagBars } from '../charts.js';
import { setupDiagram } from './checklist.js';

let root = null; let ctxRef = null; let PB = null; let ST = null; let edits = null; let notes = { worked: '', broke: '', change: '' };

const TH_LABELS = {
  risk_pct: ['Risk per trade', '%'], liq_buffer_min: ['Min liquidation buffer', 'stop widths'], no_expansion_candles: ['Expansion deadline', 'candles'],
  range_atr_min: ['Range gate: height', 'x ATR'], range_stop_min: ['Range gate: height', 'x stop'], thin_range_pct_min: ['Thin-asset width floor', '% of price'],
  cost_pct_of_risk_max: ['Cost gate ceiling', '% of risk'], log_within_minutes: ['Log window', 'minutes'],
  pen_floor_atr: ['Penetration floor', 'ATR'], pen_floor_atr_thin: ['Penetration floor (thin)', 'ATR'], pen_abandon_atr: ['Abandon line', 'ATR'],
  window_min_candles: ['Decision window min', 'candles'], window_max_candles: ['Decision window max', 'candles'], funding_baseline_pct: ['Funding baseline', '% per 8h'],
  funding_stretched_pct: ['Funding stretched', '% per 8h'], thin_hours_start_utc: ['Thin window start', 'UTC hour'], thin_hours_end_utc: ['Thin window end', 'UTC hour'],
  slippage_pct_major: ['Slippage, majors', '% per side'], slippage_pct_thin: ['Slippage, thin assets', '% per side (assumption)'], taker_fee_pct: ['Taker fee fallback', '% per side'],
  maker_fee_pct: ['Maker fee fallback', '% per side'], addon1_trigger_r: ['Add-on 1 trigger', 'R'], addon1_fraction: ['Add-on 1 size', 'x initial'],
  addon2_trigger_r: ['Add-on 2 trigger', 'R'], addon2_fraction: ['Add-on 2 size', 'x initial'], risk_tolerance_pct: ['Risk tolerance before violation', '% over plan'],
};

export async function render(el, ctx) {
  root = el; ctxRef = ctx;
  [PB, ST] = await Promise.all([api.get('/api/playbook'), api.get('/api/stats')]);
  edits = null;
  draw();
}

function draw() {
  clear(root);
  const rev = PB.review; const open = !!rev.open;
  const counts = {};
  for (const v of ST.violations) if (v.rule) counts[v.rule] = (counts[v.rule] || 0) + v.n;
  if (open && !edits) edits = { rules: JSON.parse(JSON.stringify(PB.rules)), setups: JSON.parse(JSON.stringify(PB.setups)), thresholds: { ...PB.thresholds } };
  put(root, 
    h('div.page-head', h('div', h('div.eyebrow', `Playbook v${PB.id} · ${PB.note || ''}`), h('h1', 'If it is not on this page, it is not a trade'),
      h('div.sub', 'Rule changes happen at the monthly review, never during a session (rule 11). Everything here is locked until you open this month\'s review.')),
      h('div.actions', open ? h('span.chip.xp', icon('lock-open', 'sm'), 'Monthly review open') :
        rev.can_start ? h('button.btn.xp', { onclick: startReview }, icon('calendar-days', 'sm'), `Start ${rev.month} review`) :
          h('span.chip', icon('lock', 'sm'), rev.done_this_month ? `Review done for ${rev.month}` : 'Locked'))),
    open ? reviewPanel() : h('div.lockbanner', { style: { marginBottom: '16px' } }, icon('lock'), h('div', h('b', 'Locked. '), 'Want to change a threshold because of today\'s trade? That is exactly what rule 11 prevents. Write it down in a trade note and bring it to the monthly review.')),
    tuneCard(),
    h('div.grid.g3', { style: { marginTop: '16px' } }, (open ? edits.rules : PB.rules).map((r, i) => ruleCard(r, i, counts[r.n] || 0, open))),
    h('h2', { style: { margin: '26px 0 12px' } }, 'The four setups'),
    h('div.grid.g4', (open ? edits.setups : PB.setups).map((s, i) => setupCard(s, i, open))),
    h('h2', { style: { margin: '26px 0 6px' } }, 'Thresholds'),
    h('div.dim', { style: { marginBottom: '12px' } }, 'Every number here is a starting hypothesis, not a validated constant. Thirty calibrated trades turn guesses into rules.'),
    h('div.card', h('div.grid.g4', { style: { gap: '10px' } }, Object.entries(TH_LABELS).map(([k, [lbl, unit]]) => {
      const v = (open ? edits.thresholds : PB.thresholds)[k];
      return h('div', { style: { padding: '10px 12px', borderRadius: '11px', background: 'var(--panel-2)', border: '1px solid var(--line)' } },
        h('div.muted', { style: { fontSize: '11.5px' } }, lbl),
        open ? numInput(v, { style: { marginTop: '6px' }, onchange: (e) => { edits.thresholds[k] = +e.target.value; } }) : h('div', { style: { marginTop: '4px' } }, h('b.mono', { style: { fontSize: '17px' } }, v), h('span.muted', { style: { fontSize: '11.5px', marginLeft: '6px' } }, unit)));
    }))),
    h('div.grid.g2', { style: { marginTop: '16px' } },
      h('div.card', h('div.card-h', h('h3', icon('scroll-text'), 'Version history')),
        h('table.tbl', h('tbody', PB.history.map(v => h('tr', h('td.mono', `v${v.id}`), h('td.mono', fmt.local(v.ts)), h('td', v.note || '')))))),
      h('div.card', h('div.card-h', h('h3', icon('brain'), 'Coach log'), h('div.right', h('button.btn.sm.ghost', { onclick: async () => { await api.post('/api/coach/ack', {}); await ctxRef.refresh(); toast('All read', '', 'good'); } }, 'Mark all read'))),
        h('div', { style: { maxHeight: '420px', overflowY: 'auto' } }, (ctxRef.state.coach || []).map(m => ctxRef.coachItem(m))))));
}

function ruleCard(r, i, n, open) {
  return h('div.card', { style: { display: 'flex', gap: '14px' } },
    h('div', { style: { fontFamily: 'var(--display)', fontSize: '30px', fontWeight: 700, color: 'var(--accent)', lineHeight: 1, minWidth: '34px' } }, r.n),
    h('div', { style: { flex: 1 } },
      open ? h('input.input', { value: r.title, onchange: (e) => { edits.rules[i].title = e.target.value; } }) : h('h3', r.title),
      open ? h('textarea.input', { style: { marginTop: '8px', minHeight: '64px' }, onchange: (e) => { edits.rules[i].text = e.target.value; } }, r.text) : h('p.dim', { style: { margin: '6px 0 0', fontSize: '13px' } }, r.text),
      h('div', { style: { marginTop: '10px' } }, n ? h('span.chip.short', icon('shield-alert', 'sm'), `${n} finding${n > 1 ? 's' : ''} logged`) : h('span.chip.long', icon('shield-check', 'sm'), 'no findings'))));
}
function setupCard(s, i, open) {
  const f = (k, lbl) => h('div', { style: { marginTop: '8px' } }, h('div.muted', { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' } }, lbl),
    open ? h('input.input', { value: s[k] || '', onchange: (e) => { edits.setups[i][k] = e.target.value; } }) : h('div', { style: { fontSize: '13px' } }, s[k] || '—'));
  const perf = ST.diagnostics.setup[s.name];
  return h('div.card', h('div.setup-card', { style: { border: 0, padding: 0, background: 'transparent', cursor: 'default' } }, setupDiagram(s.name)), h('h3', s.name),
    f('trigger', 'Entry trigger'), f('invalidation', 'Invalidation'), f('target', 'Target'), f('notes', 'Notes'),
    perf ? h('div.muted', { style: { fontSize: '12px', marginTop: '10px' } }, `${perf.n} trades · avg ${fmt.r(perf.avg_r)}`) : null);
}

async function startReview() {
  if (!(await confirmBox('Open the monthly review?', 'This unlocks rules and thresholds for editing. Once you complete it, they lock again until next month. Do this with the Dashboard diagnostics open, not in the middle of a session.', 'Open review'))) return;
  try { await api.post('/api/review/start'); await render(root, ctxRef); } catch (e) { toast('Cannot open', e.message, 'warn'); }
}

function reviewPanel() {
  const d = ST.diagnostics; const k = ST.kpis;
  const prompts = [
    ['Grade ladder', d.verdicts.grade], ['Setups', d.verdicts.setup], ['Thin hours', d.verdicts.thin],
    ['Penetration floor', `Buckets: ${Object.entries(d.pen).map(([b, v]) => `${b} ${v.n ? fmt.r(v.avg_r) : '—'} (n=${v.n})`).join(' · ')}`],
    ['Candle window', `Buckets: ${Object.entries(d.candles).map(([b, v]) => `${b} ${v.n ? fmt.r(v.avg_r) : '—'} (n=${v.n})`).join(' · ')}`],
    ['Discipline', `Adherence ${Math.round(k.rule_adherence * 100)}% over ${k.trades_taken} trades. Expectancy ${fmt.r(k.expectancy_r)}.`],
  ];
  return h('div.card.xpglow',
    h('div.card-h', h('h3', icon('calendar-days'), `Monthly review · ${PB.review.month}`), h('span.sub', '+250 XP on completion')),
    h('div.grid.g2', h('div', h('div.eyebrow', { style: { marginBottom: '8px' } }, 'What the data says'), prompts.map(([t, x]) => h('div.verdict', h('b', `${t}: `), x)),
      k.trades_taken < 30 ? h('div.warnline', { style: { marginTop: '10px' } }, icon('info', 'sm'), `Only ${k.trades_taken} trades. Change thresholds only with strong evidence; prefer to keep collecting.`) : null),
      h('div.col', { style: { gap: '10px' } },
        h('div.f', 'What worked this month?', h('textarea.input', { oninput: (e) => { notes.worked = e.target.value; } }, notes.worked)),
        h('div.f', 'Which rule broke most, and why?', h('textarea.input', { oninput: (e) => { notes.broke = e.target.value; } }, notes.broke)),
        h('div.f', 'One change for next month (or "none")', h('textarea.input', { oninput: (e) => { notes.change = e.target.value; } }, notes.change)))),
    h('div.row', { style: { marginTop: '14px', justifyContent: 'flex-end', gap: '10px' } },
      h('button.btn', { onclick: async () => {
        try { PB = { ...PB, ...(await api.put('/api/playbook', { ...edits, note: `Monthly review ${PB.review.month}${notes.change ? ': ' + notes.change.slice(0, 120) : ''}` })).data }; toast('Rulebook saved', 'A new version was recorded.', 'good'); await render(root, ctxRef); }
        catch (e) { toast('Not saved', e.message, 'warn'); }
      } }, icon('download', 'sm'), 'Save rule changes'),
      h('button.btn.xp', { onclick: async (e) => {
        if (!notes.worked || !notes.change) { toast('Finish the worksheet', 'Answer "what worked" and "one change" first.', 'warn'); return; }
        await api.post('/api/review/complete', notes); ctxRef.celebrateXP(250, e.target); confetti({ particleCount: 160, spread: 100 });
        toast('Review complete', 'Rules locked until next month. +250 XP.', 'xp'); await ctxRef.refresh(); await render(root, ctxRef);
      } }, icon('check', 'sm'), 'Complete review (+250 XP)')));
}


// ---------------------------------------------------------------- auto-tune
const pct = (v) => (v === null || v === undefined ? 'n/a' : fmt.r(v));
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '?');

function tuneCard() {
  const card = h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('h3', icon('sparkles'), 'Auto-tune zone boundaries')), h('div.skeleton', { style: { height: '110px' } }));
  fillTune(card);
  return card;
}

async function fillTune(card) {
  let T;
  try { T = await api.get('/api/tune'); } catch (e) { card.replaceChildren(h('div.errline', e.message)); return; }
  const refill = () => fillTune(card);
  const redrawAll = async () => { await render(root, ctxRef); };
  const unit = (k) => (k === 'window_max_candles' ? ' candles' : ' ATR');
  const num = (k, v) => (k === 'window_max_candles' ? String(v) : (Number.isInteger(+v) ? (+v).toFixed(1) : String(+v)));
  const last = T.last || {};
  const ev = T.evidence;

  const head = h('div.card-h', h('h3', icon('sparkles'), 'Auto-tune zone boundaries'),
    h('div.right', h(`span.chip${T.enabled ? '.long' : ''}`, T.enabled ? (T.running ? 'scanning…' : 'on') : 'off')));

  const intro = h('p.dim', { style: { marginTop: 0 } },
    'Three times a day, runs the live trap detector over months of Bybit history for your watchlist and checks whether different boundaries would have paid better. ',
    'A change is only proposed when it also wins on the most recent weeks the search never saw. Approving a proposal queues it; like every rule change it only takes effect when you open your next monthly review (rule 11), and never during an open trade. ',
    'Once 30 of your own trades carry the orange fields, they can block any change that would cut away a region where you made money.');

  const toggleRow = h('div.row', { style: { padding: '8px 0', borderBottom: '1px solid var(--line)' } },
    h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 600 } }, 'Scan and propose automatically'),
      h('div.muted', { style: { fontSize: '12px' } }, 'Uses read-only public market data. Rule 11 governs everything: approved proposals queue and apply at your monthly review, same as manual edits.')),
    toggle(T.enabled, async (v) => { await api.put('/api/settings', { auto_tune: v }); toast(v ? 'Auto-tune on' : 'Auto-tune off', v ? 'The first scan starts now. It downloads history and replays it, so allow a few minutes; you can keep using the app.' : '', 'good', 8000); setTimeout(refill, 800); }));

  const statusLine = h('div.row.wrap', { style: { gap: '10px', margin: '10px 0', alignItems: 'center' } },
    h('span.muted', { style: { fontSize: '12.5px' } },
      last.ok_at ? `Last scan ${fmt.local(last.ok_at)}: ${last.result === 'proposal' ? 'proposal made' : 'no change'}` : 'Not scanned yet',
      T.next_at ? ` · next ${fmt.local(T.next_at)}` : ''),
    h('button.btn.sm', { disabled: T.running, onclick: async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Scanning…';
      try { await api.post('/api/tune/scan'); toast('Scan started', 'This takes a minute or two. You can keep using the app.', 'info', 6000); }
      catch (err) { toast('Scan failed to start', err.message, 'warn', 9000); }
      refill();
    } }, icon('refresh-cw', 'sm'), T.running ? 'Scanning…' : 'Scan now'));
  if (T.running) {
    // keep checking until the scan finishes, then say what it found
    setTimeout(async () => {
      if (!card.isConnected) return;
      let N; try { N = await api.get('/api/tune'); } catch { return; }
      if (N.running) { fillTune(card); return; }
      const L = N.last || {};
      if (L.error && (L.failed_at || 0) > (L.ok_at || 0)) toast('Scan failed', L.error, 'warn', 9000);
      else toast(L.result === 'proposal' ? 'Proposal ready' : 'Scan complete', L.result === 'proposal' ? 'Review it below.' : (L.reason || 'No change needed.'), L.result === 'proposal' ? 'xp' : 'info', 9000);
      fillTune(card);
    }, 4000);
  }

  const err = last.error && (!last.ok_at || (last.failed_at || 0) > last.ok_at)
    ? h('div.warnline', icon('triangle-alert', 'sm'), `Last scan failed: ${last.error} It will retry in 30 minutes.`) : null;
  const holdReason = !T.open && last.reason ? h('div.help', { style: { marginBottom: '8px' } }, icon('info', 'sm'), ' ', last.reason) : null;

  // ---- the open proposal
  let proposal = null;
  const P = T.open;
  if (P) {
    const pe = P.evidence || {};
    const ho = pe.holdout || {};
    const rows = Object.entries(P.changes).map(([k, v]) => h('tr', h('td', T.labels[k] || k),
      h('td.num.mono', `${num(k, v.from)}${unit(k)}`), h('td', { style: { textAlign: 'center' } }, icon('arrow-right', 'sm')), h('td.num.mono', { style: { color: 'var(--accent)', fontWeight: 700 } }, `${num(k, v.to)}${unit(k)}`)));
    proposal = h('div', { style: { padding: '14px', borderRadius: '12px', border: '1px solid rgba(54,215,199,.4)', background: 'rgba(54,215,199,.06)', margin: '6px 0 12px' } },
      h('div.row', { style: { justifyContent: 'space-between' } }, h('b', `Proposal · ${fmt.local(P.ts)}`), pe.demo ? h('span.chip', 'DEMO data') : null),
      h('table.tbl', { style: { margin: '8px 0' } }, h('tbody', rows)),
      h('div.grid.g3', { style: { gap: '8px', margin: '8px 0' } },
        kv('Replayed trades', `${pe.events ?? '?'}`, `${day(pe.from)} to ${day(pe.to)}`),
        kv('Now, all history', pct(pe.current_stats && pe.current_stats.avg_r), `${(pe.current_stats && pe.current_stats.trades) || 0} trades would trigger`),
        kv('Proposed, all history', pct(pe.proposed_stats && pe.proposed_stats.avg_r), `${(pe.proposed_stats && pe.proposed_stats.trades) || 0} trades would trigger`)),
      ho.gain_r !== undefined && ho.gain_r !== null ? h('div.help', icon('shield-check', 'sm'),
        ` The deciding test, on the newest ${ho.days || '?'} days of history that the search never saw: ${pct(ho.avg_r_cur)} per trade now vs ${pct(ho.avg_r_new)} proposed, a gain of ${pct(ho.gain_r)} against day-to-day noise of about ±${ho.se !== null && ho.se !== undefined ? ho.se.toFixed(2) : '?'}R.`) : null,
      pe.journal ? h('div.help', icon('notebook-pen', 'sm'),
        pe.journal.n_excluded ? ` Checked against your journal: ${pe.journal.n_excluded} of your ${pe.journal.trades} calibrated trades fall in the region this would cut (${pct(pe.journal.avg_r_excluded)} average), not enough to block it.`
          : ` Checked against your journal: none of your ${pe.journal.trades} calibrated trades fall in the region this would cut.`) :
        h('div.help', icon('notebook-pen', 'sm'), ` Your journal check starts at ${pe.journal_min || 30} calibrated trades (you have ${pe.journal_trades || 0}). Until then, market history alone decides.`),
      T.position_block ? h('div.warnline', { style: { marginTop: '8px' } }, icon('lock', 'sm'), T.position_block) : null,
      !T.review_open ? h('div.help', { style: { marginTop: '8px' } }, icon('lock', 'sm'),
        ' Rule 11: approving this records your decision and queues it. It takes effect when you open your next monthly review, never mid-session.') : null,
      h('div.row', { style: { gap: '10px', marginTop: '12px' } },
        h('button.btn.primary', { disabled: T.open_position, onclick: async () => {
          try {
            const r = await api.post(`/api/tune/${P.id}/apply`);
            const q = r && r.data && r.data.status && (r.data.status.queued || []).some(x => x.id === P.id);
            toast(T.review_open ? 'Applied' : 'Queued for monthly review',
              T.review_open ? 'New rulebook version recorded. You can undo it below.' : 'It takes effect when you open your next monthly review.',
              'good', 8000);
            await ctxRef.refresh(); await redrawAll();
          } catch (e) { toast('Not applied', e.message, 'warn', 9000); refill(); }
        } }, icon('check', 'sm'), T.review_open ? 'Apply now' : 'Queue for monthly review'),
        h('button.btn.ghost', { onclick: async () => {
          try { await api.post(`/api/tune/${P.id}/dismiss`); toast('Dismissed', 'This same change will not be proposed again for a week.', 'info'); refill(); }
          catch (e) { toast('Not dismissed', e.message, 'warn'); refill(); }
        } }, 'Dismiss')));
  }

  // ---- approved-and-queued changes waiting for the next monthly review
  let queued = null;
  if ((T.queued || []).length) {
    queued = h('div', { style: { padding: '12px 14px', borderRadius: '12px', border: '1px solid var(--line)', background: 'rgba(250,178,25,.06)', margin: '6px 0 12px' } },
      h('div.row', { style: { gap: '8px', alignItems: 'center' } }, icon('clock-3', 'sm'), h('b', `${T.queued.length} approved change${T.queued.length === 1 ? '' : 's'} queued for your next monthly review`)),
      h('div.help', { style: { marginTop: '4px' } }, T.review_open ? 'A review is open, so these are being applied now.' : `Open ${PB.review.month ? 'this month’s' : 'a'} review to apply them. They take effect only then (rule 11).`),
      T.queued.map(q => h('div.row', { style: { padding: '6px 0', borderTop: '1px solid var(--line)', gap: '8px', flexWrap: 'wrap' } },
        h('span', { style: { flex: 1 } }, T.describe ? T.describe : Object.entries(q.changes).map(([k, v]) => `${T.labels[k] || k} ${num(k, v.from)}→${num(k, v.to)}${unit(k)}`).join('; ')),
        h('button.btn.sm.ghost', { onclick: async () => {
          try { await api.post(`/api/tune/${q.id}/dismiss`); toast('Removed from the queue', '', 'info'); refill(); }
          catch (e) { toast('Not removed', e.message, 'warn'); }
        } }, 'Remove'))));
  }

  // ---- the evidence chart (latest scan, proposal or not)
  let chart = null;
  if (ev && ev.buckets && ev.events) {
    const gated = Object.values(ev.per_symbol || {}).reduce((a, s) => a + (s.gated_out || 0), 0);
    chart = h('details', { style: { marginTop: '6px' } }, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, 'What the latest scan saw'),
      h('div', { style: { marginTop: '10px' } },
        h('div.muted', { style: { fontSize: '12px', marginBottom: '8px' } },
          `Average replayed result by how deep the break closed, for Springs and Upthrusts reclaimed inside the ${ev.window || T.thresholds.window_max_candles}-candle window (the trades the floor and abandon line decide). ${ev.events} replayed trades in all, ${day(ev.from)} to ${day(ev.to)}. `,
          `Current trap zone: ${T.thresholds.pen_floor_atr} to ${T.thresholds.pen_abandon_atr} ATR (thin assets from ${T.thresholds.pen_floor_atr_thin}).`),
        diagBars(ev.buckets.map(b => ({ label: `${b.label} ATR`, avg_r: b.avg_r, n: b.n })), { minN: 5 }),
        h('div.muted', { style: { fontSize: '11px', marginTop: '4px' } }, 'Grey bars: fewer than 5 trades, too few to read anything into.'),
        ev.trials ? h('div.muted', { style: { fontSize: '11px', marginTop: '4px' } },
          `This scan scored ${ev.trials.combinations_scored} boundary combinations (${ev.trials.with_enough_evidence} with enough trades to read). A proposal is only made when the winner also beats the current boundaries on the newest weeks it never saw, so trying many did not, on its own, earn a change.`) : null,
        h('table.tbl', { style: { marginTop: '10px' } }, h('tbody', Object.entries(ev.per_symbol || {}).map(([sym, v]) => h('tr',
          h('td', sym.replace('USDT', ''), v.thin ? h('span.muted', ' (thin)') : null),
          h('td.num.mono', `${v.events} trades`),
          h('td.muted', { style: { fontSize: '12px' } }, `${v.gated_out || 0} refused by your cost gate (${v.cost_pct}% round trip)`))))),
        gated > ev.events * 3 ? h('div.warnline', { style: { marginTop: '8px' } }, icon('info', 'sm'),
          `Most replayed traps (${gated} of ${gated + ev.events}) fail your rule 8 cost gate: at taker fees, 15-minute stops are usually too tight for costs to stay under ${ctxRef.state.thresholds.cost_pct_of_risk_max}% of risk. That is the playbook working, but it means few setups qualify. Maker (limit) entries or wider structural stops are what pass.`) : null,
        h('div.help', { style: { marginTop: '8px' } }, ev.method)));
  }

  // ---- history with undo
  const hist = (T.history || []).filter(p => p.status !== 'open');
  const lastApplied = hist.find(p => p.status === 'applied');
  const history = hist.length ? h('details', { style: { marginTop: '6px' } }, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, `History (${hist.length})`),
    h('table.tbl', { style: { marginTop: '8px' } }, h('tbody', hist.map(p => h('tr',
      h('td.mono', { style: { fontSize: '12px' } }, fmt.local(p.ts)),
      h('td', { style: { fontSize: '12.5px' } }, Object.entries(p.changes).map(([k, v]) => `${T.labels[k] || k} ${num(k, v.from)} to ${num(k, v.to)}${unit(k)}`).join(', ')),
      h('td', h(`span.chip${p.status === 'applied' ? '.long' : ''}`, p.status)),
      h('td', p === lastApplied ? h('button.btn.sm.ghost', { onclick: async () => {
        if (!(await confirmBox('Undo this change?', 'Restores the previous values as a new rulebook version.'))) return;
        try { await api.post(`/api/tune/${p.id}/revert`); toast('Undone', 'Previous boundaries restored.', 'good'); await ctxRef.refresh(); await redrawAll(); }
        catch (e) { toast('Not undone', e.message, 'warn'); }
      } }, 'Undo') : null)))))) : null;

  card.replaceChildren(...[head, intro, toggleRow, statusLine, err, holdReason, proposal, queued, chart, history].filter(Boolean));
}

function kv(label, value, sub) {
  return h('div', { style: { padding: '8px 10px', borderRadius: '10px', background: 'var(--panel-2)', border: '1px solid var(--line)' } },
    h('div.muted', { style: { fontSize: '11px' } }, label), h('b.mono', { style: { fontSize: '16px' } }, value), sub ? h('div.muted', { style: { fontSize: '11px' } }, sub) : null);
}
