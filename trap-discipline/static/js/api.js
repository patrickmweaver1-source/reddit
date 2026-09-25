// Thin client for the local API. Every call carries the per-session token.
const TOKEN = document.querySelector('meta[name="trap-token"]').content;

const TIMEOUT_MS = 60000;   // a request that hangs this long is reported, never left spinning forever

async function req(method, path, body) {
  const opt = { method, headers: { 'X-Trap-Token': TOKEN } };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  if (ctl) opt.signal = ctl.signal;
  let res;
  try { res = await fetch(path, opt); }
  catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') throw new Error('The app server took too long to answer. Try again; if it keeps happening, restart TRAP.');
    throw new Error('The app server is not responding. Is the TRAP window still open?');
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  clearTimeout(timer);
  if (!res.ok || !data || data.ok === false) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status; err.payload = data;
    throw err;
  }
  return data;
}

// A coin's market data can still be loading right after TRAP starts: the server says so (503,
// loading) instead of making the page wait, and the page asks again by itself.
async function getWithRetry(p) {
  for (let i = 0; ; i++) {
    try { return (await req('GET', p)).data; }
    catch (e) {
      if (!(e.status === 503 && e.payload && e.payload.loading) || i >= 5) throw e;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

export const api = {
  get: (p) => getWithRetry(p),
  raw: (p) => req('GET', p),
  post: (p, b = {}) => req('POST', p, b),
  put: (p, b = {}) => req('PUT', p, b),
  patch: (p, b = {}) => req('PATCH', p, b),
  del: (p) => req('DELETE', p),
  download(path) {
    // file downloads go through a hidden link carrying the token as a query param
    const a = document.createElement('a');
    a.href = `${path}?token=${encodeURIComponent(TOKEN)}`;
    a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
  },
};

// Server-sent events, shared by every open TRAP tab.
// Browsers allow only 6 connections to one site. Each live-event stream holds
// one open for good, so with one stream per tab, six open tabs (every
// "Start TRAP" opens another) left no room for page requests and pages hung
// until refreshed. Now one tab (the leader, picked with a Web Lock) holds the
// only stream and relays every event to the other tabs over a BroadcastChannel.
// When the leader tab closes, another tab takes over automatically.
export function connectEvents(onMsg, onStatus) {
  const shared = typeof BroadcastChannel !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function';
  if (!shared) return directEvents(onMsg, onStatus, null, true);
  const bc = new BroadcastChannel('trap-events');
  let leader = false; let last = null;
  bc.onmessage = (e) => {
    const m = e.data || {};
    if (leader) { if (m.t === 'ask' && last !== null) bc.postMessage({ t: 'status', ok: last }); return; }
    if (m.t === 'msg') { onStatus && last !== true && onStatus(true); last = true; onMsg(m.d); }
    else if (m.t === 'status') { last = m.ok; onStatus && onStatus(m.ok); }
  };
  bc.postMessage({ t: 'ask' });
  navigator.locks.request('trap-events-leader', () => new Promise(() => {
    // held until this tab closes: this tab now owns the one stream
    leader = true;
    directEvents(onMsg, (ok) => { last = ok; onStatus && onStatus(ok); bc.postMessage({ t: 'status', ok }); }, bc, false);
  })).catch(() => { if (!leader) { leader = true; directEvents(onMsg, onStatus, null, true); } });
  return () => bc.close();
}

function directEvents(onMsg, onStatus, bc, pauseWhenHidden) {
  let es = null; let retry = 1000; let timer = null;
  const open = () => {
    clearTimeout(timer); timer = null;
    if (es) return;
    es = new EventSource(`/api/events?token=${encodeURIComponent(TOKEN)}`);
    es.onopen = () => { retry = 1000; onStatus && onStatus(true); };
    es.onmessage = (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (bc) bc.postMessage({ t: 'msg', d });
      try { onMsg(d); } catch (err) { console.error(err); }
    };
    es.onerror = () => {
      onStatus && onStatus(false);
      if (es) es.close();
      es = null;
      timer = setTimeout(open, retry);
      retry = Math.min(retry * 2, 15000);
    };
  };
  const close = () => { clearTimeout(timer); timer = null; if (es) { es.close(); es = null; } };
  if (pauseWhenHidden) {
    // no way to share the stream in this browser: at least give the connection back while the tab is hidden
    document.addEventListener('visibilitychange', () => { if (document.hidden) close(); else { retry = 1000; open(); } });
  }
  if (!pauseWhenHidden || !document.hidden) open();
  return close;
}
