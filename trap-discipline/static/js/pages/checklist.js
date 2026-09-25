// Pre-trade checklist: the gate, not the cheerleader. C1-C4, both gates, grade,
// server-decided verdict, sizing and add-on plan.
import { api } from '../api.js';
import { h, icon, fmt, svg, stateChip, dirChip, clear, segmented, numInput, field, toast, sound, confetti, modal, put } from '../ui.js';

const STEPS = [
  { key: 'session', title: 'Session gate', icon: 'shield-check' },
  { key: 'setup', title: 'Level & setup', icon: 'crosshair' },
  { key: 'c1', title: 'C1 · Obvious level', icon: 'layers' },
  { key: 'c2', title: 'C2 · Recruitment', icon: 'users' },
  { key: 'c3', title: 'C3 · No follow-through', icon: 'hourglass' },
  { key: 'c4', title: 'C4 · Close back inside', icon: 'check-circle-2' },
  { key: 'gates', title: 'Gates & sizing', icon: 'scale' },
  { key: 'verdict', title: 'Verdict', icon: 'gavel' },
];

let S = null; let root = null; let ctxRef = null;
// AI scan state lives outside S so it survives "Start over" and symbol switches
const AI = { status: null, poll: null, tick: null, clock: null, hidden: false, mounted: false };

function fresh(ctx) {
  const wl = ctx.state?.settings?.watchlist || [];
  return {
    step: 0, symbol: ctx.params[0] || wl[0], snap: null, levelPrice: ctx.params[1] ? +ctx.params[1] : null, level: null,
    setup: null, direction: null,
    c1: { checks: {}, score: null }, c2: { checks: {}, score: null }, c3: { checks: {}, score: null }, c4: { checks: {}, score: null, quality: null },
    rangeHigh: null, rangeLow: null, entry: null, stop: null, target: null, sizing: null, result: null,
    oi_confirmed: null, pen_atr: null, candles_to_reclaim: null,
  };
}

export async function render(el, ctx) {
  root = el; ctxRef = ctx;
  if (!S || ctx.params.length) S = fresh(ctx);
  await loadSnap();
  draw();
  AI.mounted = true;
  aiRefresh();
  clearInterval(AI.clock);
  AI.clock = setInterval(() => { if (!AI.status?.running) paintAI(); }, 30000);   // keeps "minutes ago" and the stale warning honest
}
export function destroy() { AI.mounted = false; stopPoll(); clearInterval(AI.clock); AI.clock = null; /* keep S so a half-done checklist survives navigation */ }
export function onEvent(msg) { if (msg.kind === 'ai_scan' && msg.data && msg.data.symbol === S?.symbol) aiRefresh(); }

async function loadSnap() {
  if (!S.symbol) return;
  try { S.snap = await api.get(`/api/market/${S.symbol}`); } catch (e) { S.snap = null; S.snapErr = e.message; }
  if (S.snap && S.levelPrice && !S.level) S.level = (S.snap.levels || []).find(l => Math.abs(l.price - S.levelPrice) / S.levelPrice < 0.0005) || null;
  if (S.snap && !S.level && S.snap.top) S.level = S.snap.top;
  prefillFromLevel();
}
function prefillFromLevel() {
  const lv = S.level; const sn = S.snap;
  if (!sn) return;
  if (sn.range) { S.rangeHigh = S.rangeHigh ?? sn.range.high; S.rangeLow = S.rangeLow ?? sn.range.low; }
  if (S.entry === null && sn.price) S.entry = sn.price;
  if (!lv) { if (S.target === null && S.direction) S.target = S.direction === 'Long' ? S.rangeHigh : S.rangeLow; return; }
  S.setup = S.setup || lv.setup || null;
  S.direction = S.direction || lv.direction || null;
  S.pen_atr = lv.pen_atr ?? S.pen_atr;
  S.candles_to_reclaim = lv.candles_since_break ?? S.candles_to_reclaim;
  if (sn.range) { S.rangeHigh = S.rangeHigh ?? sn.range.high; S.rangeLow = S.rangeLow ?? sn.range.low; }
  if (lv.trigger && S.entry === null) S.entry = lv.state === 'TRIGGERED' ? lv.trigger : sn.price;
  if (S.entry === null) S.entry = sn.price;
  if (lv.extreme && S.stop === null) {
    const tick = sn.tick || 0; const buf = 3 * tick;
    S.stop = S.direction === 'Short' ? lv.extreme + buf : lv.extreme - buf;
  }
  if (S.target === null && S.direction) S.target = S.direction === 'Long' ? S.rangeHigh : S.rangeLow;
}

// ---------------------------------------------------------------- scoring helpers
const total = () => ['c1', 'c2', 'c3', 'c4'].reduce((a, k) => a + (S[k].score ?? 0), 0);
const gradeOf = (t) => t >= 7 ? 'A' : t >= 5 ? 'B' : t >= 3 ? 'C' : 'D';
function disqualifier() {
  const lv = S.level;
  if (S.c3.checks.ran || lv?.state === 'DEAD_RAN') return 'Price cleared a full ATR beyond and held (flag, not trap)';
  if (S.c3.checks.timedout || lv?.state === 'DEAD_TIMED_OUT') return 'Four or more candles beyond with no reclaim (the break is real)';
  if (S.c2.checks.shallow || lv?.state === 'DEAD_SHALLOW') return 'Penetration below the floor line (nobody recruited)';
  if (S.c1.checks.only15) return 'Level only exists on the 15 minute chart';
  if (S.aiDq) return `AI scan: ${S.aiDq}`;
  if (S.step >= 6 && !S.level) return 'No level selected: nothing to trap against';
  if (S.step >= 6 && !S.setup) return 'Not one of the four setups';
  if (S.step >= 7 && !S.stop) return 'No invalidation price: size cannot come from the stop';
  return null;
}
function stepStatus(i) {
  const k = STEPS[i].key;
  if (k === 'session') return i < S.step ? 'done' : '';
  if (['c1', 'c2', 'c3', 'c4'].includes(k)) return S[k].score === 0 ? 'fail' : S[k].score !== null ? 'done' : '';
  if (k === 'setup') return S.setup && S.direction && S.level ? 'done' : '';
  if (k === 'gates') return S.sizing ? 'done' : '';
  if (k === 'verdict') return S.result ? (S.result.verdict === 'GO' ? 'done' : 'fail') : '';
  return '';
}

// ---------------------------------------------------------------- lessons from your own record
const LS = { key: null, data: null };
function lessonsSlot() {
  const key = [S.symbol, S.setup, S.direction].join('|');
  if (LS.key !== key) {
    LS.key = key; LS.data = null;
    const q = new URLSearchParams({ symbol: S.symbol || '', setup: S.setup || '', direction: S.direction || '' });
    api.get(`/api/learning/lessons?${q}`).then(d => {
      if (LS.key !== key) return;
      LS.data = d;
      const el = document.getElementById('lessons-slot');
      if (el) { clear(el); put(el, lessonsBody()); }
    }).catch(() => {});
  }
  return h('div', { id: 'lessons-slot' }, lessonsBody());
}
function lessonsBody() {
  const d = LS.data;
  const exposure = (d && d.exposure) || [];
  if (!d || (!d.lessons.length && !d.blocks.length && !exposure.length)) return null;
  return h('div.card.pad-s', { style: { marginBottom: '14px' } },
    h('div.eyebrow', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, icon('brain', 'sm'), 'From your own record'),
    d.blocks.map(b => h('div.lesson.block', icon('ban', 'sm'), h('span', b))),
    d.lessons.map(l => h(`div.lesson.${l.kind}`, icon(l.kind === 'leak' ? 'triangle-alert' : 'trending-up', 'sm'), h('span', l.text))),
    exposure.map(x => h('div.lesson.leak', icon('scale', 'sm'), h('span', x.text))));
}

