// App shell: routing, global state, live events, top bar, coach drawer, celebrations.
import { api, connectEvents } from './api.js';
import { etParts } from './ui.js';
import { h, icon, clear, fmt, toast, xpFloat, sound, setSound, confetti, setMotion, modal, put } from './ui.js';
import * as command from './pages/command.js';
import * as checklist from './pages/checklist.js';
import * as planner from './pages/planner.js';
import * as markets from './pages/markets.js';
import * as journal from './pages/journal.js';
import * as dashboard from './pages/dashboard.js';
import * as study from './pages/study.js';
import * as playbook from './pages/playbook.js';
import * as progress from './pages/progress.js';
import * as learning from './pages/learning.js';
import * as settings from './pages/settings.js';
import * as pushdev from './push.js';

const PAGES = {
  command: { mod: command, title: 'Command Center', icon: 'layout-dashboard', sec: 'Trade' },
  checklist: { mod: checklist, title: 'Pre-Trade Checklist', icon: 'list-checks', sec: 'Trade' },
  planner: { mod: planner, title: 'Position Planner', icon: 'calculator', sec: 'Trade' },
  markets: { mod: markets, title: 'Market Monitor', icon: 'candlestick-chart', sec: 'Trade' },
  journal: { mod: journal, title: 'Trade Journal', icon: 'notebook-pen', sec: 'Review' },
  dashboard: { mod: dashboard, title: 'Dashboard', icon: 'chart-no-axes-combined', sec: 'Review' },
  playbook: { mod: playbook, title: 'Playbook & Coach', icon: 'scroll-text', sec: 'Review' },
  learning: { mod: learning, title: 'Learning', icon: 'brain', sec: 'Review' },
  study: { mod: study, title: 'Study Hall', icon: 'graduation-cap', sec: 'Grow' },
  progress: { mod: progress, title: 'Progress', icon: 'trophy', sec: 'Grow' },
  settings: { mod: settings, title: 'Settings', icon: 'settings', sec: 'Grow' },
};

const ctx = {
  state: null,
  current: null,
  params: [],
  api,
  go(route) { location.hash = `#/${route}`; },
  async refresh() {
    try {
      const prev = ctx.state;
      ctx.state = await api.get('/api/state');
      applyPrefs();
      renderTop();
      renderNav();
      renderConn();
      detectLevelUp(prev, ctx.state);
      return ctx.state;
    } catch (e) {
      renderConn(e.message);
      return null;
    }
  },
  onGame(fn) { gameListeners.add(fn); return () => gameListeners.delete(fn); },
  celebrateXP(amount, anchor) { if (amount) { xpFloat(amount, anchor); sound('xp'); } },
};
window.__trap = ctx;
const gameListeners = new Set();

function applyPrefs() {
  const s = ctx.state?.settings || {};
  setSound(s.sound !== false);
  setMotion(!s.reduced_motion);
}

// ---------------------------------------------------------------- nav
function renderNav() {
  const nav = document.getElementById('nav');
  clear(nav);
  let sec = null;
  const unreviewed = ctx.state?.unreviewed_count ?? ctx.state?.unreviewed?.length ?? 0;
  for (const [key, p] of Object.entries(PAGES)) {
    if (p.sec !== sec) { sec = p.sec; nav.appendChild(h('div.nav-sec', sec)); }
    const a = h(`a${ctx.current === key ? '.active' : ''}`, { href: `#/${key}`, title: p.title }, icon(p.icon), h('span', p.title));
    if (key === 'journal' && unreviewed) a.appendChild(h('span.badge-count', unreviewed));
    nav.appendChild(a);
  }
}

