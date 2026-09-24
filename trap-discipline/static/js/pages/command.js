// Command Center: session status, discipline, live positions, what to log, watchlist, coach.
import { api } from '../api.js';
import { h, icon, fmt, ring, spark, stateChip, dirChip, rpill, modal, segmented, toast, sound, confetti, clear, put } from '../ui.js';

let timer = null;
let rootEl = null;

export async function render(root, ctx) {
  rootEl = root;
  draw(root, ctx);
  clearInterval(timer);
  timer = setInterval(() => updateTimers(), 1000);
}
export function destroy() { clearInterval(timer); timer = null; }
export function onTick(ctx) { if (rootEl) draw(rootEl, ctx); }
export function onEvent(msg, ctx) {
  if (['positions', 'trade', 'level'].includes(msg.kind)) ctx.refresh().then(() => rootEl && draw(rootEl, ctx));
}

function draw(root, ctx) {
  const st = ctx.state;
  if (!st) return;
  const scroller = document.getElementById('view');   // the scrolling container (root sits inside it)
  const scrollY = scroller.scrollTop;
  clear(root);
  const g = st.game;
  put(root, 
    h('div.page-head',
      h('div', h('div.eyebrow', new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })),
        h('h1', greeting()), h('div.sub', 'Your job today is to follow the process. The market decides the outcome.')),
      h('div.actions',
        !g.streaks.checked_in_today ? h('button.btn.xp', { onclick: () => openCheckin(ctx) }, icon('sunrise'), 'Pre-session check-in') : h('span.chip', icon('check', 'sm'), 'Checked in today'),
        h('button.btn.primary', { onclick: () => ctx.go('checklist') }, icon('list-checks'), 'Run checklist'))),
    h('div.hero', sessionCard(st, ctx), disciplineCard(st, ctx)),
    h('div.grid.g2', { style: { marginTop: '16px' } }, positionsCard(st, ctx), toLogCard(st, ctx)),
    h('div', { style: { marginTop: '18px' } }, h('div.card-h', h('h3', icon('radio'), 'Watchlist'), h('span.sub', 'Levels auto-classified from 1h/4h/daily structure. Confirm on the chart.'),
      h('div.right', h('button.btn.sm.ghost', { onclick: () => ctx.go('markets') }, 'Open monitor', icon('arrow-right', 'sm'))))),
    h('div.grid.g3', (st.watch || []).map(w => watchTile(w, ctx))),
    h('div.grid.g2', { style: { marginTop: '16px' } }, coachCard(st, ctx), questsCard(st, ctx)),
  );
  scroller.scrollTop = scrollY;
  updateTimers();
}

function greeting() {
  const hr = new Date().getHours();
  return hr < 12 ? 'Good morning, Pat.' : hr < 18 ? 'Good afternoon, Pat.' : 'Good evening, Pat.';
}

