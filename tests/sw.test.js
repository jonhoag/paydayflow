// Service worker test in a REAL Chrome (service workers need a real browser on localhost).
// A local server serves this folder and can be switched to fresh, half-published, slow, failing (404) or offline, to
// check that the app opens at once from its saved copy, picks up a new version for next time (and offers a reload),
// that a bad reply never replaces the saved copy, and that a saved copy is only ever opened when it is exactly the
// published file (anything else written into the saved copies is never shown).
//
//   node tests/sw.test.js   (playwright-core from PW_PATH, or from npm ci --ignore-scripts)
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const { launchChrome, makeSteps } = require('./lib/runner');
const PORT = 8127;
const origin = 'http://localhost:' + PORT;
const { HOST, TYPES, siteRel, siteFile, publishedBytes } = require('./lib/site-files');

// live (sw.js is the version live before this check existed) | normal | fresh (a new version: the page gains a marker
// and sw.js holds its hash) | fresh-sw (the same, with a change to sw.js alone) | half (a new sw.js whose page has not arrived yet) | slow (10 s) | 404 | down (drops the
// connection)
let mode = 'live';
const LIVE_SW = path.join(__dirname, 'lib', 'sw-before-hashes.js');
const withMarker = body => Buffer.from(body.toString('utf8').replace('</body>', '<div id="fresh-marker"></div></body>'));
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const realPage = publishedBytes(path.join(__dirname, '..', 'index.html'));
const realCss = publishedBytes(path.join(__dirname, '..', 'tailwind.css')).toString('utf8');
// prev: the version live just before the scripts moved out (its page held them inline, under 'unsafe-inline', and its
// sw.js had no app.js or guard.js), rebuilt from today's files the way it was built then.
const swPublished = publishedBytes(path.join(__dirname, '..', 'sw.js')).toString('utf8');
const PREV_PAGE = Buffer.from(realPage.toString('utf8')
  .replace(/<script src="([\w-]+\.js)\?v=[0-9a-f]+"><\/script>/g, (all, f) => '<script>\n' + publishedBytes(path.join(__dirname, '..', f)).toString('utf8') + '</script>')
  .replace("script-src 'self' ", "script-src 'self' 'unsafe-inline' "));
const PREV_SW = Buffer.from(swPublished.replace(/(\/\/ <site-hashes>\n)([\s\S]*?)( *\/\/ <\/site-hashes>)/, (all, open, body, close) =>
  open + body.split('\n').filter(l => l && !/'\/(app|guard)\.js'/.test(l)).map(l => l.startsWith("  '/': ") ? `  '/': '${sha256(PREV_PAGE)}',` : l).join('\n') + '\n' + close));
