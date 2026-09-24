// Web Push enrollment for this browser/device. The laptop app decides WHAT
// to send (setup forming, entry signal); this file only lets a device opt in
// or out. Permission must be requested from a tap, so enable() is only ever
// called from a click handler.
import { api } from './api.js';

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** Why push can't work here right now, or null if it can. */
export function blocker() {
  if (!window.isSecureContext) return 'insecure';
  if (isIOS() && !isStandalone()) return 'ios-home-screen';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return null;
}

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function sameKey(sub, publicKey) {
  const k = sub && sub.options && sub.options.applicationServerKey;
  if (!k) return true; // browser does not expose it: assume it matches
  const a = new Uint8Array(k); const b = keyBytes(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function registration() {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return reg;
}

/** This device's current subscription, if it has one. */
export async function currentSubscription() {
  if (blocker() && blocker() !== 'denied') return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Opt this device in. Must be called directly from a tap/click. */
export async function enable(publicKey, label) {
  const perm = await Notification.requestPermission();   // first await, so it stays inside the user gesture (iOS requires this)
  if (perm !== 'granted') throw new Error('Notifications were not allowed on this device. Allow them in the browser or system settings, then try again.');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, publicKey)) { await sub.unsubscribe(); sub = null; }  // enrolled against an older app key
  if (!sub) {
    try {
      // the browser registers with its vendor's push service here; if that
      // service is unreachable some browsers wait indefinitely, so cap it
      const timeout = new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'AbortError' })), 25000));
      sub = await Promise.race([reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }), timeout]);
    } catch (e) {
      // translate browser errors into something actionable
      if (e && e.name === 'NotAllowedError') throw new Error('This browser window blocked push. Private or Incognito windows cannot receive push notifications. Open the app in a normal window and try again.');
      if (e && e.name === 'AbortError') throw new Error('The browser could not reach its push service. Check the internet connection (and that nothing is blocking Google, Apple or Mozilla push), then try again.');
      throw e;
    }
  }
  const r = await api.post('/api/push/subscribe', { subscription: sub.toJSON(), label });
  return r.data;
}

/** Opt this device out (both in the browser and on the laptop). */
export async function disable() {
  const sub = await currentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch { /* already gone */ }
  const r = await api.post('/api/push/unsubscribe', { endpoint });
  return r.data;
}

/** Keep the worker registered on every load for devices that are enrolled,
 *  and route notification taps to the right page. */
export async function boot() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'trap-nav' && e.data.url) {
      const u = new URL(e.data.url);
      if (u.origin === location.origin) location.hash = u.hash || '#/';
    }
  });
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (reg) reg.update();
  } catch { /* ignore */ }
}

export function defaultLabel() {
  const ua = navigator.userAgent;
  const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || isIOS() ? 'iPad' : /Android/.test(ua) ? 'Android phone'
    : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'This device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${dev} (${br})` : dev;
}