function symbolToggle(st) {
  return segmented(st.settings.watchlist, S.symbol, async (v) => { S = { ...fresh(ctxRef), symbol: v }; stopPoll(); AI.status = null; AI.hidden = false; await loadSnap(); draw(); aiRefresh(); });
}

// ---------------------------------------------------------------- layout
function draw() {
  clear(root);
  const st = ctxRef.state;
  put(root, 
    h('div.page-head',
      h('div', h('div.eyebrow', 'Pre-trade checklist'), h('h1', 'Be the gate, not the cheerleader'),
        h('div.sub', 'Most setups should fail. If a component fails, the answer is no trade. No smaller size as a compromise, no waiting for a better entry on the same idea.')),
      h('div.actions', { style: { alignItems: 'center' } },
        h('div', { style: { marginRight: '4px' } }, symbolToggle(st)),
        h('button.btn.primary', { id: 'ai-scan-btn', onclick: aiScan, disabled: !!AI.status?.running }, icon('sparkles', 'sm'), AI.status?.running ? 'Scanning…' : 'Scan with AI'),
        h('span.chip', `Running score ${total()}/8`), h('span', { class: `chip grade-${gradeOf(total())}` }, `Grade ${gradeOf(total())}`),
        h('button.btn.ghost', { onclick: () => { S = fresh(ctxRef); S.symbol = st.settings.watchlist[0]; stopPoll(); AI.status = null; AI.hidden = false; loadSnap().then(() => { draw(); aiRefresh(); }); } }, icon('refresh-cw', 'sm'), 'Start over'))),
    aiSlot(),
    lessonsSlot(),
    h('div.stepper',
      h('div.card.pad-s.steps', STEPS.map((s, i) => {
        const cls = [i === S.step ? 'cur' : '', stepStatus(i)].filter(Boolean).join('.');
        const sc = ['c1', 'c2', 'c3', 'c4'].includes(s.key) && S[s.key].score !== null ? `${S[s.key].score}/2` : '';
        return h(`div.st${cls ? '.' + cls : ''}`, { onclick: () => { S.step = i; draw(); } },
          h('span.n', stepStatus(i) === 'done' ? icon('check', 'sm') : stepStatus(i) === 'fail' ? icon('x', 'sm') : i + 1), h('span', s.title), sc ? h('span.sc', sc) : null);
      }),
        h('div.sep'),
        S.snap ? h('div', { style: { padding: '12px 8px 0', fontSize: '12px' }, class: 'dim' },
          h('div.row.between', h('span', 'Price'), h('b.mono', fmt.px(S.snap.price))),
          h('div.row.between', h('span', 'ATR(14) 15m'), h('b.mono', fmt.px(S.snap.atr15))),
          h('div.row.between', h('span', '4h regime'), h('b', S.snap.regime?.regime)),
          h('div.row.between', h('span', 'Funding 8h'), h('b.mono', fmt.pct(S.snap.funding?.rate_8h_pct, 4))),
          S.snap.liquidity && S.snap.liquidity.state && S.snap.liquidity.state !== 'unknown'
            ? h('div.row.between', { style: { marginTop: '2px' }, title: S.snap.liquidity.note },
                h('span', 'Liquidity'), h('b', { class: S.snap.liquidity.state === 'normal' ? 'good' : 'bad' },
                  S.snap.liquidity.state === 'severely_thin' ? 'severely thin' : S.snap.liquidity.state)) : null) : null),
      h('div.card', { style: { minHeight: '520px' } }, stepBody(), navRow())));
}
function navRow() {
  const last = S.step === STEPS.length - 1;
  return h('div.row', { style: { marginTop: '22px', paddingTop: '16px', borderTop: '1px solid var(--line)' } },
    S.step > 0 ? h('button.btn', { onclick: () => { S.step--; draw(); } }, icon('chevron-left', 'sm'), 'Back') : null,
    h('div', { style: { flex: 1 } }),
    disqualifier() && S.step < 7 ? h('button.btn.danger', { onclick: () => { S.step = 7; draw(); } }, icon('octagon-x', 'sm'), 'Disqualified: see verdict') : null,
    !last ? h('button.btn.primary', { onclick: async () => { S.step++; if (STEPS[S.step].key === 'gates') await calcSize(); draw(); } }, 'Next', icon('chevron-right', 'sm')) : null);
}
function why(text) { return h('div.verdict', { style: { marginTop: '0', marginBottom: '16px' } }, icon('lightbulb', 'sm'), ' ', text); }
function check(key, group, title, desc, auto, negative = false) {
  const on = !!S[group].checks[key];
  return h(`div.check${negative ? '.no' : ''}${on ? '.on' : ''}`, { onclick: () => { S[group].checks[key] = !on; draw(); } },
    h('span.box', on ? icon(negative ? 'x' : 'check', 'sm') : null), h('div', h('div.t', title), desc ? h('div.d', desc) : null), auto !== undefined && auto !== null ? h('span.auto', auto) : null);
}
function scorePick(group, suggested, labels) {
  const cur = S[group].score;
  return h('div', { style: { marginTop: '18px' } },
    h('div.row', { style: { gap: '18px', alignItems: 'center' } },
      h('div.score-pick', [0, 1, 2].map(v => h(`button${cur === v ? '.on' : ''}${cur === v && v === 0 ? '.zero' : ''}`, { onclick: () => { S[group].score = v; sound(v === 0 ? 'warn' : 'tick'); draw(); } }, v))),
      h('div', h('div.eyebrow', 'Score this component'), h('div.suggest', icon('sparkles', 'sm'), suggested !== null ? `Suggested from the data: ${suggested}` : 'Score it yourself from the chart', S.aiScores && S.aiScores[group] != null ? ` · AI scan scored it ${S.aiScores[group]}` : ''),
        h('div.help', { style: { marginTop: '4px' } }, labels))));
}


// ---------------------------------------------------------------- AI scan (Claude)
// One button: the server sends market data only to Claude, which scores every
// checklist item; the server then re-checks the answer with the checklist's
// own rules. The stamp at the Verdict step still decides (rule 11).
const V_STYLE = { 'TRADEABLE NOW': 'go', WATCH: 'watch', 'NO SETUP': 'none', 'STAND DOWN': 'stop' };
const CANDLE_MS = 15 * 60000;

function stopPoll() { clearInterval(AI.poll); clearInterval(AI.tick); AI.poll = null; AI.tick = null; }

async function aiRefresh() {
  if (!S?.symbol) return;
  const sym = S.symbol;
  try { const st = await api.get(`/api/ai/scan/${sym}`); if (!AI.mounted || sym !== S.symbol) return; AI.status = st; }
  catch (e) { if (!AI.mounted) return; AI.status = { error: { message: e.message } }; }
  paintAI();
  if (AI.status?.running && !AI.poll) {
    AI.poll = setInterval(aiRefresh, 2500);
    AI.tick = setInterval(() => { const el = document.getElementById('ai-elapsed'); if (el && AI.status?.started) el.textContent = `${Math.round((Date.now() - AI.status.started) / 1000)}s`; }, 1000);
  } else if (!AI.status?.running && AI.poll) {
    stopPoll();
    if (AI.status?.error) toast('AI scan did not finish', AI.status.error.message, 'warn', 9000);
    else if (AI.status?.last) sound(AI.status.last.result?.verdict === 'TRADEABLE NOW' ? 'stamp' : 'tick');
  }
}

