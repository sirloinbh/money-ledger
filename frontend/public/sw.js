// Managed file. Edit it in sirloinbh/project-standards templates/app/frontend/public/
// Service worker: makes the app installable, shows an offline notice, and caches built files. Rules in docs/pwa.md (central repository).
// - Pages: always from the network; when offline, offline.html. Pages are not cached, so data is never stale.
// - /assets/ (file names carry a content hash): cache first.
// - /api/, other methods and other origins: not touched.
// - Web Push: `push` shows a notification from the JSON payload { title, body, url }; `notificationclick` focuses a window already on the
//   url or opens it (same origin only, else '/'). Nothing happens unless an app subscribes to push.
// A new version installs on the next visit, takes over at once, and deletes the caches of older versions.
/* global self, caches */ // Service worker globals for ESLint.
const VERSION = 'v1';
const CACHE = `static-${VERSION}`;
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(OFFLINE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(OFFLINE)) ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') event.respondWith(networkOrOffline(request));
  else if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(request));
});

// Web Push. The payload is JSON { title, body, url }; a missing or broken payload still shows a plain notification.
function readPayload(event) {
  try {
    const data = event.data ? event.data.json() : {};
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

// Only a URL on this app's origin is opened; anything else (or an invalid URL) goes to the start page.
function sameOriginUrl(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : '/', self.location.origin);
    return url.origin === self.location.origin ? url.href : new URL('/', self.location.origin).href;
  } catch {
    return new URL('/', self.location.origin).href;
  }
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event);
  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Notification';
  const options = { data: { url: sameOriginUrl(payload.url) }, icon: '/icons/icon-192.png' };
  if (typeof payload.body === 'string') options.body = payload.body;
  event.waitUntil(self.registration.showNotification(title, options));
});

// A window already on the url is focused; others are left alone (they may hold unsaved input), and the url opens in a new window.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = sameOriginUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url === target);
      return open ? open.focus() : self.clients.openWindow(target);
    }),
  );
});
