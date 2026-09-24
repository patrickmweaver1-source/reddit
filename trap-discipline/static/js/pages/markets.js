// Market monitor: candles with live level states, OI, funding, CVD, liquidations, and the OI/volume lab.
// Charts: any timeframe and lookback, free pan and zoom on both axes, four panes locked together.
import { api } from '../api.js';
import { etOffsetSec } from '../ui.js';
import { h, icon, fmt, clear, stateChip, dirChip, segmented, ring, toast, put } from '../ui.js';

let root = null; let ctxRef = null; let sym = null; let snap = null; let cd = null;
let charts = []; let series = {}; let priceLines = []; let refreshTimer = null; let ro = null;
let paneData = {}; let syncingCross = false; let opts = null;
let loadSeq = 0; let fullPending = 0;   // only the newest full load may write; refreshes wait for it
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });

const STATE_COLORS = { TRIGGERED: '#36d7c7', WATCH: '#ec835a', RECRUITING: '#fab219', TESTED: '#b4c3d6', APPROACHING: '#3987e5', DORMANT: '#4a5566' };
const TF_LABEL = { 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', D: '1D', W: '1W' };
/* Empty space, in bars, between the newest candle and the right edge. */
const RIGHT_OFFSET_BARS = 3;
const PANE_IDS = ['c-main', 'c-oi', 'c-cvd', 'c-fund'];
const COARSE = window.matchMedia('(pointer: coarse)').matches;   // phones and tablets
const LB_LABEL = { '1D': '24h', '3D': '3 days', '1W': '1 week', '2W': '2 weeks', '1M': '1 month', '3M': '3 months', '6M': '6 months', '1Y': '1 year', '2Y': '2 years' };

// per-device memory of the chosen view (browser storage can be unavailable; the defaults then apply)
const pref = {
  get(k, d) { try { return localStorage.getItem(`trap.mk.${k}`) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`trap.mk.${k}`, v); } catch { /* private mode */ } },
};
let tf = pref.get('tf', '15'); let lookback = pref.get('lb', '3D');

export async function render(el, ctx) {
  root = el; ctxRef = ctx;
  sym = (ctx.params[0] || ctx.state.settings.watchlist[0]).toUpperCase();
  clear(root);
  put(root, h('div.skeleton', { style: { height: '520px' } }));
  if (!opts) { try { opts = await api.get('/api/chart/options'); } catch { opts = null; } }
  if (!root) return;   // left the page while loading
  if (opts && !(opts.valid[tf] || []).includes(lookback)) { tf = '15'; lookback = '3D'; }
  cd = null;
  await load(true);
  if (!root) return;
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => load(false), 15000);
}
export function destroy() { clearInterval(refreshTimer); refreshTimer = null; teardown(); root = null; }

function teardown() {
  charts.forEach(c => { try { c.remove(); } catch { /* ignore */ } });
  charts = []; series = {}; priceLines = [];
  if (ro) { ro.disconnect(); ro = null; }
}

async function load(full) {
  const mySym = sym;
  try { snap = await api.get(`/api/market/${sym}${full ? '?refresh=1' : ''}`); }
  catch (e) { if (root && (full || !charts.length)) { clear(root); put(root, h('div.card', h('div.errline', icon('wifi-off', 'sm'), e.message))); } return; }
  if (!root || mySym !== sym) return;
  if (full || !charts.length) { build(); await loadChart(true); }
  else { updateOverlay(); drawSide(); await loadChart(false); }
}

/* Full load (first paint, new timeframe or lookback) or a small top-up with only the newest bars.
   Every full load gets a sequence number; a slower, older response is thrown away. */
async function loadChart(full) {
  if (!full && (fullPending || !cd)) return;          // a full load is on its way; it brings the newest bars
  const seq = full ? ++loadSeq : loadSeq;
  const mySym = sym; const myTf = tf; const myLb = lookback;
  const since = !full ? cd.candles[Math.max(0, cd.candles.length - 3)]?.t ?? null : null;
  if (full) { fullPending++; setBusy(true); cd = null; }
  try {
    const d = await api.get(`/api/chart/${sym}?tf=${tf}&lookback=${lookback}${since !== null ? `&since=${since}` : ''}`);
    if (!root || seq !== loadSeq || mySym !== sym || myTf !== tf || myLb !== lookback || !charts.length) return;
    if (full) { cd = d; setAll(); frame(); }
    else if (cd) mergeTail(d);
    const note = document.getElementById('mk-range-note');
    if (note && cd) note.textContent = cd.complete ? '' : `Only ${cd.candles.length.toLocaleString('en-US')} bars of history exist for this timeframe.`;
  } catch (e) {
    if (full && seq === loadSeq && root) toast('Chart did not load', e.message, 'warn', 8000);
  } finally {
    if (full) { fullPending--; if (seq === loadSeq) setBusy(false); }
  }
}

