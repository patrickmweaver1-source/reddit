// Settings: mode, read-only Bybit connection, watchlist, preferences, exports.
import { api } from '../api.js';
import { h, icon, fmt, clear, toggle, toast, confirmBox, field, numInput, segmented, put } from '../ui.js';

let root = null; let ctxRef = null; let S = null;

export async function render(el, ctx) {
  root = el; ctxRef = ctx;
  S = await api.get('/api/settings');
  draw();
}

function draw() {
  clear(root);
  const st = S.settings; const c = S.connection;
  put(root, 
    h('div.page-head', h('div', h('div.eyebrow', 'Settings'), h('h1', 'Setup and preferences'),
      h('div.sub', 'The app runs only on this computer (127.0.0.1). Your API secret is stored in your operating system\'s credential vault and never reaches the browser.'))),
    h('div.grid.g2',
      h('div.col', { style: { gap: '16px' } }, modeCard(c), connectCard(c), aiCard(), backupCard()),
      h('div.col', { style: { gap: '16px' } }, appearanceCard(), notifCard(st), smsCard(st), watchCard(st), prefsCard(st), exportCard())));
}

// ---------------------------------------------------------------- appearance (per device)
// Preview colours for each palette: [light page, light accent, dark page, dark accent]
const PALETTES = {
  classic: { label: 'Classic', sw: ['#f4f6f9', '#0b8a7d', '#06090f', '#36d7c7'] },
  ocean: { label: 'Ocean', sw: ['#f1f5fb', '#1d63c9', '#050a14', '#5aa2ff'] },
  forest: { label: 'Forest', sw: ['#f2f6f2', '#1f7a3a', '#060c08', '#4ade80'] },
  sunset: { label: 'Sunset', sw: ['#faf6f1', '#b4540b', '#0d0906', '#ffa04d'] },
  grape: { label: 'Grape', sw: ['#f6f4fb', '#6d3fc4', '#09060f', '#b69cff'] },
  contrast: { label: 'High contrast', sw: ['#ffffff', '#0047b3', '#000000', '#7ab8ff'] },
};
function appearanceCard() {
  const T = window.trapTheme;
  const card = h('div.card');
  const paint = () => {
    const cur = T ? T.get() : { mode: 'light', palette: 'classic' };
    const half = (bg, ac) => h('span', { style: { flex: 1, background: bg, display: 'grid', placeItems: 'center' } },
      h('i', { style: { width: '14px', height: '14px', borderRadius: '50%', background: ac, display: 'block' } }));
    card.replaceChildren(
      h('div.card-h', h('h3', icon('palette'), 'Appearance'), h('span.sub', 'Saved on this device. The price charts stay black in every theme.')),
      field('Mode', segmented([['light', 'Light'], ['dark', 'Dark'], ['system', 'Match this computer']], cur.mode, (v) => { T.set(v); paint(); })),
      h('div', { style: { marginTop: '14px' } }, h('div.eyebrow', { style: { marginBottom: '8px' } }, 'Color theme'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: '10px' } },
          Object.entries(PALETTES).map(([id, p]) => h('button', {
            type: 'button', title: p.label, 'aria-pressed': String(cur.palette === id), onclick: () => { T.set(null, id); paint(); },
            style: { padding: '0', borderRadius: '12px', overflow: 'hidden', cursor: 'pointer', background: 'var(--panel)',
              border: cur.palette === id ? '2px solid var(--accent)' : '1px solid var(--line-2)', textAlign: 'left', color: 'var(--ink)' } },
            h('div', { style: { display: 'flex', height: '46px' } }, half(p.sw[0], p.sw[1]), half(p.sw[2], p.sw[3])),
            h('div', { style: { padding: '7px 10px', fontSize: '12.5px', fontWeight: cur.palette === id ? 700 : 500 } }, p.label))))));
  };
  if (!T) { card.replaceChildren(h('div.card-h', h('h3', icon('palette'), 'Appearance')), h('div.muted', 'Reload the page to change the theme.')); return card; }
  paint();
  return card;
}

