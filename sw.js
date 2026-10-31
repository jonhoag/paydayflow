const CACHE_NAME = 'paydayflow-v5';
const ASSETS = ['/', '/index.html', '/manifest.json'];
// On a weak signal, wait this long for the network before opening the saved copy instead.
const NETWORK_TIMEOUT_MS = 3000;

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

// Only a good reply is worth keeping: a 404 or an error page must never replace a working copy.
function isGood(res) {
  return res && res.ok && res.type === 'basic';
}

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
        if (!isGood(res)) return res;
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

  // Everything else: network-first so updates on GitHub appear immediately, but with a time limit. If the
  // network is slow, failing or returns an error, the saved copy is used; a late network reply still
  // refreshes the saved copy for next time.
  const network = fetch(event.request).then((res) => {
    if (isGood(res)) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return res;
  });
  event.waitUntil(network.catch(() => {}));
  event.respondWith((async () => {
    const timedOut = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
    const res = await Promise.race([network.catch(() => null), timedOut]);
    if (res && res.ok) return res;
    const cached = await caches.match(event.request);
    if (cached) return cached;
    return res || network;   // nothing saved yet: keep waiting for the network (or pass on its error)
  })());
});
