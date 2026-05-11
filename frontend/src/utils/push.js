// Browser-side Web Push glue: register the service worker, ask for
// permission, subscribe with the backend's VAPID public key, and POST the
// subscription back to the server.
//
// All API calls go through the shared axios `API` instance so the JWT is
// attached automatically.

import API from '../api';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function registerServiceWorker() {
  if (!isPushSupported()) return null;
  return navigator.serviceWorker.register('/sw.js');
}

export async function getCurrentSubscription() {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function subscribePush() {
  if (!isPushSupported()) throw new Error('This browser does not support push notifications.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was denied.');

  const reg = await navigator.serviceWorker.ready;
  // If already subscribed, reuse it.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { data } = await API.get('/push/vapid-public-key');
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    });
  }

  const json = sub.toJSON();
  await API.post('/push/subscribe', {
    endpoint: sub.endpoint,
    keys: json.keys,
  });
  return sub;
}

export async function unsubscribePush() {
  const sub = await getCurrentSubscription();
  if (!sub) return;
  try { await API.post('/push/unsubscribe', { endpoint: sub.endpoint }); } catch {}
  await sub.unsubscribe();
}

export async function sendTestPush() {
  return API.post('/push/test');
}
