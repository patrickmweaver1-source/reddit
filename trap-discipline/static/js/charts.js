// Hand-built SVG charts. Thin marks (2px lines, <=24px bars with 4px rounded
// data ends), hairline recessive grid, one y-axis, hover tooltips by default.
// Charts render at the container's true pixel width (a ResizeObserver redraws
// on size changes) so text and markers are never stretched.
import { h, svg, fmt } from './ui.js';

function niceTicks(min, max, n = 5) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min; const step0 = span / n; const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || 10 * mag;
  const lo = Math.floor(min / step) * step; const hi = Math.ceil(max / step) * step;
  const out = []; for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}

/* Redraw `draw(width)` at the wrap's true width, and again whenever it changes. */
function responsive(wrap, draw) {
  let last = 0;
  const render = () => {
    const w = Math.max(320, Math.round(wrap.clientWidth || 0) || 800);
    if (Math.abs(w - last) < 8) return;
    last = w; draw(w);
  };
  requestAnimationFrame(render);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(render);
    ro.observe(wrap);
  }
  draw(800); // immediate draw so the chart exists even before layout
}

/* Position the tooltip at (px,py) in svg units, flipped near the edges so it
   never overflows the card. */
function placeTip(tip, px, py, W, H) {
  const fx = px / W; const fy = py / H;
  tip.style.left = `${fx * 100}%`;
  tip.style.top = `${Math.max(0.06, fy) * 100}%`;
  const tx = fx > 0.8 ? '-100%' : fx < 0.14 ? '0' : '-50%';
  const ty = fy < 0.28 ? '18px' : '-110%';
  tip.style.transform = `translate(${tx}, ${ty})`;
  tip.style.display = 'block';
}

/** Line (optionally area) chart.
 *  series: [{name, color, points:[{x, y, label?}], area?:bool}]
 *  x values are indices or timestamps (numeric). */