function setBusy(on) { const el = document.getElementById('mk-busy'); if (el) el.style.display = on ? 'flex' : 'none'; }

function build() {
  teardown();
  clear(root);
  const wl = ctxRef.state.settings.watchlist;
  const up = (snap.change24h || 0) >= 0;
  put(root,
    h('div.page-head',
      h('div', h('div.eyebrow', 'Market monitor · auto-classified, confirm on the chart'),
        h('div.row', { style: { gap: '14px', alignItems: 'baseline', flexWrap: 'wrap' } }, h('h1', sym.replace('USDT', ''), h('span.muted', { style: { fontSize: '16px', marginLeft: '6px' } }, 'USDT perp')),
          h('span.mono', { id: 'mk-price', style: { fontSize: '26px', fontWeight: 600 } }, fmt.px(snap.price)),
          h('span.mono', { id: 'mk-chg', class: up ? 'good' : 'bad' }, fmt.pct(snap.change24h, 2, true)),
          h('span.chip', icon(snap.regime?.regime === 'uptrend' ? 'trending-up' : snap.regime?.regime === 'downtrend' ? 'trending-down' : 'move-vertical', 'sm'), `4h ${snap.regime?.regime}`),
          snap.thin ? h('span.chip', 'thin asset') : null)),
      h('div.actions', segmented(wl, sym, (v) => ctxRef.go(`markets/${v}`)),
        h('button.btn', { onclick: () => load(true) }, icon('refresh-cw', 'sm'), 'Refresh'),
        h('button.btn.primary', { onclick: () => ctxRef.go(`checklist/${sym}${snap.top ? '/' + snap.top.price : ''}`) }, icon('list-checks', 'sm'), 'Checklist this'))),
    snap.errors?.length ? h('div.warnline', { style: { marginBottom: '12px' } }, icon('triangle-alert', 'sm'), `Some data failed to load: ${snap.errors.join('; ')}`) : null,
    h('div.grid.mk-layout',
      h('div.col', { style: { gap: '10px' } },
        toolbar(),
        h('div.lw-wrap', h('div.lw-label', h('span', { id: 'mk-title' }, paneTitle()), h('b.lw-val', { id: 'v-main' })), h('div.mk-chart-main', { id: 'c-main' }),
          h('div.mk-busy', { id: 'mk-busy' }, h('span.spinner'), 'Loading history…')),
        h('div.lw-wrap', h('div.lw-label', 'Open interest (base coin, both sides)', h('b.lw-val', { id: 'v-oi' })), h('div', { id: 'c-oi', style: { height: '120px' } })),
        h('div.lw-wrap', h('div.lw-label', h('span', { id: 'mk-cvd-title' }, cvdTitle()), h('b.lw-val', { id: 'v-cvd' })), h('div', { id: 'c-cvd', style: { height: '110px' } })),
        h('div.lw-wrap', h('div.lw-label', h('span', { id: 'mk-fund-title' }, fundTitle()), h('b.lw-val', { id: 'v-fund' })), h('div', { id: 'c-fund', style: { height: '100px' } })),
        h('div.legend', h('span', h('i', { style: { background: STATE_COLORS.TRIGGERED } }), 'Triggered'), h('span', h('i', { style: { background: STATE_COLORS.WATCH } }), 'Watch'),
          h('span', h('i', { style: { background: STATE_COLORS.RECRUITING } }), 'Recruiting'), h('span', h('i', { style: { background: STATE_COLORS.APPROACHING } }), 'Approaching'),
          h('span', h('i', { style: { background: STATE_COLORS.DORMANT } }), 'Dormant'), h('a', { href: 'https://www.tradingview.com/', target: '_blank', rel: 'noopener', style: { color: 'var(--ink-3)' } }, 'Charts by TradingView Lightweight Charts™'))),
      h('div.col', { style: { gap: '14px' }, id: 'mk-side' })));
  makeCharts();
  updateOverlay();
  drawSide();
}

function paneTitle() { return `${TF_LABEL[tf]} candles · levels colored by state${tf !== '15' ? ' (states come from 15m closes)' : ''}`; }
function cvdTitle() { return tf === '5' ? 'CVD · recorded in 15m buckets, not shown on 5m' : 'CVD · taker buy minus sell volume (live since app start)'; }
function fundTitle() { return ['5', '15', '30', '60', '240'].includes(tf) ? 'Funding rate at each settlement, %' : 'Funding, sum of settlements per bar, %'; }

