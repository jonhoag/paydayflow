// Service worker test in a REAL Chrome (service workers need a real browser on localhost).
// A local server serves this folder and can be switched to slow, failing (404) or offline, to check that the
// app still opens quickly from its saved copy and that a bad reply never replaces the saved copy.
//
//   set PW_PATH=C:\Users\JonfH\pf-tools\node_modules\playwright-core
//   node tests/sw.test.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { chromium } = require(process.env.PW_PATH || 'playwright-core');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8127;
const origin = 'http://localhost:' + PORT;
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };

// normal | fresh (adds a marker to the page) | slow (10 s) | 404 | down (drops the connection)
let mode = 'normal';
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const isPage = rel === 'index.html';
  if (mode === 'down') return req.socket.destroy();
  if (mode === '404' && rel !== 'sw.js') { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<title>Not found</title>Not found'); }
  const file = path.resolve(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  const send = () => {
    let body = fs.readFileSync(file);
    if (isPage && mode === 'fresh') body = Buffer.from(body.toString('utf8').replace('</body>', '<div id="fresh-marker"></div></body>'));
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  };
  if (mode === 'slow' && isPage) setTimeout(send, 10000); else send();
});

const results = [];
async function step(name, fn) {
  try { await fn(); results.push([true, name]); }
  catch (e) { results.push([false, name + '\n      ' + String(e.message).split('\n')[0]]); }
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
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

  await step('first visit: the service worker installs and saves the app', async () => {
    await reload();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await reload();   // now controlled by the service worker
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'page is not controlled by the service worker');
    const c = await cachedPage();
    assert.ok(c && c.status === 200 && /PaydayFlow/.test(c.text), 'app not saved');
  });

  await step('normal visit: a newer page from the network is shown and saved', async () => {
    mode = 'fresh';
    await reload();
    assert.ok(await page.$('#fresh-marker'), 'did not show the network copy');
    await page.waitForTimeout(300);
    assert.ok((await cachedPage()).text.includes('fresh-marker'), 'saved copy was not refreshed');
  });

  await step('slow network: the saved app opens within about 3 seconds instead of waiting', async () => {
    mode = 'slow';
    const ms = await reload();
    assert.strictEqual(await page.title(), 'PaydayFlow');
    assert.ok(ms < 6000, 'took ' + ms + ' ms');
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

  await step('a missing stylesheet version is not saved', async () => {
    const saved = await page.evaluate(async () => {
      await fetch('/tailwind.css?v=missing').catch(() => {});
      await new Promise(r => setTimeout(r, 300));
      return !!(await caches.match('/tailwind.css?v=missing'));
    });
    assert.strictEqual(saved, false);
  });

  await step('offline: the saved app opens', async () => {
    mode = 'down';
    await reload();
    assert.strictEqual(await page.title(), 'PaydayFlow');
  });

  await browser.close();
  server.close();
  let failed = 0;
  results.forEach(([ok, name]) => { if (!ok) failed++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name); });
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
