// Management Hub — Service Worker
const CACHE_NAME = 'mgmt-hub-v2';
const PRECACHE = [
  './',
  './index.html',
  './staff.html',
  './admin.html',
  './superadmin.html',
  './supabase-config.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// ─── PUSH NOTIFICATIONS ────────────────────────────────────────────────────
// Fired when the browser receives a push message (even when app is closed)
self.addEventListener('push', event => {
  let payload = { title: 'Management Hub', body: 'You have a new notification.', url: './staff.html', icon: './icon-192.png' };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon || './icon-192.png',
    badge: payload.badge || './icon-192.png',
    data: { url: payload.url || './staff.html' },
    vibrate: [200, 100, 200],
    tag: payload.tag || 'mgmt-hub',          // collapse duplicate notifications
    renotify: true,
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// ─── NOTIFICATION CLICK ────────────────────────────────────────────────────
// Opens / focuses the app when user taps the notification
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './staff.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing open tab if found
      for (const client of windowClients) {
        if (client.url.includes('staff.html') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