function btnGroup(items, value, onPick, disabled = () => false) {
  return h('div.seg.mk-seg', items.map(([v, label]) => h(`button${v === value ? '.on' : ''}`, {
    type: 'button', disabled: disabled(v), title: disabled(v) ? 'Too many bars at this timeframe. Pick a bigger timeframe first.' : null,
    onclick: () => onPick(v) }, label)));
}

function toolbar() {
  const valid = (t) => !opts || (opts.valid[t] || []).includes(lookback);
  const tfs = Object.keys(TF_LABEL).map(v => [v, TF_LABEL[v]]);
  const lbs = (opts?.lookbacks || Object.keys(LB_LABEL)).map(v => [v, LB_LABEL[v] || v]);
  const bar = h('div.mk-toolbar',
    h('div.mk-tgroup', h('span.eyebrow', 'Timeframe'), btnGroup(tfs, tf, (v) => {
      tf = v; pref.set('tf', v);
      if (!valid(v)) {   // keep the lookback if it fits, else the longest that does
        const ok = opts.valid[v]; lookback = ok.includes('3D') ? '3D' : ok[ok.length - 1]; pref.set('lb', lookback);
      }
      refreshToolbar(); relabel(); loadChart(true);
    })),
    h('div.mk-tgroup', h('span.eyebrow', 'Lookback'), btnGroup(lbs, lookback, (v) => { lookback = v; pref.set('lb', v); refreshToolbar(); loadChart(true); },
      (v) => !!opts && !(opts.valid[tf] || []).includes(v))),
    h('div.mk-tgroup.mk-tools',
      h('button.btn.sm', { type: 'button', title: 'Show the whole lookback period', onclick: frame }, icon('grid-3x3', 'sm'), 'Fit'),
      h('button.btn.sm', { type: 'button', title: 'Jump to the newest candle', onclick: () => charts[0]?.timeScale().scrollToRealTime() }, icon('arrow-right', 'sm'), 'Latest'),
      h('button.btn.sm', { type: 'button', title: 'Turn automatic price scaling back on', onclick: autoPrice }, icon('move-vertical', 'sm'), 'Auto price')),
    h('div.mk-hint', COARSE ? 'Swipe sideways to move. Pinch to zoom. Drag the price axis up or down to stretch prices. Double-tap an axis to reset it.'
      : 'Drag to move. Scroll or pinch to zoom. Drag the price or time axis to stretch it. Double-click an axis to reset it.',
      h('span.dim', { id: 'mk-range-note', style: { marginLeft: '6px' } })));
  bar.id = 'mk-toolbar';
  return bar;
}
function refreshToolbar() { const old = document.getElementById('mk-toolbar'); if (old) old.replaceWith(toolbar()); }
function relabel() {
  const t = document.getElementById('mk-title'); if (t) t.textContent = paneTitle();
  const f = document.getElementById('mk-fund-title'); if (f) f.textContent = fundTitle();
  const cv = document.getElementById('mk-cvd-title'); if (cv) cv.textContent = cvdTitle();
  const intraday = !['D', 'W'].includes(tf);
  charts.forEach(c => c.applyOptions({ timeScale: { timeVisible: intraday } }));
}

function baseOpts(el, height, main) {
  return {
    width: el.clientWidth, height,
    layout: { attributionLogo: false, background: { type: 'solid', color: '#0a0f16' }, textColor: '#6f7a8b', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
    grid: { vertLines: { color: '#141b25' }, horzLines: { color: '#141b25' } },
    rightPriceScale: { borderColor: '#222b37', minimumWidth: 84 },   // same width on every pane so the time axes line up
    timeScale: { borderColor: '#222b37', timeVisible: !['D', 'W'].includes(tf), secondsVisible: false, rightOffset: RIGHT_OFFSET_BARS,
      shiftVisibleRangeOnNewBar: true, minBarSpacing: 0.05 },
    crosshair: { mode: 0 },
    localization: { locale: 'en-US' },
    kineticScroll: { touch: true, mouse: false },
    // Free movement: drag pans time (and price, once the price axis has been stretched); the wheel and
    // pinch zoom; dragging an axis stretches it; double-clicking an axis resets it. On touch screens a
    // vertical swipe scrolls the page (never trapped by a chart); stretch prices by dragging the price axis.
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: !!main && !COARSE },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true } },
  };
}

