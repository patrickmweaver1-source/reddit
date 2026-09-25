// UI toolkit: element builder, icons, formatting, toasts, modals, sound, celebration.
import { ICONS } from './icons.js';

// ---------------------------------------------------------------- element builder
export function h(tag, attrs, ...kids) {
  const [t, ...cls] = tag.split('.');
  const el = document.createElement(t || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const frag = (...kids) => { const f = document.createDocumentFragment(); append(f, kids); return f; };
export function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  for (const k of kids.flat(Infinity)) if (k) el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

const ICON_ALIAS = { pen: 'pen-line', hand: 'hand', clock: 'clock-3', dial: 'gauge', shield: 'shield-check', door: 'door-open',
  gate: 'ban', list: 'list-checks', ladder: 'chart-column', four: 'hourglass', thirty: 'target', calendar: 'calendar-days',
  book: 'book-open-text', flame: 'flame', moon: 'moon', lotus: 'flower-2' };
export function icon(name, cls = '') {
  const inner = ICONS[name] || ICONS[ICON_ALIAS[name]] || ICONS['circle-dot'];
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `i ${cls}`.trim());
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = inner;
  return s;
}

// ---------------------------------------------------------------- formatting
export const TZ = 'America/New_York';
const _etF = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
/* Wall-clock parts in Eastern Time. */
export function etParts(ms) {
  const o = {}; for (const p of _etF.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}:${o.minute}`, sec: o.second, zone: o.timeZoneName, y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute };
}
/* Seconds to add to a UTC timestamp to get Eastern wall-clock time. */
export function etOffsetSec(ms) {
  const p = etParts(ms);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, +p.sec) - Math.floor(ms / 1000) * 1000) / 1000);
}
/* An Eastern date + time typed by the user -> UTC milliseconds. */
export function etToUtcMs(date, time) {
  const [y, mo, d] = String(date).split('-').map(Number); const [h, mi] = String(time || '0:0').split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h || 0, mi || 0);
  let ms = guess - etOffsetSec(guess) * 1000;
  ms = guess - etOffsetSec(ms) * 1000;
  return ms;
}
export const fmt = {
  num(v, d = 2) { if (v === null || v === undefined || Number.isNaN(v)) return '—'; return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); },
  px(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    const a = Math.abs(v); const d = a >= 1000 ? 2 : a >= 100 ? 2 : a >= 10 ? 3 : a >= 1 ? 4 : a >= 0.1 ? 5 : 6;
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  usd(v, d = 2) { if (v === null || v === undefined || Number.isNaN(v)) return '—'; const s = v < 0 ? '-' : ''; return `${s}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`; },
  sUsd(v) { if (v === null || v === undefined) return '—'; return (v > 0 ? '+' : '') + fmt.usd(v); },
  pct(v, d = 1, sign = false) { if (v === null || v === undefined || Number.isNaN(v)) return '—'; return (sign && v > 0 ? '+' : '') + Number(v).toFixed(d) + '%'; },
  r(v, d = 2) { if (v === null || v === undefined || Number.isNaN(v)) return '—'; return (v > 0 ? '+' : '') + Number(v).toFixed(d) + 'R'; },
  qty(v) { if (v === null || v === undefined) return '—'; return Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 }); },
  compact(v) { if (v === null || v === undefined) return '—'; return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v); },
  utc(ms, withDate = false) {
    if (!ms) return '—';
    const d = new Date(ms); const p = (n) => String(n).padStart(2, '0');
    const t = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
    return withDate ? `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${t}` : t;
  },
  local(ms) { if (!ms) return '—'; return new Date(ms).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); },
  /* Eastern Time (follows daylight saving: EDT in summer, EST in winter). */
  et(ms, withDate = false) {
    if (!ms) return '—';
    const t = new Date(ms).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    return withDate ? `${etParts(ms).date} ${t}` : t;
  },
  tz(ms = Date.now()) { return etParts(ms).zone; },
  ago(ms) {
    if (!ms) return '—';
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`;
  },
  dur(ms) {
    if (ms === null || ms === undefined) return '—';
    const neg = ms < 0; ms = Math.abs(ms);
    const s = Math.floor(ms / 1000); const hh = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); const ss = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return (neg ? '-' : '') + (hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`);
  },
};
export function rpill(r) {
  if (r === null || r === undefined) return h('span.rpill.zero', '—');
  return h(`span.rpill.${r > 0.05 ? 'up' : r < -0.05 ? 'down' : 'zero'}`, fmt.r(r));
}
export function stateChip(s) { return h(`span.state.${s}`, (s || '').replace('DEAD_', 'DEAD ').replace('_', ' ')); }
export function dirChip(d) { return d ? h(`span.chip.${d === 'Long' ? 'long' : 'short'}`, icon(d === 'Long' ? 'arrow-up-right' : 'arrow-down-right', 'sm'), d) : null; }
export function gradeChip(g) { return g ? h(`span.chip.grade-${g}`, `Grade ${g}`) : null; }

// ---------------------------------------------------------------- toasts
export function toast(title, body = '', kind = 'info', ms = 5000) {
  const box = document.getElementById('toasts');
  const icn = { info: 'info', warn: 'triangle-alert', alert: 'octagon-x', stop: 'octagon-x', praise: 'sparkles', xp: 'sparkles', good: 'check-circle-2' }[kind] || 'info';
  const col = { warn: 'warn', alert: 'bad', stop: 'bad', good: 'good', xp: 'accent' }[kind] || 'dim';
  const el = h(`div.toast.${kind}`, h(`span.${col}`, icon(icn)), h('div', h('div.tt', title), body ? h('div.tb', body) : null));
  el.addEventListener('click', () => dismiss());
  box.appendChild(el);
  const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  if (ms) setTimeout(dismiss, ms);
  return el;
}
export function xpFloat(amount, anchor) {
  if (!amount) return;
  const r = anchor ? anchor.getBoundingClientRect() : { left: window.innerWidth - 300, top: 60, width: 0 };
  const el = h('div.xpfloat', `${amount > 0 ? '+' : ''}${amount} XP`);
  el.style.left = `${r.left + r.width / 2 - 40}px`; el.style.top = `${r.top}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// ---------------------------------------------------------------- modal
export function modal({ title, icon: ic, body, foot, wide = false, onClose }) {
  const m = document.getElementById('modal');
  clear(m);
  const close = () => { m.classList.remove('open'); clear(m); onClose && onClose(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  const box = h(`div.mbox${wide ? '.wide' : ''}`,
    h('div.mh', ic ? icon(ic) : null, h('h2', title), h('div', { style: { marginLeft: 'auto' } }, h('button.iconbtn', { onclick: close, 'aria-label': 'Close' }, icon('x')))),
    h('div.mb', body),
    foot ? h('div.mf', foot) : null);
  m.appendChild(box);
  m.onclick = (e) => { if (e.target === m) close(); };
  m.classList.add('open');
  return { close, box };
}
export function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const md = modal({ title, body: h('p.dim', text), onClose: () => { if (!done) resolve(false); },
      foot: [h('button.btn.ghost', { onclick: () => { done = true; resolve(false); md.close(); } }, 'Cancel'),
        h(`button.btn.${danger ? 'danger' : 'primary'}`, { onclick: () => { done = true; resolve(true); md.close(); } }, okLabel)] });
  });
}

// ---------------------------------------------------------------- sound (synthesized, no files)
let actx = null; let soundOn = true;
export function setSound(on) { soundOn = !!on; }
export function sound(kind = 'tick') {
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const now = actx.currentTime;
    const seq = {
      tick: [[880, 0, 0.05, 0.05]],
      chime: [[784, 0, 0.18, 0.12], [1175, 0.09, 0.3, 0.1]],
      xp: [[660, 0, 0.12, 0.09], [990, 0.07, 0.18, 0.09], [1320, 0.14, 0.25, 0.08]],
      level: [[523, 0, 0.18, 0.12], [659, 0.12, 0.18, 0.12], [784, 0.24, 0.18, 0.12], [1047, 0.36, 0.5, 0.14]],
      warn: [[620, 0, 0.15, 0.1], [520, 0.16, 0.2, 0.1]],
      alarm: [[880, 0, 0.14, 0.14], [660, 0.16, 0.14, 0.14], [880, 0.32, 0.14, 0.14], [660, 0.48, 0.2, 0.14]],
      stamp: [[140, 0, 0.18, 0.25], [90, 0.02, 0.25, 0.2]],
    }[kind] || [[880, 0, 0.05, 0.05]];
    for (const [f, t, d, g] of seq) {
      const o = actx.createOscillator(); const gn = actx.createGain();
      o.type = kind === 'alarm' ? 'square' : kind === 'stamp' ? 'triangle' : 'sine';
      o.frequency.value = f;
      gn.gain.setValueAtTime(0.0001, now + t);
      gn.gain.exponentialRampToValueAtTime(g * 0.6, now + t + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, now + t + d);
      o.connect(gn).connect(actx.destination);
      o.start(now + t); o.stop(now + t + d + 0.05);
    }
  } catch { /* audio unavailable */ }
}

