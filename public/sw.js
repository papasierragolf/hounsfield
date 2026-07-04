/* Hounsfield service worker — offline app shell.
 * Model weights are cached separately by transformers.js in the Cache API
 * ("transformers-cache"), so they are NOT duplicated here.
 */
const SHELL_CACHE = 'hounsfield-shell-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('hounsfield-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  // Never intercept model downloads — transformers.js manages its own cache.
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    // Network-first for navigations so deploys are picked up; offline falls back to cache.
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Cache-first ONLY for content-hashed build assets (immutable by design).
  // Everything else (dev modules, manifest updates, …) goes to the network.
  if (!url.pathname.startsWith('/assets/') && url.pathname !== '/icon.svg' && url.pathname !== '/manifest.webmanifest') {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        })
    )
  );
});