async function aiScan() {
  // The server decides whether an AI is connected (it reads the key from the OS vault).
  // Deciding here from AI.status sent people to Settings whenever that status had not
  // loaded yet (slow page, symbol just switched, Start over) even with a key saved.
  AI.hidden = false;
  try { AI.status = await api.post('/api/ai/scan', { symbol: S.symbol }).then(r => r.data); }
  catch (e) {
    if (e.payload && e.payload.not_connected) { toast('Connect an AI first', 'Settings > AI analyst: paste a Claude API key.', 'info', 8000); ctxRef.go('settings'); return; }
    toast('Scan not started', e.message, 'warn', 8000); return;
  }
  paintAI();
  if (AI.status.running) aiRefresh();
}

function aiSlot() { const el = h('div', { id: 'ai-panel', style: { marginBottom: '16px' } }); queueMicrotask(paintAI); return el; }

function paintAI() {
  const el = document.getElementById('ai-panel'); if (!el) return;
  const btn = document.getElementById('ai-scan-btn');
  if (btn) { btn.disabled = !!AI.status?.running; btn.lastChild.textContent = AI.status?.running ? 'Scanning…' : 'Scan with AI'; }
  el.replaceChildren(...[aiBody()].filter(Boolean));
}

function aiBody() {
  const st = AI.status;
  if (!st) return null;
  if (st.running) {
    return h('div.card.ai-card.ai-run', h('div.row', { style: { gap: '14px' } }, h('span.spinner'),
      h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 600 } }, `Claude is scanning ${st.symbol}…`),
        h('div.muted', { style: { fontSize: '12.5px' } }, st.progress ? `Claude: ${st.progress}` : 'Reading candles, open interest, funding and levels against your checklist. Usually 30 to 90 seconds.')),
      h('b.mono', { id: 'ai-elapsed' }, st.started ? `${Math.round((Date.now() - st.started) / 1000)}s` : '')));
  }
  if (st.any_ai === false && !st.last) {
    return h('div.lockbanner', icon('sparkles'), h('div', h('b', 'AI scan: '), 'connect Claude once in Settings > AI analyst, then press "Scan with AI" for a full checklist read in about a minute.'),
      h('button.btn.sm', { style: { marginLeft: 'auto' }, onclick: () => ctxRef.go('settings') }, 'Set up'));
  }
  const err = st.error ? h('div.errline', { style: { marginBottom: st.last ? '10px' : 0 } }, icon('octagon-x', 'sm'), h('div', h('b', 'Last scan failed: '), st.error.message)) : null;
  if (!st.last) return err;
  if (AI.hidden) {
    const r0 = st.last.result;
    return h('div.row.ai-mini', err, h(`span.ai-v.${V_STYLE[r0.verdict] || 'none'}`, r0.verdict), h('span.dim', { style: { flex: 1 } }, r0.headline),
      h('span.muted', fmt.ago(st.last.at)), h('button.btn.sm.ghost', { onclick: () => { AI.hidden = false; paintAI(); } }, 'Show'));
  }
  return h('div', err, aiResult(st.last));
}