let fontHits = 0;   // requests for the font files that reached this server
let pageHits = 0;   // requests for the page itself that reached this server
let cssHits = 0;    // requests for the stylesheet that reached this server
const server = http.createServer((req, res) => {
  const rel = siteRel(req.url) || '';
  const isPage = rel === 'index.html';
  if (rel.startsWith('fonts/')) fontHits++;
  if (isPage) pageHits++;
  if (rel === 'tailwind.css') cssHits++;
  if (mode === 'down') return req.socket.destroy();
  if (mode === '404' && rel !== 'sw.js') { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<title>Not found</title>Not found'); }
  const file = siteFile(req.url);
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  const send = () => {
    let body = publishedBytes(rel === 'sw.js' && mode === 'live' ? LIVE_SW : file);
    if (mode === 'prev' && isPage) body = PREV_PAGE;
    if (mode === 'prev' && rel === 'sw.js') body = PREV_SW;
    if (isPage && mode.startsWith('fresh')) body = withMarker(body);
    // The new version's sw.js records the new page; when half-published, the page itself is still the old one.
    if (rel === 'sw.js' && (mode.startsWith('fresh') || mode === 'half')) body = Buffer.from(body.toString('utf8').replace(sha256(realPage), sha256(withMarker(realPage))));
    if (rel === 'sw.js' && mode === 'fresh-sw') body = Buffer.concat([body, Buffer.from('// changed\n')]);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  };
  if (mode === 'slow' && isPage) setTimeout(send, 10000); else send();
});

const { step, finish } = makeSteps();

(async () => {
  await new Promise(r => server.listen(PORT, HOST, r));
  const browser = await launchChrome();
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  // Keep the test local: Google's sign-in script and the Apps Script backend are not needed here.
  await context.route(url => !String(url).startsWith(origin), r => r.abort());
  const page = await context.newPage();
  const cachedPage = () => page.evaluate(async () => {
    const hit = await caches.match('/');
    return hit ? { status: hit.status, text: await hit.text() } : null;
  });
  const reload = async () => {
    const t0 = Date.now();
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(e => { throw new Error('page did not open: ' + e.message.split('\n')[0]); });
    return Date.now() - t0;
  };

  // Read from the file itself (build-sw.js --check makes sure it matches the site files).
  const swText = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const CACHE_NAME = swText.match(/CACHE_NAME = '([^']+)'/)[1];
  const HASHES = Object.fromEntries([...swText.matchAll(/^ *'(\/[^']*)': '([0-9a-f]{64})',\r?$/gm)].map(m => [m[1], m[2]]));
  const SAVED = Object.keys(HASHES);
  const caches_ = () => page.evaluate(() => caches.keys());
  // Writes straight into the saved copies (of the version now running), as code injected into the page could.
  const plant = (url, body, headers, name) => page.evaluate(async ([n, prefix, u, b, h]) => {
    n = n || (await caches.keys()).find(k => k.startsWith(prefix));
    await (await caches.open(n)).put(u, new Response(b, { headers: h || { 'Content-Type': 'text/html' } }));
  }, [name, CACHE_NAME + '-', url, body, headers]);
  const FAKE = '<!doctype html><title>Swapped</title><p id="swapped-marker">not the real app</p>';
  const updateOffered = () => page.evaluate(() => {
    const t = document.getElementById('toast');
    return !t.classList.contains('hidden') && /new version/i.test(t.textContent);
  });
  const waitForOffer = () => page.waitForFunction(() => {
    const t = document.getElementById('toast');
    return !t.classList.contains('hidden') && /new version/i.test(t.textContent);
  }, null, { timeout: 5000 }).catch(() => { throw new Error('no "new version" offer appeared'); });

  await step('first visit (the version live before this change): its service worker installs and saves the app', async () => {
    await reload();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await reload();   // now controlled by the service worker
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'page is not controlled by the service worker');
    const c = await cachedPage();
    assert.ok(c && c.status === 200 && /PaydayFlow/.test(c.text), 'app not saved');
    assert.deepStrictEqual(await caches_(), [CACHE_NAME]);
  });

  await step('upgrade from the live version: every file saved in a cache of its own, the old cache gone, a reload offered', async () => {
    // A device that ran older versions can also hold the page saved as /index.html, and older stylesheets saved
    // under their ?v= address.
    await plant('/index.html', 'old page', null, CACHE_NAME);
    await plant('/tailwind.css?v=old', 'old css', { 'Content-Type': 'text/css' }, CACHE_NAME);
    mode = 'normal';
    await reload();
    await waitForOffer();
    assert.ok(SAVED.length >= 10 && SAVED.includes('/') && SAVED.includes('/tailwind.css'), 'could not read the hashes in sw.js');
    const names = await caches_();
    assert.ok(names.length === 1 && names[0].startsWith(CACHE_NAME + '-'), 'caches: ' + names.join(', '));
    const keys = await page.evaluate(async n => (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname + new URL(r.url).search), names[0]);
    assert.deepStrictEqual(keys.slice().sort(), SAVED.slice().sort());
    await reload();
    assert.strictEqual(await page.title(), 'PaydayFlow');
  });

  await step('a swapped saved page is never opened: the real one opens and is saved again', async () => {
    await plant('/', FAKE);
    await reload();
    assert.strictEqual(await page.title(), 'PaydayFlow', 'opened the swapped page');
    await page.waitForTimeout(300);
    assert.strictEqual(sha256(Buffer.from((await cachedPage()).text, 'utf8')), sha256(realPage), 'the saved copy is not the real page again');
  });

  await step('a saved copy is passed on with its own headers only (anything saved alongside it is dropped)', async () => {
    await plant('/', realPage.toString('utf8'), { 'Content-Type': 'text/plain', 'Refresh': '0; url=/manifest.json', 'X-Planted': '1' });
    const r = await page.evaluate(async () => { const res = await fetch('/?go=add'); return { type: res.headers.get('content-type'), refresh: res.headers.get('refresh'), planted: res.headers.get('x-planted') }; });
    assert.deepStrictEqual(r, { type: 'text/html; charset=utf-8', refresh: null, planted: null });
  });

  await step('a swapped stylesheet is never used: the real one is fetched instead', async () => {
    await plant('/tailwind.css', 'body{display:none}', { 'Content-Type': 'text/css' });
    const before = cssHits;
    const css = await page.evaluate(async v => (await fetch('/tailwind.css?v=' + v)).text(), HASHES['/tailwind.css'].slice(0, 10));
    assert.strictEqual(css, realCss);
    assert.strictEqual(cssHits, before + 1, 'the real stylesheet was not fetched');
  });

  await step('swapped saved scripts (app.js, guard.js) never run: the real ones run and are saved again', async () => {
    await plant('/app.js', 'window.__planted = "app"; document.title = "swapped";', { 'Content-Type': 'text/javascript' });
    await plant('/guard.js', 'window.__planted = "guard";', { 'Content-Type': 'text/javascript' });
    await reload();
    await page.waitForFunction(() => typeof ACTIONS === 'object', null, { timeout: 10000 });
    assert.deepStrictEqual(await page.evaluate(() => [window.__planted || null, document.title]), [null, 'PaydayFlow']);
    await page.waitForTimeout(300);   // let the real copies be saved again
    const saved = await page.evaluate(async () => Promise.all(['/app.js', '/guard.js'].map(async p => { const hit = await caches.match(p); return hit ? hit.text() : null; })));
    assert.ok(saved.every(t => t && !t.includes('__planted')), 'a swapped script is still saved');
  });

  await step("a stylesheet version this version doesn't have is fetched, not taken from the saved copy, and not saved", async () => {
    await page.waitForTimeout(300);   // let the last step's copy be saved
    const before = cssHits;
    const css = await page.evaluate(async () => (await fetch('/tailwind.css?v=0000000000')).text());
    assert.strictEqual(css, realCss);
    assert.strictEqual(cssHits, before + 1, 'it came from the saved copy');
    assert.strictEqual(await page.evaluate(() => caches.match('/tailwind.css?v=0000000000').then(Boolean)), false);
  });

  await step('the font is fetched once, then always served from the saved copy', async () => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);   // let the service worker finish saving it
    const before = fontHits;
    for (let i = 0; i < 2; i++) { await reload(); await page.evaluate(() => document.fonts.ready); }
    assert.ok(before > 0, 'the font was never fetched');
    assert.strictEqual(fontHits, before, 'the font was fetched again (' + (fontHits - before) + ' more times)');
  });

  await step("Google's sign-in script is fetched only when the lock screen shows", async () => {
    const gsiRequested = () => page.evaluate(() => !!document.querySelector('script[src*="accounts.google.com"]'));
    // signed in (a token that looks valid): no lock screen, so Google's script is never asked for
    await page.evaluate(() => localStorage.setItem('pf_google_id_token', 'h.' + btoa(JSON.stringify({ email: 'owner@example.com', exp: Math.floor(Date.now() / 1000) + 3600 })) + '.s'));
    await reload();
    await page.waitForTimeout(300);
    assert.strictEqual(await gsiRequested(), false, 'fetched while signed in');
    await page.evaluate(() => localStorage.removeItem('pf_google_id_token'));
    await reload();
    await page.waitForTimeout(300);
    assert.strictEqual(await gsiRequested(), true, 'the lock screen should fetch it');
  });

  await step('half-published (new sw.js, old page): the new version does not take over, the saved app still opens', async () => {
    mode = 'half';
    const before = pageHits;
    await reload();
    // The browser checks sw.js and tries to install the new version, which asks for the page.
    for (let i = 0; i < 50 && pageHits === before; i++) await page.waitForTimeout(100);
    assert.ok(pageHits > before, 'the new version never tried to install');
    await page.waitForTimeout(1000);
    assert.strictEqual(await updateOffered(), false, 'offered an update that has not fully arrived');
    assert.strictEqual(sha256(Buffer.from((await cachedPage()).text, 'utf8')), sha256(realPage), 'the saved page changed');
    mode = 'down';
    await reload();
    assert.strictEqual(await page.title(), 'PaydayFlow', 'the saved app did not open offline');
  });

  await step('a newer version: opens at once from the saved copy, saves the new one (reusing unchanged files) and offers a reload', async () => {
    mode = 'fresh';
    const fontsBefore = fontHits;
    await reload();
    assert.ok(!(await page.$('#fresh-marker')), 'expected the saved copy first');
    await waitForOffer();
    assert.strictEqual(fontHits, fontsBefore, 'unchanged files (the fonts) were downloaded again');
    assert.ok((await cachedPage()).text.includes('fresh-marker'), 'saved copy was not refreshed');
  });

  await step('the next open shows the new page, and nothing is offered when the page has not changed', async () => {
    await reload();
    assert.ok(await page.$('#fresh-marker'), 'next open did not show the new page');
    await page.waitForTimeout(1500);
    assert.strictEqual(await updateOffered(), false, 'offered an update when nothing changed');
  });

  await step("a change to sw.js alone: the new service worker takes over without downloading any file again, and leaves other sites' caches", async () => {
    await page.evaluate(() => caches.open('another-app').then(c => c.put('/x', new Response('x'))));   // not this app's
    try {
      const before = [pageHits, fontHits, cssHits];
      const changed = page.evaluate(() => new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', () => r(true), { once: true })));
      mode = 'fresh-sw';
      await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
      assert.ok(await Promise.race([changed, new Promise(r => setTimeout(() => r(false), 5000))]), 'the new service worker did not take over');
      assert.deepStrictEqual([pageHits, fontHits, cssHits], before, 'files were downloaded again');
      // Taking over comes before the old caches are cleared out: wait for that to finish.
      await page.evaluate(() => new Promise(r => { const w = navigator.serviceWorker.controller; if (w.state === 'activated') r(); else w.addEventListener('statechange', () => { if (w.state === 'activated') r(); }); }));
      assert.ok((await caches_()).includes('another-app'), "another app's cache was deleted");
    } finally { await page.evaluate(() => caches.delete('another-app')); }
    await reload();
    assert.ok(await page.$('#fresh-marker'), 'the saved app did not open');
  });

  await step('slow network: the saved app opens straight away instead of waiting', async () => {
    mode = 'slow';
    const ms = await reload();
    assert.strictEqual(await page.title(), 'PaydayFlow');
    assert.ok(ms < 2500, 'took ' + ms + ' ms');
  });

  await step('server error (404): the saved app opens, and the error page is not saved', async () => {
    mode = '404';
    await page.waitForTimeout(8000);   // let the slow reply from the last step finish first
    await reload();
    assert.strictEqual(await page.title(), 'PaydayFlow', 'showed the error page');
    await page.waitForTimeout(300);
    const c = await cachedPage();
    assert.ok(c.status === 200 && /PaydayFlow/.test(c.text), 'saved copy was replaced by the error page');
  });

  await step('a file the app does not save (sw.js itself) is left to the network and never saved', async () => {
    mode = 'normal';
    const r = await page.evaluate(async () => {
      const status = (await fetch('/sw.js')).status;
      await new Promise(res => setTimeout(res, 300));
      return { status, saved: !!(await caches.match('/sw.js')) };
    });
    assert.deepStrictEqual(r, { status: 200, saved: false });
  });

  await step('offline: the saved app opens, and its scripts run from the saved copies', async () => {
    mode = 'down';
    await reload();
    assert.strictEqual(await page.title(), 'PaydayFlow');
    await page.waitForFunction(() => typeof ACTIONS === 'object' && getComputedStyle(document.getElementById('authLockScreen')).display === 'flex', null, { timeout: 10000 });
  });

  await step('offline: the font comes from the saved copy too', async () => {
    const font = await page.evaluate(async () => {
      await document.fonts.load('600 16px Inter').catch(() => {});
      return { loaded: document.fonts.check('600 16px Inter'), saved: !!(await caches.match('/fonts/inter-latin.woff2')) };
    });
    assert.ok(font.saved, 'the font file was not saved');
    assert.ok(font.loaded, 'Inter did not load offline');
  });

  await step('offline: a home-screen shortcut (/?go=add) opens the saved app too, and saves no extra copy', async () => {
    await page.goto(`http://localhost:${PORT}/?go=add`);
    assert.strictEqual(await page.title(), 'PaydayFlow');
    const keys = await page.evaluate(async () => {
      const out = [];
      for (const n of await caches.keys()) out.push(...(await (await caches.open(n)).keys()).map(r => new URL(r.url).search));
      return out.filter(u => u.includes('go='));
    });
    assert.deepStrictEqual(keys, []);
  });

  await step('offline: a swapped saved page is not opened even with no network', async () => {
    await plant('/', FAKE);
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    assert.ok(!(await page.$('#swapped-marker').catch(() => null)), 'opened the swapped page');
  });

  // A device that has the version live just before the scripts moved out (a fresh browser, so nothing else saved).
  await step('upgrade from the page with inline scripts: the new version installs, and after Reload the app runs from app.js, offline too', async () => {
    const ctx2 = await browser.newContext({ serviceWorkers: 'allow' });
    await ctx2.route(url => !String(url).startsWith(origin), r => r.abort());
    const p = await ctx2.newPage();
    const open = () => p.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const appRuns = () => p.waitForFunction(() => typeof ACTIONS === 'object' && getComputedStyle(document.getElementById('authLockScreen')).display === 'flex', null, { timeout: 10000 });
    try {
      mode = 'prev';
      await open();
      await p.evaluate(() => navigator.serviceWorker.ready);
      await open();
      await appRuns();
      assert.ok(await p.evaluate(() => !!navigator.serviceWorker.controller && !document.querySelector('script[src*="app.js"]')), 'not the inline version, or not controlled');
      const before = await p.evaluate(() => caches.keys());
      mode = 'normal';
      await open();   // the saved inline version opens; the new one installs and offers a reload
      await p.waitForFunction(() => { const t = document.getElementById('toast'); return !t.classList.contains('hidden') && /new version/i.test(t.textContent); }, null, { timeout: 10000 })
        .catch(() => { throw new Error('no "new version" offer appeared'); });
      await open();
      await appRuns();
      assert.ok(await p.evaluate(() => !!document.querySelector('script[src^="app.js?v="]')), 'still the inline page after Reload');
      const names = await p.evaluate(() => caches.keys());
      assert.ok(names.length === 1 && !before.includes(names[0]), 'caches: ' + before.join(', ') + ' -> ' + names.join(', '));
      const keys = await p.evaluate(async n => (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname), names[0]);
      assert.deepStrictEqual(keys.slice().sort(), SAVED.slice().sort());
      mode = 'down';
      await open();
      await appRuns();
    } finally { await ctx2.close(); }
  });

  await browser.close();
  server.close();
  finish();
})().catch(e => { console.error(e); process.exit(1); });
