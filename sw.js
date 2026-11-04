const CACHE_NAME = 'paydayflow-v6';
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

// Only a good reply is worth keeping: a 404, an error page or a redirect must never replace a working copy (Chrome
// refuses to open a page from a saved redirect).
function isGood(res) {
  return res && res.ok && res.type === 'basic' && !res.redirected;
}

self.addEventListener('fetch', (event) => {
  // Never intercept POST requests or external Google/Apps Script URLs
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // The stylesheet URL carries a content hash (tailwind.css?v=...), and a font file never changes under the same
  // name, so a cached copy is always the right one: serve it straight from the cache and only touch the network the
  // first time a version is seen.
  const path = new URL(event.request.url).pathname;
  if (path === '/tailwind.css' || path.startsWith('/fonts/')) {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
        if (!isGood(res)) return res;
        const copy = res.clone();
        caches.open(CACHE_NAME).then(async (cache) => {
          // Drop older versions of the stylesheet so they don't pile up.
          if (path === '/tailwind.css') {
            for (const key of await cache.keys()) {
              if (new URL(key.url).pathname === '/tailwind.css') await cache.delete(key);
            }
          }
          await cache.put(event.request, copy);
        });
        return res;
      }))
    );
    return;
  }

  // Everything else opens from the saved copy straight away, so the app starts instantly even on a weak signal or
  // offline. A fresh copy is fetched at the same time and saved for next time (never an error page). When the page
  // itself has changed, the open app is told, and offers to reload. With nothing saved yet, the network is used.
  const isPage = event.request.mode === 'navigate';
  // A home-screen shortcut opens the page as /?go=..., which is still the same page: it is saved and found under
  // its plain address, so it opens offline too and the saved copies don't pile up.
  const pageUrl = new URL(event.request.url);
  const key = isPage ? pageUrl.origin + pageUrl.pathname : event.request;
  const cachedP = caches.match(key);
  // The copy is taken as soon as the reply arrives, before the browser starts reading it.
  const networkP = fetch(event.request).then((res) => ({ res, copy: isGood(res) ? res.clone() : null }));
  event.waitUntil(networkP.then(async ({ copy }) => {
    if (!copy) return;
    const cache = await caches.open(CACHE_NAME);
    // Compared with its own read of the saved copy (the one being shown is the browser's to read).
    const saved = isPage ? await cache.match(key) : null;
    const changed = !!saved && (await saved.text()) !== (await copy.clone().text());
    await cache.put(key, copy);
    if (changed) {
      const client = await self.clients.get(event.resultingClientId || event.clientId);
      if (client) client.postMessage({ type: 'pf-updated' });
    }
  }).catch(() => {}));
  event.respondWith(cachedP.then((cached) => cached || networkP.then(({ res }) => res)));
});