function renderConn(err) {
  const el = document.getElementById('conn-line');
  const c = ctx.state?.connection;
  clear(el);
  if (err) { put(el, h('span.dotlive.err'), h('span.lbl', 'App server offline')); return; }
  if (!c) return;
  if (c.demo) put(el, h('span.dotlive.demo'), h('span.lbl', 'Demo mode'));
  else if (c.connected && c.private_ws) put(el, h('span.dotlive.on'), h('span.lbl', `Bybit live · ${c.key_masked}`));
  else if (c.connected) put(el, h('span.dotlive'), h('span.lbl', `Bybit: ${c.status}`));
  else put(el, h(`span.dotlive${c.public_ws ? '.on' : ''}`), h('span.lbl', c.public_ws ? 'Market data only' : 'Connecting to market…'));
}

// ---------------------------------------------------------------- top bar
let clockTimer = null;
// ---------------------------------------------------------------- collapsible sidebar
// Laptop and iPad: the menu collapses away and the choice is remembered on this device.
// Phone: the menu is hidden by default and slides in over the page from the menu button.
function sidePref(v) { try { if (v === undefined) return localStorage.getItem('trap.side'); localStorage.setItem('trap.side', v); } catch { return null; } return null; }
function applySide() { document.body.classList.toggle('side-collapsed', sidePref() === 'collapsed'); }
function toggleSide() {
  if (window.matchMedia('(max-width: 720px)').matches) document.body.classList.toggle('side-open');
  else { const next = document.body.classList.contains('side-collapsed') ? 'open' : 'collapsed'; sidePref(next); applySide(); }
  renderTop();
}
function closeSideOverlay() { if (document.body.classList.contains('side-open')) { document.body.classList.remove('side-open'); renderTop(); } }
applySide();
document.addEventListener('click', (e) => {
  if (document.body.classList.contains('side-open') && !e.target.closest('#side') && !e.target.closest('.side-toggle')) closeSideOverlay();
});
window.matchMedia('(max-width: 720px)').addEventListener?.('change', () => { document.body.classList.remove('side-open'); renderTop(); });

function renderTop() {
  const top = document.getElementById('top');
  const st = ctx.state;
  if (!st) return;
  clear(top);
  const sess = st.session;
  const label = { clear: 'CLEAR TO TRADE', caution: 'CAUTION', stand_down: 'STAND DOWN' }[sess.status];
  const ic = { clear: 'shield-check', caution: 'triangle-alert', stand_down: 'shield-alert' }[sess.status];
  const phone = window.matchMedia('(max-width: 720px)').matches;
  const hidden = phone ? !document.body.classList.contains('side-open') : document.body.classList.contains('side-collapsed');
  put(top,
    h('button.iconbtn.side-toggle', { type: 'button', title: hidden ? 'Show the menu' : 'Hide the menu', 'aria-label': hidden ? 'Show the menu' : 'Hide the menu', onclick: toggleSide },
      icon(phone ? 'menu' : hidden ? 'panel-left-open' : 'panel-left-close')),
    h(`div.sess-pill.${sess.status}`, { onclick: () => ctx.go('command'), title: sess.reasons.map(r => r.text).join('\n') || 'All session checks pass' }, icon(ic), label),
    st.mode === 'demo' ? h('span.chip.demo', 'DEMO') : null,
    h('div.utc', { id: 'utc-clock' }),
    h('div.top-spacer'),
  );
  const g = st.game;
  const lv = g.level;
  const streaks = g.streaks;
  put(top, 
    h(`div.streak${streaks.checkin >= 3 ? '.hot' : ''}`, { title: `Check-in streak (best ${streaks.best_checkin})` }, icon('flame'), streaks.checkin),
    h(`div.streak${streaks.clean >= 5 ? '.hot' : ''}`, { title: `Clean trades in a row (best ${streaks.best_clean})` }, icon('shield-check'), streaks.clean),
    h('div.lvl-chip', { onclick: () => ctx.go('progress'), title: 'Progress' },
      h('div.hex', lv.level),
      h('div.xpbar', h('div.row', h('b', lv.rank), h('span', `${fmt.num(lv.xp, 0)} / ${fmt.num(lv.next, 0)} XP`)),
        h('div.bar', { style: { marginTop: '5px' } }, h('i', { style: { width: `${Math.round(lv.progress * 100)}%` } })))),
  );
  const unacked = (st.coach || []).filter(m => !m.acked).length;
  put(top, h('button.iconbtn', { onclick: openDrawer, title: 'Coach', 'aria-label': 'Coach messages' }, icon(unacked ? 'bell-ring' : 'bell'), unacked ? h('span.dot') : null));
  tickClock();
  clearInterval(clockTimer);
  clockTimer = setInterval(tickClock, 1000);
}
function tickClock() {
  const el = document.getElementById('utc-clock');
  if (!el) return;
  const now = Date.now();
  const t = etParts(now);
  el.replaceChildren(`${t.zone} `, h('b', t.time), ':' + t.sec);
}