// ---------------------------------------------------------------- confetti
let confettiInst = null; let motionOk = true;
export function setMotion(ok) { motionOk = ok; document.body.classList.toggle('reduced', !ok); }
export function confetti(opts = {}) {
  if (!motionOk || !window.confetti) return;
  confettiInst = confettiInst || window.confetti.create(document.getElementById('confetti'), { resize: true, useWorker: false });
  confettiInst({ particleCount: 120, spread: 80, startVelocity: 42, origin: { y: 0.65 },
    colors: ['#36d7c7', '#8b7bff', '#c26bff', '#f4c24f', '#ffffff'], ...opts });
}

// ---------------------------------------------------------------- tweened numbers
export function tween(el, to, { d = 800, format = (v) => v.toFixed(0) } = {}) {
  const from = parseFloat(el.dataset.v || '0') || 0;
  el.dataset.v = to;
  if (!motionOk || from === to || !Number.isFinite(to)) { el.textContent = Number.isFinite(to) ? format(to) : '—'; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / d); const e = 1 - Math.pow(1 - k, 3);
    el.textContent = format(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------- ring gauge
export function ring(value, { size = 132, stroke = 11, color = 'var(--accent)', label = '', sub = '', max = 100 } = {}) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  const pct = value === null || value === undefined ? 0 : Math.max(0, Math.min(1, value / max));
  const s = svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` },
    svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'rgba(var(--ov),0.063)', 'stroke-width': stroke }),
    svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: color, 'stroke-width': stroke, 'stroke-linecap': 'round',
      'stroke-dasharray': `${c}`, 'stroke-dashoffset': `${c}`, style: `transition: stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1); filter: drop-shadow(0 0 6px ${color})` }));
  const wrap = h('div.ring', s, h('div.lbl', h('b', label), sub ? h('span', sub) : null));
  requestAnimationFrame(() => requestAnimationFrame(() => { s.lastChild.setAttribute('stroke-dashoffset', `${c * (1 - pct)}`); }));
  return wrap;
}

export function segmented(options, value, onChange, cls = '') {
  const el = h(`div.seg${cls ? '.' + cls : ''}`);
  const render = (v) => {
    clear(el);
    for (const o of options) {
      const [val, label] = Array.isArray(o) ? o : [o, o];
      el.appendChild(h(`button${String(v) === String(val) ? '.on' : ''}`, { type: 'button', dataset: { v: val }, onclick: () => { render(val); onChange(val); } }, label));
    }
  };
  render(value);
  return el;
}
export function toggle(on, onChange) {
  const el = h(`button.toggle${on ? '.on' : ''}`, { type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false' });
  el.onclick = () => { on = !on; el.classList.toggle('on', on); el.setAttribute('aria-checked', on); onChange(on); };
  return el;
}
export function field(label, input, help) { return h('div.f', label, input, help ? h('span.help', help) : null); }
export function numInput(value, attrs = {}) { return h('input.input.num', { type: 'number', step: 'any', value: value ?? '', ...attrs }); }

export function spark(values, { w = 240, hgt = 44, color = 'var(--s1)' } = {}) {
  const s = svg('svg', { class: 'spark', viewBox: `0 0 ${w} ${hgt}`, preserveAspectRatio: 'none' });
  if (!values || values.length < 2) return s;
  const mn = Math.min(...values); const mx = Math.max(...values); const rg = mx - mn || 1;
  const pts = values.map((v, i) => [i / (values.length - 1) * w, hgt - 3 - (v - mn) / rg * (hgt - 6)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  s.appendChild(svg('path', { d: `${d}L${w},${hgt}L0,${hgt}Z`, fill: color, opacity: 0.1 }));
  s.appendChild(svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
  return s;
}

/** Null-safe append (Element.append would render null as the text "null"). */
export function put(el, ...kids) { append(el, kids); return el; }