export function lineChart(series, { height = 240, yFmt = (v) => fmt.num(v, 0), xFmt = (v) => v, zero = false, refLines = [], tipFmt, endLabels = true } = {}) {
  const wrap = h('div.chart');
  const tip = h('div.tip'); wrap.appendChild(tip);
  const all = series.flatMap(s => s.points);
  if (!all.length) { wrap.appendChild(h('div.empty', 'No data yet.')); return wrap; }
  const holder = svg('svg', {});
  wrap.appendChild(holder);
  if (series.length > 1) wrap.appendChild(h('div.legend', { style: { marginTop: '8px' } }, series.map(se => h('span', h('i', { style: { background: se.color } }), se.name))));

  const draw = (W) => {
    const H = height; const m = { l: 56, r: endLabels ? 64 : 16, t: 12, b: 26 };
    const xs = all.map(p => p.x); const ys = all.map(p => p.y).concat(zero ? [0] : []).concat(refLines.map(r => r.y));
    const xmin = Math.min(...xs); const xmax = Math.max(...xs);
    const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
    const ymin = ticks[0]; const ymax = ticks[ticks.length - 1];
    const X = (x) => m.l + (xmax === xmin ? 0.5 : (x - xmin) / (xmax - xmin)) * (W - m.l - m.r);
    const Y = (y) => m.t + (1 - (y - ymin) / (ymax - ymin || 1)) * (H - m.t - m.b);
    holder.setAttribute('viewBox', `0 0 ${W} ${H}`);
    holder.setAttribute('style', `height:${H}px`);
    holder.replaceChildren();
    const g = svg('g', { class: 'axis' });
    for (const t of ticks) {
      g.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: t === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }));
      g.appendChild(svg('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }, yFmt(t)));
    }
    const xt = niceTicks(xmin, xmax, Math.max(3, Math.floor((W - m.l - m.r) / 110))).filter(v => v >= xmin && v <= xmax);
    for (const t of xt) g.appendChild(svg('text', { x: X(t), y: H - 6, 'text-anchor': 'middle' }, xFmt(t)));
    holder.appendChild(g);
    for (const r of refLines) {
      holder.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: Y(r.y), y2: Y(r.y), stroke: r.color || 'var(--axis)', 'stroke-width': 1 }));
      if (r.label) holder.appendChild(svg('text', { x: W - m.r, y: Y(r.y) - 5, 'text-anchor': 'end', fill: 'var(--ink-3)', 'font-size': 11 }, r.label));
    }
    for (const se of series) {
      const pts = se.points.map(p => [X(p.x), Y(p.y)]);
      if (!pts.length) continue;
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('');
      if (se.area) {
        const base = Y(Math.max(ymin, Math.min(0, ymax)));
        holder.appendChild(svg('path', { d: `${d}L${pts[pts.length - 1][0]},${base}L${pts[0][0]},${base}Z`, fill: se.color, opacity: 0.1 }));
      }
      holder.appendChild(svg('path', { d, fill: 'none', stroke: se.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      const last = pts[pts.length - 1];
      holder.appendChild(svg('circle', { cx: last[0], cy: last[1], r: 4.5, fill: se.color, stroke: 'var(--panel)', 'stroke-width': 2 }));
    }
    if (endLabels) {
      // selective direct labels: the latest value of each series, nudged apart
      const ends = series
        .map(se => se.points.length ? { se, y: Y(se.points[se.points.length - 1].y), v: se.points[se.points.length - 1].y } : null)
        .filter(Boolean).sort((a, b) => a.y - b.y);
      let prev = -Infinity;
      for (const e of ends) {
        const ty = Math.max(e.y, prev + 14); prev = ty;
        holder.appendChild(svg('text', { x: W - m.r + 10, y: Math.min(H - m.b - 2, Math.max(m.t + 8, ty + 4)), 'text-anchor': 'start', fill: 'var(--ink-2)', 'font-size': 11, 'font-family': 'var(--mono)' }, yFmt(e.v)));
      }
    }
    const cross = svg('line', { y1: m.t, y2: H - m.b, stroke: 'var(--line-3)', 'stroke-width': 1, visibility: 'hidden' });
    const dots = series.map(se => svg('circle', { r: 4.5, fill: se.color, stroke: 'var(--panel)', 'stroke-width': 2, visibility: 'hidden' }));
    holder.appendChild(cross); dots.forEach(d => holder.appendChild(d));
    const hit = svg('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
    holder.appendChild(hit);
    const move = (e) => {
      const r = holder.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W;
      const base = series[0].points; if (!base.length) return;
      let best = 0; let bd = Infinity;
      base.forEach((p, i) => { const d = Math.abs(X(p.x) - px); if (d < bd) { bd = d; best = i; } });
      const p0 = base[best];
      cross.setAttribute('x1', X(p0.x)); cross.setAttribute('x2', X(p0.x)); cross.setAttribute('visibility', 'visible');
      const lines = [];
      series.forEach((se, i) => {
        const p = se.points[best]; if (!p) return;
        dots[i].setAttribute('cx', X(p.x)); dots[i].setAttribute('cy', Y(p.y)); dots[i].setAttribute('visibility', 'visible');
        lines.push(h('div', h('i', { style: { display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px', background: se.color, marginRight: '6px' } }), `${se.name}: `, h('b', yFmt(p.y))));
      });
      tip.replaceChildren(h('div.muted', tipFmt ? tipFmt(p0) : xFmt(p0.x)), ...lines);
      placeTip(tip, X(p0.x), Y(p0.y), W, H);
    };
    hit.addEventListener('mousemove', move);
    hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); });
  };
  responsive(wrap, draw);
  return wrap;
}

/** Column chart. bars: [{label, value, color?, tip?}] */
export function barChart(bars, { height = 200, yFmt = (v) => String(v) } = {}) {
  const wrap = h('div.chart'); const tip = h('div.tip'); wrap.appendChild(tip);
  if (!bars.length) { wrap.appendChild(h('div.empty', 'No data yet.')); return wrap; }
  const holder = svg('svg', {});
  wrap.appendChild(holder);
  const draw = (W) => {
    const H = height; const m = { l: 40, r: 10, t: 10, b: 28 };
    const vals = bars.map(b => b.value);
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
    const ymin = ticks[0]; const ymax = ticks[ticks.length - 1];
    const Y = (y) => m.t + (1 - (y - ymin) / (ymax - ymin || 1)) * (H - m.t - m.b);
    const band = (W - m.l - m.r) / bars.length; const bw = Math.max(3, Math.min(24, band * 0.7));
    holder.setAttribute('viewBox', `0 0 ${W} ${H}`);
    holder.setAttribute('style', `height:${H}px`);
    holder.replaceChildren();
    const g = svg('g', { class: 'axis' });
    for (const t of ticks) {
      g.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: t === 0 ? 'var(--axis)' : 'var(--grid)' }));
      g.appendChild(svg('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end' }, yFmt(t)));
    }
    holder.appendChild(g);
    const every = Math.max(1, Math.ceil(bars.length / Math.max(4, Math.floor((W - m.l - m.r) / 56))));
    bars.forEach((b, i) => {
      const cx = m.l + band * i + band / 2; const y0 = Y(0); const y1 = Y(b.value);
      const top = Math.min(y0, y1); const hh = Math.max(1, Math.abs(y1 - y0)); const r = Math.min(4, hh / 2, bw / 2);
      const up = b.value >= 0;
      const d = up
        ? `M${cx - bw / 2},${y0}V${top + r}Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top}H${cx + bw / 2 - r}Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r}V${y0}Z`
        : `M${cx - bw / 2},${y0}V${top + hh - r}Q${cx - bw / 2},${top + hh} ${cx - bw / 2 + r},${top + hh}H${cx + bw / 2 - r}Q${cx + bw / 2},${top + hh} ${cx + bw / 2},${top + hh - r}V${y0}Z`;
      holder.appendChild(svg('path', { d, fill: b.color || 'var(--s1)' }));
      if (i % every === 0) holder.appendChild(svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle', fill: 'var(--ink-3)', 'font-size': 10.5, 'font-family': 'var(--mono)' }, b.label));
      const hit = svg('rect', { x: cx - band / 2, y: m.t, width: band, height: H - m.t - m.b, fill: 'transparent' });
      hit.addEventListener('mouseenter', () => { tip.replaceChildren(h('div', b.tip || `${b.label}: `, h('b', yFmt(b.value)))); placeTip(tip, cx, top, W, H); });
      hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
      holder.appendChild(hit);
    });
  };
  responsive(wrap, draw);
  return wrap;
}

/** Diverging horizontal bars for the Diagnostics tables (avg R per bucket). */
export function diagBars(rows, { maxAbs, minN = 0 } = {}) {
  const m = maxAbs || Math.max(1, ...rows.map(r => Math.abs(r.avg_r || 0)));
  return h('div.diag-bars', rows.map(r => {
    const v = r.avg_r || 0; const w = Math.min(50, Math.abs(v) / m * 50);
    // below minN the bucket is noise: draw it neutral grey so it can't read as evidence
    const color = r.n === 0 ? 'transparent' : r.n < minN ? 'var(--axis)' : v >= 0 ? 'var(--s3)' : 'var(--s8)';
    return h('div.db-row',
      h('div', { style: { color: r.n ? 'var(--ink)' : 'var(--ink-3)' } }, r.label),
      h('div.track', h('span.zero'), h('span.fill', { style: { left: v >= 0 ? '50%' : `${50 - w}%`, width: `${w}%`, background: color } })),
      h('div.num', { style: { textAlign: 'right', fontFamily: 'var(--mono)' } }, r.n ? fmt.r(v) : '—'),
      h('div.muted.num', { style: { textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '11px' } }, `n=${r.n}`));
  }));
}
