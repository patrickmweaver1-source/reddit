// TRAP Discipline service worker. Its only job is Web Push: show the alert
// the app sent, and open the right page when it is tapped. It does not cache
// pages or intercept requests, so the app always runs live from your laptop.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'TRAP Discipline';
  const entry = /TRIGGERED/.test(title);
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    tag: d.tag || 'trap',          // one notification per level: the entry alert replaces its "forming" alert
    renotify: true,                // ...and still buzzes when it does
    requireInteraction: entry,     // entry alerts stay on screen until dismissed (where the platform allows)
    icon: '/static/icons/icon-192.png',
    badge: '/static/icons/badge-96.png',
    data: { url: d.url || '/', act: d.act || null },
    actions: Array.isArray(d.actions) ? d.actions.slice(0, 2) : [],   // Apply / Dismiss on proposals (not shown on iOS)
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  if (e.action && data.act && data.act[e.action]) {
    // a proposal button: act on it without opening the app, then confirm
    e.waitUntil((async () => {
      let msg;
      try {
        const r = await fetch(data.act[e.action], { method: 'POST' });
        const j = await r.json().catch(() => ({}));
        msg = j.ok ? j.message : (j.error || 'Not done. Open TRAP to review it.');
      } catch {
        msg = 'Could not reach your laptop. Open TRAP there to review the proposal.';
      }
      await self.registration.showNotification('TRAP auto-tune', { body: msg, tag: 'tune-result', icon: '/static/icons/icon-192.png', badge: '/static/icons/badge-96.png', data: { url: '/#/playbook' } });
    })());
    return;
  }
  const url = new URL(data.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        w.postMessage({ type: 'trap-nav', url });
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