function aiResult(rec) {
  const r = rec.result; const style = V_STYLE[r.verdict] || 'none';
  const age = Date.now() - rec.at;
  const stale = Math.floor(rec.at / CANDLE_MS) !== Math.floor(Date.now() / CANDLE_MS);   // a 15m candle has closed since
  const comps = [['c1', 'C1 level'], ['c2', 'C2 recruitment'], ['c3', 'C3 stall'], ['c4', 'C4 reclaim']];
  const c = r.candidate || {};
  const g = r.gates || {};
  const p = r.plan || {};
  if (rec.local) {
    return h('div.card.ai-card.ai-stop', h('div.row', { style: { gap: '12px' } }, h('span.ai-v.stop', 'STAND DOWN'), h('b', r.headline)),
      h('ul.ai-bullets', (r.breakdown || []).map(b => h('li', b))), h('div.help', 'Answered on this laptop. Nothing was sent to Claude.'));
  }
  return h(`div.card.ai-card.ai-${style}`,
    h('div.card-h', h('h3', icon('sparkles'), 'AI scan'), h('span.sub', `${rec.symbol} at ${fmt.px(rec.price)} · ${fmt.et(rec.at)} ET · ${fmt.ago(rec.at)}${rec.demo ? ' · DEMO data' : ''}`),
      h('div.right', h('button.btn.sm.ghost', { onclick: () => { AI.hidden = true; paintAI(); } }, 'Hide'))),
    stale ? h('div.warnline', { style: { marginBottom: '10px' } }, icon('clock-3', 'sm'), `A new 15 minute candle has closed since this read (${Math.max(1, Math.round(age / 60000))} min ago). Scan again before acting on it.`) : null,
    h('div.ai-top',
      h('div.ai-verdict-box', h(`div.ai-v.big.${style}`, r.verdict),
        h('div.row', { style: { gap: '6px', marginTop: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
          r.grade ? h('span', { class: `chip grade-${r.grade}` }, `Grade ${r.grade} · ${r.total}/8`) : null,
          h('span.chip', `${r.confidence} confidence`))),
      h('div', { style: { flex: 1, minWidth: '240px' } },
        h('div.ai-headline', r.headline),
        h('div.eyebrow', { style: { margin: '10px 0 4px' } }, 'Quick breakdown'),
        h('ul.ai-bullets', (r.breakdown || []).map(b => h('li', b))))),
    (r.overrides || []).length ? h('div.errline', { style: { marginTop: '12px' } }, icon('shield-alert', 'sm'),
      h('div', h('b', `Your rules overrode Claude (it said ${r.ai_verdict}). `), r.overrides.join(' '))) : null,
    r.backup ? h('div.warnline', { style: { marginTop: '8px' } }, icon('layers', 'sm'), h('span', `Answered by the backup, ${r.backup.label}${r.backup.private ? '' : ' (market data only)'}, because Claude couldn't: ${(r.backup.why || []).join(' ')}`)) : null,
    (r.notes || []).map(n => h('div.warnline', { style: { marginTop: '8px' } }, icon('info', 'sm'), n)),
    (r.lessons || []).map(l => h(`div.lesson.${l.kind}`, icon(l.kind === 'leak' ? 'triangle-alert' : 'trending-up', 'sm'), h('span', l.text))),
    h('div.grid.g4.ai-comps', comps.map(([k, label]) => {
      const x = r[k] || {};
      return h(`div.ai-comp${x.score === 0 ? '.zero' : ''}`, h('div.row.between', h('span.eyebrow', label), h('b.mono', `${x.score ?? '—'}/2`)),
        h('div.ai-comp-r', x.reason || ''));
    })),
    h('div.grid.g2', { style: { gap: '14px', marginTop: '14px' } },
      h('div',
        h('div.eyebrow', 'Candidate'),
        c.level ? h('div.kv', { style: { marginTop: '6px' } },
          h('dt', 'Level'), h('dd', h('span.mono', fmt.px(c.level)), r.level_state ? h('span', ' ', stateChip(r.level_state)) : null),
          h('dt', 'Setup'), h('dd', c.setup === 'None' ? 'none of the four' : c.setup, ' ', c.direction !== 'None' ? dirChip(c.direction) : null),
          h('dt', 'Trap zone'), h('dd', c.trap_zone_low && c.trap_zone_high ? `${fmt.px(c.trap_zone_low)} to ${fmt.px(c.trap_zone_high)}` : '—'),
          h('dt', 'Reclaim trigger'), h('dd', c.reclaim_trigger ? `a 15m close back through ${fmt.px(c.reclaim_trigger)}` : '—'),
          h('dt', 'Plan'), h('dd', p.entry && p.invalidation ? `entry ${fmt.px(p.entry)} · stop ${fmt.px(p.invalidation)} · target ${fmt.px(p.target)}` : '—'),
          h('dt', 'Deadline'), h('dd', p.deadline || '—')) : h('div.muted', { style: { marginTop: '6px' } }, 'No candidate level.'),
        r.disqualifier ? h('div.errline', { style: { marginTop: '8px' } }, icon('octagon-x', 'sm'), h('div', h('b', 'Disqualifier: '), r.disqualifier)) : null),
      h('div',
        h('div.eyebrow', 'Gates (the app\'s own arithmetic)'),
        h('div.math', { style: { marginTop: '6px', fontSize: '11.5px' } }, (g.lines || []).length ? g.lines.map(l => h('div', h(`span.${l.startsWith('PASS') ? 'pass' : 'fail'}`, l.slice(0, 4)), l.slice(4))) : 'Not enough data to run the gates (needs a range, entry and stop).'),
        g.third === 'middle' ? h('div.help', { style: { color: 'var(--crit)' } }, 'Entry sits in the middle third of the range (rule 9).') : null)),
    (r.watch_next || []).length ? h('div', { style: { marginTop: '14px' } }, h('div.eyebrow', 'Set alerts on'), h('ul.ai-bullets', r.watch_next.map(x => h('li', x)))) : null,
    h('details', { style: { marginTop: '12px' } }, h('summary.muted', { style: { cursor: 'pointer' } }, 'More detail: every level, regime, session, what Claude could not verify'),
      h('div', { style: { marginTop: '10px' } },
        (r.levels_in_play || []).length ? h('table.tbl', h('thead', h('tr', h('th', 'Level'), h('th', 'State'), h('th', 'Would be'), h('th', 'What has to happen next'))),
          h('tbody', r.levels_in_play.map(l => h('tr', h('td.num', { style: { textAlign: 'left' } }, fmt.px(l.price)), h('td', l.state), h('td', l.would_be), h('td.dim', l.next))))) : null,
        h('div.kv', { style: { marginTop: '10px' } }, h('dt', '4h regime'), h('dd', `${r.regime?.read || '—'} (${r.regime?.permitted || '—'})`),
          h('dt', 'Session'), h('dd', `${r.session?.status || '—'}${r.session?.reason ? ': ' + r.session.reason : ''}`)),
        (r.missing_data || []).length ? h('div', { style: { marginTop: '8px' } }, h('div.eyebrow', 'Could not verify'), h('ul.ai-bullets', r.missing_data.map(x => h('li', x)))) : null,
        comps.map(([k, label]) => h('div', { style: { marginTop: '8px', fontSize: '12.5px' } }, h('b', `${label}: `), h('span.dim', r[k]?.reason || ''))))),
    h('div.row.wrap', { style: { marginTop: '14px', gap: '10px', alignItems: 'center' } },
      h('button.btn', { onclick: () => loadAI(rec) }, icon('list-checks', 'sm'), 'Load into checklist'),
      h('button.btn.ghost', { onclick: aiScan }, icon('refresh-cw', 'sm'), 'Scan again'),
      h('span.muted', { style: { marginLeft: 'auto', fontSize: '12px' } }, `${rec.model} · ${rec.seconds}s · ${fmt.usd(rec.cost_usd, 3)}`)),
    h('div.help', { style: { marginTop: '6px' } }, 'Only market data was sent (prices, levels, open interest, funding). Never your keys, balance, positions or trades. This is a read of your own checklist, not financial advice. The Verdict step still makes the call (rule 11).'));
}

function loadAI(rec) {
  const r = rec.result; const c = r.candidate || {};
  if (rec.symbol !== S.symbol) { toast('Different symbol', `This scan is for ${rec.symbol}.`, 'warn'); return; }
  if (c.level) {
    const lv = (S.snap?.levels || []).find(l => Math.abs(l.price - c.level) / c.level < 0.001);
    S.level = lv || { price: c.level, sources: ['manual'], touches: 0, c1: 0, state: 'MANUAL', manual: true };
  }
  if (c.setup && c.setup !== 'None') S.setup = c.setup;
  if (c.direction && c.direction !== 'None') S.direction = c.direction;
  for (const k of ['c1', 'c2', 'c3', 'c4']) { S[k].checks = { ...(r[k]?.checks || {}) }; S[k].score = r[k]?.score ?? null; }
  S.c4.checks.closed = !!r.c4_closed;   // the reclaim close is what the app measured, not the model's opinion
  S.c4.quality = r.c4?.quality && r.c4.quality !== 'none' ? r.c4.quality : null;
  S.aiDq = r.disqualifier || null;
  const p = r.plan || {}; const g = r.gates || {};
  S.entry = g.entry ?? p.entry ?? S.entry;
  S.stop = g.stop ?? p.invalidation ?? S.stop;
  if (p.target) S.target = p.target;
  S.result = null; S.step = 1; S.aiLoaded = rec.at;
  S.aiScores = { c1: r.c1?.score, c2: r.c2?.score, c3: r.c3?.score, c4: r.c4?.score };
  prefillFromLevel();
  calcSize().then(draw);
  toast('Loaded from the AI scan', 'Every box and score is filled in. Walk each step and change anything you disagree with; the Verdict step decides.', 'info', 9000);
}

// ---------------------------------------------------------------- steps
function stepBody() {
  const k = STEPS[S.step].key;
  const head = (t, sub) => h('div', { style: { marginBottom: '14px' } }, h('div.eyebrow', `Step ${S.step + 1} of ${STEPS.length}`), h('h2', { style: { marginTop: '4px' } }, t), sub ? h('div.dim', { style: { marginTop: '4px' } }, sub) : null);
  if (!S.snap && k !== 'session') return h('div', head(STEPS[S.step].title), h('div.errline', icon('wifi-off', 'sm'), S.snapErr || 'Loading market data…'));
  const sn = S.snap; const lv = S.level;

  if (k === 'session') {
    const ss = ctxRef.state.session;
    return h('div', head('Session gate', 'Checked before anything else. Any stand-down item means stand down or drop the grade one letter.'),
      h(`div.card.flat.sess-card.${ss.status}`, { style: { padding: '16px' } }, h('div.big', { style: { fontSize: '30px' } }, { clear: 'CLEAR', caution: 'CAUTION', stand_down: 'STAND DOWN' }[ss.status]),
        ss.reasons.length ? ss.reasons.map(r => h('div.reason', icon('triangle-alert', 'sm'), r.text)) : h('div.dim', { style: { marginTop: '6px' } }, 'No session flags: no macro event flagged and no funding settlement within the hour.')),
      null);
  }

  if (k === 'setup') {
    const cands = (sn.levels || []).filter(l => ['TRIGGERED', 'WATCH', 'RECRUITING', 'TESTED', 'APPROACHING'].includes(l.state));
    const reg = sn.regime || {};
    const counter = S.direction && reg.regime && reg.regime !== 'range' && !reg.permitted.includes(S.direction);
    S.counter = counter;
    return h('div', head('Which level, which setup?', 'Only four setups exist. If it is not one of them, it is not a trade. Do not invent a fifth.'),
      why('Ranking: state first (TRIGGERED beats WATCH beats RECRUITING), then level quality, then alignment with the 4h regime.'),
      h('div.eyebrow', 'Levels in play (auto-classified)'),
      h('div.col', { style: { margin: '8px 0 16px' } }, cands.length ? cands.slice(0, 6).map(l => h('div.check' + (lv && lv.price === l.price ? '.on' : ''), { onclick: () => { S.level = l; S.aiDq = null; S.setup = null; S.direction = null; S.entry = null; S.stop = null; S.target = null; prefillFromLevel(); draw(); } },
        h('span.box', lv && lv.price === l.price ? icon('check', 'sm') : null),
        h('div', { style: { flex: 1 } }, h('div.row', h('b.mono', fmt.px(l.price)), stateChip(l.state), l.setup ? h('span.chip', l.setup) : null, dirChip(l.direction)),
          h('div.d', l.note || `${l.sources.join(', ')} · ${l.touches} touches`)),
        h('span.auto', `${fmt.num(l.dist_atr, 1)} ATR`))) : h('div.lockbanner', icon('info'), 'Nothing is recruiting or triggered right now. That is a fine answer. Enter a level manually only if three other traders would draw it.')),
      h('div.row', { style: { gap: '12px', marginBottom: '16px' } }, field('Or enter a level manually', numInput(lv ? lv.price : '', { onchange: (e) => { const p = +e.target.value; S.aiDq = null; S.level = { price: p, sources: ['manual'], touches: 0, c1: 0, state: 'MANUAL', manual: true }; draw(); } }))),
      h('div.eyebrow', 'Setup'),
      h('div.setup-cards', { style: { margin: '8px 0 16px' } }, ['Spring', 'Upthrust', 'Sweep', 'Failed retest'].map(name => h(`div.setup-card${S.setup === name ? '.on' : ''}`, { onclick: () => { S.setup = name; if (name === 'Spring') S.direction = 'Long'; if (name === 'Upthrust') S.direction = 'Short'; S.target = null; prefillFromLevel(); draw(); } },
        setupDiagram(name), h('div.n', name), h('div.d', { Spring: 'Break of range low fails; close back inside. Target range high.', Upthrust: 'Mirror at the range high. Target range low.', Sweep: 'One candle spikes through, clears stops, closes back inside.', 'Failed retest': 'Breakout holds, the retest fails and closes back through.' }[name])))),
      h('div.row', h('div.eyebrow', 'Direction'), segmented(['Long', 'Short'], S.direction, (v) => { S.direction = v; S.target = null; S.stop = null; prefillFromLevel(); draw(); }),
        h('span.muted', { style: { marginLeft: '12px' } }, `4h regime: ${reg.regime || '—'} (${(reg.permitted || []).join(' / ')} permitted)`)),
      counter ? h('div.warnline', { style: { marginTop: '12px' } }, icon('triangle-alert', 'sm'), `Counter to a clean 4h ${reg.regime}. In a clean trend, only trap in the trend direction. This ranks last and will be blocked at the verdict.`) : null);
  }

  if (k === 'c1') {
    const srcs = lv?.sources || [];
    const htf = srcs.some(s => ['4h', '1d', '1w', 'range'].includes(s));
    const sugg = lv?.manual ? null : (srcs.includes('4h') && lv.touches >= 3 && lv.liq_near >= 3 ? 2 : htf || srcs.includes('1h') ? 1 : 0);
    return h('div', head('C1 · Is the level obvious to everyone?', 'Test: would three other traders independently draw this line?'),
      why('Qualifying, strongest first: range boundary with 3+ touches; 4h or 1h swing; prior day high/low/close (exchange day ends 8 PM ET); prior week high/low; round number; extreme of a 2x ATR candle.'),
      h('div.col',
        check('range', 'c1', 'Range boundary with three or more touches', null, lv ? `${lv.touches} touches` : null),
        check('swing', 'c1', '4 hour or 1 hour swing high or low', null, srcs.filter(s => ['4h', '1h'].includes(s)).join(', ') || '—'),
        check('prior', 'c1', 'Prior day high/low/close (the exchange day ends 8 PM ET, 7 PM in winter), or prior week high/low', null, srcs.filter(s => ['1d', '1w'].includes(s)).join(', ') || '—'),
        check('round', 'c1', 'Round number or extreme of a 2x ATR candle', null, srcs.filter(s => ['round', 'wide'].includes(s)).join(', ') || '—'),
        check('liq', 'c1', 'Liquidation cluster visible at the level', 'Recorded liquidations within the level band (last 3 days).', lv ? `${lv.liq_near ?? 0} prints` : null),
        check('three', 'c1', 'Three other traders would independently draw it'),
        h('div.eyebrow', { style: { marginTop: '8px' } }, 'Does NOT qualify'),
        check('only15', 'c1', 'Only visible on the 15 minute chart', 'Disqualifies the level outright.', null, true),
        check('weak', 'c1', 'Two-touch diagonal trend line, Fibonacci level alone, or moving average alone', null, null, true)),
      scorePick('c1', sugg, '2 = 3+ touches on a 4h level plus a visible liquidation cluster · 1 = higher-timeframe level, no cluster · 0 = only exists on the 15m'));
  }

  if (k === 'c2') {
    const T = ctxRef.state.thresholds;
    const floor = sn.thin ? T.pen_floor_atr_thin : T.pen_floor_atr;
    const abandon = T.pen_abandon_atr;   // both boundaries come from the live rulebook
    const pen = lv?.pen_atr; const oi = lv?.oi_break_pct; const f = sn.funding || {};
    const stretched = S.direction === 'Long' ? (f.rate_8h_pct || 0) < -ctxRef.state.thresholds.funding_baseline_pct : (f.rate_8h_pct || 0) > ctxRef.state.thresholds.funding_stretched_pct;
    const sugg = oi === null || oi === undefined ? null : oi <= 0 ? 0 : (pen >= floor && pen <= abandon && oi > 0.5 && stretched) ? 2 : 1;
    return h('div', head('C2 · Did the break recruit anyone?', 'If nobody entered, nobody is trapped and there is no fuel. This is the component people skip.'),
      penBracket(pen, floor, abandon),
      h('div.col', { style: { marginTop: '14px' } },
        check('closed', 'c2', 'The candle CLOSED beyond the level (not just a wick)', null, lv?.state && ['RECRUITING', 'WATCH', 'TRIGGERED', 'DEAD_TIMED_OUT'].includes(lv.state) ? 'close beyond seen' : '—'),
        check('bracket', 'c2', `Penetration between the ${floor} ATR floor and the ${abandon} ATR abandon line`, sn.thin ? `Thin asset: floor raised to ${T.pen_floor_atr_thin} ATR.` : null, pen !== null && pen !== undefined ? `${fmt.num(pen, 2)} ATR` : '—'),
        check('body', 'c2', 'Body at least two thirds of the candle range'),
        check('range', 'c2', 'Candle range at or above ATR and expanded vs the prior candles'),
        check('oi', 'c2', 'Open interest ROSE through the break', 'Primary check. Flat or falling means positions closed rather than opened. Stop here.', oi !== null && oi !== undefined ? fmt.pct(oi, 2, true) : 'n/a'),
        check('funding', 'c2', 'Funding stretched in the break direction', `Baseline ${ctxRef.state.thresholds.funding_baseline_pct}% per 8h. Current ${fmt.pct(f.rate_8h_pct, 4)} (percentile ${f.pctile !== null && f.pctile !== undefined ? Math.round(f.pctile) : '—'}).`, stretched ? 'stretched' : 'not stretched'),
        check('shallow', 'c2', 'Penetration was below the floor', 'Hard disqualifier: no recruitment.', null, true)),
      sn.thin ? h('div.warnline', { style: { marginTop: '10px' } }, icon('info', 'sm'), 'Memecoin: CVD degrades badly here. Lean on OI and funding instead.') : null,
      scorePick('c2', sugg, '2 = strong close, clear OI rise, stretched funding · 1 = partial confirmation · 0 = OI flat/falling or small body (no trade)'),
      field('Pen. ATR for the journal (orange field)', numInput(S.pen_atr, { class: 'input num orange', onchange: (e) => { S.pen_atr = e.target.value === '' ? null : +e.target.value; } })));
  }

  if (k === 'c3') {
    const n = lv?.candles_since_break;
    return h('div', head('C3 · Did it fail to follow through?', 'Decision window: two to four candles (30 to 60 minutes).'),
      why('Cleanest version: an inside bar right after the breakout candle. Break of its high means the break is real (stand down). Break of its low means the trap is live.'),
      h('div.row', { style: { gap: '10px', marginBottom: '12px' } }, h('span.chip', icon('clock-3', 'sm'), `Candles since break: ${n ?? '—'}`), lv?.state ? stateChip(lv.state) : null),
      h('div.col',
        check('contract', 'c3', 'Candle ranges contracting below one ATR'),
        check('bodies', 'c3', 'Bodies shrinking'),
        check('wicks', 'c3', 'Wicks on both sides / doji at the level'),
        check('same', 'c3', 'Two or more candles wicking to the same price'),
        check('inside', 'c3', 'Inside bar right after the breakout candle'),
        h('div.eyebrow', { style: { marginTop: '8px' } }, 'Hard disqualifiers'),
        check('ran', 'c3', 'Price cleared a full ATR beyond and consolidated there', 'Flag, not trap.', lv?.state === 'DEAD_RAN' ? 'auto: yes' : null, true),
        check('timedout', 'c3', 'Four candles elapsed with no reclaim', 'The break is real.', lv?.state === 'DEAD_TIMED_OUT' ? 'auto: yes' : null, true)),
      scorePick('c3', null, '2 = clear stall inside the window · 1 = some stall evidence · 0 = no stall'),
      field('Candles to reclaim for the journal (orange field)', numInput(S.candles_to_reclaim, { class: 'input num orange', onchange: (e) => { S.candles_to_reclaim = e.target.value === '' ? null : +e.target.value; } })));
  }

  if (k === 'c4') {
    const oi = lv?.oi_reclaim_pct;
    const liqs = (sn.series?.liqs || []).filter(x => Date.now() - x.ts < 60 * 60000);
    const trappedSide = S.direction === 'Long' ? 'Sell' : 'Buy';
    const liqAgainst = liqs.filter(x => x.side === trappedSide).length;
    if (S.oi_confirmed === null && oi !== null && oi !== undefined) S.oi_confirmed = oi < -0.3 ? 'Yes' : 'No';
    const sugg = !S.c4.checks.closed ? 0 : (oi !== null && oi !== undefined && oi < -0.5 && ['engulfing', 'large'].includes(S.c4.quality)) ? 2 : 1;
    return h('div', head('C4 · Decisive close back inside', 'This is the entry. Never enter before it. Anticipating the reclaim is the most expensive error in this strategy.'),
      h('div.col',
        check('closed', 'c4', 'The candle CLOSED back inside (rule 5)', 'Not merely wicked in. Required for any trade.', lv?.state === 'TRIGGERED' ? 'auto: yes' : null),
        check('far', 'c4', 'Closed near the far extreme; body at or above average'),
        check('oi', 'c4', 'Open interest DROPPED sharply on the reclaim', 'If it does not drop, nobody was forced out.', oi !== null && oi !== undefined ? fmt.pct(oi, 2, true) : 'n/a'),
        check('funding', 'c4', 'Funding normalizing or flipping'),
        check('liqs', 'c4', 'Liquidations printing against the trapped side', 'From the live liquidation stream, last 60 minutes.', `${liqAgainst} prints`)),
      h('div', { style: { marginTop: '14px' } }, h('div.eyebrow', 'Reclaim quality (best to worst)'),
        h('div', { style: { marginTop: '8px' } }, segmented([['engulfing', 'Engulfing close'], ['large', 'Large-bodied close'], ['pin', 'Pin bar + confirm'], ['inside', 'Inside-bar break'], ['grind', 'Slow grind (weakest)']], S.c4.quality, (v) => { S.c4.quality = v; draw(); }))),
      h('div.row', { style: { marginTop: '14px', gap: '12px' } }, h('div.eyebrow', 'OI confirmed (orange field)'), segmented(['Yes', 'No'], S.oi_confirmed, (v) => { S.oi_confirmed = v; }, 'yn')),
      scorePick('c4', sugg, '2 = engulfing or large-bodied close with a sharp OI drop · 1 = closed back inside with partial confirmation · 0 = no close back inside'));
  }

  if (k === 'gates') return gatesStep(head);
  if (k === 'verdict') return verdictStep(head);
  return h('div');
}

function penBracket(pen, floor, abandon = 1) {
  const top = Math.max(1.4, abandon * 1.4, (pen || 0) * 1.1);   // scale grows with the rulebook and the reading
  const W = 600; const Hh = 64; const X = (v) => 20 + Math.min(top, Math.max(0, v)) / top * (W - 40);
  const f = (v) => (Number.isInteger(+v) ? (+v).toFixed(1) : String(+v));   // 1 -> "1.0", 0.25 -> "0.25"
  return h('div.fig.dark-zone', { style: { background: '#0a0f16', border: '1px solid var(--line)', borderRadius: '12px', padding: '10px' } },
    svg('svg', { viewBox: `0 0 ${W} ${Hh}`, width: '100%' },
      svg('rect', { x: X(0), y: 22, width: X(floor) - X(0), height: 14, rx: 4, fill: 'rgba(239,75,75,.25)' }),
      svg('rect', { x: X(floor), y: 22, width: X(abandon) - X(floor), height: 14, rx: 4, fill: 'rgba(54,215,199,.28)' }),
      svg('rect', { x: X(abandon), y: 22, width: X(top) - X(abandon), height: 14, rx: 4, fill: 'rgba(250,178,25,.22)' }),
      svg('text', { x: X(floor / 2), y: 54, 'text-anchor': 'middle', fill: 'var(--ink-3)', 'font-size': 11 }, 'too shallow'),
      svg('text', { x: X((floor + abandon) / 2), y: 54, 'text-anchor': 'middle', fill: 'var(--accent)', 'font-size': 11 }, 'trap zone'),
      svg('text', { x: X((abandon + top) / 2), y: 54, 'text-anchor': 'middle', fill: 'var(--ink-3)', 'font-size': 11 }, 'ran: flag'),
      svg('text', { x: X(floor), y: 13, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-size': 11, 'font-family': 'var(--mono)' }, f(floor)),
      svg('text', { x: X(abandon), y: 13, 'text-anchor': 'middle', fill: 'var(--ink-2)', 'font-size': 11, 'font-family': 'var(--mono)' }, `${f(abandon)} ATR`),
      pen !== null && pen !== undefined ? svg('g', {}, svg('line', { x1: X(pen), x2: X(pen), y1: 19, y2: 40, stroke: '#fff', 'stroke-width': 2 }), svg('circle', { cx: X(pen), cy: 29, r: 6, fill: '#fff' }),
        svg('text', { x: X(pen) > W * 0.8 ? X(pen) - 10 : X(pen) + 10, y: 33, 'text-anchor': X(pen) > W * 0.8 ? 'end' : 'start', fill: '#fff', 'font-size': 11, 'font-family': 'var(--mono)', 'font-weight': 700 }, `${(+pen).toFixed(2)}`)) : null),
    h('div.help', pen !== null && pen !== undefined ? `Close penetration: ${fmt.num(pen, 2)} ATR` : 'No close-through break measured for this level.'));
}

async function calcSize() {
  if (!S.entry || !S.stop || !S.direction) { S.sizing = null; return; }
  try {
    const r = await api.post('/api/size', { symbol: S.symbol, direction: S.direction, entry: S.entry, stop: S.stop, target: S.target });
    S.sizing = r.data;
  } catch (e) { S.sizing = { ok: false, errors: [e.message] }; }
}

function gateCalc() {
  const th = ctxRef.state.thresholds; const sn = S.snap;
  const atr = sn.atr15; const height = S.rangeHigh && S.rangeLow ? S.rangeHigh - S.rangeLow : null;
  const stopD = S.entry && S.stop ? Math.abs(S.entry - S.stop) : null;
  const fee = ctxRef.state.settings.taker_fee_pct || th.taker_fee_pct;
  const slip = sn.thin ? th.slippage_pct_thin : th.slippage_pct_major;
  const lines = []; let rangeOk = null; let costOk = null;
  if (height && atr) {
    const ra = height / atr; const rs = stopD ? height / stopD : null; const pct = height / sn.price * 100;
    rangeOk = ra >= th.range_atr_min && (rs === null || rs >= th.range_stop_min) && (!sn.thin || pct >= th.thin_range_pct_min);
    lines.push([ra >= th.range_atr_min, `Range ${fmt.px(height)} / ATR ${fmt.px(atr)} = ${ra.toFixed(2)}x  (need >= ${th.range_atr_min}x)`]);
    if (rs !== null) lines.push([rs >= th.range_stop_min, `Range ${fmt.px(height)} / stop ${fmt.px(stopD)} = ${rs.toFixed(2)}x  (need >= ${th.range_stop_min}x)`]);
    if (sn.thin) lines.push([pct >= th.thin_range_pct_min, `Width ${pct.toFixed(2)}% of price  (thin asset, need >= ${th.thin_range_pct_min}%)`]);
  }
  if (stopD) {
    const rt = 2 * fee + 2 * slip; const cost = sn.price * rt / 100; const share = cost / stopD * 100;
    costOk = share < th.cost_pct_of_risk_max;
    lines.push([costOk, `Cost (2 x ${fee}% fee + 2 x ${slip}% slippage) = ${rt.toFixed(3)}% of price = ${fmt.px(cost)}`]);
    lines.push([costOk, `${fmt.px(cost)} / stop ${fmt.px(stopD)} = ${share.toFixed(1)}% of risk  (need < ${th.cost_pct_of_risk_max}%)`]);
  }
  let third = null;
  if (height && S.entry) { const pos = (S.entry - S.rangeLow) / height; third = pos < 1 / 3 ? 'lower' : pos > 2 / 3 ? 'upper' : 'middle'; }
  return { lines, rangeOk, costOk, third, height, stopD };
}

function gatesStep(head) {
  const g = gateCalc(); const sz = S.sizing;
  const set = (k) => async (e) => { S[k] = e.target.value === '' ? null : +e.target.value; await calcSize(); draw(); };
  return h('div', head('Both gates, then size from the stop', 'Show the arithmetic every time. Most quiet-regime setups fail these gates. That is the gate working.'),
    h('div.grid.g3', { style: { gap: '12px' } },
      field('Range high', numInput(S.rangeHigh, { onchange: set('rangeHigh') })),
      field('Range low', numInput(S.rangeLow, { onchange: set('rangeLow') })),
      field('Target (opposite boundary)', numInput(S.target, { onchange: set('target') })),
      field('Entry (the reclaim close)', numInput(S.entry, { onchange: set('entry') })),
      field('Invalidation (a few ticks beyond the trap wick)', numInput(S.stop, { onchange: set('stop') }), 'Beyond the extreme wick, NOT beyond the level.'),
      h('div', h('div.eyebrow', 'Where is entry in the range?'), h('div', { style: { marginTop: '8px' } }, g.third ? h(`span.chip${g.third === 'middle' ? '.short' : '.long'}`, `${g.third} third`) : '—'),
        g.third === 'middle' ? h('div.help', { style: { color: 'var(--crit)' } }, 'Rule 9: middle third, no trade.') : null)),
    h('div.eyebrow', { style: { margin: '16px 0 8px' } }, 'Gate arithmetic'),
    h('div.math', g.lines.length ? g.lines.map(([ok, t]) => h('div', h(`span.${ok ? 'pass' : 'fail'}`, ok ? 'PASS ' : 'FAIL '), t)) : 'Enter the range, entry and stop.'),
    h('div.row', { style: { gap: '10px', marginTop: '10px' } }, gateChip('Range gate', g.rangeOk), gateChip('Cost gate', g.costOk)),
    h('div.sep'),
    sz ? sizeSummary(sz) : h('div.muted', 'Sizing appears once entry, stop and direction are set.'));
}
function gateChip(label, ok) { return h(`span.chip${ok === true ? '.long' : ok === false ? '.short' : ''}`, icon(ok ? 'check' : ok === false ? 'x' : 'minus', 'sm'), label); }

export function sizeSummary(sz) {
  if (!sz.ok) return h('div', (sz.errors || []).map(e => h('div.errline', icon('octagon-x', 'sm'), e)));
  return h('div',
    h('div.grid.g4', { style: { gap: '10px' } },
      tileMini('Size', fmt.qty(sz.qty), `${fmt.usd(sz.notional)} notional`),
      tileMini('Risk (1R)', fmt.usd(sz.actual_risk_usd), `${fmt.num(sz.stop_pct, 3)}% stop`),
      tileMini('Leverage needed', `${fmt.num(sz.required_leverage, 2)}x`, `liq est. ${fmt.num(sz.liq_buffer, 1)} stops away`),
      tileMini('Target', sz.target_r !== null && sz.target_r !== undefined ? fmt.r(sz.target_r) : '—', `cost ${fmt.num(sz.cost_share_pct, 1)}% of risk`)),
    (sz.warnings || []).map(w => h('div.warnline', { style: { marginTop: '8px' } }, icon('triangle-alert', 'sm'), w)),
    h('details', { style: { marginTop: '10px' } }, h('summary.muted', { style: { cursor: 'pointer' } }, 'Show sizing arithmetic'), h('div.math', { style: { marginTop: '8px' } }, sz.arithmetic.map(l => h('div', l)))),
    h('div.eyebrow', { style: { margin: '14px 0 8px' } }, 'Add-on ladder (only after candle-four expansion)'),
    h('table.tbl', h('thead', h('tr', h('th', 'Leg'), h('th.num', 'Trigger'), h('th.num', 'Add qty'), h('th.num', 'Total'), h('th.num', 'Avg entry'), h('th.num', 'Move stop to'), h('th.num', 'Worst case'))),
      h('tbody', h('tr', h('td', 'Initial'), h('td.num', 'entry'), h('td.num', fmt.qty(sz.qty)), h('td.num', fmt.qty(sz.qty)), h('td.num', '—'), h('td.num', 'initial stop'), h('td.num', '-1.00R')),
        sz.ladder.map(l => h('tr', { style: { opacity: l.viable ? 1 : 0.5 } }, h('td', l.name, ` (+${l.trigger_r}R)`), h('td.num', fmt.px(l.trigger)), h('td.num', fmt.qty(l.qty)), h('td.num', fmt.qty(l.total_qty)), h('td.num', fmt.px(l.avg_entry)), h('td.num', fmt.px(l.move_stop_to)), h('td.num', fmt.r(l.worst_case_r)))))),
    h('div.help', { style: { marginTop: '6px' } }, 'Move the stop FIRST, then add. Worst case includes fees and slippage and never exceeds the original 1R.'));
}
function tileMini(label, val, foot) {
  return h('div', { style: { padding: '12px', borderRadius: '12px', background: 'var(--panel-2)', border: '1px solid var(--line)' } },
    h('div.eyebrow', label), h('div', { style: { fontFamily: 'var(--display)', fontSize: '22px', fontWeight: 700, marginTop: '4px' } }, val), h('div.muted', { style: { fontSize: '12px' } }, foot));
}

function verdictStep(head) {
  const t = total(); const grade = gradeOf(t); const dq = disqualifier(); const g = gateCalc();
  if (S.result) return resultView(head);
  return h('div', head('Verdict', 'The server re-checks everything and makes the call. You cannot argue with it mid-session (rule 11).'),
    h('div.grid.g4', { style: { gap: '10px' } }, ['c1', 'c2', 'c3', 'c4'].map((k, i) => tileMini(['C1 level', 'C2 recruitment', 'C3 stall', 'C4 reclaim'][i], S[k].score ?? '—', S[k].score === 0 ? 'fails' : S[k].score === null ? 'not scored' : 'of 2'))),
    h('div.row', { style: { margin: '14px 0', gap: '12px' } }, h('span', { class: `chip grade-${grade}`, style: { fontSize: '14px', padding: '5px 12px' } }, `Grade ${grade} (${t}/8)`), gateChip('Range gate', g.rangeOk), gateChip('Cost gate', g.costOk),
      g.third === 'middle' ? h('span.chip.short', 'Middle third') : null, S.counter ? h('span.chip.short', 'Counter-trend') : null),
    dq ? h('div.errline', icon('octagon-x', 'sm'), h('div', h('b', 'Hard disqualifier: '), dq)) : null,
    h('div.row', { style: { marginTop: '18px' } }, h('div', { style: { flex: 1 } }),
      h('button.btn.lg.primary', { onclick: submit }, icon('gavel'), 'Get the verdict')));
}

async function submit() {
  const g = gateCalc();
  const body = {
    symbol: S.symbol, direction: S.direction, setup: S.setup, level: S.level?.price,
    scores: { c1: S.c1.score, c2: S.c2.score, c3: S.c3.score, c4: S.c4.score },
    checks: { c1: S.c1.checks, c2: S.c2.checks, c3: S.c3.checks, c4: S.c4.checks }, quality: S.c4.quality,
    c4_closed: !!S.c4.checks.closed, disqualifier: disqualifier(),
    counter_trend: !!S.counter, trend_block: !!S.counter,
    gates: { range_ok: g.rangeOk, cost_ok: g.costOk, pass: g.rangeOk === true && g.costOk === true, lines: g.lines.map(l => l[1]) },
    third: g.third, pen_atr: S.pen_atr, candles_to_reclaim: S.candles_to_reclaim, oi_confirmed: S.oi_confirmed,
    sizing: S.sizing?.ok ? { entry: S.entry, stop: S.stop, target: S.target, qty: S.sizing.qty } : { entry: S.entry, stop: S.stop, target: S.target },
    snapshot: { price: S.snap.price, atr15: S.snap.atr15, funding: S.snap.funding, oi: S.snap.oi, regime: S.snap.regime?.regime, level_state: S.level?.state },
  };
  try {
    const r = await api.post('/api/checklist', body);
    S.result = r.data;
    sound('stamp');
    if (r.data.xp) setTimeout(() => ctxRef.celebrateXP(r.data.xp), 500);
    if (r.data.verdict === 'GO') setTimeout(() => confetti({ particleCount: 70, spread: 60 }), 350);
    draw();
  } catch (e) { toast('Could not submit', e.message, 'alert'); }
}

function resultView(head) {
  const r = S.result; const go = r.verdict === 'GO';
  const deadline = Date.now() - Date.now() % 900000 + 4 * 900000;
  return h('div', head('Verdict'),
    h('div', { style: { textAlign: 'center', padding: '18px 0 8px' } }, h(`div.stamp.${go ? 'go' : 'no'}`, go ? 'GO' : 'NO TRADE'),
      h('div', { style: { marginTop: '16px' } }, h('span', { class: `chip grade-${r.grade}`, style: { fontSize: '14px', padding: '5px 12px' } }, `Grade ${r.grade}`))),
    r.reasons.length ? h('div', { style: { marginTop: '12px' } }, r.reasons.map(x => h(go ? 'div.warnline' : 'div.errline', { style: { marginTop: '6px' } }, icon(go ? 'info' : 'octagon-x', 'sm'), x))) : null,
    (r.lessons || []).map(l => h(`div.lesson.${l.kind}`, icon(l.kind === 'leak' ? 'triangle-alert' : 'trending-up', 'sm'), h('span', l.text))),
    go ? h('div', { style: { marginTop: '18px' } },
      h('div.card.flat.glow', h('div.card-h', h('h3', icon('target'), 'Your plan'), h('span.sub', 'Plan saved. It will auto-match to the Bybit fill.')),
        S.sizing ? sizeSummary(S.sizing) : null,
        h('div.grid.g3', { style: { marginTop: '12px', gap: '10px' } },
          h('div.warnline', icon('shield-alert', 'sm'), 'Put the stop on the exchange immediately after the fill.'),
          h('div.warnline', icon('hourglass', 'sm'), h('span', 'No expansion by candle four: out at breakeven. ~', h('b', fmt.et(deadline)), ' ET.')),
          h('div.warnline', icon('ban', 'sm'), 'Never move the stop away from entry.')))) :
      h('div', { style: { marginTop: '18px', textAlign: 'center' } },
        h('p.dim', 'That is the gate working. Log it as a pass: it takes one tap and it tells you, in month one, whether your problem is finding setups or pulling the trigger.'),
        h('div.row', { style: { justifyContent: 'center', gap: '10px', marginTop: '10px' } },
          h('button.btn.xp.lg', { onclick: async (e) => { const res = await api.post(`/api/plans/${r.id}/skip`); ctxRef.celebrateXP(25, e.target); toast('Logged as a pass', 'Honor it for 60 minutes (no position on this symbol) for +30 XP more.', 'xp'); S = fresh(ctxRef); ctxRef.go(`journal/${res.data.trade_id}`); } }, icon('hand'), 'Log as skipped (+25 XP)')),
      h('div.help', { style: { textAlign: 'center', marginTop: '8px' } }, 'Honoring a NO TRADE verdict for an hour pays +30 XP automatically.')),
    h('div.row', { style: { marginTop: '20px', justifyContent: 'center' } }, h('button.btn', { onclick: () => { S = fresh(ctxRef); draw(); } }, icon('refresh-cw', 'sm'), 'New checklist')));
}

// ---------------------------------------------------------------- mini diagrams
export function setupDiagram(name) {
  const s = svg('svg', { class: 'mini', viewBox: '0 0 160 64' });
  const line = (y, c = 'rgba(15,23,42,.28)') => svg('line', { x1: 6, x2: 154, y1: y, y2: y, stroke: c, 'stroke-dasharray': '3 3' });
  const path = (d, c = 'var(--accent)') => svg('path', { d, fill: 'none', stroke: c, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
  if (name === 'Spring') { put(s, line(14), line(46), path('M8,30 L30,18 L52,40 L72,24 L92,44 L104,56 L114,40 L134,22 L152,14')); put(s, svg('circle', { cx: 114, cy: 40, r: 3.5, fill: 'var(--ink)' })); }
  if (name === 'Upthrust') { put(s, line(18), line(50), path('M8,34 L30,46 L52,24 L72,40 L92,20 L104,8 L114,24 L134,42 L152,50')); put(s, svg('circle', { cx: 114, cy: 24, r: 3.5, fill: 'var(--ink)' })); }
  if (name === 'Sweep') {
    put(s, line(44));
    put(s, path('M8,20 L40,30 L70,36 L100,38'));
    put(s, svg('line', { x1: 112, x2: 112, y1: 24, y2: 60, stroke: 'var(--s8)', 'stroke-width': 2 }), svg('rect', { x: 107, y: 28, width: 10, height: 10, fill: 'var(--s3)' }));
    put(s, path('M118,32 L152,14'));
  }
  if (name === 'Failed retest') { put(s, line(34)); put(s, path('M8,50 L30,44 L50,40 L66,22 L82,16 L100,26 L112,30 L120,40 L138,50 L152,56')); put(s, svg('circle', { cx: 120, cy: 40, r: 3.5, fill: 'var(--ink)' })); }
  return s;
}