function makeCharts() {
  const LW = window.LightweightCharts;
  const mk = (id, h_, main = false) => { const el = document.getElementById(id); const c = LW.createChart(el, baseOpts(el, h_ || el.clientHeight, main)); charts.push(c); return c; };
  const main = mk('c-main', 0, true);
  series.candles = main.addCandlestickSeries({ upColor: '#199e70', downColor: '#e66767', borderVisible: false, wickUpColor: '#199e70', wickDownColor: '#e66767' });
  series.vol = main.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  main.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  const oi = mk('c-oi', 120);
  series.oi = oi.addAreaSeries({ lineColor: '#3987e5', topColor: 'rgba(57,135,229,.25)', bottomColor: 'rgba(57,135,229,0)', lineWidth: 2, priceFormat: { type: 'volume' } });
  const cvd = mk('c-cvd', 110);
  series.cvd = cvd.addLineSeries({ color: '#9085e9', lineWidth: 2, priceFormat: { type: 'volume' } });
  const fund = mk('c-fund', 100);
  series.fund = fund.addHistogramSeries({ priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } });
  // Panes are locked by bar index: the server puts every pane on the candle grid, so bar N is the
  // same candle everywhere, and a logical range can extend past the last bar (the right-edge space).
  let syncing = false;
  charts.forEach(c => c.timeScale().subscribeVisibleLogicalRangeChange((r) => {
    if (syncing || !r) return; syncing = true;
    try { charts.forEach(o => { if (o !== c) o.timeScale().setVisibleLogicalRange(r); }); } finally { syncing = false; }
  }));
  // On resize (window, sidebar collapse, iPad rotation) keep the same bars in view instead of
  // exposing empty space at the left edge.
  ro = new ResizeObserver(() => {
    const keep = charts[0]?.timeScale().getVisibleLogicalRange();
    charts.forEach((c, i) => { const el = document.getElementById(PANE_IDS[i]); if (el && el.clientWidth) c.applyOptions({ width: el.clientWidth, height: el.clientHeight }); });
    if (keep) { try { charts[0].timeScale().setVisibleLogicalRange(keep); } catch { /* no data yet */ } }
  });
  PANE_IDS.forEach(id => { const el = document.getElementById(id); if (el) ro.observe(el); });
  wireCrosshair();
}

/* Every pane gets exactly one point per candle (whitespace where a series has no value). */
/* The chart library only knows UTC, so intraday candles are shifted to Eastern
   wall-clock time. One offset per full load keeps bars in order across a daylight
   saving change. Daily and weekly candles are exchange (UTC) days and stay as is. */
let OFF = 0;
const S = (ms) => Math.floor(ms / 1000) + OFF;
function rowsFor(d) {
  const t = d.candles.map(k => S(k.t));
  return {
    main: d.candles.map((k, i) => ({ time: t[i], open: k.o, high: k.h, low: k.l, close: k.c })),
    vol: d.candles.map((k, i) => ({ time: t[i], value: k.v, color: k.c >= k.o ? 'rgba(25,158,112,.35)' : 'rgba(230,103,103,.35)' })),
    oi: d.oi.map((v, i) => (v == null ? { time: t[i] } : { time: t[i], value: v })),
    cvd: d.cvd.map((v, i) => (v == null ? { time: t[i] } : { time: t[i], value: v })),
    fund: d.funding.map((v, i) => (v == null ? { time: t[i] } : { time: t[i], value: v * 100, color: v >= 0 ? 'rgba(201,133,0,.8)' : 'rgba(57,135,229,.8)' })),
  };
}
function setAll() {
  OFF = ['D', 'W'].includes(tf) ? 0 : etOffsetSec(Date.now());
  const r = rowsFor(cd);
  series.candles.setData(r.main); series.vol.setData(r.vol); series.oi.setData(r.oi); series.cvd.setData(r.cvd); series.fund.setData(r.fund);
  paneData = { main: r.main, oi: r.oi.filter(p => p.value != null), cvd: r.cvd.filter(p => p.value != null), fund: r.fund.filter(p => p.value != null) };
  setVals(null);
}
/* Refresh: update() only the changed and new bars, so the view the user has panned or zoomed to is left alone. */
function mergeTail(d) {
  if (!d.candles.length) return;
  const byT = new Map(cd.candles.map((k, i) => [k.t, i]));
  const r = rowsFor(d);
  const lastT = cd.candles[cd.candles.length - 1].t;
  d.candles.forEach((k, i) => {
    if (k.t < lastT && !byT.has(k.t)) return;   // an older bar we never had: ignore rather than break ordering
    try {
      series.candles.update(r.main[i]); series.vol.update(r.vol[i]); series.oi.update(r.oi[i]); series.cvd.update(r.cvd[i]); series.fund.update(r.fund[i]);
    } catch { /* out-of-order update: the next full load fixes it */ }
    const j = byT.get(k.t);
    if (j === undefined) { cd.candles.push(k); cd.oi.push(d.oi[i]); cd.cvd.push(d.cvd[i]); cd.funding.push(d.funding[i]); }
    else { cd.candles[j] = k; cd.oi[j] = d.oi[i]; cd.cvd[j] = d.cvd[i]; cd.funding[j] = d.funding[i]; }
  });
  const extra = cd.candles.length - (d.need || cd.candles.length);
  if (extra > 0) { for (const f of ['candles', 'oi', 'cvd', 'funding']) cd[f] = cd[f].slice(extra); }
  const rr = rowsFor(cd);
  paneData = { main: rr.main, oi: rr.oi.filter(p => p.value != null), cvd: rr.cvd.filter(p => p.value != null), fund: rr.fund.filter(p => p.value != null) };
  setVals(null);
}
/* Show the whole lookback, newest candle in view with space after it, prices auto-fitted. */
function frame() {
  if (!charts.length || !cd?.candles?.length) return;
  autoPrice();
  const n = cd.candles.length;
  charts[0].timeScale().setVisibleLogicalRange({ from: -0.5, to: n - 1 + RIGHT_OFFSET_BARS });
}
function autoPrice() { charts.forEach(c => { try { c.priceScale('right').applyOptions({ autoScale: true }); } catch { /* ignore */ } }); }

