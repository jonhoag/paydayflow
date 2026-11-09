// Runbook: if a device ever opens a page that isn't the real app, bump CACHE_NAME and publish (every device throws
// its saved copies away at its next open and downloads the app afresh), and on that device use the browser's "Clear site data" for this site.
const CACHE_NAME = 'paydayflow-v6';

// The SHA-256 of every file this version saves, as published (written by build-sw.js; never edit by hand). A saved
// copy is only ever served when it is exactly one of these files, so nothing else written into the browser's saved
// copies (by code injected into the page, say) can be opened in place of the real app. A new version of any file
// changes this list, and so this file, which is how each device picks up a new version.
const SITE_HASHES = {
  // <site-hashes>
  '/': 'b5960c05c24cf3e3e187e0d1b1ff13df2577ab74a689d95bd38dbcfa1c027f6a',
  '/guard.js': 'f8d4ca9cba1a71963b8f19262e9381ba7743f9a1f8c397ee3cb776437517a7cc',
  '/app.js': '7ee2c2ea7d9d94c6ee4d5123a68f2145ff8b4da9150734a9e6f5edf2d706ef9d',
  '/tailwind.css': 'ae92c5cffe993f4cca370164fd644a8308d01db01be487c1e47338115464d316',
  '/manifest.json': 'f41e3736fbec8f5861c2d60e992c5b8133e1d06a9afdf527bf753728abb69784',
  '/icons/icon-192.png': '4d5d98ee6b7399e36c0608ae5214ef8bb0b2b5b6f93f0b2b78a0232a4f615da6',
  '/icons/icon-512.png': 'd0b21f1d59491bc8c691ca4e4a5a7e7323f2abe2c27ccee2bfa44bcfb631e918',
  '/icons/icon-maskable-512.png': '56170699c4dd0e76f5a8f9109122f16eb8f4ca4d47f9d204724fe654dc521be6',
  '/icons/shortcut-add.png': '1273198421ae1b9e475a56a9b962b9b2f4fe6bf4814bfbd105e2715a4000e171',
  '/icons/shortcut-owed.png': '9267623994d713eb36f7d6c031592d6a59e7320db15246674e4110411f127b97',
  '/icons/shortcut-spending.png': '8345af9ea342b21ba1dbc576bf46f72dbc0c3ea7c46e7e16af117f21d496e541',
  '/fonts/OFL.txt': '5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57',
  '/fonts/inter-latin-ext.woff2': '34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956',
  '/fonts/inter-latin.woff2': '3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62',
  // </site-hashes>
};
const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', json: 'application/json', png: 'image/png', woff2: 'font/woff2', txt: 'text/plain; charset=utf-8' };

// Each version keeps its copies in a cache of its own, named from all its hashes (a short FNV-1a checksum of them).
function versionCacheName() {
  let h = 2166136261;
  for (const c of Object.values(SITE_HASHES).join('')) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return CACHE_NAME + '-' + h.toString(16);
}
const VERSION_CACHE = versionCacheName();
const known = (path) => Object.prototype.hasOwnProperty.call(SITE_HASHES, path);

// The body of a reply if it is exactly the file this version expects at that address, else null.
async function verifiedBody(res, path) {
  if (!res || !known(path)) return null;
  const body = await res.clone().arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hash === SITE_HASHES[path] ? body : null;
}

// A reply built afresh from checked bytes: nothing saved alongside them (headers, status, redirects) is ever passed on.
function cleanReply(body, path) {
  const ext = path === '/' ? 'html' : path.split('.').pop();
  return new Response(body, { headers: { 'Content-Type': TYPES[ext] || 'application/octet-stream' } });
}

// Only a good reply is worth checking: a 404, an error page or a redirect is never saved.
function isGood(res) {
  return res && res.ok && res.type === 'basic' && !res.redirected;
}

// A version installs only once every one of its files is here and matches, into a cache of its own. Until then the
// version already running carries on with its own saved copies (never touched by the install), and the browser tries
// again at the next open. A file that hasn't changed is taken from the running version's saved copy, not downloaded
// again (including its own copies, when only sw.js itself changed); after a CACHE_NAME bump, everything is downloaded
// afresh.
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const older = (await caches.keys()).filter((name) => name === CACHE_NAME || name.startsWith(CACHE_NAME + '-'));
    const files = await Promise.all(Object.keys(SITE_HASHES).map(async (path) => {
      for (const name of older) {
        const body = await caches.open(name).then((c) => c.match(path)).then((hit) => verifiedBody(hit, path)).catch(() => null);
        if (body) return [path, body];
      }
      const res = await fetch(path, { cache: 'reload' });
      const body = isGood(res) ? await verifiedBody(res, path) : null;
      if (!body) throw new Error(path + ' does not match this version yet');
      return [path, body];
    }));
    const cache = await caches.open(VERSION_CACHE);
    await Promise.all(files.map(([path, body]) => cache.put(path, cleanReply(body, path))));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const upgrading = names.some((name) => name !== VERSION_CACHE && name.startsWith('paydayflow-'));
    for (const name of names) if (name !== VERSION_CACHE) await caches.delete(name);
    await self.clients.claim();
    // An older version had saved the app, so an open window is still showing it: offer a reload.
    if (upgrading) for (const client of await self.clients.matchAll({ type: 'window' })) client.postMessage({ type: 'pf-updated' });
  })());
});

// The app's own files open from the saved copy straight away (so it starts instantly on a weak signal or offline),
// but only a copy that matches. Anything else goes to the network, and a reply that matches is saved for next time.
// A home-screen shortcut opens the page as /?go=..., and the scripts and the stylesheet are asked for as app.js?v=...
// (see build-sw.js): each is found under its plain address. Other requests (POSTs, Google, Apps Script, unknown
// addresses) are left alone.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !known(url.pathname)) return;
  // A request for one exact version (app.js?v=...) that isn't this version's file is left to the network.
  const v = url.searchParams.get('v');
  if (v && !SITE_HASHES[url.pathname].startsWith(v)) return;
  const key = url.origin + url.pathname;
  event.respondWith((async () => {
    // If the saved copies can't be read at all (storage trouble), the network is used: that never stops the app opening.
    // Read and saved without ever creating this version's cache: once a newer version has deleted it, this one only
    // passes requests on.
    const saved = await caches.match(key, { cacheName: VERSION_CACHE }).then((hit) => verifiedBody(hit, url.pathname)).catch(() => null);
    if (saved) return cleanReply(saved, url.pathname);
    const res = await fetch(event.request);
    const body = isGood(res) ? await verifiedBody(res, url.pathname).catch(() => null) : null;
    if (body) {
      event.waitUntil(caches.has(VERSION_CACHE)
        .then((there) => there && caches.open(VERSION_CACHE).then((cache) => cache.put(key, cleanReply(body, url.pathname))))
        .catch(() => {}));
    }
    return res;
  })());
});