// ---------------------------------------------------------------- coach drawer
function openDrawer() {
  const d = document.getElementById('drawer');
  const list = ctx.state?.coach || [];
  clear(d);
  put(d, 
    h('div.dh', icon('brain', 'lg'), h('div', h('h3', ctx.state?.settings?.coach_name || 'Coach'), h('div.muted', { style: { fontSize: '12px' } }, 'Cites the rule it enforces. Never talks you into a trade.')),
      h('button.btn.sm.ghost', { style: { marginLeft: 'auto' }, onclick: async () => { await api.post('/api/coach/ack', {}); await ctx.refresh(); openDrawer(); } }, 'Mark all read'),
      h('button.iconbtn', { onclick: closeDrawer }, icon('x'))),
    h('div.db', list.length ? list.map(coachItem) : h('div.empty', icon('bell'), h('div', 'Quiet. That is usually good.'))),
  );
  d.classList.add('open');
}
function closeDrawer() { document.getElementById('drawer').classList.remove('open'); }
export function coachItem(m) {
  const ic = { info: 'info', warn: 'triangle-alert', alert: 'octagon-x', stop: 'octagon-x', praise: 'sparkles' }[m.level] || 'info';
  return h(`div.coach-item.${m.level}${m.acked ? '.acked' : ''}`,
    h('div.ic', icon(ic)),
    h('div', { style: { flex: 1 } }, h('div.t', m.title), h('div.b', m.body),
      h('div.m', fmt.local(m.ts), m.rule ? ` · Rule ${m.rule}` : '', m.ref && m.ref.startsWith('trade:') ? h('a', { href: `#/journal/${m.ref.split(':')[1]}`, style: { marginLeft: '8px' }, onclick: closeDrawer }, 'Open trade') : null,
        m.ref && m.ref.startsWith('market:') ? h('a', { href: `#/markets/${m.ref.split(':')[1]}`, style: { marginLeft: '8px' }, onclick: closeDrawer }, 'Open chart') : null)));
}
ctx.coachItem = coachItem;

