// Mayvel Task service worker — handles incoming Web Push messages.
// Lives at the site root (/sw.js) so its scope covers the whole app.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Mayvel Task', body: event.data?.text() || '' }; }
  const title = data.title || 'Mayvel Task';
  const options = {
    body: data.body || '',
    icon: '/vite.svg',
    badge: '/vite.svg',
    data: { url: data.url || '/', notifId: data.notifId || null },
    tag: data.notifId || 'mayvel-push',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clicking the OS notification focuses an existing tab or opens a new one
// at the URL embedded in the push payload.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) {
        client.postMessage({ type: 'push-click', url: targetUrl });
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  })());
});
