// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/frontend/public/에서
// Service worker: makes the app installable, shows an offline notice, and caches built files. Rules in docs/pwa.md (central repository).
// - Pages: always from the network; when offline, offline.html. Pages are not cached, so data is never stale.
// - /assets/ (file names carry a content hash): cache first.
// - /api/, other methods and other origins: not touched.
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