// ---------------------------------------------------------------- AI analyst (Claude)
function backupCard() {
  const card = h('div.card', h('div.card-h', h('h3', icon('layers'), 'Backup AI (when Claude can\'t answer)')), h('div.skeleton', { style: { height: '120px' } }));
  const HOW = {
    openai: [h('li', 'Go to ', h('b', 'platform.openai.com'), ' and sign in. API use is billed separately from ChatGPT Plus; Plus does not include it.'),
      h('li', 'Settings > Billing: add a payment method or a few dollars of credit.'),
      h('li', 'API keys > ', h('b', 'Create new secret key'), '. Copy it (starts with sk-).')],
    gemini: [h('li', 'Go to ', h('b', 'aistudio.google.com'), ' and sign in with a Google account.'),
      h('li', h('b', 'Get API key'), ' > Create API key. No billing needed for the free tier.'),
      h('li', 'Free tier: Google may use what is sent to improve its products and people may review it, so Gemini gets market data only, never your pattern summary.')],
  };
  const paint = async (I) => {
    I = I || await api.get('/api/ai');
    const rows = I.backups.map((b, i) => {
      let keyVal = ''; let model = b.model;
      return h('div', { style: { padding: '12px 0', borderTop: i ? '1px solid var(--line)' : 'none' } },
        h('div.row', { style: { gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, h('b', `${i + 1}. ${b.label}`),
          h(`span.chip${b.connected ? '.long' : ''}`, b.connected ? 'connected' : 'not connected'),
          h('span.chip', { title: 'The most sensitive data class this provider is ever sent' }, `sends up to: ${b.max_class_label || (b.private ? 'aggregate patterns' : 'market data only')}`)),
        b.connected
          ? h('div.row.wrap', { style: { gap: '10px', alignItems: 'flex-end', marginTop: '8px' } }, h('span.mono', b.key_masked),
              field('Model', h('input.input.mono', { value: model, style: { width: '180px' }, oninput: (e) => { model = e.target.value.trim(); } })),
              h('button.btn.sm', { onclick: async () => { try { paint(await api.put('/api/ai/settings', { [`model_${b.id}`]: model }).then(r => r.data)); toast('Saved', '', 'good'); } catch (e) { toast('Not saved', e.message, 'warn'); } } }, 'Save model'),
              h('button.btn.sm.ghost', { onclick: async () => { if (!await confirmBox(`Remove the ${b.label} key?`, '')) return; paint(await api.del(`/api/ai/backup/${b.id}/key`).then(r => r.data)); } }, icon('trash-2', 'sm'), 'Remove key'))
          : h('div', h('ol', { style: { fontSize: '13px', lineHeight: 1.6, paddingLeft: '18px', margin: '8px 0' } }, HOW[b.id]),
              h('div.row', { style: { gap: '10px', alignItems: 'flex-end' } },
                field('API key', h('input.input', { type: 'password', autocomplete: 'off', style: { minWidth: '240px' }, oninput: (e) => { keyVal = e.target.value.trim(); } })),
                h('button.btn.primary', { onclick: async (e) => {
                  const btn = e.currentTarget; btn.disabled = true;
                  try { paint(await api.post(`/api/ai/backup/${b.id}/key`, { api_key: keyVal }).then(r => r.data)); toast(`${b.label} connected`, 'It steps in when Claude can\'t answer.', 'good'); }
                  catch (err) { toast('Not saved', err.message, 'warn'); btn.disabled = false; }
                } }, 'Save'))));
    });
    card.replaceChildren(h('div.card-h', h('h3', icon('layers'), 'Backup AI (when Claude can\'t answer)')),
      h('p.dim', { style: { fontSize: '13px', marginTop: 0 } }, 'If Claude is out of credits, over a limit, busy or not connected, the scan tries these in order. Every answer gets the same rule re-check, so a backup can never be looser than Claude. ChatGPT spend counts toward your monthly AI budget.'),
      ...rows);
  };
  paint().catch(e => card.replaceChildren(h('div.errline', e.message)));
  return card;
}

function aiCard() {
  const card = h('div.card', h('div.card-h', h('h3', icon('sparkles'), 'AI analyst (Claude)')), h('div.skeleton', { style: { height: '120px' } }));
  fillAI(card);
  return card;
}

async function fillAI(card) {
  let I;
  try { I = await api.get('/api/ai'); } catch (e) { card.replaceChildren(h('div.errline', e.message)); return; }
  const redo = (info) => { I = info; paint(); };
  let keyVal = '';
  const paint = () => {
    const pct = I.budget_usd > 0 ? Math.min(100, I.spent_usd / I.budget_usd * 100) : 100;
    card.replaceChildren(
      h('div.card-h', h('h3', icon('sparkles'), 'AI analyst (Claude)'),
        h('div.right', h(`span.chip${I.connected ? '.long' : ''}`, I.connected ? 'connected' : 'not connected'))),
      h('p.dim', { style: { fontSize: '13px', marginTop: 0 } }, 'Powers "Scan with AI" on the Pre-Trade Checklist: Claude scores every checklist item from live market data, then the app re-checks the answer against your rules.'),
      I.connected
        ? h('div.row.wrap', { style: { gap: '10px', alignItems: 'center' } }, h('span.mono', I.key_masked),
            h('span.muted', { style: { fontSize: '12px' } }, I.storage === 'os-vault' ? 'stored in your OS credential vault' : 'stored in a private file on this laptop'),
            h('button.btn.sm.ghost', { style: { marginLeft: 'auto' }, onclick: async () => { if (!await confirmBox('Remove the Claude key?', 'AI scans stop until you paste a key again.')) return; redo(await api.del('/api/ai/key').then(r => r.data)); } }, icon('trash-2', 'sm'), 'Remove key'))
        : h('div',
            h('ol', { style: { fontSize: '13px', lineHeight: 1.6, paddingLeft: '18px', margin: '0 0 10px' } },
              h('li', 'Go to ', h('b', 'platform.claude.com'), ' (the Claude Console) and sign in. API use is billed separately from a Claude app subscription.'),
              h('li', 'Settings > Billing > ', h('b', 'Buy credits'), '. The API runs on prepaid credits; $5 to $10 covers dozens of scans.'),
              h('li', 'Settings > API keys > ', h('b', 'Create key'), '. Name it "TRAP", then copy it. It is shown only once and starts with sk-ant-.'),
              h('li', 'Paste it below and press Save. The app checks it with Claude before storing it.')),
            h('div.row', { style: { gap: '10px', alignItems: 'flex-end' } },
              field('Claude API key', h('input.input', { type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off', style: { minWidth: '260px' }, oninput: (e) => { keyVal = e.target.value.trim(); } })),
              h('button.btn.primary', { onclick: async (e) => {
                const btn = e.currentTarget; btn.disabled = true;
                try { redo(await api.post('/api/ai/key', { api_key: keyVal }).then(r => r.data)); toast('Claude connected', 'Open the Pre-Trade Checklist and press "Scan with AI".', 'good'); }
                catch (err) { toast('Key not saved', err.message, 'warn', 9000); btn.disabled = false; }
              } }, icon('key-round', 'sm'), 'Save'))),
      h('div.sep'),
      h('div.grid.g2', { style: { gap: '12px' } },
        field('Model', h('select.input', { onchange: async (e) => { try { redo(await api.put('/api/ai/settings', { model: e.target.value }).then(r => r.data)); } catch (err) { toast('Not saved', err.message, 'warn'); } } },
          I.models.map(m => h('option', { value: m.id, selected: m.id === I.model }, m.label))), 'Opus 5.5 is the best balance. Estimated $0.10 to $0.30 a scan on Opus; the exact cost shows under each scan.'),
        field('Scan depth', h('select.input', { onchange: async (e) => { try { redo(await api.put('/api/ai/settings', { depth: e.target.value }).then(r => r.data)); toast('Saved', '', 'good'); } catch (err) { toast('Not saved', err.message, 'warn'); } } },
          (I.depths || []).map(d => h('option', { value: d.id, selected: d.id === I.depth }, d.label))), 'How long Claude thinks before answering. Deep can catch a little more in a messy market; Fast finishes in about half the time.'),
        field('Monthly budget (USD)', numInput(I.budget_usd, { min: 0, max: 1000, step: 1, onchange: async (e) => { try { redo(await api.put('/api/ai/settings', { budget_usd: e.target.value }).then(r => r.data)); toast('Budget saved', '', 'good'); } catch (err) { toast('Not saved', err.message, 'warn'); } } }),
          'Scans stop for the month when this is reached.')),
      h('div', { style: { marginTop: '10px' } },
        h('div.row.between', { style: { fontSize: '12.5px' } }, h('span.dim', `Spent in ${I.month}`), h('b.mono', `${fmt.usd(I.spent_usd)} of ${fmt.usd(I.budget_usd)}`)),
        h(`div.bar${pct >= 90 ? '.crit' : '.accent'}`, { style: { marginTop: '6px' } }, h('i', { style: { width: `${pct}%` } }))),
      h('div.help', { style: { marginTop: '10px' } }, 'What is sent: market data for the symbol you scan (candles, open interest, funding, levels, the rulebook numbers). Never your Bybit keys, balance, positions, trades or loss count. The cost shown is computed from Claude\'s own token counts.'));
  };
  paint();
}

// ---------------------------------------------------------------- push notifications
const STATE_INFO = [
  ['APPROACHING', 'Heads-up: price within 1 ATR of a tracked level', 'Earliest warning. Can be chatty on a busy day.'],
  ['RECRUITING', 'Setup forming: the level broke with valid penetration', 'Get to the chart. The trap may be setting.'],
  ['TRIGGERED', 'Entry signal: the reclaim candle just closed', 'Run the checklist now. Stays on screen until dismissed.'],
];

const BLOCKERS = {
  insecure: 'This page is not on a secure address, so the browser will not allow notifications here. Open the app at http://127.0.0.1 on the laptop, or through your private Tailscale https address on a phone.',
  'ios-home-screen': 'On iPhone and iPad, notifications only work from the Home Screen app: tap Share, then "Add to Home Screen", open TRAP from the new icon, then come back here.',
  unsupported: 'This browser does not support web push notifications.',
  denied: 'Notifications are blocked for this site. Allow them in the browser\'s site settings (or iPhone Settings > Notifications > TRAP), then reload.',
};

function notifCard(st) {
  const card = h('div.card', h('div.card-h', h('h3', icon('bell-ring'), 'Setup and entry alerts')), h('div.skeleton', { style: { height: '120px' } }));
  fillNotif(card, st);
  return card;
}

async function fillNotif(card, st) {
  let P;
  try { P = await api.get('/api/push'); } catch (e) { card.replaceChildren(h('div.errline', e.message)); return; }
  const head = h('div.card-h', h('h3', icon('bell-ring'), 'Setup and entry alerts'),
    h('div.right', h(`span.chip${P.devices && P.devices.length ? '.long' : ''}`, P.available ? `${(P.devices || []).length} device${(P.devices || []).length === 1 ? '' : 's'}` : 'unavailable')));
  if (!P.available) {
    card.replaceChildren(head, h('div.warnline', icon('triangle-alert', 'sm'), `Push notifications are unavailable on this install (${P.reason}). Restart with the launcher so it can install the missing package.`));
    return;
  }
  const { blocker, currentSubscription, enable, disable, defaultLabel } = await import('../push.js');
  const why = blocker();
  const mine = why ? null : await currentSubscription().catch(() => null);
  const mineTail = mine ? mine.endpoint.slice(-16) : null;
  const enrolledHere = !!(mine && (P.devices || []).some(d => d.endpoint_tail === mineTail));
  let label = defaultLabel();
  const redraw = async () => { S = await api.get('/api/settings'); fillNotif(card, S.settings); };

  const thisDevice = why
    ? h('div.warnline', icon('info', 'sm'), BLOCKERS[why])
    : enrolledHere
      ? h('div.row.wrap', { style: { gap: '10px' } }, h('span.chip.long', icon('check', 'sm'), 'This device gets alerts'),
          h('button.btn.sm.ghost', { onclick: async () => { await disable(); toast('Alerts off on this device', '', 'info'); redraw(); } }, 'Turn off here'))
      : h('div.row.wrap', { style: { gap: '10px', alignItems: 'flex-end' } },
          field('Name this device', h('input.input', { value: label, maxlength: 40, oninput: (e) => { label = e.target.value; } })),
          h('button.btn.primary', { onclick: async (e) => {
            const btn = e.currentTarget; btn.disabled = true;
            try { await enable(P.public_key, label); toast('Alerts on', 'This device will get setup and entry alerts.', 'good'); redraw(); }
            catch (err) { toast('Not enabled', err.message, 'warn', 9000); btn.disabled = false; }
          } }, icon('bell-ring', 'sm'), 'Get alerts on this device'));

  const states = new Set(P.states || []);
  const stateRows = STATE_INFO.map(([k, title, sub]) => h('div.row', { style: { padding: '8px 0', borderBottom: '1px solid var(--line)' } },
    h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 600 } }, title), h('div.muted', { style: { fontSize: '12px' } }, sub)),
    toggle(states.has(k), async (v) => { v ? states.add(k) : states.delete(k); await api.put('/api/settings', { push_states: [...states] }); })));

  const devices = (P.devices || []).length ? h('table.tbl', { style: { marginTop: '6px' } }, h('tbody', P.devices.map(d => h('tr',
    h('td', h('div', { style: { fontWeight: 600 } }, d.label || 'Unnamed device', d.endpoint_tail === mineTail ? h('span.muted', ' (this one)') : null),
      h('div.muted', { style: { fontSize: '11px' } }, `${d.service} relay · added ${fmt.local(d.created_at)}`)),
    h('td.muted', { style: { fontSize: '12px' } }, d.last_error ? h('span.bad', 'last send failed') : d.last_sent_at ? `last alert ${fmt.local(d.last_sent_at)}` : 'no alerts yet'),
    h('td', { style: { textAlign: 'right' } }, h('button.btn.sm.ghost', { title: 'Stop sending to this device', onclick: async () => {
      if (!(await confirmBox('Remove this device?', 'It will stop receiving alerts. You can enroll it again any time.'))) return;
      await api.post('/api/push/unsubscribe', { endpoint_tail: d.endpoint_tail }); redraw();
    } }, icon('trash-2', 'sm'))))))) : h('div.muted', { style: { fontSize: '13px' } }, 'No devices enrolled yet.');

  let tn = st.tailnet_host || '';
  const phone = h('details', { style: { marginTop: '12px' } }, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, 'Add your phone (one-time setup)'),
    h('div.col', { style: { gap: '8px', marginTop: '8px', fontSize: '13px' } },
      h('p.dim', { style: { margin: 0 } }, 'Phones only allow notifications from a secure (https) address, and the app only listens on this laptop. Tailscale (free for personal use) gives the laptop a private https address that only your own devices can reach. The app still never opens to the internet.'),
      h('ol', { style: { margin: 0, paddingLeft: '18px', lineHeight: 1.6 } },
        h('li', 'Install Tailscale on this laptop and your phone (tailscale.com/download) and sign in to the same account on both.'),
        h('li', 'In the Tailscale admin console (login.tailscale.com), open the DNS page, make sure MagicDNS is on, then under HTTPS Certificates choose Enable HTTPS. Note: this publishes the laptop\'s Tailscale machine name in a public certificate log, so rename the machine to something that does not identify you (Machines page, "Edit machine name") first.'),
        h('li', `On this laptop, open a command prompt and run:  tailscale serve --bg ${location.port || 8080}`, h('div.muted', { style: { fontSize: '12px' } }, `If Windows says "tailscale" is not recognized, open a new command prompt, or run it by its full path:  "C:\\Program Files\\Tailscale\\tailscale.exe" serve --bg ${location.port || 8080}`)),
        h('li', 'It prints your address, like https://your-laptop.tailXXXX.ts.net. Paste the name below and save.'),
        h('li', 'On the phone, open that address. iPhone: tap Share, "Add to Home Screen", then open TRAP from the Home Screen. Android: open it in Chrome.'),
        h('li', 'Go to Settings in the app on the phone and tap "Get alerts on this device".')),
      h('div.row.wrap', { style: { gap: '8px', alignItems: 'flex-end' } },
        field('Your Tailscale address', h('input.input.mono', { value: tn, placeholder: 'your-laptop.tailXXXX.ts.net', style: { minWidth: '280px' }, oninput: (e) => { tn = e.target.value; } })),
        h('button.btn', { onclick: async () => {
          try { await api.put('/api/settings', { tailnet_host: tn }); toast(tn ? 'Saved' : 'Cleared', tn ? `Open https://${tn.replace(/^https?:\/\//, '')} on your phone.` : 'Phone access through Tailscale is off.', 'good', 7000); redraw(); }
          catch (err) { toast('Not saved', err.message, 'warn'); }
        } }, icon('check', 'sm'), 'Save')),
      h('div.help', 'Leave it empty to keep the app reachable from this laptop only. Once a phone is enrolled, alerts reach it even when Tailscale is off; you only need Tailscale to enroll or to open the app from the phone.')));

  card.replaceChildren(head,
    h('p.dim', { style: { marginTop: 0 } }, 'Alerts come from this laptop, so the app must be running (laptop awake, TRAP window open) to watch the market. Only the alert text leaves the laptop, through your browser maker\'s push service. Never your keys, positions or trades.'),
    h('div.eyebrow', { style: { margin: '6px 0' } }, 'This device'), thisDevice,
    h('div.eyebrow', { style: { margin: '14px 0 2px' } }, 'Alert me when'), ...stateRows,
    h('div.row', { style: { margin: '14px 0 2px', justifyContent: 'space-between' } }, h('div.eyebrow', 'Enrolled devices'),
      (P.devices || []).length ? h('button.btn.sm', { onclick: async () => {
        try { await api.post('/api/push/test'); toast('Test sent', 'It should arrive within a few seconds.', 'good'); setTimeout(redraw, 2500); }
        catch (err) { toast('Test failed', err.message, 'warn', 9000); redraw(); }
      } }, icon('radio', 'sm'), 'Send test') : null),
    devices, phone);
}