function sessionCard(st, ctx) {
  const s = st.session;
  const th = st.thresholds;
  const big = { clear: 'CLEAR', caution: 'CAUTION', stand_down: 'STAND DOWN' }[s.status] || 'CLEAR';
  const desc = {
    clear: 'Session checks pass. That permits evaluating setups. It does not mean take one.',
    caution: 'Something lowers setup quality. Drop grades one letter or wait.',
    stand_down: 'Stand down. Nothing here is worth the risk right now.',
  }[s.status];
  const nextThin = nextThinWindow(th);
  const fund = (st.watch || []).map(w => w.funding?.next).filter(Boolean).sort()[0];
  return h(`div.card.sess-card.${s.status}`,
    h('div.row.between',
      h('div', h('div.eyebrow', 'Session'), h('div.big', { style: { marginTop: '6px' } }, big)),
      h('div', { style: { textAlign: 'right' } }, h('div.eyebrow', 'Losses today'),
        h('div', { style: { fontFamily: 'var(--display)', fontSize: '28px', fontWeight: 700, marginTop: '4px' } }, s.losses_today ?? 0))),
    h('p.dim', { style: { margin: '12px 0 8px', maxWidth: '560px' } }, desc),
    s.reasons.length ? h('div', s.reasons.map(r => h('div.reason', icon(r.level === 'stop' ? 'octagon-x' : r.level === 'info' ? 'info' : 'triangle-alert', 'sm'), h('span', r.rule ? h('span.ruleno', `R${r.rule}`) : null, ' ', r.text)))) : null,
    h('div.sep'),
    h('div.grid.g3', { style: { gap: '10px' } },
      miniStat('clock-3', 'Thin window', nextThin.active ? 'NOW' : 'in', h('span.mono', { dataset: { countdown: nextThin.at } }, '')),
      miniStat('percent', 'Next funding', '', h('span.mono', { dataset: { countdown: fund || '' } }, fund ? '' : '—')),
      miniStat('calendar-days', 'Macro event today?', '', h('span', macroToggle(st, ctx)))));
}
function miniStat(ic, label, pre, val) {
  return h('div', { style: { padding: '10px 12px', borderRadius: '11px', background: 'rgba(255,255,255,.03)', border: '1px solid var(--line)' } },
    h('div.eyebrow', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, icon(ic, 'sm'), label),
    h('div', { style: { marginTop: '6px', fontWeight: 600 } }, pre ? `${pre} ` : '', val));
}
function macroToggle(st, ctx) {
  return segmented([['no', 'No'], ['yes', 'Yes']], st.settings.macro_today ? 'yes' : 'no', async (v) => {
    await api.put('/api/settings', { macro_today: v === 'yes' });
    await ctx.refresh();
    if (v === 'yes') toast('Macro day flagged', 'Grades drop one letter today. Consider standing down around the release.', 'warn');
  });
}
function nextThinWindow(th) {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), th.thin_hours_start_utc);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), th.thin_hours_end_utc);
  const t = Date.now();
  if (t >= start && t < end) return { active: true, at: end };
  return { active: false, at: t < start ? start : start + 86400000 };
}

function disciplineCard(st, ctx) {
  const g = st.game;
  const d = g.discipline;
  const score = d.score;
  const col = score === null ? 'var(--ink-3)' : score >= 85 ? 'var(--good)' : score >= 65 ? 'var(--accent)' : score >= 45 ? 'var(--warn)' : 'var(--crit)';
  const lv = g.level;
  return h('div.card.xpglow',
    h('div.row', { style: { gap: '22px', alignItems: 'center' } },
      ring(score ?? 0, { color: col, label: score === null ? '—' : String(score), sub: 'discipline' }),
      h('div', { style: { flex: 1 } },
        h('div.eyebrow', 'Discipline score'),
        h('div.dim', { style: { fontSize: '13px', margin: '4px 0 12px' } }, score === null ? 'Log closed trades to start scoring your process.' : `Average process score of your last ${d.n} trades. Profit is not an input.`),
        h('div.row', { style: { gap: '12px' } }, h('div.hex', lv.level), h('div', { style: { flex: 1 } },
          h('div.row.between', h('b', lv.rank), h('span.muted.mono', { style: { fontSize: '12px' } }, `${fmt.num(lv.xp - lv.floor, 0)} / ${fmt.num(lv.next - lv.floor, 0)}`)),
          h('div.bar', { style: { marginTop: '6px' } }, h('i', { style: { width: `${Math.round(lv.progress * 100)}%` } })))))),
    h('div.grid.g3', { style: { marginTop: '16px', gap: '10px' } },
      streakBox('flame', 'Check-in', g.streaks.checkin, g.streaks.best_checkin, 'days'),
      streakBox('shield-check', 'Clean trades', g.streaks.clean, g.streaks.best_clean, 'in a row'),
      streakBox('clock-3', 'Fresh logs', g.streaks.fresh, null, 'in a row')));
}
function streakBox(ic, label, n, best, unit) {
  return h('div', { style: { padding: '12px', borderRadius: '12px', background: 'rgba(255,255,255,.03)', border: '1px solid var(--line)' } },
    h('div.eyebrow', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, icon(ic, 'sm'), label),
    h('div', { style: { fontFamily: 'var(--display)', fontSize: '26px', fontWeight: 700, marginTop: '4px', color: n >= 3 ? '#ffb34d' : 'var(--ink)' } }, n, h('small.muted', { style: { fontSize: '12px', marginLeft: '6px', fontWeight: 500 } }, unit)),
    best !== null ? h('div.muted', { style: { fontSize: '11.5px' } }, `best ${best}`) : null);
}