/* Crosshair synced across all four panes, with a live value readout in each
   pane label. No hover shows the latest values. */
const PANES = [
  { key: 'main', s: () => series.candles, val: (p) => p ? `${fmt.px(p.close)}` : '' },
  { key: 'oi', s: () => series.oi, val: (p) => p ? compact.format(p.value) : '' },
  { key: 'cvd', s: () => series.cvd, val: (p) => p ? (p.value >= 0 ? '+' : '') + compact.format(p.value) : '' },
  { key: 'fund', s: () => series.fund, val: (p) => p ? `${p.value.toFixed(4)}%` : '' },
];

/* Latest row at or before time t (panes have different time grids). */
function rowAt(rows, t) {
  if (!rows.length) return undefined;
  if (t == null) return rows[rows.length - 1];
  let lo = 0; let hi = rows.length - 1; let ans;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (rows[mid].time <= t) { ans = rows[mid]; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

function setVals(t) {
  for (const pn of PANES) {
    const el = document.getElementById(`v-${pn.key}`); if (!el) continue;
    el.textContent = pn.val(rowAt(paneData[pn.key] || [], t)) || 'n/a';
  }
}

function wireCrosshair() {
  charts.forEach((c) => {
    c.subscribeCrosshairMove((param) => {
      if (syncingCross) return; syncingCross = true;
      try {
        if (param && param.time != null) {
          setVals(param.time);
          charts.forEach((o, j) => {
            if (o === c) return;
            const pn = PANES[j];
            const p = rowAt(paneData[pn.key] || [], param.time);
            const se = pn.s();
            // the vertical line sits on the hovered bar in every pane; the dot uses that pane's latest value
            if (p && se && o.setCrosshairPosition) o.setCrosshairPosition(p.value ?? p.close, param.time, se);
            else if (o.clearCrosshairPosition) o.clearCrosshairPosition();
          });
        } else {
          setVals(null);
          charts.forEach(o => { if (o !== c && o.clearCrosshairPosition) o.clearCrosshairPosition(); });
        }
      } finally { syncingCross = false; }
    });
  });
}

/* Level lines and the headline price come from the 15m snapshot. */
function updateOverlay() {
  if (!series.candles) return;
  priceLines.forEach(pl => { try { series.candles.removePriceLine(pl); } catch { /* ignore */ } });
  priceLines = [];
  for (const lv of snap.levels || []) {
    if (lv.state?.startsWith('DEAD')) continue;
    priceLines.push(series.candles.createPriceLine({ price: lv.price, color: STATE_COLORS[lv.state] || '#4a5566', lineWidth: ['TRIGGERED', 'WATCH', 'RECRUITING'].includes(lv.state) ? 2 : 1,
      lineStyle: lv.state === 'DORMANT' ? 2 : 0, axisLabelVisible: true, title: `${lv.state}${lv.touches ? ' ·' + lv.touches + 't' : ''}` }));
  }
  if (snap.range?.high && snap.range?.low) {
    priceLines.push(series.candles.createPriceLine({ price: snap.range.high, color: 'rgba(54,215,199,.35)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: 'range high' }));
    priceLines.push(series.candles.createPriceLine({ price: snap.range.low, color: 'rgba(54,215,199,.35)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: 'range low' }));
  }
  const pe = document.getElementById('mk-price'); if (pe) pe.textContent = fmt.px(snap.price);
  const ce = document.getElementById('mk-chg'); if (ce) { ce.textContent = fmt.pct(snap.change24h, 2, true); ce.className = `mono ${(snap.change24h || 0) >= 0 ? 'good' : 'bad'}`; }
}

function drawSide() {
  const side = document.getElementById('mk-side');
  if (!side) return;
  clear(side);
  const top = snap.top; const f = snap.funding || {}; const oi = snap.oi || {}; const m = snap.mechanism || {}; const sm = snap.summary || {};
  put(side, 
    h(`div.card${top?.state === 'TRIGGERED' ? '.glow' : ''}`,
      h('div.card-h', h('h3', icon('crosshair'), 'Top candidate'), top ? h('div.right', stateChip(top.state)) : null),
      top ? h('div',
        h('div.row', h('b.mono', { style: { fontSize: '20px' } }, fmt.px(top.price)), top.setup ? h('span.chip', top.setup) : null, dirChip(top.direction)),
        h('p.dim', { style: { fontSize: '13px' } }, top.note),
        h('div.kv', h('dt', 'Trap zone'), h('dd', trapZone(top)), h('dt', 'Penetration'), h('dd', top.pen_atr !== null ? `${fmt.num(top.pen_atr, 2)} ATR` : '—'),
          h('dt', 'OI through break'), h('dd', fmt.pct(top.oi_break_pct, 2, true)), h('dt', 'OI on reclaim'), h('dd', fmt.pct(top.oi_reclaim_pct, 2, true)),
          h('dt', 'Candles since break'), h('dd', top.candles_since_break ?? '—'), h('dt', 'Level sources'), h('dd', top.sources.join(', '))),
        snap.regime && top.direction && !snap.regime.permitted.includes(top.direction) ? h('div.warnline', { style: { marginTop: '10px' } }, icon('triangle-alert', 'sm'), 'Counter to the 4h regime: ranks last.') : null,
        snap.gates ? h('div', { style: { marginTop: '12px' } }, h('div.eyebrow', 'Gates (estimated stop at trap extreme)'), h('div.math', { style: { marginTop: '6px', fontSize: '11.5px' } }, snap.gates.lines.map(l => h('div', h(`span.${l.startsWith('PASS') ? 'pass' : 'fail'}`, l.slice(0, 4)), l.slice(4))))) : null)
        : h('div.muted', 'Nothing is tested, recruiting or triggered. If nothing is in play, say exactly that and stop.')),
    h('div.card', h('div.card-h', h('h3', icon('waves'), 'OI / volume lab'), h('span.sub', 'last 4 closed candles')),
      h('div', { style: { fontFamily: 'var(--display)', fontSize: '20px', fontWeight: 700 } }, m.name),
      h('p.dim', { style: { fontSize: '13px', margin: '6px 0' } }, m.reading),
      m.caution ? h('div.warnline', icon('info', 'sm'), m.caution) : null,
      h('div.grid.g3', { style: { gap: '8px', marginTop: '12px' } },
        arrowStat('Price', sm.price_chg_pct), arrowStat('OI', sm.oi_chg_pct), h('div', h('div.eyebrow', 'RVOL'), h('b.mono', snap.rvol ? `${fmt.num(snap.rvol, 2)}x` : '—'), h('div.muted', { style: { fontSize: '11px' } }, snap.rvol_label))),
      h('div.kv', { style: { marginTop: '10px' } }, h('dt', 'Creation ratio (ΔOI / volume)'), h('dd', sm.creation_ratio !== null && sm.creation_ratio !== undefined ? fmt.num(sm.creation_ratio, 3) : '—'),
        h('dt', 'OI 1h / 4h / 24h'), h('dd', `${fmt.pct(oi.chg_1h, 1, true)} / ${fmt.pct(oi.chg_4h, 1, true)} / ${fmt.pct(oi.chg_24h, 1, true)}`)),
      h('div.help', { style: { marginTop: '6px' } }, 'Rising OI adds fuel. Falling OI removes it. Volume shows the force. Price decides who is winning.')),
    h('div.card', h('div.card-h', h('h3', icon('percent'), 'Funding')),
      h('div.row', { style: { gap: '16px' } }, ring(f.pctile ?? 0, { size: 104, stroke: 9, color: f.pctile >= 90 || f.pctile <= 10 ? 'var(--warn)' : 'var(--s1)', label: f.pctile !== null && f.pctile !== undefined ? `${Math.round(f.pctile)}` : '—', sub: 'pctile' }),
        h('div.kv', { style: { flex: 1 } }, h('dt', 'Current'), h('dd', fmt.pct(f.rate_pct, 4)), h('dt', '8h equivalent'), h('dd', fmt.pct(f.rate_8h_pct, 4)),
          h('dt', 'Interval'), h('dd', `${f.interval_h || '—'}h`), h('dt', 'Next settlement'), h('dd', f.next ? `${fmt.et(f.next)} ET` : '—'),
          h('dt', 'Stretched?'), h('dd', f.stretched ? h('span.warn', 'yes') : 'no'))),
      h('div.help', { style: { marginTop: '6px' } }, 'Percentile is against this symbol\'s own history: above 90 is unusually positive, below 10 unusually negative. A crowding filter, not an entry.')),
    ratioCard(),
    liqCard(),
    liqHeatmapCard(),
    h('div.card', h('div.card-h', h('h3', icon('layers'), 'All levels')),
      h('table.tbl', h('thead', h('tr', h('th', 'Level'), h('th', 'State'), h('th.num', 'ATR away'), h('th', 'Src'))),
        h('tbody', (snap.levels || []).map(l => h('tr', h('td.num', { style: { textAlign: 'left' } }, fmt.px(l.price)), h('td', stateChip(l.state)), h('td.num', fmt.num(l.dist_atr, 1)), h('td.muted', { title: l.note || '' }, l.sources.slice(0, 3).join(', '))))))));
}
function trapZone(top) {
  if (!snap.atr15 || !top.direction) return '—';
  const floor = (snap.thin ? ctxRef.state.thresholds.pen_floor_atr_thin : ctxRef.state.thresholds.pen_floor_atr) * snap.atr15;
  const ab = ctxRef.state.thresholds.pen_abandon_atr * snap.atr15;
  const sg = top.direction === 'Long' ? -1 : 1;
  const a = top.price + sg * floor; const b = top.price + sg * ab;
  return `${fmt.px(Math.min(a, b))} to ${fmt.px(Math.max(a, b))}`;
}
function arrowStat(label, v) {
  const upv = (v || 0) > 0;
  return h('div', h('div.eyebrow', label), h('b.mono', { class: v === null || v === undefined ? '' : upv ? 'good' : 'bad' }, icon(upv ? 'arrow-up' : 'arrow-down', 'sm'), fmt.pct(v, 2, true)));
}
function ratioCard() {
  const r = snap.ratio || [];
  const last = r[r.length - 1];
  return h('div.card', h('div.card-h', h('h3', icon('scale'), 'Long / short accounts'), h('span.sub', 'share of accounts, 1h')),
    last ? h('div', h('div.row.between', h('span.good', `Long ${fmt.num(last.buy * 100, 1)}%`), h('span.bad', `Short ${fmt.num(last.sell * 100, 1)}%`)),
      h('div', { style: { display: 'flex', height: '10px', borderRadius: '99px', overflow: 'hidden', marginTop: '6px', gap: '2px' } }, h('div', { style: { width: `${last.buy * 100}%`, background: 'var(--s3)' } }), h('div', { style: { flex: 1, background: 'var(--s8)' } })),
      h('div.help', { style: { marginTop: '6px' } }, 'Headcount, not size. Every contract still has one long and one short.')) : h('div.muted', 'No data'));
}
function liqCard() {
  const l = (snap.series.liqs || []).slice(-12).reverse();
  return h('div.card', h('div.card-h', h('h3', icon('bomb'), 'Liquidations'), h('span.sub', 'recorded from the live stream')),
    l.length ? h('table.tbl', h('tbody', l.map(x => h('tr', h('td.mono', fmt.et(x.ts)), h('td', h(`span.chip.${x.side === 'Buy' ? 'long' : 'short'}`, x.side === 'Buy' ? 'long liq' : 'short liq')), h('td.num', fmt.px(x.price)), h('td.num', fmt.compact(x.size)))))) :
      h('div.muted', 'None recorded yet. The stream only captures liquidations while the app is running; there is no historical feed.'));
}
function liqHeatmapCard() {
  const hm = snap.liq_heatmap;
  const price = snap.price;
  if (!hm || !hm.n) {
    return h('div.card', h('div.card-h', h('h3', icon('flame'), 'Observed liquidation map'), h('span.sub', 'executed prints, not future levels')),
      h('div.muted', 'No executed liquidations recorded near price yet. This map is built only from real liquidation prints captured while the app was watching this coin; there is no historical backfill and no estimate of where future liquidations would trigger.'));
  }
  // rows come lowest price first; show highest price at top like a price ladder.
  // Bar height uses the recency-weighted size so a wall of old prints does not
  // outshine what is happening now; the number shown is the raw executed size.
  const rows = [...hm.rows].reverse();
  const dpeak = hm.decayed_peak || hm.peak || 1;
  return h('div.card',
    h('div.card-h', h('h3', icon('flame'), 'Observed liquidation map'), h('span.sub', `${hm.n} prints${hm.band_atr ? `, +/-${hm.band_atr} ATR band` : ''}`)),
    h('div.help', { style: { marginBottom: '8px' } },
      'These are liquidations that already executed on Bybit’s feed, positioned at the price they printed. They are not a forecast of where current positions will be liquidated - the public feed does not expose live positions or leverage, so the app never estimates that.'),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
      rows.map(r => {
        const pct = Math.round(((r.decayed || 0) / dpeak) * 100);
        const longPct = r.total > 0 ? (r.long_liq / r.total) * 100 : 0;
        const shortPct = r.total > 0 ? (r.short_liq / r.total) * 100 : 0;
        const inRow = price !== null && price !== undefined && price >= r.lo && price < r.hi;
        return h('div.row', { style: { gap: '8px', alignItems: 'center', fontSize: '11px', padding: '1px 0', background: inRow ? 'rgba(255,255,255,.05)' : 'none', borderRadius: '4px' } },
          h('span.mono', { style: { width: '78px', flexShrink: 0, color: inRow ? 'var(--ink)' : 'var(--ink-3)' } }, fmt.compact(r.lo)),
          h('div', { style: { flex: 1, height: '10px', display: 'flex', borderRadius: '3px', overflow: 'hidden', background: 'var(--panel-3)' } },
            r.total > 0 ? [
              h('div', { style: { width: `${(pct * longPct) / 100}%`, background: '#5ee49a' } }),
              h('div', { style: { width: `${(pct * shortPct) / 100}%`, background: '#ff8686' } }),
            ] : null),
          h('span.mono.muted', { style: { width: '64px', flexShrink: 0, textAlign: 'right' }, title: r.pctile != null ? `${Math.round(r.pctile * 100)}th percentile band` : '' },
            r.n ? fmt.compact(r.total) + (r.pctile != null ? ` p${Math.round(r.pctile * 100)}` : '') : '—'));
      })),
    h('div.row', { style: { gap: '14px', marginTop: '10px', fontSize: '11px' } },
      h('span', h('span.chip.long', 'long liq'), ' longs liquidated'),
      h('span', h('span.chip.short', 'short liq'), ' shorts liquidated'),
      h('span.muted', 'bar height = recency-weighted size')),
    h('div.grid.g3', { style: { gap: '8px', marginTop: '10px' } },
      hmStat('Concentration', `${Math.round((hm.concentration || 0) * 100)}%`, 'in the single busiest band'),
      hmStat('Top 3 bands', `${Math.round((hm.concentration3 || 0) * 100)}%`, 'of executed size'),
      hmStat('Capture window', hm.coverage_hours != null ? `${hm.coverage_hours}h` : '—', 'app-watching time only')),
    h('div.help', { style: { marginTop: '8px' } },
      `Bars fade by half every ${hm.half_life_hours || 6}h so recent prints stand out. The number is the raw executed size in that band, with its size percentile for this coin. Captured since ${hm.since_ts ? fmt.et(hm.since_ts) : 'tracking began'}, and only while the app was running - gaps are not filled.${hm.outside ? ` ${hm.outside} print(s) fell outside this band and are not shown.` : ''}`));
}
function hmStat(label, val, note) {
  return h('div', { style: { padding: '8px 10px', borderRadius: '10px', background: 'var(--panel-2)', border: '1px solid var(--line)' } },
    h('div.eyebrow', label), h('div', { style: { fontFamily: 'var(--display)', fontSize: '18px', fontWeight: 700 } }, val), h('div.muted', { style: { fontSize: '10.5px' } }, note));
}