// ---------------------------------------------------------------- SMS alerts (Twilio)
function smsCard(st) {
  const card = h('div.card', h('div.card-h', h('h3', icon('text'), 'Text alerts (for when your VPN blocks push)')), h('div.skeleton', { style: { height: '90px' } }));
  fillSms(card, st);
  return card;
}

async function fillSms(card, st) {
  let I;
  try { I = await api.get('/api/sms'); } catch (e) { card.replaceChildren(h('div.errline', e.message)); return; }
  const head = h('div.card-h', h('h3', icon('text'), 'Text alerts (for when your VPN blocks push)'),
    h('div.right', h(`span.chip${I.configured ? '.long' : ''}`, I.configured ? 'connected' : 'not connected')));
  const redraw = async () => { S = await api.get('/api/settings'); fillSms(card, S.settings); };
  const intro = h('p.dim', { style: { marginTop: 0 } },
    'A privacy VPN on your phone (like NordVPN) can silently block push notifications, since Apple\'s push channel has no split-tunnel exception on iOS. A text message rides your carrier\'s SMS network instead, not your data connection, so it still arrives with the VPN on. Only the same alert text push already sends leaves this laptop: never your Bybit keys, balance, positions or trade history.');

  if (!I.configured) {
    const f = { account_sid: '', auth_token: '', from_number: '', to_number: '' };
    const how = h('ol', { style: { fontSize: '13px', lineHeight: 1.6, paddingLeft: '18px', margin: '8px 0' } },
      h('li', 'Go to ', h('b', 'twilio.com/try-twilio'), ' and sign up (no card needed for the free trial).'),
      h('li', 'Twilio Console home shows your ', h('b', 'Account SID'), ' and ', h('b', 'Auth Token'), ' (click "view" to reveal it). Copy both.'),
      h('li', 'The trial gives you a free Twilio phone number automatically; find it under ', h('b', 'Phone Numbers > Manage > Active Numbers'), '. Copy it in international format, e.g. +15551234567.'),
      h('li', 'On the trial, you can only text numbers you have verified. Under ', h('b', 'Phone Numbers > Manage > Verified Caller IDs'), ', verify your own cell number, then enter it below the same way, e.g. +15551234567.'));
    card.replaceChildren(head, intro, how,
      h('div.grid.g2', { style: { gap: '10px' } },
        field('Account SID', h('input.input.mono', { placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', oninput: (e) => { f.account_sid = e.target.value.trim(); } })),
        field('Auth Token', h('input.input.mono', { type: 'password', autocomplete: 'off', oninput: (e) => { f.auth_token = e.target.value.trim(); } })),
        field('Twilio number (From)', h('input.input.mono', { placeholder: '+15551234567', oninput: (e) => { f.from_number = e.target.value.trim(); } })),
        field('Your cell number (To)', h('input.input.mono', { placeholder: '+15551234567', oninput: (e) => { f.to_number = e.target.value.trim(); } }))),
      h('div.row', { style: { marginTop: '10px' } },
        h('button.btn.primary', { onclick: async (e) => {
          const btn = e.currentTarget; btn.disabled = true;
          try { await api.post('/api/sms/config', f); toast('Twilio connected', 'Turn text alerts on below, then send a test.', 'good'); redraw(); }
          catch (err) { toast('Not saved', err.message, 'warn', 9000); btn.disabled = false; }
        } }, 'Save')));
    return;
  }

  card.replaceChildren(head, intro,
    h('div.kv', h('dt', 'Account'), h('dd.mono', I.account_sid_masked), h('dt', 'From'), h('dd.mono', I.from_number), h('dt', 'To'), h('dd.mono', I.to_number),
      h('dt', 'Storage'), h('dd', I.storage === 'os-vault' ? 'OS credential vault' : 'local file, owner-only')),
    h('div.row', { style: { margin: '12px 0', gap: '10px', alignItems: 'center' } },
      h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 600 } }, 'Text alerts'), h('div.muted', { style: { fontSize: '12px' } }, 'Sends the same setup/entry alerts as push, by SMS.')),
      toggle(!!I.enabled, async (v) => {
        try { await api.put('/api/settings', { sms_enabled: v }); toast(v ? 'Text alerts on' : 'Text alerts off', '', 'good'); redraw(); }
        catch (err) { toast('Not saved', err.message, 'warn'); }
      })),
    h('div.row.wrap', { style: { gap: '10px' } },
      h('button.btn.sm', { onclick: async () => {
        try { await api.post('/api/sms/test'); toast('Test sent', 'Should arrive within a few seconds, even with your VPN on.', 'good'); }
        catch (err) { toast('Test failed', err.message, 'warn', 9000); }
      } }, icon('radio', 'sm'), 'Send test'),
      h('button.btn.sm.ghost', { onclick: async () => {
        if (!(await confirmBox('Remove this Twilio account?', 'Text alerts turn off. Your Twilio account itself is unaffected.'))) return;
        await api.del('/api/sms/config'); redraw();
      } }, icon('trash-2', 'sm'), 'Remove')),
    h('div.help', { style: { marginTop: '8px' } }, 'Trial accounts prefix every text with "Sent from your Twilio trial account" and can only text the verified number above. Upgrading in the Twilio Console (about $0.01 to $0.014 per text, plus roughly $1.15/month to keep the number) removes both limits.'));
}