function positionsCard(st, ctx) {
  const pos = st.positions || [];
  const trades = st.open_trades || [];
  const body = pos.length ? pos.map(p => positionBox(p, trades.find(t => t.symbol === p.symbol), st)) :
    trades.length ? trades.map(t => positionBox(null, t, st)) :
      h('div.empty', icon('crosshair'), h('div', st.connection.connected ? 'Flat. Being flat is a position.' : st.mode === 'demo' ? 'Demo mode has no live positions. Connect Bybit in Settings to see yours here.' : 'Connect a read-only Bybit key in Settings to watch positions live.'));
  return h('div.card', h('div.card-h', h('h3', icon('activity'), 'Open positions'), h('span.sub', 'Live from Bybit, read-only')), body);
}
function positionBox(p, t, st) {
  const dir = p ? (p.side === 'Buy' ? 'Long' : 'Short') : t?.direction;
  const entry = t?.entry || p?.entry; const stop = p?.stop || t?.stop; const mark = p?.mark;
  const d = entry && stop ? Math.abs(entry - stop) : null;
  const sg = dir === 'Long' ? 1 : -1;
  const rNow = d && mark ? (mark - entry) * sg / d : null;
  const lo = -1.25; const hi = 3.25;
  const pct = (r) => `${Math.max(0, Math.min(100, (r - lo) / (hi - lo) * 100))}%`;
  const liqBuf = entry && stop && p?.liq ? Math.abs(entry - p.liq) / Math.abs(entry - stop) : t?.liq_buffer;
  const c4 = t?.opened_at ? (t.opened_at - t.opened_at % 900000) + 5 * 900000 : null;
  const checks = [
    [!!stop, stop ? 'Stop on exchange' : 'NO STOP'],
    [liqBuf === null || liqBuf === undefined ? null : liqBuf >= st.thresholds.liq_buffer_min, `Liq ${liqBuf ? fmt.num(liqBuf, 1) + ' stops' : '—'}`],
    [!!t?.plan_id, t?.plan_id ? 'Checklist matched' : 'No checklist'],
  ];
  return h('div.pos',
    h('div.row', h('b', { style: { fontFamily: 'var(--display)', fontSize: '16px' } }, p?.symbol || t?.symbol), dirChip(dir),
      h('span.muted.mono', { style: { fontSize: '12px' } }, `${fmt.qty(p?.size || t?.qty)} @ ${fmt.px(entry)}`),
      h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' } }, rpill(rNow), p?.upl !== undefined ? h('span.mono', { class: p.upl >= 0 ? 'good' : 'bad' }, fmt.sUsd(p.upl)) : null)),
    d ? h('div.rmeter', h('div.track'),
      [-1, 0, 1, 2, 3].map(r => h('div.tick', { style: { left: pct(r) } }, h('span', r === -1 ? 'stop' : r === 0 ? 'entry' : r === 1 ? '+1R add' : r === 2 ? '+2R add' : '+3R'))),
      rNow !== null ? h('div.now', { style: { left: pct(rNow) } }) : null) : h('div.warnline', icon('triangle-alert', 'sm'), 'No stop known, so R cannot be computed. Rule 2: place the stop now.'),
    h('div.checks-mini', checks.map(([ok, label]) => h(`span${ok === true ? '.ok' : ok === false ? '.no' : ''}`, icon(ok ? 'check' : ok === false ? 'x' : 'minus', 'sm'), label)),
      c4 ? h('span', { title: 'Rule 6: no expansion by candle four, exit at breakeven' }, icon('hourglass', 'sm'), 'Candle 4 ', h('b.mono', { dataset: { countdown: c4 } }, '')) : null));
}

function toLogCard(st, ctx) {
  const list = st.unreviewed || [];
  return h(`div.card${list.length ? '.glow' : ''}`,
    h('div.card-h', h('h3', icon('notebook-pen'), 'Log these now'), h('span.sub', 'Within 10 minutes of the close = +30 XP fresh-log bonus'),
      h('div.right', h('button.btn.sm', { onclick: () => ctx.go('journal/new-skip') }, icon('hand', 'sm'), 'Log a skipped setup'))),
    list.length ? h('div.col', list.slice(0, 5).map(t => h('div.row', { style: { padding: '10px 12px', borderRadius: '11px', border: '1px solid var(--line)', background: 'var(--panel-2)', cursor: 'pointer' }, onclick: () => ctx.go(`journal/${t.id}`) },
      h('b', t.symbol), dirChip(t.direction), rpill(t.r), h('span.muted', { style: { fontSize: '12px' } }, `closed ${fmt.ago(t.closed_at)}`),
      h('div', { style: { marginLeft: 'auto' } }, h('span.timerpill', { dataset: { logdeadline: t.closed_at + st.thresholds.log_within_minutes * 60000 } }, ''))))) :
      h('div.empty', icon('check-circle-2'), h('div', 'Journal is up to date.'), h('div', { style: { fontSize: '12px', marginTop: '4px' } }, 'Saw a setup you passed on? Log it. Skipped trades teach you whether the problem is finding setups or pulling the trigger.')));
}

function watchTile(w, ctx) {
  if (w.loading) return h('div.card.wtile', h('div.row.between', h('b', w.symbol), h('span.muted', 'loading…')), h('div.skeleton', { style: { height: '44px', marginTop: '10px' } }));
  const top = w.top;
  const up = (w.change24h || 0) >= 0;
  return h('div.card.wtile', { onclick: () => ctx.go(`markets/${w.symbol}`) },
    h('div.row.between', h('div.row', h('b', { style: { fontFamily: 'var(--display)', fontSize: '16px' } }, w.symbol.replace('USDT', '')), h('span.muted', { style: { fontSize: '12px' } }, 'USDT perp'), w.thin ? h('span.chip', { title: 'Thin asset: 0.4 ATR floor, 2% width floor' }, 'thin') : null),
      top ? stateChip(top.state) : h('span.muted', { style: { fontSize: '12px' } }, 'nothing in play')),
    h('div.row', { style: { marginTop: '6px', alignItems: 'baseline' } }, h('span.px', fmt.px(w.price)), h('span.mono', { class: up ? 'good' : 'bad', style: { fontSize: '13px' } }, fmt.pct(w.change24h, 2, true))),
    spark(w.spark, { color: up ? 'var(--s3)' : 'var(--s8)' }),
    h('div.grid.g3', { style: { gap: '8px', fontSize: '12px' } },
      h('div', h('div.muted', 'Funding 8h'), h('b.mono', { class: w.funding?.stretched ? 'warn' : '' }, fmt.pct(w.funding?.rate_8h_pct, 4))),
      h('div', h('div.muted', 'OI 1h'), h('b.mono', { class: (w.oi?.chg_1h || 0) >= 0 ? 'good' : 'bad' }, fmt.pct(w.oi?.chg_1h, 2, true))),
      h('div', h('div.muted', 'Regime'), h('b', w.regime?.regime || '—'))),
    h('div', { style: { marginTop: '10px', fontSize: '12px', color: 'var(--ink-2)' } }, icon('waves', 'sm'), ' ', h('b', w.mechanism?.name || '—')),
    top ? h('div', { style: { marginTop: '8px', fontSize: '12px', color: 'var(--ink-2)' } }, `${fmt.px(top.price)} · ${top.setup || ''} ${top.direction ? '(' + top.direction + ')' : ''}`) : null);
}

function coachCard(st, ctx) {
  const msgs = (st.coach || []).slice(0, 5);
  return h('div.card',
    h('div.card-h', h('h3', icon('brain'), st.settings.coach_name || 'Coach'), h('span.sub', 'Firm, specific, cites the rule')),
    h('div.mantra', { style: { margin: '4px 0 16px' } }, st.mantra),
    msgs.length ? msgs.map(m => ctx.coachItem(m)) : h('div.muted', 'No messages yet.'));
}

function questsCard(st, ctx) {
  const q = st.game.quests || [];
  return h('div.card',
    h('div.card-h', h('h3', icon('target'), 'Weekly quests'), h('span.sub', q[0] ? `resets in ${q[0].ends_in_h}h` : ''), h('div.right', h('span.chip.xp', '+150 XP each'))),
    q.map(x => h('div', { style: { padding: '12px 0', borderBottom: '1px solid var(--line)' } },
      h('div.row', icon(x.done ? 'check-circle-2' : 'circle-dot', x.done ? '' : ''), h('b', { class: x.done ? 'good' : '' }, x.title), h('span.muted.mono', { style: { marginLeft: 'auto', fontSize: '12px' } }, `${x.progress}/${x.goal}`)),
      h('div.muted', { style: { fontSize: '12px', margin: '2px 0 8px 26px' } }, x.desc),
      h('div.bar.accent', { style: { marginLeft: '26px' } }, h('i', { style: { width: `${Math.round(x.progress / x.goal * 100)}%` } })))),
    h('div.help', { style: { marginTop: '10px' } }, 'Quests reward process only. None of them pay you to trade more.'));
}

function updateTimers() {
  const now = Date.now();
  document.querySelectorAll('[data-countdown]').forEach(el => {
    const at = +el.dataset.countdown; if (!at) return;
    el.textContent = fmt.dur(at - now);
  });
  document.querySelectorAll('[data-logdeadline]').forEach(el => {
    const left = +el.dataset.logdeadline - now;
    if (left > 0) { el.textContent = `${fmt.dur(left)} left`; el.classList.remove('late'); }
    else { el.textContent = 'late, log anyway'; el.classList.add('late'); }
  });
}

// ---------------------------------------------------------------- daily check-in ritual
export function openCheckin(ctx) {
  const st = ctx.state;
  const rules = [
    'Risk 1% per trade. Size comes from the stop.', 'Entry is the decisive close back inside. Never the wick.',
    'No expansion by candle four: exit at breakeven.', 'Never move a stop away from entry.',
    'Middle third of the range: no trade.', 'Both gates must pass.',
  ];
  const rod = rules[Math.floor(Date.now() / 86400000) % rules.length];
  const ans = { macro: st.settings.macro_today ? 'yes' : 'no' };
  const m = modal({
    title: 'Pre-session check-in', icon: 'sunrise',
    body: h('div.col', { style: { gap: '16px' } },
      h('div.row', { style: { gap: '16px', alignItems: 'flex-start' } },
        h('div', { style: { flex: 1 } }, h('div.eyebrow', 'Session right now'), h('h2', { style: { marginTop: '4px' } }, { clear: 'Clear', caution: 'Caution', stand_down: 'Stand down' }[st.session.status]),
          h('div.dim', { style: { fontSize: '13px' } }, st.session.reasons.map(r => r.text).join(' ') || 'No session flags.')),
        h('div', { style: { flex: 1.2, padding: '14px', borderRadius: '12px', background: 'var(--accent-soft)', border: '1px solid rgba(54,215,199,.3)' } }, h('div.eyebrow', 'Rule of the day'), h('div.mantra', { style: { fontSize: '16px', marginTop: '6px' } }, rod))),
      h('div.f', 'Macro event today? (CPI, FOMC, major token unlock)', segmented([['no', 'No'], ['yes', 'Yes']], ans.macro, v => { ans.macro = v; })),
      h('div.help', 'Flagging a macro day puts the session on caution. Checking in pays +10 XP and keeps your streak.')),
    foot: [h('button.btn.ghost', { onclick: () => m.close() }, 'Later'),
      h('button.btn.xp', { onclick: async (e) => {
        const r = await api.post('/api/checkin', { macro: ans.macro === 'yes' });
        m.close();
        ctx.celebrateXP(r.data.xp, e.target);
        confetti({ particleCount: 60, spread: 60 });
        toast('Checked in', 'Streak extended. Grade the process today.', 'xp');
        await ctx.refresh();
        if (rootEl && ctx.current === 'command') draw(rootEl, ctx);
      } }, icon('check'), 'Check in (+10 XP)')],
  });
}
