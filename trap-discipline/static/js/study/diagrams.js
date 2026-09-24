// Original, schematic teaching diagrams (not market data). Built from simple
// close paths so every pattern is drawn consistently.
import { svg, h, put } from '../ui.js';

const UP = '#199e70'; const DN = '#e66767'; const INK = '#a9b3c2'; const MUTED = '#6f7a8b';

/** Build OHLC candles from a close path. `special` overrides by index: {i: {h, l, o}} */
export function fromCloses(closes, { wick = 0.35, special = {}, seed = 3 } = {}) {
  let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  return closes.map((c, i) => {
    const o = i === 0 ? c - 0.3 : closes[i - 1];
    const body = Math.abs(c - o);
    const k = { o, c, h: Math.max(o, c) + wick * (0.3 + rnd()) * Math.max(0.6, body), l: Math.min(o, c) - wick * (0.3 + rnd()) * Math.max(0.6, body) };
    return { ...k, ...(special[i] || {}) };
  });
}

/**
 * Candle chart with annotations.
 * opts: { candles, height, lines:[{y, label, color, dash}], marks:[{i, y, label, color, dir}], zones:[{y0,y1,color}],
 *         segs:[{i0,y0,i1,y1,color,dash,label}], shade:[{i0,i1,color}], title }
 */
export function candleFig(opts) {
  const { candles, height = 220, lines = [], marks = [], zones = [], segs = [], shade = [], vol = null, oi = null } = opts;
  const W = 720; const panels = (vol ? 1 : 0) + (oi ? 1 : 0);
  const mainH = height; const subH = 56; const H = mainH + panels * (subH + 10) + 8;
  const ys = candles.flatMap(k => [k.h, k.l]).concat(lines.map(l => l.y)).concat(zones.flatMap(z => [z.y0, z.y1]));
  const lo = Math.min(...ys); const hi = Math.max(...ys); const pad = (hi - lo) * 0.08;
  const Y = (v) => 10 + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (mainH - 20);
  const n = candles.length; const bw = (W - 110) / n; const X = (i) => 20 + i * bw + bw / 2;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  for (const z of zones) put(s, svg('rect', { x: 20, width: W - 110, y: Y(Math.max(z.y0, z.y1)), height: Math.abs(Y(z.y0) - Y(z.y1)), fill: z.color || 'rgba(54,215,199,.10)' }));
  for (const sh of shade) put(s, svg('rect', { x: X(sh.i0) - bw / 2, width: (sh.i1 - sh.i0 + 1) * bw, y: 4, height: mainH - 8, fill: sh.color || 'rgba(139,123,255,.08)', rx: 6 }));
  for (const l of lines) {
    put(s, svg('line', { x1: 20, x2: W - 90, y1: Y(l.y), y2: Y(l.y), stroke: l.color || INK, 'stroke-width': 1.3, 'stroke-dasharray': l.dash ?? '5 4' }));
    if (l.label) put(s, svg('text', { x: W - 86, y: Y(l.y) + 4, fill: l.color || INK, 'font-size': 12, 'font-family': 'Inter, sans-serif' }, l.label));
  }
  candles.forEach((k, i) => {
    const col = k.color || (k.c >= k.o ? UP : DN);
    put(s, svg('line', { x1: X(i), x2: X(i), y1: Y(k.h), y2: Y(k.l), stroke: col, 'stroke-width': 1.4 }));
    put(s, svg('rect', { x: X(i) - bw * 0.32, width: Math.max(2, bw * 0.64), y: Y(Math.max(k.o, k.c)), height: Math.max(1.5, Math.abs(Y(k.o) - Y(k.c))), fill: col, rx: 1 }));
  });
  for (const g of segs) {
    put(s, svg('line', { x1: X(g.i0), x2: X(g.i1), y1: Y(g.y0), y2: Y(g.y1), stroke: g.color || '#f4c24f', 'stroke-width': 1.8, 'stroke-dasharray': g.dash || '' }));
    if (g.label) put(s, svg('text', { x: X(g.i1) + 6, y: Y(g.y1), fill: g.color || '#f4c24f', 'font-size': 11.5, 'font-family': 'Inter, sans-serif' }, g.label));
  }
  for (const m of marks) {
    const x = X(m.i); const y = Y(m.y); const up = m.dir !== 'down';
    const col = m.color || '#36d7c7';
    put(s, svg('circle', { cx: x, cy: y, r: 5, fill: col, stroke: '#0a0f16', 'stroke-width': 2 }));
    if (m.label) {
      const ty = up ? y - 14 : y + 22;
      put(s, svg('text', { x, y: ty, 'text-anchor': 'middle', fill: col, 'font-size': 12, 'font-weight': 700, 'font-family': 'Inter, sans-serif', stroke: '#0a0f16', 'stroke-width': 4, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, m.label));
    }
  }
  let yOff = mainH + 8;
  const sub = (vals, label, color, kind) => {
    const mx = Math.max(...vals); const mn = kind === 'line' ? Math.min(...vals) : 0;
    const Ys = (v) => yOff + subH - ((v - mn) / (mx - mn || 1)) * (subH - 8);
    put(s, svg('text', { x: 20, y: yOff + 10, fill: MUTED, 'font-size': 10.5, 'font-family': 'Inter, sans-serif', 'letter-spacing': '.08em' }, label));
    if (kind === 'bar') vals.forEach((v, i) => put(s, svg('rect', { x: X(i) - bw * 0.3, width: Math.max(2, bw * 0.6), y: Ys(v), height: yOff + subH - Ys(v), fill: color, opacity: 0.8, rx: 1 })));
    else put(s, svg('path', { d: vals.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Ys(v)}`).join(''), fill: 'none', stroke: color, 'stroke-width': 2 }));
    yOff += subH + 10;
  };
  if (vol) sub(vol, 'VOLUME', '#3987e5', 'bar');
  if (oi) sub(oi, 'OPEN INTEREST', '#9085e9', 'line');
  return s;
}

export function fig(node, caption) { return h('div.fig', node, caption ? h('div.cap', caption) : null); }

/** Tiny three-panel "price / volume / OI" arrow card used in the matrix section. */
export function arrows(p, v, o) {
  const a = (dir, label) => h('div', { style: { textAlign: 'center' } }, h('div', { style: { fontSize: '22px', color: dir > 0 ? UP : dir < 0 ? DN : MUTED, fontWeight: 700 } }, dir > 0 ? '▲' : dir < 0 ? '▼' : '■'), h('div', { style: { fontSize: '11px', color: MUTED } }, label));
  return h('div', { style: { display: 'flex', gap: '14px' } }, a(p, 'price'), a(v, 'volume'), a(o, 'OI'));
}