function modeCard(c) {
  return h('div.card', h('div.card-h', h('h3', icon('monitor-dot'), 'Mode')),
    h('p.dim', { style: { marginTop: 0 } }, 'Demo mode runs on a synthetic market and a sample month of trades in a separate database, so you can explore every screen safely. Live mode uses real Bybit market data and your read-only account.'),
    segmented([['live', 'Live'], ['demo', 'Demo']], c.demo ? 'demo' : 'live', async (v) => {
      toast('Switching mode…', 'The app is restarting its engines.', 'info', 3000);
      await api.post('/api/mode', { demo: v === 'demo' });
      setTimeout(() => location.reload(), 800);
    }),
    c.demo ? h('div', { style: { marginTop: '12px' } }, h('button.btn.sm', { onclick: async () => { if (await confirmBox('Reset the demo?', 'Re-seeds the sample journal. Live data is untouched.')) { await api.post('/api/demo/reset'); location.reload(); } } }, icon('refresh-cw', 'sm'), 'Reset demo data')) : null);
}

function connectCard(c) {
  const f = { api_key: '', api_secret: '' };
  const status = c.demo ? 'Demo mode: no account connection.' : c.connected ? `Connected (${c.status})` : 'Not connected';
  const k = c.key;
  return h(`div.card${c.connected ? '.glow' : ''}`,
    h('div.card-h', h('h3', icon('key-round'), 'Bybit connection (read-only)'), h('div.right', h(`span.chip${c.connected ? '.long' : ''}`, status))),
    c.connected && k ? h('div',
      h('div.kv', h('dt', 'Key'), h('dd', c.key_masked), h('dt', 'Read-only'), h('dd', k.read_only ? h('span.good', 'yes, verified') : h('span.bad', 'NO')),
        h('dt', 'Withdraw permission'), h('dd', k.withdraw ? h('span.bad', 'present') : h('span.good', 'none')),
        h('dt', 'Expires'), h('dd', k.expires ? fmt.local(Date.parse(k.expires)) : '—'),
        h('dt', 'IP restriction'), h('dd', k.ips && k.ips.length && k.ips[0] !== '*' ? k.ips.join(', ') : 'none'),
        h('dt', 'Private stream'), h('dd', c.private_ws ? h('span.good', 'live') : 'reconnecting'),
        h('dt', 'Fee rate (taker/maker)'), h('dd', c.fee ? `${fmt.num(c.fee.taker_pct, 3)}% / ${fmt.num(c.fee.maker_pct, 3)}%` : '—'),
        h('dt', 'Secret stored in'), h('dd', c.storage === 'os-vault' ? 'OS credential vault' : 'local file (no vault found)')),
      c.error ? h('div.errline', { style: { marginTop: '10px' } }, icon('octagon-x', 'sm'), c.error) : null,
      h('div.row', { style: { marginTop: '14px' } }, h('button.btn.danger', { onclick: async () => { if (await confirmBox('Disconnect Bybit?', 'Removes the stored key from this computer. Your journal stays.', 'Disconnect', true)) { await api.post('/api/disconnect'); S = await api.get('/api/settings'); draw(); ctxRef.refresh(); } } }, icon('unplug', 'sm'), 'Disconnect'))) :
      h('div.col', { style: { gap: '12px' } },
          c.demo ? h('div.lockbanner', icon('info'), 'Demo mode: the steps below are shown so you can create the key ahead of time. Switch to Live mode (above) to connect it.') : null,
          h('ol', { style: { margin: 0, paddingLeft: '20px', color: 'var(--ink-2)', fontSize: '13px', lineHeight: 1.7 } },
            h('li', 'On bybit.com (the website; keys cannot be created in the app), click your profile icon, top right, then ', h('b', 'API'), '.'),
            h('li', 'Click ', h('b', 'Create New Key'), ', then ', h('b', 'System-generated API Keys'), '.'),
            h('li', 'Keep ', h('b', 'API Transaction'), ' selected and choose ', h('b', 'Read-Only'), '. Do not tick any trade, transfer or withdraw permission.'),
            h('li', 'IP restriction: your VPN changes your IP, so choose no IP restriction. Such keys expire (reported as 3 months), and the app shows the exact expiry once connected.'),
            h('li', 'Finish the 2FA step, then copy the key and the secret (the secret is shown once) and paste both below.')),
          field('API key', h('input.input.mono', { autocomplete: 'off', spellcheck: 'false', oninput: (e) => { f.api_key = e.target.value; } })),
          field('API secret', h('input.input.mono', { type: 'password', autocomplete: 'off', oninput: (e) => { f.api_secret = e.target.value; } })),
          h('div.help', 'The app checks the key with Bybit before saving it. A key that can trade or withdraw is refused and never stored.'),
          c.demo ? null : h('button.btn.primary', { onclick: async (e) => {
            e.target.disabled = true;
            try { await api.post('/api/connect', f); toast('Connected, read-only verified', 'Backfilling your last 30 days of trades into the journal…', 'good', 8000); S = await api.get('/api/settings'); draw(); ctxRef.refresh(); }
            catch (err) { toast('Not connected', err.message, 'alert', 12000); e.target.disabled = false; }
          } }, icon('plug', 'sm'), 'Verify and connect')),
    h('div.sep'),
    h('div.help', icon('shield-check', 'sm'), ' The app\'s code can only send GET requests to an allowlist of read endpoints, and its WebSocket can only authenticate, subscribe and ping. There is no code that places, amends or cancels an order.'));
}

