const CACHE_NAME = 'kp-app-shell-v1';
const APP_SHELL = ['/theme.css', '/alpine.min.js', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// App-shell caching only — no data caching. Anything not in APP_SHELL goes to network.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!APP_SHELL.includes(url.pathname)) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