// ---------------------------------------------------------------- celebrations
function detectLevelUp(prev, cur) {
  if (!prev || !cur) return;
  const a = prev.game.level.level; const b = cur.game.level.level;
  if (b > a) celebrateLevel(cur.game.level);
}
export function celebrateLevel(lv) {
  sound('level'); confetti({ particleCount: 200, spread: 120 });
  const el = h('div.celebrate', { onclick: () => el.remove() },
    h('div.rays'),
    h('div.inner', h('div.hex.bighex', lv.level), h('div.eyebrow', 'Level up'), h('h1', lv.rank),
      h('p.dim', 'Earned by process, not profit. Keep grading the execution.'), h('div.muted', { style: { marginTop: '14px' } }, 'Click anywhere to continue')));
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 7000);
}
function celebrateBadge(b) {
  sound('chime'); confetti({ particleCount: 90, spread: 70, colors: ['#f4c24f', '#ffffff', '#d98c55'] });
  const el = h('div.celebrate', { onclick: () => el.remove() },
    h('div.inner', h('div', { class: `medal t${b.tier}`, style: { border: 0, background: 'transparent' } }, h('div.disc', { style: { width: '120px', height: '120px' } }, icon(b.icon, 'xl'))),
      h('div.eyebrow', 'Badge unlocked'), h('h1', b.name), h('p.dim', b.desc), h('div.muted', 'Click anywhere to continue')));
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

// ---------------------------------------------------------------- live events
function onEvent(msg) {
  const { kind, data } = msg;
  if (kind === 'coach') {
    const lvl = data.level;
    toast(data.title, data.body, lvl === 'praise' ? 'xp' : lvl, lvl === 'alert' || lvl === 'stop' ? 12000 : 6000);
    sound(data.sound || 'tick');
    if ((lvl === 'alert' || lvl === 'stop') && document.hidden && ctx.state?.settings?.notifications && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(`TRAP: ${data.title}`, { body: data.body }); } catch { /* ignore */ }
    }
    if (ctx.state) ctx.state.coach = [data, ...(ctx.state.coach || [])].slice(0, 50);
    renderTop();
  } else if (kind === 'badge') {
    celebrateBadge(data);
  } else if (kind === 'game') {
    if (ctx.state) {
      const before = ctx.state.game.level;
      ctx.state.game.level = data.level; ctx.state.game.streaks = data.streaks;
      if (data.level.level > before.level) celebrateLevel(data.level);
      renderTop();
    }
    gameListeners.forEach(fn => fn(data));
  } else if (kind === 'session') {
    if (ctx.state) { ctx.state.session = data; renderTop(); }
  } else if (kind === 'rules') {
    toast('Playbook updated', `Rulebook v${data.id} is now live everywhere: checklist floors, planner add-on triggers, dashboard buckets and session gates.`, 'good', 8000);
    ctx.refresh();
  }
  const page = PAGES[ctx.current];
  if (page && page.mod.onEvent) page.mod.onEvent(msg, ctx);
}

// ---------------------------------------------------------------- router
let routeSeq = 0;
async function route() {
  const seq = ++routeSeq;
  const parts = (location.hash.replace(/^#\/?/, '') || 'command').split('/');
  const key = PAGES[parts[0]] ? parts[0] : 'command';
  const prev = PAGES[ctx.current];
  if (prev && prev.mod.destroy) prev.mod.destroy();
  ctx.current = key; ctx.params = parts.slice(1).map(decodeURIComponent);
  closeSideOverlay();
  renderNav();
  const view = document.getElementById('view');
  clear(view);
  view.scrollTop = 0;
  document.title = `${PAGES[key].title} · TRAP Discipline`;
  // Each visit renders into its own container. A page still waiting on the
  // server when you move on finishes into a detached container instead of
  // drawing over the page you are now on.
  const pane = h('div.page-root');
  view.appendChild(pane);
  try {
    await PAGES[key].mod.render(pane, ctx);
  } catch (e) {
    console.error(e);
    if (seq === routeSeq) put(pane, h('div.card', h('div.errline', icon('octagon-x'), h('div', h('b', 'This page failed to load. '), e.message))));
  }
}

async function boot() {
  await ctx.refresh();
  window.addEventListener('hashchange', route);
  await route();
  connectEvents(onEvent, (ok) => { if (!ok) renderConn('offline'); else renderConn(); });
  pushdev.boot();
  setInterval(() => { if (!document.hidden) ctx.refresh().then(() => { const p = PAGES[ctx.current]; if (p?.mod.onTick) p.mod.onTick(ctx); }); }, 8000);
  // gentle one-time notification permission ask (only after a user gesture)
  document.addEventListener('click', () => {
    if (ctx.state?.settings?.notifications && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }, { once: true });
  if (ctx.state && !ctx.state.game.streaks.checked_in_today) setTimeout(() => command.openCheckin(ctx), 600);
}
boot();
export { ctx, modal };