function watchCard(st) {
  let wl = st.watchlist.join(', '); let thin = st.thin_assets.join(', ');
  return h('div.card', h('div.card-h', h('h3', icon('radio'), 'Watchlist')),
    field('Coins (comma separated, max 8). Type XRP or XRPUSDT; the app finds the Bybit USDT perpetual.', h('input.input.mono', { value: wl, oninput: (e) => { wl = e.target.value; } })),
    field('Thin / fragmented assets (0.4 ATR floor, 2% width floor, CVD warning)', h('input.input.mono', { value: thin, style: { marginTop: '4px' }, oninput: (e) => { thin = e.target.value; } })),
    h('button.btn', { style: { marginTop: '12px' }, onclick: async () => {
      try {
        const r = await api.put('/api/settings', { watchlist: wl.split(','), thin_assets: thin.split(',') });
        const notes = (r && r.notes) || [];
        toast('Watchlist saved', notes.length ? notes.join('. ') + '.' : 'Market engine restarted.', 'good', notes.length ? 8000 : undefined);
        S = await api.get('/api/settings'); draw(); ctxRef.refresh();
      }
      catch (e) { toast('Not saved', e.message, 'warn'); }
    } }, icon('check', 'sm'), 'Save watchlist'));
}

function prefsCard(st) {
  const row = (label, sub, ctl) => h('div.row', { style: { padding: '10px 0', borderBottom: '1px solid var(--line)' } }, h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 600 } }, label), sub ? h('div.muted', { style: { fontSize: '12px' } }, sub) : null), ctl);
  const put = async (b) => { await api.put('/api/settings', b); await ctxRef.refresh(); };
  let eq = st.starting_equity; let days = st.backfill_days; let name = st.coach_name;
  return h('div.card', h('div.card-h', h('h3', icon('sliders-horizontal'), 'Preferences')),
    row('Sounds', 'Chimes for XP, alarms for rule breaks', toggle(st.sound, (v) => put({ sound: v }))),
    row('Desktop notifications', 'Alerts when the tab is in the background', toggle(st.notifications, (v) => { put({ notifications: v }); if (v && 'Notification' in window) Notification.requestPermission(); })),
    row('Reduced motion', 'Turns off confetti and animations', toggle(st.reduced_motion, (v) => put({ reduced_motion: v }))),
    h('div.grid.g3', { style: { gap: '10px', marginTop: '12px' } },
      field('Starting equity (for manual/demo)', numInput(eq, { oninput: (e) => { eq = e.target.value; } })),
      field('Backfill days on connect', numInput(days, { oninput: (e) => { days = e.target.value; } })),
      field('Coach name', h('input.input', { value: name, oninput: (e) => { name = e.target.value; } }))),
    h('button.btn', { style: { marginTop: '12px' }, onclick: async () => { await put({ starting_equity: eq, backfill_days: days, coach_name: name }); toast('Saved', '', 'good'); } }, icon('check', 'sm'), 'Save'));
}

function exportCard() {
  return h('div.card', h('div.card-h', h('h3', icon('download'), 'Export and backup')),
    h('p.dim', { style: { marginTop: 0 } }, 'The Excel export fills your original Trap Journal workbook, so its Dashboard and Diagnostics tabs keep working.'),
    h('div.row.wrap', h('button.btn', { onclick: () => api.download('/api/export.xlsx') }, icon('file-spreadsheet', 'sm'), 'Trap Journal.xlsx'),
      h('button.btn', { onclick: () => api.download('/api/export.csv') }, icon('file-text', 'sm'), 'CSV'),
      h('button.btn', { onclick: () => api.download('/api/export.json') }, icon('file-json', 'sm'), 'Full backup (JSON)')),
    h('div.help', { style: { marginTop: '10px' } }, 'Your data lives in the app\'s "data" folder (trap.db). Back that folder up to keep everything, including XP and badges.'));
}
