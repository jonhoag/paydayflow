// Shared by the screen tests (tests/ui/*.test.js, run by tests/run-all.js): the test page (the real index.html with a
// pretend backend) served under the app's own script policy, real Chrome, the step counter, and the helpers more than
// one of them uses. Each test file starts its own server (on a free port), browser and pages, so a failure in one
// file can't knock on to another. A new step goes in the file for its screen; a new file in tests/ui/ (named
// x.test.js, its steps inside uiSuite) is picked up by run-all by itself.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const { launchChrome, makeSteps } = require('./runner');
const { root, HOST, siteRel, sendSiteFile, publishedBytes } = require('./site-files');
const { siteFiles } = require('../../build-sw');
// The test page is served under the app's own script policy (read from index.html), plus the test page's own inline
// scripts by hash. So, as on the real site, an inline script or an inline handler (onclick="...") in the app is
// refused, even on a control a screen draws later (when its event fires), and the refusal fails the run. (Only
// attribute-free <script> tags are hashed: any other inline script in the test page is refused too, and fails.)
const PAGE_CSP = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
const PAGE_SCRIPTS = PAGE_CSP.split(';').map(d => d.trim()).find(d => d.startsWith('script-src '));
const inlineScriptHashes = file => [...publishedBytes(path.join(root, file)).toString('utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(m => `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
const STRICT_SCRIPTS = [PAGE_SCRIPTS, ...inlineScriptHashes('tests/harness.html')].join(' ');
// The app's own code (the page and every script of the site), as the source checks below read it.
const appSource = () => siteFiles(root).filter(f => /\.(html|js)$/.test(f)).map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');

// Spending's month bars with six big months: the bars it shows, each label's text, line count and whether it fits
// its own bar; or a message if the row spills out of the box.
async function monthBars(page) {
  return page.evaluate(() => {
    const real = spendMonthTotals;
    spendMonthTotals = () => ['May', 'June', 'July', 'August', 'September', 'October'].map(m => ({ name: m + ' Payday 2026', total: 1234.56 }));
    try {
      openSpendModal();
      const labels = [...document.querySelectorAll('#spendBody .items-end > div > span:first-child')];
      const row = document.querySelector('#spendBody .items-end'), box = document.getElementById('spendBody').getBoundingClientRect();
      if (row.scrollWidth > row.clientWidth || row.getBoundingClientRect().right > box.right + 0.5 || box.right > innerWidth) return 'the month bars spill out of the box';
      return labels.map(l => {
        const r = document.createRange(); r.selectNodeContents(l);
        const col = l.parentElement.getBoundingClientRect(), txt = r.getBoundingClientRect();
        return { text: l.textContent, lines: r.getClientRects().length, fits: txt.left >= col.left - 0.5 && txt.right <= col.right + 0.5 };
      });
    } finally { spendMonthTotals = real; closeSpendModal(); }
  });
}

// 21 extra "owed" items (Kim 10, Robin 4 more, Sam 4, Lee 3) on top of the demo data. All names are invented.
const SEED_OWED = `(async () => {
  const add = [['kim Tesco', 23.4], ['kim Pret', 6.85], ['kim Uber', 14.2], ['kim Boots', 9.99], ['kim Cinema', 12.5],
    ['kim Deliveroo', 18.75], ['kim Sainsburys', 31.1], ['kim Trainline', 22.6], ['kim Costa', 4.3], ['kim Zara', 27.5],
    ['robin Nandos', 15.4], ['robin Spoons', 11.2], ['robin Five Guys', 13.95], ['robin Greggs', 3.8],
    ['sam Airbnb', 64], ['sam Petrol', 25], ['sam M&S', 8.45], ['sam Lidl', 12.3],
    ['lee Gift', 20], ['lee Pizza', 16.7], ['lee Parking', 4.5]];
  const ch = MOCK.db.checking;
  add.forEach(([desc, amount]) => ch.push({ row: Math.max(...ch.map(r => r.row)) + 1, desc, amount, need: true }));
  [['Tesco', -46.8], ['Deliveroo', -37.5], ['Amazon', -32.99]].forEach(([desc, amount]) => MOCK.db.amex.push({ row: Math.max(...MOCK.db.amex.map(r => r.row)) + 1, desc, amount }));
  forceSyncSheet();
  await new Promise(r => setTimeout(r, 900));
})()`;

const calls = (page, action) => page.evaluate(a => MOCK.calls.filter(c => c.action === a).map(c => c.payload), action);
// The server saved a change, then couldn't read the month's figures back: saved, so never kept or sent again.
const SAVED_NO_STATE = { code: 'SAVED_NO_STATE', error: 'SAVED_NO_STATE: saved, but the figures could not be read just now.' };
const failSavedNoState = page => page.evaluate(t => { MOCK.failWith = t; MOCK.failAfterWriteNext = 1; }, SAVED_NO_STATE);
const resetFailures = page => page.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; MOCK.failAfterWriteNext = 0; MOCK.dropNext = 0; MOCK.dropReadsNext = 0; });
const sheetReads = page => page.evaluate(() => MOCK.calls.filter(c => c.action === 'getCachedSheetState').length);
const visible = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; }, sel);
const owedCount = page => page.evaluate(() => state.checking.filter(r => r.need).length);
// How many lines each element's text takes (1 = it does not wrap). Hidden elements count as 0.
const lineCounts = (page, sels) => page.evaluate(list => list.map(sel => {
  const el = document.querySelector(sel);
  if (!el || !el.getClientRects().length) return sel + ':0';
  const r = document.createRange(); r.selectNodeContents(el);
  return sel + ':' + new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top))).size;
}), sels);
// Each button's hit area: at least 44x44px, and every part of it really reaches that button (not cut off by a
// scrolling box, not covered by a neighbour's hit area). Returns the problems found, plus the sizes measured.
const hitAreas = (page, sel) => page.evaluate(async s => {
  const n = document.querySelectorAll(s).length;
  const out = { count: 0, sizes: [], bad: [] };
  for (let i = 0; i < n; i++) {
    const el = document.querySelectorAll(s)[i];   // looked up afresh: a reply may have redrawn the list meanwhile
    if (!el || !el.getClientRects().length) continue;
    out.count++;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    await new Promise(r => requestAnimationFrame(r));
    const b = el.getBoundingClientRect(), a = getComputedStyle(el, '::after');
    const w = Math.max(b.width, a.content !== 'none' ? parseFloat(a.width) || 0 : 0), h = Math.max(b.height, a.content !== 'none' ? parseFloat(a.height) || 0 : 0);
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    out.sizes.push(Math.round(w) + 'x' + Math.round(h));
    const name = (el.id || el.getAttribute('aria-label') || el.textContent.trim()).slice(0, 30);
    if (w < 44 || h < 44) out.bad.push(name + ' is ' + Math.round(w) + 'x' + Math.round(h));
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const x = cx + dx * (Math.max(w, 44) / 2 - 1.5), y = cy + dy * (Math.max(h, 44) / 2 - 1.5);
      const hit = document.elementFromPoint(x, y);
      if (!hit || !el.contains(hit)) { out.bad.push(name + ' misses at ' + dx + ',' + dy + ' (hits ' + (hit ? hit.tagName + '.' + String(hit.className).slice(0, 30) : 'nothing') + ')'); break; }
    }
  }
  window.scrollTo({ top: 0 });
  return out;
}, sel);
// The toast's message and its button's label (null: no button).
const toastParts = page => page.evaluate(() => [document.querySelector('#toast span').textContent, (document.getElementById('toastAction') || {}).textContent || null]);
// The sheet busy with another save, as the server says it.
const LOCK_TIMEOUT = 'Lock timeout: another process was holding the lock for too long.';
const BUSY = { code: 'BUSY', error: LOCK_TIMEOUT };

