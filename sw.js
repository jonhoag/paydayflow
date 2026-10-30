const CACHE_NAME = 'paydayflow-v5';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Never intercept POST requests or external Google/Apps Script URLs
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // The stylesheet URL carries a content hash (tailwind.css?v=...), so a cached copy is always the right
  // one: serve it straight from the cache and only touch the network the first time a version is seen.
  if (new URL(event.request.url).pathname === '/tailwind.css') {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(async (cache) => {
          // Drop older versions of the stylesheet so they don't pile up.
          for (const key of await cache.keys()) {
            if (new URL(key.url).pathname === '/tailwind.css') await cache.delete(key);
          }
          await cache.put(event.request, copy);
        });
        return res;
      }))
    );
    return;
  }

  // Everything else: network-first so updates on GitHub appear immediately
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