const phone = { viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, colorScheme: 'dark' };
const desk = { viewport: { width: 1280, height: 800 }, colorScheme: 'light' };

// Runs one screen test file: `body` gets the browser, the step counter and the helpers below, and runs its steps.
// Afterwards every file checks that none of its pages had an error or fetched anything from another site.
async function uiSuite(body) {
  const server = http.createServer((req, res) => {
    if (siteRel(req.url) === 'tests/harness.html') res.setHeader('Content-Security-Policy', STRICT_SCRIPTS);
    sendSiteFile(req, res);
  });
  await new Promise(r => server.listen(0, HOST, r));   // any free port
  const port = server.address().port;
  const browser = await launchChrome();
  const { step, finish } = makeSteps();
  const errors = [];
  const offSite = [];   // every request that leaves this test server (there should be none)
  // Every page the test opens reports its errors, refused loads and off-site requests (checked at the end).
  const watch = page => {
    page.on('pageerror', e => errors.push(e.message));
    // Anything the page's security policy refuses is reported here too ("Refused to load ...").
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400 && r.url().startsWith('http://localhost')) errors.push(r.status() + ' ' + r.url()); });
    page.on('request', r => { if (!/^(http:\/\/localhost|data:|blob:)/.test(r.url())) offSite.push(r.url()); });
    return page;
  };
  // A fresh page of the test page, once its figures are on screen.
  const open = async (opts, query = 'demo=1') => {
    const ctx = await browser.newContext(opts);
    const page = watch(await ctx.newPage());
    await page.goto(`http://localhost:${port}/tests/harness.html?${query}&latency=50`);
    await page.waitForFunction(() => document.getElementById('kpiNCA') && /£\d/.test(document.getElementById('kpiNCA').textContent) && window.MOCK && MOCK.calls.length > 0);
    await page.waitForTimeout(400);
    return { ctx, page };
  };
  // Requests a test fails on purpose are logged by the page; take just those back out of the error list.
  const dropExpectedSyncErrors = from => { for (let i = errors.length - 1; i >= from; i--) if (/Failed to fetch|Mock server failure|something unexpected|Lock timeout|Invalid amount|check the Google sign-in|SAVED_NO_STATE|NetworkError/.test(errors[i])) errors.splice(i, 1); };

  try {
    await body({ browser, errors, watch, open, step, PORT: port, dropExpectedSyncErrors });
  } catch (e) {
    await step('the file ran to its end', () => { throw e; });
  }
  await step('no page errors anywhere (nothing refused by the security policy either)', async () => {
    assert.deepStrictEqual(errors, [], JSON.stringify(errors));
  });
  await step('nothing was fetched from anywhere but this site (no Google Fonts)', async () => {
    assert.deepStrictEqual(offSite, [], JSON.stringify(offSite.slice(0, 5)));
  });
  await browser.close();
  server.close();
  finish();
}

module.exports = { uiSuite, root, appSource, phone, desk, monthBars, SEED_OWED, calls, SAVED_NO_STATE, failSavedNoState, resetFailures,
  sheetReads, visible, owedCount, lineCounts, hitAreas, toastParts, LOCK_TIMEOUT, BUSY };
