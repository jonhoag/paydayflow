// Real-Chrome click-through of the main screens, using the test page (real index.html, pretend backend).
// Checks the redesigned layout and that every button still makes the right save.
//
//   node tests/ui-flows.test.js   (playwright-core from PW_PATH, or from npm ci --ignore-scripts)
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { launchChrome, makeSteps, awayAndBack } = require('./lib/runner');
const PORT = 8129;
const crypto = require('crypto');
const { root, HOST, siteRel, sendSiteFile, publishedBytes } = require('./lib/site-files');
const { siteFiles } = require('../build-sw');
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
const server = http.createServer((req, res) => {
  if (siteRel(req.url) === 'tests/harness.html') res.setHeader('Content-Security-Policy', STRICT_SCRIPTS);
  sendSiteFile(req, res);
});

const { step, finish } = makeSteps();
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
const SAVED_NO_STATE = 'SAVED_NO_STATE: saved, but the figures could not be read just now.';
const failSavedNoState = page => page.evaluate(t => { MOCK.failWith = t; MOCK.failAfterWriteNext = 1; }, SAVED_NO_STATE);
const resetFailures = page => page.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; MOCK.failAfterWriteNext = 0; });
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
// The page never scrolls sideways, and no balance spills out of its card.
const noSideways = page => page.evaluate(() => ({ width: innerWidth, sideways: document.documentElement.scrollWidth > innerWidth,
  kpi: [...document.querySelectorAll('.kpi-figure')].filter(e => e.getClientRects().length && e.scrollWidth > e.clientWidth).map(e => e.id) }));
// How the screen is laid out: rows of account cards, and columns of main sections.
const layoutShape = page => page.evaluate(() => ({
  cardRows: new Set([...document.querySelectorAll('#tilesSection > div')].map(x => Math.round(x.getBoundingClientRect().top))).size,
  cols: getComputedStyle(document.getElementById('mainGrid')).gridTemplateColumns.split(' ').length }));
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
// WCAG contrast ratio of an element's text against the first solid background behind it.
const contrastOf = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  let bg = null;
  for (let n = el; n && !bg; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] === 1)) bg = c.slice(0, 3); }
  bg = bg || rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3);
  const fg = rgb(getComputedStyle(el).color).slice(0, 3);
  const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return Math.round((l1 + 0.05) / (l2 + 0.05) * 100) / 100;
}, sel);

(async () => {
  await new Promise(r => server.listen(PORT, HOST, r));
  const browser = await launchChrome();
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
  const open = async (opts, query = 'demo=1') => {
    const ctx = await browser.newContext(opts);
    const page = watch(await ctx.newPage());
    await page.goto(`http://localhost:${PORT}/tests/harness.html?${query}&latency=50`);
    await page.waitForFunction(() => document.getElementById('kpiNCA') && /£\d/.test(document.getElementById('kpiNCA').textContent) && window.MOCK && MOCK.calls.length > 0);
    await page.waitForTimeout(400);
    return { ctx, page };
  };
  const phone = { viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, colorScheme: 'dark' };
  const desk = { viewport: { width: 1280, height: 800 }, colorScheme: 'light' };

  // ---------------- phone ----------------
  let { ctx, page } = await open(phone);

  await step('balances: lettered account cards, real minus sign, card never overlaps the figure', async () => {
    const tiles = await page.evaluate(() => ['Amex', 'Barclays', 'Checking', 'Marcus'].map(k => {
      const card = document.querySelector('#logoCard' + k + ' span');
      const fig = document.getElementById('kpi' + (k === 'Checking' ? 'NCA' : k));
      const a = card.getBoundingClientRect(), b = fig.getBoundingClientRect();
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const tile = fig.parentElement.getBoundingClientRect();
      return { label: card.textContent, text: fig.textContent, overlap, fits: b.right <= tile.right + 0.5 };
    }));
    assert.deepStrictEqual(tiles.map(t => t.label), ['AX', 'BC', 'NW', 'MS']);
    tiles.forEach(t => { assert.ok(!t.overlap, t.label + ' card overlaps its balance'); assert.ok(t.fits, t.label + ' balance spills out of its tile'); });
    assert.ok(tiles[1].text.startsWith('\u2212£'), 'Barclays should show a minus sign: ' + tiles[1].text);
  });

  await step('balances still fit on a narrow 344px phone screen', async () => {
    await page.setViewportSize({ width: 344, height: 860 });
    const ok = await page.evaluate(() => ['kpiAmex', 'kpiBarclays', 'kpiNCA', 'kpiMarcus'].every(id => {
      const f = document.getElementById(id); return f.getBoundingClientRect().right <= f.parentElement.getBoundingClientRect().right + 0.5;
    }));
    await page.setViewportSize({ width: 400, height: 860 });
    assert.ok(ok, 'a balance spills out of its tile');
  });

  await step('money helpers: fmtSigned shows + for money in, a real minus for money out', async () => {
    const out = await page.evaluate(() => [fmtSigned(5), fmtSigned(-5), fmtSigned(0), fmtSigned(1234.5)]);
    assert.deepStrictEqual(out, ['+£5.00', '−£5.00', '£0.00', '+£1,234.50']);
  });

  await step('storage helpers: storage that refuses (a private window, or blocked) reads as empty instead of throwing', async () => {
    const out = await page.evaluate(() => {
      localStorage.setItem('pf_test_junk', '{not json');
      const junk = lsJson('pf_test_junk');
      localStorage.removeItem('pf_test_junk');
      const P = Storage.prototype, real = [P.getItem, P.setItem, P.removeItem];
      P.getItem = P.setItem = P.removeItem = () => { throw new DOMException('blocked', 'SecurityError'); };
      try {
        return [junk, lsGet(THEME_KEY), lsSet(THEME_KEY, 'dark'), lsDel(THEME_KEY) === undefined, lsJson(OUTBOX_KEY), loadOutbox().length, getSession(), hasValidGoogleToken()];
      } finally { [P.getItem, P.setItem, P.removeItem] = real; }
    });
    assert.deepStrictEqual(out, [null, null, false, true, null, 0, null, false]);
  });

  await step('a Google sign-in token is read as UTF-8, and anything that is not one reads as nothing', async () => {
    const out = await page.evaluate(() => {
      const part = o => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const p = parseJwtPayload('x.' + part({ what: 'Café ✓ ~~~>>>???', exp: 5 }) + '.y');
      return [p && p.what, p && p.exp, parseJwtPayload('nonsense'), parseJwtPayload('a.!!!.b'), parseJwtPayload(null)];
    });
    assert.deepStrictEqual(out, ['Café ✓ ~~~>>>???', 5, null, null, null]);
  });

  await step('bottom bar reads Home, Bills, Owed, Activity', async () => {
    const labels = await page.$$eval('nav [data-nav]', bs => bs.map(b => b.textContent.trim()));
    assert.deepStrictEqual(labels, ['Home', 'Bills', 'Owed', 'Activity']);
  });

  await step('bills: the paid fold-away is hidden while nothing is paid, and reads "Paid (n)" once something is', async () => {
    assert.strictEqual(await page.evaluate(() => state.budgets.filter(b => Number(b.amount) === 0).length), 0, 'test set-up: a bill is already paid');
    assert.ok(!(await visible(page, '#paidFold')), 'the fold-away shows with nothing in it');
    await page.click('#upcomingBudgetsList button[aria-label^="Mark"]');
    await page.waitForFunction(() => state.budgets.some(b => Number(b.amount) === 0 && !b.pending));
    assert.ok(await visible(page, '#paidFold'));
    assert.strictEqual((await page.textContent('#paidFold summary')).replace(/\s+/g, ' ').replace('▼', '').trim(), 'Paid (1)');
    await page.evaluate(() => { document.getElementById('paidFold').open = true; });
    await page.click('#clearedBudgetsList button:has-text("Restore")');
    await page.waitForFunction(() => !state.budgets.some(b => Number(b.amount) === 0 || b.pending) && MOCK.calls.every(c => c.end));
    assert.ok(!(await visible(page, '#paidFold')), 'the fold-away should go again at 0');
  });

  await step('bills: the header says "to pay" with no minus, and no "rolls to next month" legend', async () => {
    const t = await page.textContent('#budLeftVal');
    assert.ok(/^£[\d,]+\.\d\d to pay$/.test(t), t);
    assert.ok(!/rolls to next month/.test(await page.textContent('#budgetsBody')), 'the legend is back');
  });

  await step('bills: the phone Bills tab lists every unpaid bill (no "Show all"); Home keeps the first 6', async () => {
    const unpaid = await page.evaluate(() => state.budgets.filter(b => Number(b.amount) !== 0).length);
    assert.ok(unpaid > 6, 'test set-up: needs more than 6 unpaid bills');
    const rows = () => page.$$eval('#upcomingBudgetsList button[aria-label^="Mark "]', b => b.length);
    const more = () => page.$('#upcomingBudgetsList button:has-text("Show all")');
    assert.strictEqual(await rows(), 6);
    assert.ok(await more(), 'Home should offer "Show all"');
    await page.click('nav [data-nav="budgets"]');
    assert.strictEqual(await rows(), unpaid, 'the Bills tab should list every unpaid bill');
    assert.ok(!(await more()), 'the Bills tab should have no "Show all"');
    await page.click('nav [data-nav="home"]');
    assert.strictEqual(await rows(), 6);
  });

  await step('tabs: the section that is the whole screen has no ▾ and its header does not fold it; Home keeps them', async () => {
    await page.evaluate(() => setView('home'));   // whatever an earlier failed step left
    const chevs = ['#chevBudgets', '#chevPending', '#chevActivity'];
    for (const c of chevs) assert.ok(await visible(page, c), c + ' should show on Home');
    for (const [nav, chev, body] of [['budgets', '#chevBudgets', '#budgetsBody'], ['pending', '#chevPending', '#pendingBody'], ['activity', '#chevActivity', '#activityBody']]) {
      await page.click(`nav [data-nav="${nav}"]`);
      assert.ok(!(await visible(page, chev)), chev + ' still shows on its own tab');
      await page.click(body.replace('Body', '').replace('#', '#sec_') + ' h2');
      assert.ok(await visible(page, body), 'tapping the header folded the ' + nav + ' tab away');
    }
    await page.click('nav [data-nav="home"]');
    const expanded = () => page.$$eval('#chevBudgets, #chevPending, #chevActivity', els => els.map(e => [e.getAttribute('aria-label'), e.getAttribute('aria-controls'), e.getAttribute('aria-expanded')].join('|')));
    assert.deepStrictEqual(await expanded(), ['Bills & Budgets|budgetsBody|true', 'Owed to you|pendingBody|true', 'Recent Activity|activityBody|true']);
    await page.click('#chevActivity');
    assert.ok(!(await visible(page, '#activityBody')), 'the ▾ on Home should still fold a section');
    assert.strictEqual((await expanded())[2], 'Recent Activity|activityBody|false', 'a screen reader should hear it is folded');
    await page.click('#chevActivity');
    assert.strictEqual((await expanded())[2], 'Recent Activity|activityBody|true');
  });

  await step('owed: with one person owing, the header has no "All paid back" (theirs does the same job)', async () => {
    await page.evaluate(() => setView('home'));
    await page.click('nav [data-nav="pending"]');
    assert.strictEqual(await page.evaluate(() => owedGroupsShown.length), 1, 'test set-up: one person should owe');
    assert.ok(!(await visible(page, '#btnSettleAll')), 'header "All paid back" shows with one person');
    assert.ok(await visible(page, '.owed-groups button[data-person][data-action="handleSettlePerson"]'), "that person's own button is missing");
    await page.click('nav [data-nav="home"]');
  });

  await step('bills: Paid saves the bill as paid, Restore brings it back', async () => {
    await page.evaluate(() => setView('home'));
    const first = await page.$eval('#upcomingBudgetsList button[aria-label^="Mark"]', b => b.getAttribute('aria-label'));
    await page.click('#upcomingBudgetsList button[aria-label^="Mark"]');
    await page.waitForTimeout(250);
    const paid = (await calls(page, 'updateBudgetRow')).pop();
    assert.ok(paid && paid.newAmount === 0, 'expected updateBudgetRow with 0, got ' + JSON.stringify(paid));
    const name = first.replace(/^Mark | paid$/g, '');
    assert.ok((await page.textContent('#clearedBudgetsList')).includes(name), 'bill should move to Paid');
    await page.evaluate(() => document.querySelector('#clearedBudgetsList').closest('details').open = true);
    await page.click('#clearedBudgetsList button:has-text("Restore")');
    await page.waitForTimeout(250);
    const restored = (await calls(page, 'updateBudgetRow')).pop();
    assert.ok(restored && restored.newAmount < 0, 'Restore should put the amount back: ' + JSON.stringify(restored));
  });

  await step('bills: tapping a name opens its edit form; the skip icon still works', async () => {
    await page.click('#upcomingBudgetsList button[aria-label^="Edit"]');
    assert.ok(await visible(page, '#budgetModal'), 'edit form did not open');
    assert.ok(/^Edit /.test(await page.textContent('#budFormTitle')));
    await page.click('#budgetModal button[aria-label="Close"]');
    await page.click('#upcomingBudgetsList button[aria-label^="Simulate skipping"]');
    assert.ok(await visible(page, '#simBadge'), 'What-If badge should show');
    await page.click('#upcomingBudgetsList button[aria-label^="Simulate skipping"]');
  });

  await page.evaluate(SEED_OWED);

  await step('owed on Home: a short summary per person, not every item', async () => {
    assert.ok(await visible(page, '.owed-summary'), 'summary hidden');
    assert.ok(!(await visible(page, '.owed-groups')), 'full list should be hidden on Home');
    assert.ok(!(await visible(page, '#owedTabs')), 'Still owed / Paid back tabs should be hidden on Home');
    const people = await page.$$eval('.owed-summary > button[data-action="setView"][data-arg="pending"]', bs => bs.length);
    assert.strictEqual(people, 4, 'one row per person, and no "See everything owed" button');
    assert.ok(!/See everything/.test(await page.textContent('.owed-summary')), 'the "See everything owed" button is back');
    assert.strictEqual(await owedCount(page), 24);
  });

  await step('owed header: just the total, no count; the tabs say "Still owed" / "Paid back" with no counts', async () => {
    const total = await page.evaluate(() => fmtGBP(state.checking.filter(r => r.need).reduce((a, r) => a + r.amount, 0)));
    assert.strictEqual((await page.textContent('#sec_pending h2 + span')).trim(), total);
    assert.strictEqual((await page.textContent('#pill_pending')).trim(), 'Still owed');
    assert.strictEqual((await page.textContent('#pill_settled')).trim(), 'Paid back');
  });

  await step('owed tab: grouped by person; one tick marks one item paid back', async () => {
    await page.click('.owed-summary > button:has-text("Kim")');
    assert.strictEqual(await page.evaluate(() => document.body.dataset.view), 'pending');
    assert.ok(await visible(page, '.owed-groups') && !(await visible(page, '.owed-summary')));
    assert.ok(await visible(page, '#heroSection') === false, 'Owed tab should show only the Owed section');
    const names = await page.$$eval('.owed-groups .text-sm.font-semibold.truncate', els => els.map(e => e.textContent));
    assert.deepStrictEqual(names, ['Kim', 'Sam', 'Robin', 'Lee'], 'biggest amount owed first: ' + JSON.stringify(names));
    await page.click('.owed-groups button[aria-label="Mark Sam Lidl paid back"]');
    await page.waitForTimeout(250);
    const t = (await calls(page, 'toggleNeedFlag')).pop();
    assert.ok(t && t.setNeed === false, JSON.stringify(t));
    assert.strictEqual(await owedCount(page), 23);
  });

  await step('owed tab: with several people owing, the header "All paid back" shows', async () => {
    assert.ok(await visible(page, '#btnSettleAll'), 'should show while 4 people owe');
  });

  await step('owed tab: "All paid back" for one person saves only their items', async () => {
    const before = await page.evaluate(() => state.checking.filter(r => r.need && /^robin/i.test(r.desc)).map(r => r.row).sort());
    await page.click('.owed-groups button[data-person="robin"]');
    await page.waitForTimeout(250);
    const s = (await calls(page, 'settleAllNeeds')).pop();
    assert.deepStrictEqual(s.rows.slice().sort(), before);
    assert.strictEqual(await owedCount(page), 23 - before.length, 'rows ' + JSON.stringify(before));
    const left = await page.evaluate(() => state.checking.filter(r => r.need && /^robin/i.test(r.desc)).length);
    assert.strictEqual(left, 0);
  });

  await step('owed tab: Paid back list has Undo, which puts an item back', async () => {
    await page.click('#pill_settled');
    assert.ok(await visible(page, '#panel_settled'));
    const n = await owedCount(page);
    await page.click('#panel_settled button:has-text("Undo")');
    await page.waitForTimeout(250);
    const t = (await calls(page, 'toggleNeedFlag')).pop();
    assert.ok(t && t.setNeed === true);
    assert.strictEqual(await owedCount(page), n + 1);
    await page.click('#pill_pending');
  });

  await step('activity tab: spending on top, full list, no "Show all"', async () => {
    await page.click('nav [data-nav="activity"]');
    assert.ok(await visible(page, '#actSpend'), 'spending summary hidden');
    assert.ok(/Activity$/.test((await page.textContent('#sec_activity h2')).trim()) && !(await visible(page, '.act-title-home')));
    const rows = await page.$$eval('#txListContainer > .tx-row', d => d.length);
    const total = await page.evaluate(() => ['amex', 'barclays', 'checking', 'marcus'].reduce((n, a) => n + state[a].filter(r => r.desc.toLowerCase() !== 'start').length, 0));
    assert.strictEqual(rows, total, 'should list every transaction');
    assert.ok(!(await page.$('#sec_activity button:has-text("Show all")')));
  });

  await step('activity tab: tapping a category chip filters the list to that category', async () => {
    await page.click('#actSpend button[data-cat="Groceries"]');
    const names = await page.$$eval('#txListContainer > .tx-row .truncate', els => els.map(e => e.textContent));
    assert.ok(names.length >= 2, 'expected grocery rows, got ' + JSON.stringify(names));
    const cats = await page.evaluate(n => n.map(x => categoryFor(x, loadSpendOverrides())), names);
    assert.ok(cats.every(c => c === 'Groceries'), JSON.stringify(names));
    assert.ok((await page.textContent('#actSpend')).includes('Groceries on cards'));
    await page.click('#actSpend button[data-cat="Groceries"]');
    assert.ok((await page.textContent('#actSpend')).includes('Spent on cards this month'));
  });

  await step('Activity tab: the account filters and search fold away behind one button; each left on shows as a chip that clears it', async () => {
    await page.evaluate(() => setView('activity'));
    const rowCount = () => page.$$eval('#txListContainer > .tx-row', d => d.length);
    assert.ok(!(await visible(page, '#txFilters')) && !(await visible(page, '#txSearch')), 'the filters should start folded away');
    assert.strictEqual(await page.getAttribute('#txFilterBtn', 'aria-expanded'), 'false');
    const all = await rowCount();
    const look = () => page.$eval('#txFilterBtn', b => getComputedStyle(b).color + ' ' + getComputedStyle(b).backgroundColor);
    const closedLook = await look();
    await page.click('#txFilterBtn');
    assert.notStrictEqual(await look(), closedLook, 'the button should look different while its filters are open');
    assert.ok(await visible(page, '#txFilters') && await visible(page, '#txSearch'), 'the button should show the filters');
    assert.strictEqual(await page.getAttribute('#txFilterBtn', 'aria-expanded'), 'true');
    assert.ok(!(await visible(page, '#txActive')), 'no chips while the filters themselves show');
    const word = await page.evaluate(() => state.amex.find(r => r.desc.toLowerCase() !== 'start').desc.slice(0, 4).trim());
    await page.click('#txf_amex');
    await page.fill('#txSearch', word + ' ');   // phone keyboards add a space after a suggestion
    await page.click('#txFilterBtn');
    assert.ok(!(await visible(page, '#txFilters')) && !(await visible(page, '#txSearch')));
    const chips = await page.$$eval('#txActive button', b => b.map(x => x.getAttribute('aria-label')));
    assert.deepStrictEqual(chips, ['Clear filter: Amex only', 'Clear filter: \u201C' + word + '\u201D']);
    const shown = await page.$$eval('#txListContainer > .tx-row', d => d.map(r => r.getAttribute('aria-label')));
    assert.ok(shown.length >= 1 && shown.length < all, 'the list should still be filtered: ' + JSON.stringify(shown));
    await page.click('#txActive button[aria-label="Clear filter: Amex only"]');
    assert.strictEqual(await page.evaluate(() => txFilter), 'all');
    await page.click('#txFilterBtn');
    await page.fill('#txSearch', '   ');   // only spaces: no filter, so every row and no chip
    await page.click('#txFilterBtn');
    assert.strictEqual(await rowCount(), all, 'a search of only spaces hid rows');
    assert.deepStrictEqual(await page.$$eval('#txActive button', b => b.map(x => x.getAttribute('aria-label'))), [], 'no chip for spaces');
    await page.click('#txFilterBtn');
    await page.fill('#txSearch', word);
    await page.click('#txFilterBtn');
    await page.click('#txActive button');   // the search one
    assert.strictEqual(await page.inputValue('#txSearch'), '');
    assert.ok(!(await visible(page, '#txActive')), 'no chips once nothing is left on');
    assert.strictEqual(await rowCount(), all);
  });

  await step('leaving the Activity tab clears its filters; Home shows the latest 4, no filters, and "See all"', async () => {
    await page.click('#actSpend button[data-cat="Groceries"]');
    await page.click('#txFilterBtn');
    await page.click('#txf_amex');
    await page.fill('#txSearch', 'zzz');
    await page.click('nav [data-nav="home"]');
    const rows = await page.$$eval('#txListContainer > .tx-row', d => d.map(r => r.getAttribute('aria-label')));
    assert.strictEqual(rows.length, 4, 'Home should show the latest 4: ' + JSON.stringify(rows));
    assert.ok(!(await visible(page, '#actSpend')));
    assert.ok(!(await visible(page, '#txFilters')) && !(await visible(page, '#txSearch')), 'the filters should not show on Home');
    assert.ok(!(await page.$('#sec_activity button:has-text("Show all")')), 'Home has "See all", not "Show all"');
    await page.click('#sec_activity button:has-text("See all")');
    assert.strictEqual(await page.evaluate(() => document.body.dataset.view), 'activity', '"See all" should open the Activity tab');
    const s = await page.evaluate(() => ({ filter: txFilter, search: document.getElementById('txSearch').value, cat: actCat }));
    assert.deepStrictEqual(s, { filter: 'all', search: '', cat: null }, 'the old filters came back');
    assert.ok(!(await visible(page, '#txFilters')) && !(await visible(page, '#txActive')), 'the filters should be folded away again, with no chips');
    await page.click('nav [data-nav="home"]');
  });

  await step('Home on a phone shows the same latest 4 the Activity tab starts with', async () => {
    const home = await page.$$eval('#txListContainer > .tx-row', d => d.map(r => r.getAttribute('aria-label')));
    await page.click('nav [data-nav="activity"]');
    const tab = await page.$$eval('#txListContainer > .tx-row', d => d.map(r => r.getAttribute('aria-label')));
    await page.click('nav [data-nav="home"]');
    assert.deepStrictEqual(home, tab.slice(0, 4));
  });

  await step('spending details: ring chart, open a category, change a shop\'s category, Escape closes', async () => {
    await page.click('nav [data-nav="activity"]');
    await page.click('#actSpend button:has-text("Details")');
    assert.ok(await visible(page, '#spendModal'));
    assert.ok(await page.$('#spendBody svg circle'));
    await page.click('#spendBody button[data-cat="Groceries"]');
    await page.selectOption('#spendBody select', 'Shopping');
    await page.waitForTimeout(250);
    const c = (await calls(page, 'setCategoryChoice')).pop();
    assert.ok(c && c.category === 'Shopping', JSON.stringify(c));
    await page.keyboard.press('Escape');
    assert.ok(!(await visible(page, '#spendModal')), 'Escape should close it');
  });

  await step('add a spend: saves and appears in activity', async () => {
    await page.click('nav button[aria-label="Add transaction"]');
    await page.fill('#inpMerchant', 'Flow test shop');
    await page.fill('#inpAmount', '7.25');
    await page.click('#btnSubmitTx');
    await page.waitForTimeout(300);
    const a = (await calls(page, 'addTransactionBundle')).pop();
    assert.ok(a && a.merchant === 'Flow test shop' && Number(a.grossAmount) === 7.25, JSON.stringify(a));
    assert.ok((await page.textContent('#txListContainer')).includes('Flow test shop'));
  });

  // The sync button: its colour (data-sync) and label are the status; the red caption is the only text, when a sync failed.
  const syncShown = () => page.evaluate(() => {
    const b = document.getElementById('syncBtn'), n = document.getElementById('syncStatus');
    return { sync: b.dataset.sync, label: b.getAttribute('aria-label'), sameTitle: b.title === b.getAttribute('aria-label'),
      colour: getComputedStyle(b).color, caption: n.classList.contains('hidden') ? null : n.textContent.trim() };
  });
  const syncSettled = sync => page.waitForFunction(v => apiInflight === 0 && document.getElementById('syncBtn').dataset.sync === v, sync, { timeout: 8000 });
  // Requests this test fails on purpose are logged by the page; take just those back out of the error list.
  const dropExpectedSyncErrors = from => { for (let i = errors.length - 1; i >= from; i--) if (/Failed to fetch|Mock server failure|something unexpected|Lock timeout|Invalid amount|check the Google sign-in|SAVED_NO_STATE|NetworkError/.test(errors[i])) errors.splice(i, 1); };
  await step('sync status: green when synced, with when in its label; no words on the page', async () => {
    await syncSettled('synced');
    const v = await syncShown();
    assert.ok(/^Synced (just now|\d+ min ago)\. Tap to sync now$/.test(v.label) && v.sameTitle, JSON.stringify(v));
    assert.strictEqual(v.caption, null);
  });
  await step('sync status: no reply turns it red with "Couldn\'t reach your sheet", on one line; the next good sync clears it', async () => {
    const from = errors.length;
    try {
      const green = (await syncShown()).colour;
      await page.evaluate(() => { MOCK.dropNext = 1; });
      await page.click('#syncBtn');
      await syncSettled('failed');
      const v = await syncShown();
      assert.deepStrictEqual([v.caption, v.label], ["Couldn't reach your sheet. Tap ↻ to try again.", "Couldn't reach your sheet. Tap to try again"], JSON.stringify(v));
      assert.notStrictEqual(v.colour, green, 'red should look different from green');
      await page.click('#syncStatus');   // the caption syncs too
      await syncSettled('synced');
      assert.strictEqual((await syncShown()).caption, null);
    } finally { dropExpectedSyncErrors(from); }
  });
  await step('sync status: a spend that could not be sent is amber with no words; tapping the button sends it', async () => {
    const from = errors.length;
    try {
      await page.evaluate(() => { MOCK.dropNext = 1; });
      await page.click('nav button[aria-label="Add transaction"]');
      await page.fill('#inpAmount', '4.10');
      await page.fill('#inpMerchant', 'Waiting shop');
      await page.click('#btnSubmitTx');
      await syncSettled('waiting');
      const v = await syncShown();
      assert.deepStrictEqual([v.label, v.caption], ['1 spend waiting to send. Tap to send now', null], 'waiting comes before the failure, with no words');
      const sent = (await calls(page, 'addTransactionBundle')).length;
      await page.click('#syncBtn');
      await syncSettled('synced');
      const after = await calls(page, 'addTransactionBundle');
      assert.ok(after.length === sent + 1 && after.pop().merchant === 'Waiting shop', 'tapping should send the waiting spend');
      assert.strictEqual(await page.evaluate(() => loadOutbox().length), 0);
    } finally { dropExpectedSyncErrors(from); }
  });
  await step('sync status: offline is grey with no words; a spend saved offline makes it amber; back online it sends', async () => {
    await ctx.setOffline(true);
    await page.waitForFunction(() => document.getElementById('syncBtn').dataset.sync === 'offline');
    const off = await syncShown();
    assert.deepStrictEqual([off.label, off.caption], ['Offline, showing saved figures', null]);
    await page.click('nav button[aria-label="Add transaction"]');
    await page.fill('#inpAmount', '2.50');
    await page.fill('#inpMerchant', 'Offline shop');
    await page.click('#btnSubmitTx');
    await page.waitForFunction(() => document.getElementById('syncBtn').dataset.sync === 'waiting');
    const w = await syncShown();
    assert.deepStrictEqual([w.label, w.caption], ["1 spend waiting to send. It sends when you're back online", null]);
    assert.notStrictEqual(w.colour, off.colour, 'amber should look different from grey');
    await ctx.setOffline(false);
    await syncSettled('synced');
    assert.strictEqual(await page.evaluate(() => loadOutbox().length), 0);
  });
  // Offline spends: kept on this phone until the sheet has them. Only the sheet being busy is tried again by itself
  // (plus no reply, which the server de-duplicates); anything else is set aside in red, with Remove.
  const outbox = () => page.evaluate(() => loadOutbox());
  const rowsNamed = merchant => page.evaluate(m => Object.values(MOCK.db).filter(Array.isArray).flat().filter(r => r && r.desc === m).length, merchant);
  const sentCount = merchant => page.evaluate(m => MOCK.calls.filter(c => c.action === 'addTransactionBundle' && c.payload.merchant === m).length, merchant);
  const toastParts = () => page.evaluate(() => [document.querySelector('#toast span').textContent, (document.getElementById('toastAction') || {}).textContent || null]);
  const LOCK_TIMEOUT = 'Lock timeout: another process was holding the lock for too long.';
  const addSpend = async (amount, merchant) => {
    await page.click('nav button[aria-label="Add transaction"]');
    await page.fill('#inpAmount', amount);
    await page.fill('#inpMerchant', merchant);
    await page.click('#btnSubmitTx');
  };
  await step('outbox: a reply that cannot be read (Google error page) keeps the spend and sends it again, saved once', async () => {
    const from = errors.length;
    try {
      await page.evaluate(() => { MOCK.badReplyNext = 1; });
      await addSpend('3.30', 'Bad reply shop');
      await syncSettled('waiting');
      const o = await outbox();
      assert.ok(o.length === 1 && o[0].sentAt > 0, 'kept on this phone, noted as maybe sent: ' + JSON.stringify(o));
      assert.ok((await toastParts())[0].includes('kept on this device'));
      await page.click('#syncBtn');
      await syncSettled('synced');
      assert.strictEqual((await outbox()).length, 0);
      assert.strictEqual(await rowsNamed('Bad reply shop'), 1, 'the server ignores the repeat, so it is in the sheet once');
    } finally { dropExpectedSyncErrors(from); }
  });
  await step('outbox: the sheet busy (lock timeout) keeps the spend waiting; the next send gets it there', async () => {
    const from = errors.length;
    try {
      await page.evaluate(t => { MOCK.failWith = t; MOCK.failNext = 2; }, LOCK_TIMEOUT);
      await addSpend('2.20', 'Busy shop');
      await syncSettled('waiting');
      await page.click('#syncBtn');   // the sheet is still busy
      await syncSettled('waiting');
      const o = await outbox();
      assert.ok(o.length === 1 && o[0].tries === 1 && !o[0].setAside && !o[0].sentAt, JSON.stringify(o));
      await page.click('#syncBtn');
      await syncSettled('synced');
      assert.strictEqual((await outbox()).length, 0);
      assert.strictEqual(await rowsNamed('Busy shop'), 1);
    } finally { await page.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; }); dropExpectedSyncErrors(from); }
  });
  await step('outbox: busy OUTBOX_MAX_TRIES times in a row sets it aside in red; the timer leaves it; a tap sends it', async () => {
    const from = errors.length;
    try {
      const max = await page.evaluate(() => OUTBOX_MAX_TRIES);
      await page.evaluate(([t, n]) => { MOCK.failWith = t; MOCK.failNext = n + 1; }, [LOCK_TIMEOUT, max]);
      await addSpend('1.10', 'Very busy shop');   // the first send isn't counted: then `max` tries
      await syncSettled('waiting');
      await page.evaluate(async n => { for (let i = 0; i < n; i++) await flushOutbox(); }, max);
      await syncSettled('failed');
      const o = await outbox();
      assert.ok(o.length === 1 && /^Lock timeout/.test(o[0].setAside), JSON.stringify(o));
      const v = await syncShown();
      assert.deepStrictEqual([v.caption, v.label], ["A spend couldn't be sent. Tap ↻ to try again.", "A spend saved on this device couldn't be sent. Tap to try again"]);
      await page.evaluate(() => flushOutbox());   // the timer leaves a set-aside spend alone
      assert.strictEqual(await sentCount('Very busy shop'), max + 1);
      await page.click('#syncStatus');
      await syncSettled('synced');
      assert.strictEqual((await outbox()).length, 0);
      assert.strictEqual(await rowsNamed('Very busy shop'), 1);
    } finally { await page.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; }); dropExpectedSyncErrors(from); }
  });
  await step('outbox: any other server error is not sent again by itself: set aside, and the screen shows whether it got there', async () => {
    const from = errors.length;
    try {
      // The server wrote the rows, then failed (so it never noted the spend as saved: a resend would write it twice).
      await page.evaluate(() => { MOCK.failAfterWriteNext = 1; });
      await addSpend('5.40', 'Half done shop');
      await syncSettled('failed');
      assert.strictEqual(await sentCount('Half done shop'), 1, 'sent once, not again');
      assert.strictEqual((await outbox())[0].setAside, 'Mock server failure');
      assert.deepStrictEqual(await toastParts(), ["Couldn't send Half done shop £5.40: Mock server failure", 'Remove']);
      await page.waitForFunction(() => document.getElementById('txListContainer').textContent.includes('Half done shop'));   // fetched afresh: it is there
      await page.click('#toastAction');   // so remove it from this phone
      await syncSettled('synced');
      assert.strictEqual((await outbox()).length, 0);
      assert.strictEqual(await rowsNamed('Half done shop'), 1, 'Remove only takes it off this phone');
    } finally { await page.evaluate(() => { MOCK.failAfterWriteNext = 0; }); dropExpectedSyncErrors(from); }
  });
  await step('outbox: a spend the sheet turns down is kept and shown in red (not lost); a tap tries it again; Remove takes it off', async () => {
    const from = errors.length;
    try {
      await page.evaluate(() => { MOCK.failWith = 'Invalid amount.'; MOCK.failNext = 2; });
      await addSpend('1.00', 'Refused shop');
      await syncSettled('failed');
      assert.deepStrictEqual(await toastParts(), ["Couldn't send Refused shop £1.00: Invalid amount.", 'Remove']);
      assert.strictEqual((await outbox())[0].setAside, 'Invalid amount.');
      assert.strictEqual((await syncShown()).caption, "A spend couldn't be sent. Tap ↻ to try again.");
      await page.click('#syncBtn');   // a tap tries it again: still turned down, still kept
      await page.waitForFunction(() => MOCK.failNext === 0 && apiInflight === 0);
      await syncSettled('failed');
      assert.strictEqual(await sentCount('Refused shop'), 2);
      assert.strictEqual((await outbox()).length, 1);
      await page.click('#toastAction');
      await syncSettled('synced');
      assert.strictEqual((await outbox()).length, 0);
      assert.strictEqual(await rowsNamed('Refused shop'), 0);
    } finally { await page.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; }); dropExpectedSyncErrors(from); }
  });
  await step('outbox: a spend whose reply was lost hours ago is not sent again by itself (it may be there); a tap sends it', async () => {
    const payload = { sheetName: await page.evaluate(() => activeMonth), merchant: 'Old lost shop', grossAmount: 6.5, isRefund: false, account: 'amex', splits: [], marcusShare: 0, markNeed: false, clientId: 'old-lost-1' };
    await page.evaluate(p => { saveOutbox([{ id: p.clientId, payload: p, sentAt: Date.now() - RESEND_WITHIN_MS - 60000 }]); return flushOutbox(); }, payload);
    await syncSettled('failed');
    assert.strictEqual(await sentCount('Old lost shop'), 0, 'not sent by itself');
    assert.ok(/may already be in your sheet/.test((await outbox())[0].setAside));
    assert.ok((await toastParts())[0].startsWith("Couldn't send Old lost shop £6.50: it may already be in your sheet."));
    await page.click('#syncBtn');
    await syncSettled('synced');
    assert.strictEqual(await sentCount('Old lost shop'), 1);
    assert.strictEqual((await outbox()).length, 0);
  });
  await step("outbox: with this phone's storage full, a turned-down spend is not sent over and over", async () => {
    const from = errors.length;
    try {
      const payload = { sheetName: await page.evaluate(() => activeMonth), merchant: 'Full storage shop', grossAmount: 2, isRefund: false, account: 'amex', splits: [], marcusShare: 0, markNeed: false, clientId: 'full-1' };
      await page.evaluate(p => {
        saveOutbox([{ id: p.clientId, payload: p }]);
        MOCK.failWith = 'Invalid amount.'; MOCK.failNext = 10;
        window.__setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); };   // nothing can be saved now
        return flushOutbox();
      }, payload);
      await page.waitForTimeout(2500);   // long enough for several rounds if setting it aside started another
      await page.waitForFunction(() => apiInflight === 0);
      assert.strictEqual(await sentCount('Full storage shop'), 1);
    } finally {
      await page.evaluate(() => { Storage.prototype.setItem = window.__setItem; MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; saveOutbox([]); updateSyncUi(); });
      dropExpectedSyncErrors(from);
    }
  });
  await step('saved, but the figures could not be read back: not kept or shown in red; the screen is fetched afresh; in the sheet once', async () => {
    const from = errors.length;
    try {
      const syncs = await sheetReads(page);
      await failSavedNoState(page);
      await page.evaluate(() => { document.querySelector('#toast span').textContent = ''; });
      await addSpend('3.80', 'Read back shop');
      await page.waitForFunction(n => MOCK.calls.filter(c => c.action === 'getCachedSheetState').length > n, syncs);
      await syncSettled('synced');
      assert.deepStrictEqual(await outbox(), [], 'nothing kept on this phone');
      assert.strictEqual(await sentCount('Read back shop'), 1, 'sent once, not again');
      assert.strictEqual(await rowsNamed('Read back shop'), 1);
      assert.ok((await page.textContent('#txListContainer')).includes('Read back shop'));
      assert.ok(!/Couldn't/.test((await toastParts())[0]), 'no failure toast: ' + (await toastParts())[0]);
      assert.strictEqual((await syncShown()).caption, null);
    } finally { await resetFailures(page); dropExpectedSyncErrors(from); }
  });
  await step('a waiting spend sent again and saved, but the figures could not be read back: it leaves this phone, saved once', async () => {
    const from = errors.length;
    try {
      const payload = { sheetName: await page.evaluate(() => activeMonth), merchant: 'Resent read back shop', grossAmount: 1.25, isRefund: false, account: 'amex', splits: [], marcusShare: 0, markNeed: false, clientId: 'resent-rb-1' };
      const syncs = await sheetReads(page);
      await failSavedNoState(page);
      await page.evaluate(p => { saveOutbox([{ id: p.clientId, payload: p }]); return flushOutbox(); }, payload);
      await syncSettled('synced');
      assert.ok(await sheetReads(page) > syncs, 'the screen was fetched afresh');
      assert.deepStrictEqual(await outbox(), []);
      assert.strictEqual(await sentCount('Resent read back shop'), 1);
      assert.strictEqual(await rowsNamed('Resent read back shop'), 1);
      await page.waitForFunction(() => document.getElementById('txListContainer').textContent.includes('Resent read back shop'));
    } finally { await resetFailures(page); dropExpectedSyncErrors(from); }
  });
  await step('outbox: (tidy up) the spends these steps saved are taken back out of the pretend sheet', async () => {
    await page.evaluate(() => {
      const ours = /^(Bad reply|Busy|Very busy|Half done|Old lost|Read back|Resent read back) shop$/;
      Object.values(MOCK.db).filter(Array.isArray).forEach(a => { for (let i = a.length - 1; i >= 0; i--) if (ours.test(a[i].desc)) a.splice(i, 1); });
    });
    await page.click('#syncBtn');
    await syncSettled('synced');
    assert.strictEqual(await rowsNamed('Busy shop'), 0);
  });
  await step("sign-in check unavailable on the server: \"Couldn't reach your sheet\", still signed in, no lock screen", async () => {
    const from = errors.length;
    try {
      const before = await page.evaluate(() => [hasValidToken(), Object.keys(localStorage).filter(k => /token|session/i.test(k)).sort().join()]);
      await page.evaluate(() => { MOCK.authError = "AUTH_UNAVAILABLE: Couldn't check the Google sign-in just now. Try again in a minute."; });
      await page.click('#syncBtn');
      await syncSettled('failed');
      assert.strictEqual((await syncShown()).caption, "Couldn't reach your sheet. Tap ↻ to try again.");
      assert.ok(!(await page.evaluate(() => lockScreenShowing())), 'no lock screen');
      assert.deepStrictEqual(await page.evaluate(() => [hasValidToken(), Object.keys(localStorage).filter(k => /token|session/i.test(k)).sort().join()]), before, 'sign-in kept');
      await page.evaluate(() => { MOCK.authError = null; });
      await page.click('#syncBtn');
      await syncSettled('synced');
    } finally { await page.evaluate(() => { MOCK.authError = null; }); dropExpectedSyncErrors(from); }
  });
  await step('sync status: with no caption, Money Left sits the normal gap below the top bar (no empty line left)', async () => {
    await syncSettled('synced');
    await page.evaluate(() => { setView('home'); window.scrollTo(0, 0); });
    const gap = await page.evaluate(() => Math.round(document.getElementById('heroSection').getBoundingClientRect().top - document.querySelector('header').getBoundingClientRect().bottom));
    assert.strictEqual(gap, 14, 'gap above Money Left: ' + gap + 'px (the page padding is 14px)');
  });
  await step('sync status: a request that fails while offline shows grey, and back online the sheet is checked again (no red left)', async () => {
    const from = errors.length;
    try {
      await ctx.setOffline(true);
      await page.evaluate(() => { MOCK.dropNext = 1; });
      await page.click('#syncBtn');
      await page.waitForFunction(() => apiInflight === 0 && lastSyncFailed === 'reach');
      assert.strictEqual((await syncShown()).sync, 'offline', 'offline comes before the failure');
      await ctx.setOffline(false);
      await syncSettled('synced');
      assert.strictEqual((await syncShown()).caption, null);
    } finally { await ctx.setOffline(false); dropExpectedSyncErrors(from); }
  });
  await step('sync status: fingerprint requests never change it', async () => {
    const from = errors.length;
    try {
      await page.evaluate(() => { MOCK.dropNext = 1; return apiCall('passkeyList').catch(() => {}); });
      await syncSettled('synced');
      assert.strictEqual((await syncShown()).caption, null);
    } finally { dropExpectedSyncErrors(from); }
  });

  await step('Add and Edit forms: Amount comes first, full width and large, then Where / Description', async () => {
    const r = await page.evaluate(() => {
      const out = {};
      for (const [modal, a, d] of [['addModal', 'inpAmount', 'inpMerchant'], ['editTxModal', 'editTxAmt', 'editTxDesc']]) {
        document.getElementById(modal).classList.remove('hidden');
        const A = document.getElementById(a), D = document.getElementById(d), ra = A.getBoundingClientRect(), rd = D.getBoundingClientRect();
        out[modal] = { above: ra.bottom <= rd.top, sameWidth: Math.abs(ra.width - rd.width) < 1, size: getComputedStyle(A).fontSize,
          tabOrder: !!(A.compareDocumentPosition(D) & Node.DOCUMENT_POSITION_FOLLOWING) };
        document.getElementById(modal).classList.add('hidden');
      }
      return out;
    });
    const want = { above: true, sameWidth: true, size: '28px', tabOrder: true };
    assert.deepStrictEqual(r, { addModal: want, editTxModal: want });
  });

  // ---- quicker Add form ----
  const addForm = () => page.evaluate(() => ({ focus: document.activeElement && document.activeElement.id,
    amtErr: document.getElementById('inpAmountErr').classList.contains('hidden') ? null : document.getElementById('inpAmountErr').textContent,
    descErr: document.getElementById('inpMerchantErr').classList.contains('hidden') ? null : document.getElementById('inpMerchantErr').textContent,
    open: !document.getElementById('addModal').classList.contains('hidden') }));
  // Every step below leaves the Add form closed and empty, even when it fails half way.
  const resetAddForm = () => page.evaluate(() => {
    closeAddModal(); closeEditTxModal();
    ['inpAmount', 'inpMerchant'].forEach(id => { document.getElementById(id).value = ''; clearFieldError(id); });
    document.getElementById('chkEqualIncludeMe').checked = true;
  });
  await step('Add form: opens with the cursor in Amount; Enter moves to Description; Enter there saves', async () => {
    try {
      await page.click('nav button[aria-label="Add transaction"]');
      assert.strictEqual((await addForm()).focus, 'inpAmount');
      assert.deepStrictEqual(await page.$eval('#inpAmount', i => [i.type, i.inputMode, i.enterKeyHint]), ['text', 'decimal', 'next']);
      await page.keyboard.type('6.40');
      await page.keyboard.press('Enter');
      assert.strictEqual((await addForm()).focus, 'inpMerchant');
      assert.strictEqual(await page.$eval('#inpMerchant', i => i.enterKeyHint), 'done');
      const sent = (await calls(page, 'addTransactionBundle')).length;
      await page.keyboard.type('Enter key shop');
      await page.keyboard.press('Enter');
      await page.waitForFunction(n => MOCK.calls.filter(c => c.action === 'addTransactionBundle').length === n + 1, sent);
      const a = (await calls(page, 'addTransactionBundle')).pop();
      assert.ok(a.merchant === 'Enter key shop' && Number(a.grossAmount) === 6.4, JSON.stringify(a));
      assert.ok(!(await addForm()).open, 'the form closes once saved');
    } finally { await resetAddForm(); }
  });
  await step('Add form: Save with something missing says what, under the box, and sends nothing', async () => {
    try {
      const sent = (await calls(page, 'addTransactionBundle')).length;
      await page.click('nav button[aria-label="Add transaction"]');
      await page.click('#btnSubmitTx');
      let f = await addForm();
      assert.deepStrictEqual([f.amtErr, f.focus], ['Add the amount', 'inpAmount']);
      await page.fill('#inpAmount', '12.5e3');
      assert.strictEqual((await addForm()).amtErr, null, 'typing clears the line');
      await page.click('#btnSubmitTx');
      assert.strictEqual((await addForm()).amtErr, 'Type an amount, like 12.50');
      await page.fill('#inpAmount', '3.20');
      await page.click('#btnSubmitTx');
      f = await addForm();
      assert.deepStrictEqual([f.descErr, f.focus, f.open], ['Add where it was', 'inpMerchant', true]);
      assert.deepStrictEqual(await page.$eval('#inpMerchant', i => [i.getAttribute('aria-invalid'), i.getAttribute('aria-describedby')]), ['true', 'inpMerchantErr']);
      assert.strictEqual((await calls(page, 'addTransactionBundle')).length, sent, 'nothing is sent');
      await page.evaluate(() => { closeAddModal(); openAddModal(); });
      f = await addForm();
      assert.deepStrictEqual([f.amtErr, f.descErr], [null, null], 'a fresh form shows no old message');
    } finally { await resetAddForm(); }
  });
  await step('Edit and New Month: an amount that is not one says so and saves nothing (never a different amount)', async () => {
    try {
      await page.click('#txListContainer > .tx-row');
      await page.fill('#editTxAmt', '4..50');
      const edits = (await calls(page, 'editOrMoveTransaction')).length;
      await page.click('#btnSaveEditTx');
      assert.strictEqual(await page.textContent('#editTxAmtErr'), 'Type an amount, like 12.50');
      assert.strictEqual((await calls(page, 'editOrMoveTransaction')).length, edits);
      await page.evaluate(() => { closeEditTxModal(); openNewMonthModal(); });
      await page.fill('#nmPaycheck', '2500a');
      const months = (await calls(page, 'startNewMonth')).length;
      await page.evaluate(() => confirmStartNewMonth());
      assert.strictEqual(await page.textContent('#nmPaycheckErr'), 'Type an amount, like 12.50');
      assert.strictEqual((await calls(page, 'startNewMonth')).length, months, 'no month was made with £0 pay');
      await page.evaluate(() => { closeNewMonthModal(); openNewMonthModal(); closeNewMonthModal(); openEditTxModal('amex', 4, 'start', 0); });
      assert.ok(await page.evaluate(() => ['nmPaycheckErr', 'editTxAmtErr'].every(id => document.getElementById(id).classList.contains('hidden'))), 'reopened forms show no old message');
    } finally { await page.evaluate(() => closeNewMonthModal()); await resetAddForm(); }
  });
  await step('amount boxes read "12.50", "£1,234.50", " 7 " and "1,500"; anything else ("12,50", "-4", "12.5e3") is not an amount', async () => {
    const cases = ['12.50', '£1,234.50', ' 7 ', '.5', '', '1,234', '1,500', '£ 3', '12,50', '0,500', '-4', '−4', '12.5e3', '1.2.3', 'abc', '1 2', '1,23'];
    const r = await page.evaluate(c => c.map(parseAmount), cases);
    assert.deepStrictEqual(r.map(x => Number.isNaN(x) ? 'NaN' : x), [12.5, 1234.5, 7, 0.5, 0, 1234, 1500, 3, 'NaN', 'NaN', 'NaN', 'NaN', 'NaN', 'NaN', 'NaN', 'NaN', 'NaN']);
  });
  await step('Add form: starts on the card the last spend went on, also after the app is opened again', async () => {
    try {
      await page.click('nav button[aria-label="Add transaction"]');
      await page.click('#acct_barclays');
      await page.fill('#inpAmount', '1.75');
      await page.fill('#inpMerchant', 'Card memory shop');
      await page.click('#btnSubmitTx');
      await page.waitForFunction(() => apiInflight === 0);
      assert.strictEqual(await page.evaluate(() => localStorage.getItem('pf_last_acct')), 'barclays');
      const p2 = watch(await ctx.newPage());   // the app opened again on this phone (same saved data)
      try {
        const u = new URL(page.url()); u.searchParams.set('keep', '1');
        await p2.goto(u.href);
        await p2.waitForFunction(() => typeof openAddModal === 'function' && window.MOCK && MOCK.calls.length > 0);
        await p2.evaluate(() => openAddModal());
        assert.ok((await p2.getAttribute('#acct_barclays', 'class')).includes('bg-emerald-500'), 'Barclays should be picked');
        assert.ok(!(await p2.getAttribute('#acct_amex', 'class')).includes('bg-emerald-500'));
      } finally { await p2.close(); }
    } finally { await page.evaluate(() => localStorage.setItem('pf_last_acct', 'amex')); await resetAddForm(); }
  });
  await step('group split: equal shares from the start, redone as people are added or taken off, until you type one', async () => {
    try {
      const shares = () => page.$$eval('#dynamicSplitRows .split-amt', i => i.map(x => x.value));
      await page.evaluate(() => openAddModal());
      await page.fill('#inpAmount', '42.50');
      await page.evaluate(() => selectSplit('custom'));   // the quick-split person is added by itself
      assert.deepStrictEqual(await shares(), ['21.25'], 'you and Kim, half each');
      await page.click('#chip_lee');
      assert.deepStrictEqual(await shares(), ['14.17', '14.17']);
      assert.ok((await page.textContent('#cleanSplitPill')).includes('You pay: £14.16'), await page.textContent('#cleanSplitPill'));
      await page.click('#chip_lee');
      assert.deepStrictEqual(await shares(), ['21.25'], 'taking Lee off shares it again');
      await page.fill('#inpAmount', '50');
      assert.deepStrictEqual(await shares(), ['25'], 'a new amount is shared again');
      await page.fill('#dynamicSplitRows .split-amt', '10');   // typed: yours from now on
      await page.click('#chip_lee');
      assert.deepStrictEqual(await shares(), ['10', ''], 'a typed share stays; the new person starts empty');
      await page.click('#customSplitBox button:has-text("Split Equally")');
      assert.deepStrictEqual(await shares(), ['16.67', '16.67'], '÷ Split Equally goes back to equal shares');
    } finally { await resetAddForm(); }
  });
  await step('group split: taking the last person off clears their share (on screen and when saved)', async () => {
    try {
      await page.evaluate(() => openAddModal());
      await page.fill('#inpAmount', '42.50');
      await page.evaluate(() => selectSplit('custom'));
      await page.click('#chip_kim');   // the only person, off again
      assert.strictEqual(await page.$$eval('#dynamicSplitRows .split-amt', i => i.length), 0);
      assert.ok(!(await page.getAttribute('#chip_kim', 'class')).includes('bg-emerald-500'), 'the chip still looks picked');
      assert.ok((await page.textContent('#cleanSplitPill')).includes('You pay: £42.50'), await page.textContent('#cleanSplitPill'));
      assert.deepStrictEqual(await page.evaluate(() => buildSplitData().splits), []);
    } finally { await resetAddForm(); }
  });
  await step('group split: Marcus is never given a share by itself; without "Include me" the shares add up exactly', async () => {
    try {
      const shares = () => page.$$eval('#dynamicSplitRows .split-amt', i => i.map(x => x.value));
      await page.evaluate(() => openAddModal());
      await page.fill('#inpAmount', '30');
      await page.evaluate(() => selectSplit('custom'));
      await page.click('#chip_marcus');
      assert.deepStrictEqual(await shares(), ['15', ''], 'Kim and you share it; Marcus waits for a typed amount');
      await page.click('#chip_marcus');
      await page.fill('#inpAmount', '20');
      await page.click('#chip_lee');
      await page.click('#chip_jo');
      await page.uncheck('#chkEqualIncludeMe');
      assert.deepStrictEqual(await shares(), ['6.67', '6.67', '6.66']);
      assert.strictEqual(await page.evaluate(() => buildSplitData().splits.reduce((a, s) => a + s.amount, 0).toFixed(2)), '20.00');
      await page.fill('#inpAmount', '0.02');
      await page.click('#chip_robin');   // 2p between four: nobody's share goes below 0
      assert.deepStrictEqual(await shares(), ['0', '0', '0', '0.02'].map(v => v === '0' ? '' : v));
    } finally { await resetAddForm(); }
  });
  await step('group split: a share that is not an amount, has no name, or makes the shares more than the amount is not saved', async () => {
    try {
      const adds = async () => (await calls(page, 'addTransactionBundle')).length;
      const err = () => page.evaluate(() => { const n = document.getElementById('dynamicSplitRowsErr'); return n.classList.contains('hidden') ? '' : n.textContent; });
      await page.evaluate(() => openAddModal());
      await page.fill('#inpMerchant', 'Split check shop');
      await page.fill('#inpAmount', '30');
      await page.evaluate(() => selectSplit('custom'));
      const n = await adds();
      await page.fill('#dynamicSplitRows .split-amt', '1O');   // a letter O, not a zero
      await page.click('#btnSubmitTx');
      assert.strictEqual(await err(), 'Each share needs an amount like 12.50');
      assert.ok(await visible(page, '#addModal'), 'the form closed');
      await page.fill('#dynamicSplitRows .split-amt', '40');
      assert.strictEqual(await err(), '', 'typing clears the message');
      await page.click('#btnSubmitTx');
      assert.strictEqual(await err(), 'The shares come to £40.00, more than £30.00');
      await page.fill('#dynamicSplitRows .split-name', '');
      await page.fill('#dynamicSplitRows .split-amt', '10');
      await page.click('#btnSubmitTx');
      assert.strictEqual(await err(), 'Add a name for each share');
      assert.strictEqual(await page.evaluate(() => document.activeElement.className.includes('split-amt')), true, 'the cursor is not in a share box');
      assert.strictEqual(await adds(), n, 'a spend was sent');
    } finally { await resetAddForm(); }
  });
  await step('phone keyboard up: the sheet fills just what is visible, so the form stays in sight (and scrolls if taller)', async () => {
    try {
      await page.evaluate(() => openAddModal());
      const r = await page.evaluate(() => {
        const vv = window.visualViewport, h = 500, top = 60;
        Object.defineProperty(vv, 'height', { get: () => h, configurable: true });
        Object.defineProperty(vv, 'offsetTop', { get: () => top, configurable: true });   // the page moved up to show the box
        vv.dispatchEvent(new Event('resize'));
        const sheet = document.querySelector('#addModal > div'), s = sheet.getBoundingClientRect();
        const out = { kb: getComputedStyle(document.documentElement).getPropertyValue('--kb').trim(), kbtop: getComputedStyle(document.documentElement).getPropertyValue('--kbtop').trim(),
          inSight: s.top >= top && s.bottom <= top + h, scrolls: sheet.scrollHeight > sheet.clientHeight };
        delete vv.height; delete vv.offsetTop;
        vv.dispatchEvent(new Event('resize'));
        out.after = [getComputedStyle(document.documentElement).getPropertyValue('--kb').trim(), getComputedStyle(document.documentElement).getPropertyValue('--kbtop').trim()];
        return out;
      });
      const H = page.viewportSize().height;
      assert.deepStrictEqual(r, { kb: (H - 500 - 60) + 'px', kbtop: '60px', inSight: true, scrolls: true, after: ['0px', '0px'] });
    } finally { await resetAddForm(); }
  });
  await step('Add form: (tidy up) the spends these steps saved are taken back out of the pretend sheet', async () => {
    await page.evaluate(() => {
      const ours = /^(Enter key|Card memory) shop$/;
      Object.values(MOCK.db).filter(Array.isArray).forEach(a => { for (let i = a.length - 1; i >= 0; i--) if (ours.test(a[i].desc)) a.splice(i, 1); });
      forceSyncSheet();
    });
    await page.waitForFunction(() => apiInflight === 0 && !document.getElementById('txListContainer').textContent.includes('Card memory shop'));
  });
  for (const [w, h] of [[411, 847], [749, 638]]) {
    await step(`Add form at ${w}x${h} (the Fold ${w < 700 ? 'folded' : 'unfolded'}): Amount has the cursor and sits in sight`, async () => {
      const { ctx: c3, page: p3 } = await open({ viewport: { width: w, height: h }, deviceScaleFactor: 2.63, isMobile: true, hasTouch: true });
      try {
        await p3.click('nav button[aria-label="Add transaction"]');
        const r = await p3.evaluate(() => { const a = document.getElementById('inpAmount').getBoundingClientRect(), s = document.querySelector('#addModal > div').getBoundingClientRect();
          return { focus: document.activeElement.id, inSight: a.top >= 0 && a.bottom <= innerHeight, sheetFits: s.top >= 0 && s.bottom <= innerHeight + 1 }; });
        assert.deepStrictEqual(r, { focus: 'inpAmount', inSight: true, sheetFits: true });
      } finally { await c3.close(); }
    });
  }
  await step('edit then delete a transaction (with what the row should contain), and Undo', async () => {
    await page.click('#txListContainer > .tx-row:has-text("Flow test shop")');
    assert.ok(await visible(page, '#editTxModal'));
    await page.fill('#editTxDesc', 'Flow test shop 2');
    await page.click('#editTxModal button:has-text("Save")');
    await page.waitForTimeout(300);
    const e = (await calls(page, 'editOrMoveTransaction')).pop();
    assert.ok(e && e.newDesc === 'Flow test shop 2' && e.expect && e.expect.desc === 'Flow test shop', JSON.stringify(e));
    await page.click('#txListContainer > .tx-row:has-text("Flow test shop 2")');
    await page.click('#editTxModal button:has-text("Delete")');
    await page.waitForTimeout(300);
    const d = (await calls(page, 'deleteTransactionRow')).pop();
    assert.ok(d && d.expect && d.expect.desc === 'Flow test shop 2', JSON.stringify(d));
    await page.click('#toastAction');
    await page.waitForTimeout(300);
    assert.ok((await page.textContent('#txListContainer')).includes('Flow test shop 2'), 'Undo should bring it back');
    const u = (await calls(page, 'addTransactionBundle')).pop();
    assert.ok(u && u.merchant === 'Flow test shop 2' && u.clientId, 'Undo is sent as a spend with a clientId: ' + JSON.stringify(u));
  });

  await step('activity rows: tap to edit like Bills, no pencil; a row is a real button (keyboard works too)', async () => {
    const s = await page.$$eval('#txListContainer > .tx-row', rows => rows.map(r => ({ tag: r.tagName, label: r.getAttribute('aria-label') || '', svgs: r.querySelectorAll('svg').length, wide: r.getBoundingClientRect().width >= r.parentElement.getBoundingClientRect().width })));
    assert.ok(s.length > 0);
    assert.ok(s.every(r => r.tag === 'BUTTON' && r.label.startsWith('Edit ')), JSON.stringify(s.slice(0, 2)));
    assert.ok(s.every(r => r.svgs === 0), 'a pencil (or other icon) is still on a row');
    assert.ok(s.every(r => r.wide), 'a row no longer spans the list');
    await page.focus('#txListContainer > .tx-row');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('editTxModal').classList.contains('hidden'));
    await page.evaluate(() => closeEditTxModal());
  });
  await step('Escape closes the Add form', async () => {
    await page.click('nav button[aria-label="Add transaction"]');
    await page.keyboard.press('Escape');
    assert.ok(!(await visible(page, '#addModal')));
  });
  // ---- Back (Android's Back gesture = the browser going back) ----
  const backState = () => page.evaluate(() => ({ depth: (history.state && history.state.pfDepth) || 0, view: document.body.dataset.view,
    add: !document.getElementById('addModal').classList.contains('hidden'), app: typeof setView === 'function' && location.pathname.endsWith('/tests/harness.html') }));
  // history.back(), then wait until the page has handled it (and any step of its own it took after).
  const backOn = async pg => {
    await pg.evaluate(() => new Promise(r => { addEventListener('popstate', () => setTimeout(r, 0), { once: true }); history.back(); }));
    await pg.waitForFunction(() => !historyMoving);
  };
  const goBack = () => backOn(page);
  await step('Back with the Add form open closes it and stays in the app', async () => {
    await page.click('nav button[aria-label="Add transaction"]');
    assert.deepStrictEqual(await backState(), { depth: 1, view: 'home', add: true, app: true });
    await goBack();
    assert.deepStrictEqual(await backState(), { depth: 0, view: 'home', add: false, app: true });
  });
  await step('Back from the Bills tab goes to Home; with a sheet open over a tab, Back closes the sheet first', async () => {
    await page.click('nav button[data-nav="budgets"]');
    assert.deepStrictEqual(await backState(), { depth: 1, view: 'budgets', add: false, app: true });
    await page.click('nav button[data-nav="activity"]');   // tab to tab: still one step
    assert.strictEqual((await backState()).depth, 1);
    await page.click('nav button[aria-label="Add transaction"]');
    assert.deepStrictEqual(await backState(), { depth: 2, view: 'activity', add: true, app: true });
    await goBack();
    assert.deepStrictEqual(await backState(), { depth: 1, view: 'activity', add: false, app: true });
    await goBack();
    assert.deepStrictEqual(await backState(), { depth: 0, view: 'home', add: false, app: true });
  });
  await step('closing a sheet with ✕, Escape or Save takes its step off too, so the next Back is not wasted', async () => {
    await page.click('nav button[aria-label="Add transaction"]');
    await page.click('#addModal button[aria-label="Close"]');
    await page.waitForFunction(() => !((history.state && history.state.pfDepth) || 0));
    await page.click('nav button[aria-label="Add transaction"]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !((history.state && history.state.pfDepth) || 0));
    await page.click('nav button[data-nav="budgets"]');
    await page.click('nav button[data-nav="home"]');   // Home by tapping: its step is taken off as well
    await page.waitForFunction(() => !((history.state && history.state.pfDepth) || 0));
    await page.click('nav button[aria-label="Add transaction"]');
    await page.fill('#inpAmount', '1.05');
    await page.fill('#inpMerchant', 'Back step shop');
    await page.click('#btnSubmitTx');   // saved: the form closes, and so does its step
    await page.waitForFunction(() => !((history.state && history.state.pfDepth) || 0) && !historyMoving && apiInflight === 0);
    await page.evaluate(() => { const a = MOCK.db.amex; a.splice(a.findIndex(r => r.desc === 'Back step shop'), 1); forceSyncSheet(); });
    // Closing one sheet and opening another straight away still leaves one step for the open one.
    await page.evaluate(() => { openAddModal(); closeAddModal(); openAddModal(); });
    await page.waitForFunction(() => (history.state && history.state.pfDepth) === 1 && !historyMoving);
    assert.deepStrictEqual(await backState(), { depth: 1, view: 'home', add: true, app: true });
    await goBack();
    assert.deepStrictEqual(await backState(), { depth: 0, view: 'home', add: false, app: true });
  });
  await step('screen readers: form boxes have labels, sheets are dialogs with a title, chosen buttons say so', async () => {
    const r = await page.evaluate(() => {
      const unlabelled = ['monthSelector', 'inpAmount', 'inpMerchant', 'editTxAmt', 'editTxDesc', 'nmName', 'nmPaycheck', 'nmSavings', 'inpBudName', 'inpBudAmt', 'txSearch']
        .filter(id => { const el = document.getElementById(id); return !(el.labels && el.labels.length) && !el.getAttribute('aria-label'); });
      const dialogs = SHEETS.map(([id]) => { const d = document.querySelector('#' + id + ' [role="dialog"]'); const t = d && document.getElementById(d.getAttribute('aria-labelledby'));
        return d && d.getAttribute('aria-modal') === 'true' && t && t.textContent.trim() ? 'ok' : id; });
      openAddModal(); selectAcct('barclays');
      const pressed = ACCTS.map(a => document.getElementById('acct_' + a).getAttribute('aria-pressed'));
      selectAcct('amex'); closeAddModal();
      const sameSheets = JSON.stringify([...document.querySelectorAll('.kb-sheet')].map(el => el.id).sort()) === JSON.stringify(SHEETS.map(([id]) => id).sort());
      const live = () => document.getElementById('toast').getAttribute('role') + '/' + document.getElementById('toast').getAttribute('aria-live');
      showToast('x', { kind: 'info' }); const info = live();
      showToast('x'); const failure = live();
      return { unlabelled, dialogs, pressed, sameSheets, current: [...document.querySelectorAll('nav [data-nav]')].map(b => b.getAttribute('aria-current')),
        toast: [info, failure] };
    });
    assert.deepStrictEqual(r, { unlabelled: [], dialogs: Array(7).fill('ok'), pressed: ['false', 'true', 'false', 'false'],
      sameSheets: true, current: ['page', null, null, null], toast: ['status/polite', 'alert/assertive'] });
    await page.click('nav button[data-nav="pending"]');
    assert.deepStrictEqual(await page.$$eval('nav [data-nav]', bs => bs.map(b => b.getAttribute('aria-current'))), [null, null, 'page', null]);
    await page.click('nav button[data-nav="home"]');
  });
  await step('after a reload with a sheet open over a tab (Sign out reloads), the first Back is not wasted', async () => {
    const { ctx: c4, page: p4 } = await open(phone);
    try {
      await p4.click('nav button[data-nav="budgets"]');
      await p4.click('nav button[aria-label="Add transaction"]');
      assert.strictEqual(await p4.evaluate(() => history.state.pfDepth), 2);
      await p4.reload();
      await p4.waitForFunction(() => typeof setView === 'function' && window.MOCK && MOCK.calls.length > 0 && !historyMoving);
      assert.strictEqual(await p4.evaluate(() => (history.state && history.state.pfDepth) || 0), 0);
      await p4.goBack();   // nothing is open, so Back leaves the app at once
      assert.ok(!p4.url().includes('harness.html'), 'still in the app after Back: ' + p4.url());
    } finally { await c4.close(); }
  });
  await step('a window widened past the phone layout on a tab drops its step, and gets it back when narrowed', async () => {
    const { ctx: c5, page: p5 } = await open(phone);
    try {
      const depth = () => p5.evaluate(() => (history.state && history.state.pfDepth) || 0);
      await p5.click('nav button[data-nav="activity"]');
      assert.strictEqual(await depth(), 1);
      await p5.setViewportSize({ width: 1280, height: 860 });
      await p5.waitForFunction(() => !historyMoving && !((history.state && history.state.pfDepth) || 0));
      await p5.setViewportSize({ width: 400, height: 860 });
      await p5.waitForFunction(() => (history.state && history.state.pfDepth) === 1);
      await backOn(p5);
      assert.strictEqual(await p5.evaluate(() => document.body.dataset.view), 'home');
    } finally { await c5.close(); }
  });
  // ---- the bill form is a sheet (like Edit Transaction), so it opens where you are ----
  await step('bills: a bill far down a long list opens its sheet in sight, and the list stays where it was', async () => {
    const { ctx: c6, page: p6 } = await open({ viewport: { width: 411, height: 847 }, deviceScaleFactor: 2.63, isMobile: true, hasTouch: true });
    try {
      await p6.evaluate(() => {
        for (let i = 0; i < 16; i++) MOCK.db.budgets.push({ row: 50 + i, name: 'Long list bill ' + i, amount: -(10 + i), originalBudget: -(10 + i), isRecurring: true });
        forceSyncSheet();
      });
      await p6.waitForFunction(() => apiInflight === 0 && state.budgets.some(b => b.name === 'Long list bill 15'));
      await p6.click('nav button[data-nav="budgets"]');
      const target = '#upcomingBudgetsList button[aria-label="Edit Long list bill 15"]';
      await p6.$eval(target, el => el.scrollIntoView({ block: 'center' }));
      const before = await p6.evaluate(() => scrollY);
      assert.ok(before > 300, 'the bill should be far down the page: ' + before);
      await p6.click(target);
      const r = await p6.evaluate(() => {
        const sheet = document.querySelector('#budgetModal [role="dialog"]').getBoundingClientRect(), amt = document.getElementById('inpBudAmt').getBoundingClientRect();
        return { y: scrollY, inSight: sheet.top >= 0 && sheet.bottom <= innerHeight + 1 && amt.top >= 0 && amt.bottom <= innerHeight,
          title: document.getElementById('budFormTitle').textContent, save: document.getElementById('budSaveBtn').textContent.trim(),
          del: !document.getElementById('budDeleteBtn').classList.contains('hidden'), amount: document.getElementById('inpBudAmt').value,
          depth: (history.state && history.state.pfDepth) || 0 };
      });
      assert.deepStrictEqual(r, { y: before, inSight: true, title: 'Edit Long list bill 15', save: 'Save Changes', del: true, amount: '25', depth: 2 });
      await backOn(p6);   // Back closes the sheet; still on the Bills tab, still scrolled where you were
      assert.deepStrictEqual(await p6.evaluate(() => [document.getElementById('budgetModal').classList.contains('hidden'), document.body.dataset.view, scrollY]), [true, 'budgets', before]);
    } finally { await c6.close(); }
  });
  await step('bills: + Add opens "Add bill" with the cursor in Amount; Enter goes to Name, Enter saves; no name says so', async () => {
    try {
      await page.click('#btnAddBill');
      const f = await page.evaluate(() => ({ title: document.getElementById('budFormTitle').textContent, save: document.getElementById('budSaveBtn').textContent.trim(),
        del: document.getElementById('budDeleteBtn').classList.contains('hidden'), focus: document.activeElement.id }));
      assert.deepStrictEqual(f, { title: 'Add bill', save: 'Save Bill', del: true, focus: 'inpBudAmt' });
      const sent = (await calls(page, 'saveBudgetItem')).length;
      await page.keyboard.type('12.50');
      await page.keyboard.press('Enter');
      assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'inpBudName');
      await page.keyboard.press('Enter');   // no name yet
      assert.strictEqual(await page.textContent('#inpBudNameErr'), 'Add a name');
      assert.strictEqual((await calls(page, 'saveBudgetItem')).length, sent, 'nothing is sent without a name');
      await page.keyboard.type('Sheet test bill');
      await page.keyboard.press('Enter');
      await page.waitForFunction(n => MOCK.calls.filter(c => c.action === 'saveBudgetItem').length === n + 1, sent);
      const sv = (await calls(page, 'saveBudgetItem')).pop();
      assert.ok(sv.name === 'Sheet test bill' && sv.amount === -12.5 && !sv.row, JSON.stringify(sv));
      assert.ok(!(await visible(page, '#budgetModal')), 'the sheet closes once saved');
    } finally {
      await page.evaluate(() => { closeBudgetForm(); const i = MOCK.db.budgets.findIndex(b => b.name === 'Sheet test bill'); if (i > -1) MOCK.db.budgets.splice(i, 1); forceSyncSheet(); });
      await page.waitForFunction(() => apiInflight === 0);
    }
  });
  await step('bills: saved, but the figures could not be read back: no failure message; the sheet is fetched and the bill shows', async () => {
    const from = errors.length;
    try {
      await failSavedNoState(page);
      await page.evaluate(() => { document.querySelector('#toast span').textContent = ''; });
      await page.click('#btnAddBill');
      await page.fill('#inpBudAmt', '9.99');
      await page.fill('#inpBudName', 'Read back bill');
      await page.click('#budSaveBtn');
      await page.waitForFunction(() => MOCK.calls.some(c => c.action === 'saveBudgetItem' && c.payload.name === 'Read back bill' && c.end) && apiInflight === 0);
      assert.strictEqual(await page.textContent('#toast span'), '', 'no message');
      await page.waitForFunction(() => apiInflight === 0 && state.budgets.some(b => b.name === 'Read back bill' && !b.pending));   // fetched afresh
      assert.strictEqual(await page.evaluate(() => MOCK.db.budgets.filter(b => b.name === 'Read back bill').length), 1);
    } finally {
      await resetFailures(page);
      await page.evaluate(() => { closeBudgetForm(); const i = MOCK.db.budgets.findIndex(b => b.name === 'Read back bill'); if (i > -1) MOCK.db.budgets.splice(i, 1); forceSyncSheet(); });
      await page.waitForFunction(() => apiInflight === 0);
      dropExpectedSyncErrors(from);
    }
  });
  await step('delete: saved, but the figures could not be read back: the "Deleted / Undo" message stays, and Undo works', async () => {
    const from = errors.length;
    try {
      await page.evaluate(() => { const a = MOCK.db.amex; a.push({ row: Math.max(...a.map(r => r.row)) + 1, desc: 'Read back delete', amount: -2.5 }); forceSyncSheet(); });
      await page.waitForFunction(() => apiInflight === 0 && state.amex.some(t => t.desc === 'Read back delete'));
      const syncs = await sheetReads(page);
      await failSavedNoState(page);
      await page.evaluate(() => { const t = state.amex.find(x => x.desc === 'Read back delete'); openEditTxModal('amex', t.row, t.desc, t.amount); });
      await page.click('#editTxModal button:has-text("Delete")');
      await page.waitForFunction(n => apiInflight === 0 && MOCK.calls.filter(c => c.action === 'getCachedSheetState').length > n, syncs);
      assert.deepStrictEqual(await toastParts(), ['Deleted "Read back delete"', 'Undo']);
      assert.ok(!(await page.evaluate(() => MOCK.db.amex.some(t => t.desc === 'Read back delete'))), 'deleted in the sheet');
      await page.click('#toastAction');
      await page.waitForFunction(() => apiInflight === 0 && MOCK.db.amex.filter(t => t.desc === 'Read back delete').length === 1);
    } finally {
      await resetFailures(page);
      await page.evaluate(() => { MOCK.db.amex = MOCK.db.amex.filter(t => t.desc !== 'Read back delete'); forceSyncSheet(); });
      await page.waitForFunction(() => apiInflight === 0);
      dropExpectedSyncErrors(from);
    }
  });
  await step('delete that fails, with Undo tapped before the reply: Undo adds nothing (no second copy)', async () => {
    const from = errors.length;
    try {
      await page.evaluate(() => { const a = MOCK.db.amex; a.push({ row: Math.max(...a.map(r => r.row)) + 1, desc: 'Failed delete', amount: -3.25 }); forceSyncSheet(); });
      await page.waitForFunction(() => apiInflight === 0 && state.amex.some(t => t.desc === 'Failed delete'));
      const adds = (await calls(page, 'addTransactionBundle')).length;
      await page.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 1; MOCK.nextLatencies = [800]; const t = state.amex.find(x => x.desc === 'Failed delete'); openEditTxModal('amex', t.row, t.desc, t.amount); });
      await page.click('#editTxModal button:has-text("Delete")');
      assert.deepStrictEqual(await toastParts(), ['Deleted "Failed delete"', 'Undo']);
      await page.click('#toastAction');   // while the delete is still on its way
      await page.waitForFunction(() => apiInflight === 0 && MOCK.calls.some(c => c.action === 'deleteTransactionRow' && c.end));
      assert.strictEqual(await page.evaluate(() => MOCK.db.amex.filter(t => t.desc === 'Failed delete').length), 1, 'a second copy was added');
      assert.strictEqual((await calls(page, 'addTransactionBundle')).length, adds, 'Undo sent a spend');
      await page.waitForFunction(() => state.amex.filter(t => t.desc === 'Failed delete' && !t.pending).length === 1 && !state.amex.some(t => t.pending));
    } finally {
      await resetFailures(page);
      await page.evaluate(() => { MOCK.db.amex = MOCK.db.amex.filter(t => t.desc !== 'Failed delete'); forceSyncSheet(); });
      await page.waitForFunction(() => apiInflight === 0);
      dropExpectedSyncErrors(from);
    }
  });
  await step('the "Open Sheet" links open only a Google Sheet, in a new tab with no link back', async () => {
    const r = await page.evaluate(() => {
      const before = document.getElementById('rawSheetBtn').href;
      applyServerState({ ...state, sheetUrl: 'javascript:alert(1)' });
      const bad = document.getElementById('rawSheetBtn').href;
      applyServerState({ ...state, sheetUrl: 'https://docs.google.com/spreadsheets/d/x/edit#gid=1' });
      return { kept: bad === before, good: document.getElementById('rawSheetMenuBtn').href,
        rel: ['rawSheetBtn', 'rawSheetMenuBtn'].map(id => document.getElementById(id).rel) };
    });
    assert.deepStrictEqual(r, { kept: true, good: 'https://docs.google.com/spreadsheets/d/x/edit#gid=1', rel: ['noopener noreferrer', 'noopener noreferrer'] });
  });
  await step('bills: the sheet fits a 344px phone (no label wraps), every button has a 44px hit area, boxes are 44px tall', async () => {
    const { ctx: c7, page: p7 } = await open({ viewport: { width: 344, height: 740 }, isMobile: true, hasTouch: true });
    try {
      await p7.evaluate(() => { const b = state.budgets.find(x => !x.pending); openBudgetFormForRow(b.row); });
      const lines = await lineCounts(p7, ['#budFormTitle', '#btype_event', '#btype_bill', '#bsign_neg', '#bsign_pos', 'label[for="inpBudAmt"]', 'label[for="inpBudName"]', '#budDeleteBtn', '#budSaveBtn']);
      assert.deepStrictEqual(lines.filter(x => !/:1$/.test(x)), [], lines.join(' '));
      const hits = await hitAreas(p7, '#budgetModal button');   // sizes only: the rounded corners don't count as misses
      assert.ok(hits.count >= 7 && !hits.bad.filter(x => / is \d/.test(x)).length, JSON.stringify(hits));
      const boxes = await p7.$$eval('#budgetModal input:not([type="hidden"])', els => els.map(e => Math.round(e.getBoundingClientRect().height)));
      assert.ok(boxes.every(h => h >= 44), 'boxes: ' + boxes);
      assert.strictEqual(await p7.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'scrolls sideways');
    } finally { await c7.close(); }
  });
  await step('Add and Edit spend sheets: toggles, cards, Save and Delete are 44px like the bill sheet, and fit at 344px', async () => {
    const { ctx: c8, page: p8 } = await open({ viewport: { width: 344, height: 740 }, isMobile: true, hasTouch: true });
    try {
      const sizesOk = async sel => { const h = await hitAreas(p8, sel); return [h.count, h.bad.filter(x => / is \d/.test(x))]; };
      await p8.evaluate(() => openAddModal());
      assert.deepStrictEqual(await sizesOk('#addModal [id^="dir_"], #addModal [id^="acct_"], #btnSubmitTx'), [7, []]);
      let lines = await lineCounts(p8, ['#dir_spend', '#dir_refund', '#acct_checking', '#btnSubmitTx']);
      await p8.evaluate(() => { closeAddModal(); const r = state.amex.find(x => !x.pending && x.desc !== 'start') || state.checking.find(x => x.desc !== 'start'); openEditTxModal(state.amex.includes(r) ? 'amex' : 'checking', r.row, r.desc, r.amount); });
      assert.deepStrictEqual(await sizesOk('#editTxModal [id^="etsign_"], #editTxModal [id^="etx_"], #btnSaveEditTx, #editTxModal button[data-action="deleteCurrentTx"]'), [8, []]);
      lines = lines.concat(await lineCounts(p8, ['#etsign_neg', '#etsign_pos', '#etx_checking', '#btnSaveEditTx']));
      assert.deepStrictEqual(lines.filter(x => !/:1$/.test(x)), [], lines.join(' '));
    } finally { await c8.close(); }
  });
  // The Add sheet's small split controls (Jon kept their look, 2026-11-08): each has a hidden tap area of at least
  // 24px (as big as it can be, up to 44px, without reaching a neighbour), and adding it changes nothing on screen.
  const SMALL_TAPS = { equal: '#customSplitBox button[data-action="applyEqualGroupSplit"]', includeMe: '#customSplitBox label:has(#chkEqualIncludeMe)',
    remove: '#dynamicSplitRows button[data-action="removePersonRow"]', owed: '#needToggleWrap' };
  // Where each one's tap area is (from its ::after), and every way it could go wrong: too small, a point in it that
  // doesn't reach it, overlapping another control, or taking a tap from one.
  const smallTaps = page => page.evaluate(sels => {
    const out = { sizes: {}, bad: [], boxes: {} };
    const controls = Object.entries(sels).flatMap(([k, sel]) => [...document.querySelectorAll(sel)].map((el, i) => [k + i, el]));
    const others = [...document.querySelectorAll('#addModal :is(button, input, label, select, textarea, a)')]
      .filter(el => el.getClientRects().length && !controls.some(([, c]) => c === el || c.contains(el) || el.contains(c)));
    const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const tapBoxes = controls.map(([k, el]) => {
      const b = el.getBoundingClientRect(), a = getComputedStyle(el, '::after');
      const w = Math.max(b.width, a.content !== 'none' ? parseFloat(a.width) : 0), h = Math.max(b.height, a.content !== 'none' ? parseFloat(a.height) : 0);
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const box = { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
      out.sizes[k] = Math.round(w) + 'x' + Math.round(h);
      out.boxes[k] = box;
      if (w < 24 || h < 24) out.bad.push(k + ' is only ' + out.sizes[k]);
      sample: for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
        const x = box.left + 0.5 + (w - 1) * i / 6, y = box.top + 0.5 + (h - 1) * j / 6, hit = document.elementFromPoint(x, y);
        if (!hit || !el.contains(hit)) { out.bad.push(k + ' misses at ' + Math.round(x) + ',' + Math.round(y) + ' (hits ' + (hit ? hit.tagName + '#' + hit.id : 'nothing') + ')'); break sample; }
      }
      return [k, el, box];
    });
    for (const [k, , box] of tapBoxes) {
      for (const [k2, , box2] of tapBoxes) if (k < k2 && overlap(box, box2)) out.bad.push(k + ' overlaps ' + k2);
      for (const o of others) if (overlap(box, o.getBoundingClientRect())) out.bad.push(k + ' overlaps ' + o.tagName + '#' + o.id + '.' + String(o.className).slice(0, 20));
    }
    // A tick box inside one of them still takes a tap on itself (not the label's area drawn over it).
    for (const [k, el] of controls) for (const box of el.querySelectorAll('input')) {
      const r = box.getBoundingClientRect();
      if (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== box) out.bad.push(k + ' covers its own tick box');
    }
    // Every other control still gets every tap on itself (sampled over its own box).
    for (const o of others) {
      const r = o.getBoundingClientRect();
      sample: for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
        const x = r.left + 1 + (r.width - 2) * i / 4, y = r.top + 1 + (r.height - 2) * j / 4, hit = document.elementFromPoint(x, y);
        const thief = hit && tapBoxes.find(([, el]) => el.contains(hit));
        if (thief) { out.bad.push(thief[0] + ' takes a tap meant for ' + o.tagName + '#' + o.id); break sample; }
      }
    }
    return out;
  }, SMALL_TAPS);
  // Every element's place in the Add sheet, to compare with and without the tap areas.
  const addSheetLayout = page => page.evaluate(() => {
    const d = document.querySelector('#addModal [role="dialog"]');
    return [d.scrollHeight, ...[d, ...d.querySelectorAll('*')].map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(v => Math.round(v * 10) / 10).join(','); })];
  });
  // Where two screenshots of the Add sheet differ: how many pixels, the box round them (page px), the biggest colour
  // difference, and what is drawn there. A difference of up to 8 (of 255) in a colour is too small to see, and Linux
  // Chrome's software drawing makes such specks (it gave 2 at most on GitHub's runner); anything visible is far more.
  const SPECK = 8;
  const pictureDiff = (page, a, b) => page.evaluate(async ([a, b, speck]) => {
    const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const px = i => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
    const da = px(ia), db = px(ib), d = document.querySelector('#addModal [role="dialog"]').getBoundingClientRect();
    let n = 0, max = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let p = 0; p < da.length; p += 4) {
      const m = Math.max(Math.abs(da[p] - db[p]), Math.abs(da[p + 1] - db[p + 1]), Math.abs(da[p + 2] - db[p + 2]));
      if (m <= speck) continue;
      const x = (p / 4) % ia.width, y = Math.floor(p / 4 / ia.width);
      n++; max = Math.max(max, m); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (!n) return '';
    const at = document.elementFromPoint(d.left + (x0 + x1) / 2, d.top + (y0 + y1) / 2);
    return n + ' px differ (max ' + max + ') in ' + [x0 + d.left, y0 + d.top, x1 + d.left, y1 + d.top].map(Math.round).join(',') + ' at ' + (at ? at.tagName + '#' + at.id + '.' + String(at.className).slice(0, 30) : 'nothing');
  }, [a.toString('base64'), b.toString('base64'), SPECK]);
  for (const w of [411, 344]) {
    await step(`${w}px Add sheet, group split: the small split controls have tap areas of 24px+ that reach only them`, async () => {
      const { ctx: c9, page: p9 } = await open({ viewport: { width: w, height: 960 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
      // The Add sheet with £30 split between Kim and Lee (and me).
      const openSplit = async () => {
        await p9.evaluate(() => { closeAddModal(); openAddModal(); document.getElementById('inpAmount').value = '30'; selectSplit('custom'); });
        await p9.click('#chip_lee');
        await p9.evaluate(() => document.activeElement.blur());
      };
      try {
        await openSplit();
        const t = await smallTaps(p9);
        assert.deepStrictEqual(t.bad, [], JSON.stringify(t.sizes));
        // The heights each one is given (widths follow the wording; the ✕ is 32px both ways).
        assert.deepStrictEqual(Object.entries(t.sizes).map(([k, v]) => k + ' ' + (k.startsWith('remove') ? v : v.split('x')[1])),
          ['equal0 36', 'includeMe0 36', 'remove0 32x32', 'remove1 32x32', 'owed0 44']);

        // A tap at the very edge of each tap area (outside the control as drawn) does that control's job.
        const edge = async (k, where) => {
          const { boxes } = await smallTaps(p9), b = boxes[k];
          const pt = { top: [(b.left + b.right) / 2, b.top + 1], bottom: [(b.left + b.right) / 2, b.bottom - 1], left: [b.left + 1, (b.top + b.bottom) / 2] }[where];
          await p9.touchscreen.tap(pt[0], pt[1]);
        };
        await p9.fill('#dynamicSplitRows .split-amt', '5');
        assert.strictEqual(await p9.inputValue('#dynamicSplitRows .split-amt'), '5');
        await edge('equal0', 'top');
        assert.deepStrictEqual(await p9.$$eval('#dynamicSplitRows .split-amt', i => i.map(x => x.value)), ['10', '10'], 'Split Equally');
        const tick = id => p9.evaluate(i => document.getElementById(i).checked, id);
        const me = await tick('chkEqualIncludeMe');
        await edge('includeMe0', 'bottom');
        assert.strictEqual(await tick('chkEqualIncludeMe'), !me, 'Include me');
        const owed = await tick('chkNeed');
        await edge('owed0', 'top');
        assert.strictEqual(await tick('chkNeed'), !owed, 'Add to "Owed"');
        await edge('remove1', 'left');
        assert.deepStrictEqual(await p9.$$eval('#dynamicSplitRows .split-name', i => i.map(x => x.value)), ['kim'], 'the ✕ by Lee');

        // Nothing on screen changes: the same layout and the same picture with the tap areas taken away (last, as the
        // controls written into the page keep their classes off until it reloads).
        await openSplit();
        const sheet = p9.locator('#addModal [role="dialog"]');
        const withTaps = [await addSheetLayout(p9), await sheet.screenshot()];
        await p9.evaluate(sels => Object.values(sels).forEach(sel => document.querySelectorAll(sel).forEach(el => el.classList.remove('hit', 'hit-36', 'hit-32'))), SMALL_TAPS);
        assert.ok(/x16$/.test((await smallTaps(p9)).sizes.owed0), 'the tap areas were not taken away');
        assert.deepStrictEqual(await addSheetLayout(p9), withTaps[0], 'the tap areas move something in the Add sheet');
        const diff = await pictureDiff(p9, withTaps[1], await sheet.screenshot());
        assert.ok(!diff, 'the tap areas change how the Add sheet looks: ' + diff);
      } finally { await c9.close(); }
    });
  }
  await step('bills: a tap outside the sheet does not close it (what was typed is kept)', async () => {
    try {
      await page.click('#btnAddBill');
      await page.keyboard.type('7');
      await page.mouse.click(5, 5);   // the dimmed area above the sheet
      assert.ok(await visible(page, '#budgetModal'), 'the sheet closed');
      assert.strictEqual(await page.inputValue('#inpBudAmt'), '7');
    } finally { await page.evaluate(() => closeBudgetForm()); }
  });
  await step('bills: Restore of a paid bill with no remembered amount puts the cursor in Amount', async () => {
    try {
      await page.evaluate(() => openBudgetForm(4, 'Some bill', 0, true));
      assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'inpBudAmt');
      await page.evaluate(() => { closeBudgetForm(); document.activeElement.blur(); openBudgetForm(4, 'Some bill', -20, true); });
      assert.notStrictEqual(await page.evaluate(() => document.activeElement.id), 'inpBudAmt', 'editing a bill with an amount should not pop the keyboard');
    } finally { await page.evaluate(() => closeBudgetForm()); }
  });
  await ctx.close();

  // ---------------- layout: widths, wrapping, hit areas, contrast ----------------
  const VIEWS = ['home', 'budgets', 'pending', 'activity'];
  // Jon's Galaxy Z Fold 7 in Chrome, measured: folded 411 x 847, unfolded 749 x 638 CSS px, pixel ratio 2.63.
  // The unfolded layout starts at 720px (index.html), so that edge is checked at the unfolded height too.
  const UNFOLD_FROM = 720, UNFOLDED = 749, FOLD_DPR = 2.63;
  for (const [w, h, scheme] of [[344, 860, 'dark'], [400, 860, 'light'], [411, 847, 'dark'], [UNFOLD_FROM, 638, 'dark'], [UNFOLDED, 638, 'light']]) {
    const dpr = w === 411 || w >= UNFOLD_FROM ? { deviceScaleFactor: FOLD_DPR } : {};
    ({ ctx, page } = await open({ viewport: { width: w, height: h }, ...dpr, isMobile: true, hasTouch: true, colorScheme: scheme }));
    await page.evaluate(SEED_OWED);
    await step(`${w}px: no sideways scroll and no balance spills out, on every tab`, async () => {
      const found = [];
      for (const v of VIEWS) {
        await page.evaluate(x => setView(x), v);
        const m = await noSideways(page);
        if (m.sideways || m.kpi.length) found.push(v + ' ' + JSON.stringify(m));
      }
      await page.evaluate(() => setView('home'));
      assert.deepStrictEqual(found, []);
    });
    await step(`${w}px: the changed labels each fit on one line`, async () => {
      const sels = ['#budLeftVal', '#heroNote', '#sumPending', '#budClearedCount', '#txListContainer > button:not(.tx-row)', '.owed-summary .text-xs'];
      await page.evaluate(() => { markBudgetPaid(state.budgets.find(b => Number(b.amount) < 0).row); });
      await page.waitForFunction(() => !state.budgets.some(b => b.pending));
      let lines = await lineCounts(page, sels.concat('#paidFold summary > span:first-child'));
      await page.evaluate(() => setView('pending'));
      lines = lines.concat(await lineCounts(page, ['#pill_pending', '#pill_settled', '#btnSettleAll', '.owed-groups span.block.text-xs']));
      await page.evaluate(() => setView('home'));
      assert.deepStrictEqual(lines.filter(x => !/:1$/.test(x)), [], lines.join(' '));
    });
    if (w === 344) {
      await step('344px: each red sync caption fits on one line, with no sideways scroll', async () => {
        await page.waitForFunction(() => apiInflight === 0);   // a request in flight would show "syncing" instead
        const r = await page.evaluate(() => Object.keys(SYNC_FAILED).map(k => {
          const saved = localStorage.getItem(OUTBOX_KEY);
          if (k === 'setAside') saveOutbox([{ id: 'fit1', payload: { merchant: 'x' }, setAside: 'test' }]); else lastSyncFailed = k;
          updateSyncUi();
          const n = document.getElementById('syncStatus'), rg = document.createRange(); rg.selectNodeContents(n);
          const out = { k, shown: !n.classList.contains('hidden'), fits: rg.getBoundingClientRect().right <= innerWidth - 14, sideways: document.documentElement.scrollWidth > innerWidth };
          lastSyncFailed = null;
          if (saved === null) localStorage.removeItem(OUTBOX_KEY); else localStorage.setItem(OUTBOX_KEY, saved);
          updateSyncUi();
          return out;
        }));
        assert.strictEqual(r.length, 3, JSON.stringify(r));
        assert.ok(r.every(x => x.shown && x.fits && !x.sideways), JSON.stringify(r));
      });
      await step('344px: Spending shows full amounts (pounds and pence); four big month figures each fit their own bar', async () => {
        const out = await monthBars(page);
        assert.strictEqual(out.length, 4, JSON.stringify(out));
        assert.ok(out.every(o => o.text === '£1,234.56' && o.lines === 1 && o.fits), JSON.stringify(out));
        await page.evaluate(() => setView('activity'));
        const chips = await page.$$eval('#actSpend button[data-cat] .tabular-nums', els => els.map(e => e.textContent));
        await page.evaluate(() => setView('home'));
        assert.ok(chips.length && chips.every(t => /^£[\d,]+\.\d\d$/.test(t)), JSON.stringify(chips));
      });
      await step('344px: the Bills header wording for every sign, never with a minus, on one line', async () => {
        const r = await page.evaluate(() => {
          const saved = state.budgets;
          const show = list => { state.budgets = list; renderAll(); return document.getElementById('budLeftVal').textContent; };
          const out = {
            out: show([{ row: 90, name: 'Rent', amount: -12345.67, isRecurring: true }]),
            none: show([{ row: 90, name: 'Rent', amount: 0, originalBudget: -500, isRecurring: true }]),
            evens: show([{ row: 90, name: 'Out', amount: -50, isRecurring: false }, { row: 91, name: 'In', amount: 50, isRecurring: false }]),
            in: show([{ row: 90, name: 'Refund', amount: 12345.67, isRecurring: false }]),
          };
          const rg = document.createRange(); rg.selectNodeContents(document.getElementById('budLeftVal'));
          out.lines = new Set([...rg.getClientRects()].map(x => Math.round(x.top))).size;
          state.budgets = saved; renderAll();
          return out;
        });
        assert.deepStrictEqual(r, { out: '£12,345.67 to pay', none: 'Nothing to pay', evens: 'Nothing to pay', in: '+£12,345.67 to come in', lines: 1 });
      });
    }
    if (w === 400) {
      await step('400px: small buttons have hit areas of at least 44x44px that reach them and do not overlap', async () => {
        const report = [];
        const check = async (sel, min) => {
          const h = await hitAreas(page, sel);
          assert.ok(h.count >= min, sel + ': expected at least ' + min + ', found ' + h.count);
          report.push(sel + ' ' + [...new Set(h.sizes)].join(','));
          return h.bad;
        };
        await page.waitForFunction(() => MOCK.calls.every(c => c.end) && !state.budgets.some(b => b.pending));
        let bad = [];
        bad = bad.concat(await check('#upcomingBudgetsList button[aria-label^="Mark "]', 6));
        bad = bad.concat(await check('#bf_all, #bf_recurring, #bf_events', 3));
        bad = bad.concat(await check('#btnAddBill', 1));
        bad = bad.concat(await check('#chevBudgets, #chevPending, #chevActivity', 3));
        await page.evaluate(() => setView('pending'));
        bad = bad.concat(await check('.owed-groups button[aria-label$=" paid back"]', 10));
        bad = bad.concat(await check('#pill_pending, #pill_settled, #btnSettleAll', 3));
        bad = bad.concat(await check('.owed-groups button[data-action="handleSettlePerson"]', 3));
        await page.evaluate(() => setView('budgets'));
        await page.evaluate(() => { document.getElementById('paidFold').open = true; });
        bad = bad.concat(await check('#clearedBudgetsList button:not([aria-label])', 1));
        await page.evaluate(() => setView('activity'));
        bad = bad.concat(await check('#txFilterBtn', 1));
        await page.click('#txFilterBtn');
        bad = bad.concat(await check('#txFilters button', 5));
        await page.click('#txf_amex');
        await page.click('#txFilterBtn');
        bad = bad.concat(await check('#txActive button', 1));
        await page.click('#txActive button');
        bad = bad.concat(await check('#actSpend button[data-cat]', 2));
        await page.evaluate(() => setView('home'));
        console.log('      hit areas: ' + report.join(' | '));
        assert.deepStrictEqual(bad, []);
      });
    }
    if (w < UNFOLD_FROM) {
      await step(`${w}px ${scheme}: the small captions read at a contrast of at least 4.5:1`, async () => {
        const sels = ['#syncText', '#budClearedCount', '.owed-summary .text-xs'];
        const r = [];
        await page.evaluate(() => { lastSyncFailed = 'reach'; updateSyncUi(); });   // the red caption
        for (const s of sels) r.push([s, await contrastOf(page, s)]);
        await page.evaluate(() => { lastSyncFailed = null; updateSyncUi(); });
        await page.evaluate(() => setView('pending'));
        r.push(['.owed-groups span.block.text-xs', await contrastOf(page, '.owed-groups span.block.text-xs')]);
        await page.evaluate(() => setView('home'));
        console.log('      contrast ' + scheme + ': ' + r.map(x => x.join(' ')).join(', '));
        assert.deepStrictEqual(r.filter(x => x[1] < 4.5), []);
      });
    }
    if (w < UNFOLD_FROM) {
      await step(`${w}px: account cards 2x2 and one column of sections`, async () => {
        assert.deepStrictEqual(await layoutShape(page), { cardRows: 2, cols: 1 });
      });
    }
    if (w === UNFOLD_FROM) {
      await step(`the unfolded layout starts at exactly ${UNFOLD_FROM}px (${UNFOLD_FROM - 1}px is still the phone layout)`, async () => {
        await page.setViewportSize({ width: UNFOLD_FROM - 1, height: h });
        const below = await layoutShape(page);
        await page.setViewportSize({ width: UNFOLD_FROM, height: h });
        assert.deepStrictEqual(below, { cardRows: 2, cols: 1 });
      });
    }
    if (w >= UNFOLD_FROM) {
      await step(`${w}px (unfolded): the biggest balances still fit 4 cards across`, async () => {
        await page.evaluate(() => document.querySelectorAll('#tilesSection .kpi-figure').forEach(e => { e.textContent = '−£99,999.99'; }));
        const m = await noSideways(page);
        await page.evaluate(() => renderAll());
        assert.deepStrictEqual(m.kpi, [], JSON.stringify(m));
      });
      await step(`${w}px (unfolded): 4 account cards across; Bills beside Owed + Activity; one column on a tab`, async () => {
        assert.deepStrictEqual(await layoutShape(page), { cardRows: 1, cols: 2 });
        const r = await page.evaluate(() => Object.fromEntries(['sec_budgets', 'sec_pending', 'sec_activity'].map(id => { const b = document.getElementById(id).getBoundingClientRect(); return [id, { l: Math.round(b.left), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width) }]; })));
        assert.ok(r.sec_pending.l > r.sec_budgets.l + 100 && r.sec_pending.t === r.sec_budgets.t, JSON.stringify(r));
        assert.ok(r.sec_activity.l === r.sec_pending.l && r.sec_activity.t > r.sec_pending.b && r.sec_activity.t - r.sec_pending.b <= 20, 'Activity should follow Owed: ' + JSON.stringify(r));
        await page.evaluate(() => setView('budgets'));
        const full = await page.evaluate(() => Math.round(document.getElementById('sec_budgets').getBoundingClientRect().width));
        await page.evaluate(() => setView('home'));
        assert.ok(full > r.sec_budgets.w * 1.8, 'the Bills tab should use the full width: ' + full);
      });
    }
    await ctx.close();
  }

  // ---------------- review fixes (desktop) ----------------
  ({ ctx, page } = await open(desk));
  await step('"All paid back" while a spend is still saving leaves that one alone (no made-up row numbers)', async () => {
    await page.evaluate(() => {
      MOCK.latency = 1500;
      openAddModal();
      document.getElementById('inpMerchant').value = 'Saving now';
      document.getElementById('inpAmount').value = '30';
      selectSplit('half');
      submitExpense();
    });
    await page.click('#btnSettleAll');
    await page.waitForTimeout(3500);
    await page.evaluate(() => { MOCK.latency = 50; });
    const s = (await calls(page, 'settleAllNeeds')).pop();
    assert.ok(s && s.rows.length === 3 && s.rows.every(r => r < 98), 'rows sent: ' + JSON.stringify(s));
    assert.ok(Array.isArray(s.expect) && s.expect.length === 3 && s.expect.every(e => /^robin /.test(e.desc) && typeof e.amount === 'number'), JSON.stringify(s.expect));
    const still = await page.evaluate(() => state.checking.find(r => r.desc === 'kim Saving now'));
    assert.ok(still && still.need && !still.pending, 'the new item should still be owed once saved: ' + JSON.stringify(still));
  });

  await step('owed: ticking one item sends what that row held', async () => {
    await page.click('.owed-groups button[aria-label="Mark Kim Saving now paid back"]');
    await page.waitForTimeout(250);
    const t = (await calls(page, 'toggleNeedFlag')).pop();
    assert.ok(t && t.setNeed === false && t.expect && t.expect.desc === 'kim Saving now' && t.expect.amount === 15, JSON.stringify(t));
  });

  await step('bills: Paid, edit and delete send what the bill held', async () => {
    await page.click('#upcomingBudgetsList button[aria-label="Mark Groceries wk 1 paid"]');
    await page.waitForTimeout(250);
    const u = (await calls(page, 'updateBudgetRow')).pop();
    assert.ok(u && u.expect && u.expect.name === 'Groceries wk 1' && u.expect.amount === -45, JSON.stringify(u));
    await page.click('#upcomingBudgetsList button[aria-label="Edit Fuel wk 2"]');
    await page.fill('#inpBudAmt', '36');
    await page.click('#budSaveBtn');
    await page.waitForTimeout(250);
    const sv = (await calls(page, 'saveBudgetItem')).pop();
    assert.ok(sv && sv.amount === -36 && sv.expect && sv.expect.name === 'Fuel wk 2' && sv.expect.amount === -35, JSON.stringify(sv));
    await page.click('#upcomingBudgetsList button[aria-label="Edit Groceries wk 3"]');
    await page.click('#budDeleteBtn');
    await page.waitForTimeout(250);
    const dl = (await calls(page, 'deleteBudgetItem')).pop();
    assert.ok(dl && dl.expect && dl.expect.name === 'Groceries wk 3' && dl.expect.amount === -45, JSON.stringify(dl));
  });

  // These tests make the server refuse a save on purpose: the refusal must have happened, and is not a page error.
  const dropExpectedStale = () => {
    const i = errors.findIndex(e => /STALE: This entry was changed on another device/.test(e));
    assert.ok(i > -1, 'the server did not refuse the stale save');
    errors.splice(i, 1);
  };
  // The figures can refresh while a form is open (another save's reply, coming back to the app). If the row now holds
  // something else, the save must still be checked against what the form showed, so the server refuses it.
  await step('edit form left open while the row changes underneath: checked against what the form showed', async () => {
    const before = await page.evaluate(() => { const r = state.amex.find(x => !x.pending); openEditTxForRow('amex', r.row); return { row: r.row, desc: r.desc, amount: r.amount }; });
    await page.evaluate(row => { MOCK.db.amex.find(r => r.row === row).desc = 'Someone else spend'; forceSyncSheet(); }, before.row);
    await page.waitForFunction(row => state.amex.some(r => r.row === row && r.desc === 'Someone else spend'), before.row);
    await page.fill('#editTxDesc', 'Mine edited');
    await page.click('#editTxModal button:has-text("Save")');
    await page.waitForTimeout(400);
    const e = (await calls(page, 'editOrMoveTransaction')).pop();
    assert.deepStrictEqual(e.expect, { desc: before.desc, amount: before.amount }, JSON.stringify(e));
    assert.strictEqual(await page.evaluate(row => MOCK.db.amex.find(r => r.row === row).desc, before.row), 'Someone else spend', 'the other entry was overwritten');
    await page.waitForFunction(row => state.amex.some(r => r.row === row && r.desc === 'Someone else spend'), before.row);
    dropExpectedStale();
  });
  await step('bill form left open while the bill changes underneath: checked against what the form showed', async () => {
    const b = await page.evaluate(() => { const x = state.budgets.find(y => !y.pending && Number(y.amount) !== 0); openBudgetFormForRow(x.row); return { row: x.row, name: x.name, amount: Number(x.amount) }; });
    await page.evaluate(row => { MOCK.db.budgets.find(r => r.row === row).name = 'Changed elsewhere'; forceSyncSheet(); }, b.row);
    await page.waitForFunction(row => state.budgets.some(r => r.row === row && r.name === 'Changed elsewhere'), b.row);
    await page.click('#budDeleteBtn');
    await page.waitForTimeout(300);
    const dl = (await calls(page, 'deleteBudgetItem')).pop();
    assert.deepStrictEqual(dl.expect, { name: b.name, amount: b.amount }, JSON.stringify(dl));
    assert.ok(await page.evaluate(row => state.budgets.some(r => r.row === row && r.name === 'Changed elsewhere'), b.row), 'the other bill was taken off the screen');
    assert.ok(await page.evaluate(row => MOCK.db.budgets.some(r => r.row === row && r.name === 'Changed elsewhere'), b.row), 'the other bill was deleted on the server');
    dropExpectedStale();
  });
  await step('delete from an edit form whose row has since changed: refused, and no Undo that would add a copy', async () => {
    const before = await page.evaluate(() => { const r = state.amex.find(x => !x.pending); openEditTxForRow('amex', r.row); return { row: r.row, desc: r.desc }; });
    await page.evaluate(row => { MOCK.db.amex.find(r => r.row === row).desc = 'Changed again'; forceSyncSheet(); }, before.row);
    await page.waitForFunction(row => state.amex.some(r => r.row === row && r.desc === 'Changed again'), before.row);
    await page.evaluate(() => { MOCK.nextLatencies = [800]; });   // the refusal arrives later, so the first toast is seen
    await page.click('#editTxModal button:has-text("Delete")');
    assert.ok(!/Deleted/.test(await page.textContent('#toast')), 'offered Undo for a delete the server refuses');
    await page.waitForFunction(() => MOCK.calls.some(c => c.action === 'deleteTransactionRow' && c.end));
    assert.ok(await page.evaluate(row => MOCK.db.amex.some(r => r.row === row && r.desc === 'Changed again'), before.row), 'the other entry was deleted');
    dropExpectedStale();
  });
  await step('a saved copy of one month stored under another month name is never shown', async () => {
    await page.evaluate(() => { localStorage.setItem('pf_cache_' + MOCK.MONTH2, JSON.stringify(state)); MOCK.nextLatencies = [1200]; switchMonth(MOCK.MONTH2); });
    assert.strictEqual(await page.evaluate(() => state.amex.length), 0, "the other month's rows were shown");
    await page.waitForFunction(() => state.activeMonth === MOCK.MONTH2 && state.amex.length > 0, null, { timeout: 5000 });
    await page.evaluate(() => switchMonth(MOCK.MONTH));
    await page.waitForFunction(() => state.activeMonth === MOCK.MONTH, null, { timeout: 5000 });
  });
  await step('switching to a month with nothing saved shows it empty until it arrives, never the old rows', async () => {
    await page.evaluate(() => { localStorage.removeItem('pf_cache_' + MOCK.MONTH2); MOCK.nextLatencies = [1200]; switchMonth(MOCK.MONTH2); });
    const s = await page.evaluate(() => ({ rows: document.querySelectorAll('#txListContainer > .tx-row').length, amex: state.amex.length, bills: state.budgets.length }));
    assert.deepStrictEqual(s, { rows: 0, amex: 0, bills: 0 }, JSON.stringify(s));
    await page.waitForFunction(() => activeMonth === MOCK.MONTH2 && state.activeMonth === MOCK.MONTH2 && state.amex.length > 0, null, { timeout: 5000 });
    await page.evaluate(() => switchMonth(MOCK.MONTH));
    await page.waitForFunction(() => state.activeMonth === MOCK.MONTH, null, { timeout: 5000 });
  });
  await step('a saved copy is only ever kept under its own month', async () => {
    const ok = await page.evaluate(() => {
      savePhoneCache('Some Other Month', state, false);
      return !localStorage.getItem('pf_cache_Some Other Month');
    });
    assert.ok(ok, "this month's figures were saved under another month's name");
  });
  await step('Fingerprint dialog: "Remove" arms at once without reloading the list, and sends the device id as data', async () => {
    await page.evaluate(() => openPasskeyModal());
    await page.waitForFunction(() => /Test phone/.test(document.getElementById('pkDevices').textContent));
    const before = (await calls(page, 'passkeyList')).length;
    await page.click('#pkDevices button:has-text("Remove")');
    assert.ok(await page.isVisible('#pkDevices button:has-text("Tap again")'), 'not armed straight away');
    assert.strictEqual((await calls(page, 'passkeyList')).length, before, 'arming fetched the list again');
    await page.click('#pkDevices button:has-text("Tap again")');
    await page.waitForTimeout(300);
    assert.strictEqual(await page.evaluate(() => sessionStorage.getItem('mock_passkey_removed')), "dev'1");
    await page.evaluate(() => closePasskeyModal());
  });

  await step('bills: Undo after deleting a paid bill brings it back paid, with its amount kept', async () => {
    const b = await page.evaluate(() => { const x = state.budgets.find(y => !y.pending && Number(y.amount) !== 0); return { row: x.row, name: x.name, amount: Number(x.amount) }; });
    await page.evaluate(row => markBudgetPaid(row), b.row);
    await page.waitForFunction(row => state.budgets.some(y => y.row === row && !y.pending && Number(y.amount) === 0), b.row);
    await page.evaluate(row => removeBudgetRow(row), b.row);
    await page.click('#toastAction');
    await page.waitForFunction(name => MOCK.calls.some(c => c.action === 'saveBudgetItem' && c.payload.name === name && c.end), b.name);
    const sv = (await calls(page, 'saveBudgetItem')).pop();
    assert.ok(sv.paid === true && sv.amount === b.amount && sv.row === null, JSON.stringify(sv));
    const back = await page.evaluate(name => state.budgets.find(y => y.name === name), b.name);
    assert.ok(back && Number(back.amount) === 0 && Number(back.originalBudget) === b.amount, JSON.stringify(back));
  });
  await step('bills: Restore on a paid bill with no remembered amount asks for the amount instead of guessing', async () => {
    await page.evaluate(() => { MOCK.db.budgets.push({ row: 30, name: 'No amount bill', amount: 0, originalBudget: 0, isRecurring: false }); forceSyncSheet(); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { document.querySelector('#clearedBudgetsList').closest('details').open = true; });
    const before = (await calls(page, 'updateBudgetRow')).length;
    await page.click('#clearedBudgetsList > div:has-text("No amount bill") button:has-text("Restore")');
    assert.ok(await visible(page, '#budgetModal'), 'the edit form should open');
    assert.strictEqual(await page.inputValue('#inpBudName'), 'No amount bill');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'inpBudAmt', 'the cursor should be in Amount, ready for it');
    assert.strictEqual((await calls(page, 'updateBudgetRow')).length, before, 'should not save a guessed amount');
    await page.click('#budgetModal button[aria-label="Close"]');
  });

  await step('split chips come from the names the server sends (Marcus keeps its own colour)', async () => {
    await page.evaluate(() => { openAddModal(); selectSplit('custom'); });
    const ids = await page.$$eval('#personChips button[id^="chip_"]', b => b.map(x => x.id));
    assert.deepStrictEqual(ids, ['chip_kim', 'chip_lee', 'chip_robin', 'chip_sam', 'chip_jo', 'chip_marcus']);
    assert.ok((await page.getAttribute('#chip_kim', 'class')).includes('bg-emerald-500'), 'the quick-split person is picked by default');
    assert.ok((await page.getAttribute('#chip_marcus', 'class')).includes('text-amber-600'));
    await page.click('#chip_lee');
    assert.deepStrictEqual(await page.$$eval('#dynamicSplitRows .split-name', i => i.map(x => x.value)), ['kim', 'lee']);
    await page.evaluate(() => closeAddModal());
  });

  await step('the quick-split buttons are named by the server, and a local shop word from it picks the category', async () => {
    await page.evaluate(() => openAddModal());
    assert.strictEqual((await page.textContent('#sp_half')).trim(), 'Half w/ Kim');
    assert.strictEqual((await page.textContent('#sp_all')).trim(), "All Kim's");
    assert.ok(await visible(page, '#sp_half') && await visible(page, '#sp_all'));
    await page.evaluate(() => closeAddModal());
    assert.strictEqual(await page.evaluate(() => categoryFor('Bowling alley', {})), 'Entertainment');
    assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('pf_config')).quickSplit), 'kim', 'names are not kept on this device');
  });

  await step('a reply arriving while you type a split amount does not interrupt the typing', async () => {
    await page.evaluate(() => { openAddModal(); selectSplit('custom'); });
    await page.click('#dynamicSplitRows .split-amt');
    await page.keyboard.type('1');
    await page.evaluate(() => forceSyncSheet());
    await page.waitForTimeout(400);
    await page.keyboard.type('2');
    assert.strictEqual(await page.inputValue('#dynamicSplitRows .split-amt'), '12', 'the reply interrupted the typing');
    await page.evaluate(() => closeAddModal());
  });

  await step('a reply with no names (an older backend) keeps the names this device already has', async () => {
    await page.evaluate(() => { MOCK.config = null; forceSyncSheet(); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { openAddModal(); selectSplit('custom'); });
    assert.deepStrictEqual(await page.$$eval('#personChips button[id^="chip_"]', b => b.map(x => x.id)), ['chip_kim', 'chip_lee', 'chip_robin', 'chip_sam', 'chip_jo', 'chip_marcus']);
    assert.ok(await visible(page, '#sp_half'));
    await page.evaluate(() => closeAddModal());
  });

  await step('the page itself holds no email address', async () => {
    assert.ok(!/[\w.+-]+@[\w-]+\.[\w.-]+/.test(appSource()), 'found an email address in the page or its scripts');
  });

  await step('new month: pay and savings are filled in from this month, not figures baked into the page', async () => {
    await page.evaluate(() => openNewMonthModal());
    assert.strictEqual(await page.inputValue('#nmPaycheck'), '2600');
    assert.strictEqual(await page.inputValue('#nmSavings'), '500');
    assert.ok(!(await visible(page, '#nmExistsWarn')));
    assert.strictEqual((await page.textContent('#nmCreateBtn')).trim(), 'Create Month');
  });

  await step('new month: a name that already exists warns, and only a second tap asks to replace it', async () => {
    await page.fill('#nmName', 'Other Payday 2026');
    assert.ok(await visible(page, '#nmExistsWarn'), 'no warning');
    assert.strictEqual((await page.textContent('#nmCreateBtn')).trim(), 'Replace month');
    const before = (await calls(page, 'startNewMonth')).length;
    await page.click('#nmCreateBtn');
    assert.strictEqual((await calls(page, 'startNewMonth')).length, before, 'the first tap must not send');
    assert.ok(/Tap again/.test(await page.textContent('#nmCreateBtn')));
    await page.click('#nmCreateBtn');
    await page.waitForTimeout(300);
    const c = (await calls(page, 'startNewMonth')).pop();
    assert.ok(c && c.replaceExisting === true && c.newMonthName === 'Other Payday 2026', JSON.stringify(c));
  });

  await step('new month: a new name goes in one tap and does not ask to replace anything', async () => {
    await page.evaluate(() => openNewMonthModal());
    await page.click('#nmCreateBtn');
    await page.waitForTimeout(300);
    const c = (await calls(page, 'startNewMonth')).pop();
    assert.ok(c && c.replaceExisting === false && c.paycheck === 2600 && c.savingsAmount === 500, JSON.stringify(c));
  });

  await step('new month: if another device made that month first, nothing changes and the page says so', async () => {
    await page.evaluate(() => {
      state.availableMonths = state.availableMonths.filter(m => m !== 'Other Payday 2026');   // this screen hasn't heard yet
      openNewMonthModal();
      document.getElementById('nmName').value = 'Other Payday 2026';
      updateNewMonthName();
    });
    const syncs = (await calls(page, 'getCachedSheetState')).length;
    await page.click('#nmCreateBtn');
    await page.waitForTimeout(500);
    assert.ok(/already exists/.test(await page.textContent('#toast')), await page.textContent('#toast'));
    assert.ok((await calls(page, 'getCachedSheetState')).length > syncs, 'should reload the latest months');
  });

  await step('new month: made, but its figures could not be read back: says so and opens the new month (no "Couldn\'t create")', async () => {
    const from = errors.length, was = await page.evaluate(() => activeMonth);
    try {
      await failSavedNoState(page);
      await page.evaluate(() => {
        openNewMonthModal();
        document.getElementById('nmName').value = 'Read back Payday 2026';
        updateNewMonthName();
      });
      await page.click('#nmCreateBtn');
      await page.waitForFunction(() => MOCK.calls.some(c => c.action === 'getCachedSheetState' && c.payload.sheetName === 'Read back Payday 2026' && c.payload.forceRefresh === true));
      assert.strictEqual(await page.textContent('#toast span'), 'Made Read back Payday 2026. Loading it now.');
      assert.strictEqual(await page.evaluate(() => activeMonth), 'Read back Payday 2026');
    } finally {
      await resetFailures(page);
      await page.evaluate(m => switchMonth(m), was);
      await page.waitForFunction(m => apiInflight === 0 && activeMonth === m, was);
      dropExpectedSyncErrors(from);
    }
  });

  await step('saved copies of months no longer in the sheet are cleared from this device', async () => {
    await page.evaluate(() => { localStorage.setItem('pf_cache_Gone Payday 2025', '{}'); localStorage.setItem('pf_tx_ts_Gone Payday 2025', '{}'); forceSyncSheet(); });
    await page.waitForTimeout(400);
    const left = await page.evaluate(() => Object.keys(localStorage).filter(k => /^pf_(cache|tx_ts)_/.test(k)));
    assert.ok(!left.some(k => k.includes('Gone')), left.join());
    assert.ok(left.includes('pf_cache_Test Payday 2026'), left.join());
  });

  await step('coming back to the app after a while fetches the latest figures; a quick glance away does not', async () => {
    let n = (await calls(page, 'getCachedSheetState')).length;
    await awayAndBack(page, 5000);
    await page.waitForTimeout(300);
    assert.strictEqual((await calls(page, 'getCachedSheetState')).length, n, 'refetched after 5 seconds away');
    await awayAndBack(page, 2 * 60 * 1000);
    await page.waitForTimeout(300);
    assert.strictEqual((await calls(page, 'getCachedSheetState')).length, n + 1, 'did not refetch after 2 minutes away');
  });

  await step('coming back after the sign-in ran out shows the lock screen straight away', async () => {
    await page.evaluate(() => localStorage.setItem('pf_google_id_token', MOCK.makeToken('owner@example.com', -10)));
    await awayAndBack(page, 2 * 60 * 1000);
    await page.waitForFunction(() => getComputedStyle(document.getElementById('authLockScreen')).display !== 'none', null, { timeout: 3000 });
  });
  await step('while locked, a spend saved offline waits: no request, and the lock screen message stays as it is', async () => {
    const s = await page.evaluate(async () => {
      showLockScreen('Access Denied: test message', { noAuto: true });
      const payload = { sheetName: activeMonth, account: 'amex', merchant: 'Waiting shop', grossAmount: 2, isRefund: false, splits: [], clientId: 'lock1' };
      localStorage.setItem('pf_outbox', JSON.stringify([{ id: 'lock1', payload }]));
      const n = MOCK.calls.length;
      await flushOutbox();
      await new Promise(r => setTimeout(r, 300));
      return { asked: MOCK.calls.length - n, msg: document.getElementById('authLockMsg').textContent, auto: lockAllowsAuto };
    });
    assert.deepStrictEqual(s, { asked: 0, msg: 'Access Denied: test message', auto: false }, JSON.stringify(s));
  });
  await ctx.close();

  // ---------------- awkward text ----------------
  ({ ctx, page } = await open(phone, 'evil=1'));
  // Hostile text in every account, a bill, an Owed entry, a month name and a fingerprint device (id and label):
  // every screen that shows it is opened, and nothing may run, add an element, or add a handler.
  // The page has no handlers in its markup (it uses data-action and friends), so any on...= attribute came from text, and
  // so did any action name the page doesn't know.
  const hostile = () => page.evaluate(() => ({
    pwned: window.__pwned || null,
    imgs: document.querySelectorAll('img').length,
    bolds: document.querySelectorAll('b').length,
    protoTouched: 'total' in {} || 'count' in {},
    handlers: [...document.querySelectorAll('*')].flatMap(el => [...el.attributes]
      .filter(a => /^on/i.test(a.name) || (/^data-(action|input|change)$/.test(a.name) && !Object.prototype.hasOwnProperty.call(ACTIONS, a.value)))
      .map(a => el.tagName + ' ' + a.name + '=' + a.value.slice(0, 40)))
  }));
  const CLEAN = { pwned: null, imgs: 0, bolds: 0, protoTouched: false, handlers: [] };
  await step('hostile text (attribute and handler break-outs) on every screen, the month list and the device list: nothing runs', async () => {
    // Each screen must really show the hostile text (as text), or this would prove nothing.
    const shows = { home: 'onmouseover', budgets: 'onmouseover', pending: '<b>bold</b>', activity: 'onmouseover' };
    for (const v of Object.keys(shows)) {
      await page.click('nav [data-nav="' + v + '"]');
      await page.evaluate(() => document.querySelectorAll('button[aria-expanded="false"]').forEach(b => { if (/Show all|Paid \(/.test(b.textContent)) b.click(); }));
      assert.ok((await page.textContent('main')).includes(shows[v]), v + ' should show the hostile text');
      assert.deepStrictEqual(await hostile(), CLEAN, 'on ' + v);
    }
    await page.click('nav [data-nav="pending"]');
    assert.ok(/Constructor/.test(await page.textContent('main')) && /__proto__/i.test(await page.textContent('main')), 'Owed shows people called "constructor" and "__proto__"');
    await page.evaluate(() => openSpendModal());
    await page.click('#spendModal button:has-text("purchases")');   // the category opens to list its shops
    const shops = await page.textContent('#spendModal');
    assert.ok(shops.includes('onmouseover') && /__proto__/i.test(shops) && /constructor/i.test(shops), 'Spending details should list the hostile shops');
    assert.deepStrictEqual(await hostile(), CLEAN, 'Spending details');
    await page.evaluate(() => closeSpendModal());
    const months = await page.$$eval('#monthSelector option', os => os.map(o => o.textContent));
    assert.ok(months.includes('Evil "Month" <img src=x onerror=window.__pwned=4> 2026'), 'the month name shows as text: ' + months.join(' | '));
    await page.evaluate(() => openPasskeyModal());
    await page.waitForFunction(() => document.getElementById('pkDevices').textContent.includes('onmouseover'));
    assert.deepStrictEqual(await hostile(), CLEAN, 'fingerprint device list');
    assert.deepStrictEqual(await page.$$eval('#pkDevices button', bs => bs.map(b => b.dataset.id)), await page.evaluate(() => pkDevices.map(d => d.id)), 'each id reaches its button as data');
    await page.evaluate(() => closePasskeyModal());
  });
  await step('hostile text in a row: its edit sheet shows it exactly, as a value', async () => {
    const t = await page.evaluate(() => state.barclays.find(x => /onerror/.test(x.desc)));
    await page.evaluate(x => openEditTxModal('barclays', x.row, x.desc, x.amount), t);
    assert.strictEqual(await page.inputValue('#editTxDesc'), t.desc);
    assert.deepStrictEqual(await hostile(), CLEAN);
    await page.evaluate(() => closeEditTxModal());
  });
  await ctx.close();

  // ---------------- desktop ----------------
  ({ ctx, page } = await open(desk));
  await page.evaluate(SEED_OWED);
  await step('desktop: the sync button carries the status too; the red caption shows only on a failure', async () => {
    const r = await page.evaluate(() => { const n = document.getElementById('syncStatus'), b = document.getElementById('syncBtn');
      const fine = [b.dataset.sync, n.classList.contains('hidden')];
      lastSyncFailed = 'reach'; updateSyncUi(); const bad = [b.dataset.sync, n.classList.contains('hidden'), n.textContent.trim()];
      lastSyncFailed = null; updateSyncUi(); return { fine, bad }; });
    assert.deepStrictEqual(r, { fine: ['synced', true], bad: ['failed', false, "Couldn't reach your sheet. Tap ↻ to try again."] });
  });
  await step('desktop: every owed item grouped by person, no summary, no Activity-tab extras', async () => {
    assert.ok(await visible(page, '.owed-groups') && !(await visible(page, '.owed-summary')));
    assert.ok(await visible(page, '#owedTabs'));
    assert.ok(!(await visible(page, '#actSpend')));
    const rows = await page.$$eval('#txListContainer > .tx-row', d => d.length);
    assert.strictEqual(rows, 8);
    assert.ok(await visible(page, '#txFilters') && await visible(page, '#txSearch'), 'desktop keeps the Activity filters');
    await page.click('#txf_amex');
    assert.ok(!(await visible(page, '#txFilterBtn')) && !(await visible(page, '#txActive')), 'desktop needs no filter button or chips');
    await page.click('#txf_all');
    assert.ok(await page.$('#sec_activity button:has-text("Show all")'), 'desktop keeps "Show all"');
  });
  await step('desktop: Owed sits under Bills, Activity on the right; no top-bar Add, the sidebar Add is always there', async () => {
    const r = await page.evaluate(() => Object.fromEntries(['sec_budgets', 'sec_pending', 'sec_activity'].map(id => { const b = document.getElementById(id).getBoundingClientRect(); return [id, { l: Math.round(b.left), t: Math.round(b.top), b: Math.round(b.bottom) }]; })));
    assert.strictEqual(r.sec_pending.l, r.sec_budgets.l, JSON.stringify(r));
    assert.ok(r.sec_pending.t > r.sec_budgets.b && r.sec_pending.t - r.sec_budgets.b <= 20, 'Owed should follow Bills: ' + JSON.stringify(r));
    assert.ok(r.sec_activity.l > r.sec_budgets.l && r.sec_activity.t === r.sec_budgets.t, JSON.stringify(r));
    assert.strictEqual(await page.$$eval('header button', bs => bs.filter(b => /Add/.test(b.textContent)).length), 0, 'the top bar still has an Add button');
    for (const w of [1024, 1280, 1600]) {
      await page.setViewportSize({ width: w, height: 800 });
      assert.ok(await visible(page, 'aside button[data-action="openAddModal"]'), 'no Add Transaction in the sidebar at ' + w + 'px');
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  });
  await step('a section folded on the desktop opens again when the window narrows to its phone tab (which has no ▾)', async () => {
    await page.evaluate(() => setView('activity'));
    await page.click('#chevActivity');
    assert.ok(!(await visible(page, '#activityBody')), 'the ▾ should fold Activity on the desktop');
    await page.setViewportSize({ width: 400, height: 860 });
    await page.waitForTimeout(200);
    assert.ok(await visible(page, '#activityBody'), 'the Activity tab is stuck folded with no ▾ to open it');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => setView('home'));
  });
  await step('Spending left open while the phone folds or unfolds redraws to the bars that fit (6 wide, 4 narrow)', async () => {
    const bars = () => page.$$eval('#spendBody .items-end > div', els => els.length);
    await page.evaluate(() => {
      window.__realMonths = spendMonthTotals;
      spendMonthTotals = () => ['May', 'June', 'July', 'August', 'September', 'October'].map(m => ({ name: m + ' Payday 2026', total: 1234.56 }));
      openSpendModal();
    });
    try {
      assert.strictEqual(await bars(), 6);
      await page.setViewportSize({ width: 400, height: 860 });
      await page.waitForTimeout(200);
      assert.strictEqual(await bars(), 4, 'still six bars after narrowing with Spending open');
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(200);
      assert.strictEqual(await bars(), 6, 'still four bars after widening with Spending open');
    } finally {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.evaluate(() => { spendMonthTotals = window.__realMonths; closeSpendModal(); });
    }
  });
  await step('desktop: Spending shows six months, each full amount fitting its own bar', async () => {
    const out = await monthBars(page);
    assert.strictEqual(out.length, 6, JSON.stringify(out));
    assert.ok(out.every(o => o.text === '£1,234.56' && o.lines === 1 && o.fits), JSON.stringify(out));
  });
  await step('desktop: the header "All paid back" shows with several people owing; Bills say "to pay"', async () => {
    assert.ok(await visible(page, '#btnSettleAll'));
    assert.ok(/^£[\d,]+\.\d\d to pay$/.test(await page.textContent('#budLeftVal')), await page.textContent('#budLeftVal'));
  });
  await step('desktop light mode: the sidebar is light too', async () => {
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).backgroundColor);
    assert.strictEqual(bg, 'rgb(255, 255, 255)');
  });
  await step('the Inter font comes from this site and is in use', async () => {
    const font = await page.evaluate(async () => { await document.fonts.ready; return { loaded: document.fonts.check('600 16px Inter'), family: getComputedStyle(document.body).fontFamily }; });
    assert.ok(font.loaded, 'Inter did not load');
    assert.ok(/^"?Inter/.test(font.family), font.family);
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(appSource()), 'the page still points at Google Fonts');
  });
  await step('the page carries its security policy: only this site, the backend and Google sign-in', async () => {
    const csp = await page.evaluate(() => (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || '');
    // Requests may go only to the backend's own address, not to any Apps Script project.
    const exec = fs.readFileSync(path.join(root, 'app.js'), 'utf8').match(/const APPS_SCRIPT_EXEC_URL = '([^']+)'/)[1];
    // Scripts only from this site's own files and Google's sign-in: nothing inline (no 'unsafe-inline').
    ['default-src \'self\'', 'script-src \'self\' https://accounts.google.com/gsi/client;',
      'connect-src \'self\' ' + exec + ' https://script.googleusercontent.com https://accounts.google.com/gsi/;',
      'object-src \'none\'', 'form-action \'none\'', 'font-src \'self\''].forEach(d => assert.ok(csp.includes(d), 'missing: ' + d));
    // So the page itself holds no script: each one is a file of the site's own, asked for by its hash.
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.deepStrictEqual([...html.matchAll(/<script\b[^>]*>/gi)].map(m => m[0].replace(/\?v=[0-9a-f]{10}"/, '?v=HASH"')),
      ['<script src="guard.js?v=HASH">', '<script src="app.js?v=HASH">']);
    // The frame guard runs in <head>, before anything is drawn; the app once the page above it is in place.
    assert.ok(html.indexOf('<script src="guard.js') < html.indexOf('</head>'), 'guard.js is not in <head>');
    assert.ok(/<script src="app\.js\?v=[0-9a-f]{10}"><\/script>\s*<\/body>/.test(html), 'app.js is not at the end of <body>');
    assert.ok(await page.evaluate(() => typeof ACTIONS === 'object' && window.PF_FRAMED === undefined), 'the scripts did not run');
  });
  await step('no inline handlers in the page: each control names one of its ACTIONS, and every action is used', async () => {
    const html = appSource();
    // on...= followed by a quote, a ${...} or an unquoted call (but not a const/let/var such as `const online = ()`)
    const handler = /(?<!\b(?:const|let|var))(^|[\s"'`])on[a-z]+\s*=\s*(["'`$]|[^\s>="'`]*\()|setAttribute\(\s*['"`]on/gim;
    assert.deepStrictEqual(html.match(handler) || [], [], 'inline handlers left');
    const actions = await page.evaluate(() => Object.keys(ACTIONS));
    // The Activity filter chips are drawn by chip(label, action), so their actions are named in its calls.
    const named = [...html.matchAll(/data-(?:action|input|change)="([^"]*)"/g)].map(m => m[1]).filter(n => n !== '${action}')
      .concat([...html.matchAll(/chip\([^\n]*?, '(\w+)'\)/g)].map(m => m[1]));
    assert.deepStrictEqual(named.filter(n => !actions.includes(n)), [], 'controls name actions that do not exist');
    assert.deepStrictEqual(actions.filter(a => !named.includes(a)), [], 'actions nothing uses');
  });
  await step('taps reach the same places as before: data-stop, data-backdrop, and the menu', async () => {
    const s = await page.evaluate(() => {
      const out = {};
      const chev = () => document.getElementById('chevBudgets').getAttribute('aria-expanded');
      const shown = id => !document.getElementById(id).classList.contains('hidden');
      const was = chev();
      document.getElementById('btnAddBill').click();                  // a button inside the header's data-stop group
      out.addBill = [shown('budgetModal'), chev() === was];
      closeBudgetForm();
      document.getElementById('btnAddBill').parentElement.click();    // the group itself: nothing happens
      out.group = chev() === was;
      document.querySelector('#sec_budgets h2').click();              // the header: folds the section
      out.header = chev() !== was;
      document.querySelector('#sec_budgets h2').click();
      out.headerBack = chev() === was;
      openSpendModal();
      document.getElementById('spendTitle').click();                  // inside the sheet: stays open
      out.inside = shown('spendModal');
      document.getElementById('spendModal').click();                  // the dark area round it: closes
      out.backdrop = !shown('spendModal');
      document.getElementById('menuBtn').click();                     // its data-stop keeps it open
      out.menuOpen = shown('menuPanel');
      document.querySelector('#sec_budgets h2').click();              // any other tap closes it (and folds Bills)
      out.menuClosed = !shown('menuPanel');
      document.querySelector('#sec_budgets h2').click();
      // A tap inside a browser add-on's own panel (an open shadow root) passes by quietly (no page error).
      const host = document.body.appendChild(document.createElement('div'));
      host.attachShadow({ mode: 'open' }).appendChild(document.createElement('button')).click();
      host.remove();
      return out;
    });
    assert.deepStrictEqual(s, { addBill: [true, true], group: true, header: true, headerBack: true, inside: true, backdrop: true, menuOpen: true, menuClosed: true });
  });
  await ctx.close();

  // ---------------- a device that has never been sent any names ----------------
  ({ ctx, page } = await open(desk, 'demo=1&noconfig=1'));
  await step('with no names known yet, the quick-split buttons stay hidden and a split still saves', async () => {
    await page.evaluate(() => { openAddModal(); });
    assert.ok(!(await visible(page, '#sp_half')) && !(await visible(page, '#sp_all')), 'quick-split buttons showed without a name');
    await page.evaluate(() => selectSplit('half'));
    assert.strictEqual(await page.evaluate(() => formSplit), '100_me', 'a hidden quick split could still be chosen');
    await page.evaluate(() => selectSplit('custom'));
    assert.deepStrictEqual(await page.$$eval('#personChips button[id^="chip_"]', b => b.map(x => x.id)), ['chip_marcus']);
    assert.strictEqual(await page.$$eval('#dynamicSplitRows .split-name', i => i.length), 0, 'nobody should be picked by default');
    await page.click('#personChips button:has-text("Other")');
    await page.fill('#dynamicSplitRows .split-name', 'pat');
    await page.fill('#inpMerchant', 'Split shop');
    await page.fill('#inpAmount', '20');
    await page.click('#dynamicSplitRows .split-amt');
    await page.fill('#dynamicSplitRows .split-amt', '10');
    await page.click('#btnSubmitTx');
    await page.waitForTimeout(300);
    const a = (await calls(page, 'addTransactionBundle')).pop();
    assert.ok(a && a.splits.length === 1 && a.splits[0].person === 'pat' && a.splits[0].amount === 10, JSON.stringify(a));
  });
  await ctx.close();

  // ---------------- sign out ----------------
  {
    const keys = p => p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('pf_')).sort());
    const locked = p => p.evaluate(() => getComputedStyle(document.getElementById('authLockScreen')).display !== 'none');
    const shown = (p, id) => p.evaluate(i => !document.getElementById(i).classList.contains('hidden'), id);
    // This device has fingerprint sign-in, a theme and a dismissed offer, on top of the saved figures.
    const seed = p => p.evaluate(() => {
      localStorage.setItem('pf_passkey_cid', 'cid-test');
      localStorage.setItem('pf_theme_mode', 'dark');
      localStorage.setItem('pf_passkey_offer_dismissed', '1');
    });
    const afterReload = async p => {
      await p.waitForLoadState('load');
      await p.waitForFunction(() => window.MOCK && document.getElementById('authLockMsg') && getComputedStyle(document.getElementById('authLockScreen')).display !== 'none');
      await p.waitForTimeout(800);   // long enough for Google (auto select) or the fingerprint to have jumped in
    };

    let { ctx: c3, page: p3 } = await open(phone);
    await step('sign out: in the phone menu, and the sheet says what it clears; fingerprint options only when set up', async () => {
      await p3.click('#menuBtn');
      assert.ok(await visible(p3, '#menuSignOutItem'), 'no Sign out in the menu');
      await p3.click('#menuSignOutItem');
      assert.ok(await shown(p3, 'signOutModal') && !(await shown(p3, 'menuPanel')), 'the sheet should open and the menu close');
      assert.ok(!(await shown(p3, 'soForgetBlock')) && !(await shown(p3, 'soKeepNote')) && !(await shown(p3, 'soWaiting')), 'no fingerprint here, nothing waiting');
      await p3.keyboard.press('Escape');
      assert.ok(!(await shown(p3, 'signOutModal')), 'Escape should close it');
      await seed(p3);
      await p3.evaluate(() => openSignOutModal());
      assert.ok(await shown(p3, 'soForgetBlock') && await shown(p3, 'soKeepNote'), 'fingerprint options missing');
    });
    await step('sign out: clears the figures and sign-in, keeps theme and fingerprint, and locks without asking for the fingerprint', async () => {
      assert.ok((await keys(p3)).some(k => k.startsWith('pf_cache_')), 'test set-up: nothing saved to clear');
      await p3.click('#soBtn');
      await afterReload(p3);
      assert.deepStrictEqual(await keys(p3), ['pf_passkey_cid', 'pf_passkey_offer_dismissed', 'pf_theme_mode']);
      const s = await p3.evaluate(() => ({ msg: document.getElementById('authLockMsg').textContent, calls: MOCK.calls.map(c => c.action),
        off: MOCK.gsi.disableAutoSelect, finger: getComputedStyle(document.getElementById('passkeyUnlockBtn')).display, money: document.getElementById('kpiNCA').textContent }));
      assert.ok(await locked(p3), 'should be locked');
      assert.strictEqual(s.msg, 'Signed out. Nothing is saved on this device any more.');
      assert.deepStrictEqual(s.calls, [], 'nothing should be asked of the server (no fingerprint prompt, no data)');
      assert.ok(s.off >= 1, "Google's automatic sign-in was not stopped");
      assert.strictEqual(s.finger, 'flex', 'the fingerprint button should still be offered');
      assert.ok(!/£\d/.test(s.money), 'figures still on the page: ' + s.money);
    });
    await step('sign out: coming back to the app later still does not ask for the fingerprint by itself', async () => {
      await awayAndBack(p3, 2 * 60 * 1000);
      await p3.waitForTimeout(400);
      assert.deepStrictEqual(await p3.evaluate(() => MOCK.calls.map(c => c.action)), []);
      assert.strictEqual(await p3.textContent('#authLockMsg'), 'Signed out. Nothing is saved on this device any more.');
    });
    await step('sign out: figures a late reply saved just before the reload are cleared when the page opens', async () => {
      await p3.evaluate(() => { localStorage.setItem('pf_cache_' + MOCK.MONTH, '{"late":true}'); localStorage.setItem('pf_last_month', MOCK.MONTH); });
      await p3.reload();
      await afterReload(p3);
      assert.deepStrictEqual(await keys(p3), ['pf_passkey_cid', 'pf_passkey_offer_dismissed', 'pf_theme_mode']);
    });
    await step('sign out: then choosing the account on the Google button gets straight back in', async () => {
      await p3.evaluate(() => MOCK.gsiCallback({ credential: MOCK.makeToken('owner@example.com') }));
      await p3.waitForFunction(() => getComputedStyle(document.getElementById('authLockScreen')).display === 'none' && /£\d/.test(document.getElementById('kpiNCA').textContent));
      assert.strictEqual(await p3.evaluate(() => sessionStorage.getItem('pf_signed_out')), null, 'the signed-out note should go once signed in');
    });
    await c3.close();

    ({ ctx: c3, page: p3 } = await open(phone));
    await step('sign out with a spend still waiting to send: warns, first tap only arms, Send now sends it', async () => {
      await p3.evaluate(() => {
        const payload = { sheetName: activeMonth, account: 'amex', merchant: 'Waiting shop', grossAmount: 7.5, isRefund: false, splits: [], clientId: 'wait1' };
        localStorage.setItem('pf_outbox', JSON.stringify([{ id: 'wait1', payload }]));
        openSignOutModal();
      });
      assert.ok(await shown(p3, 'soWaiting'));
      assert.strictEqual(await p3.textContent('#soWaitingText'), "1 spend saved offline hasn't been sent yet. Signing out would lose it.");
      await p3.click('#soBtn');
      await p3.waitForTimeout(200);
      assert.strictEqual(await p3.textContent('#soBtn'), 'Tap again to sign out anyway');
      assert.ok(!(await locked(p3)) && (await keys(p3)).includes('pf_outbox'), 'one tap must not sign out');
      await p3.click('#soSendBtn');
      await p3.waitForFunction(() => !JSON.parse(localStorage.getItem('pf_outbox') || '[]').length);
      await p3.waitForTimeout(200);
      assert.deepStrictEqual((await calls(p3, 'addTransactionBundle')).map(c => c.merchant), ['Waiting shop']);
      assert.ok(!(await shown(p3, 'soWaiting')), 'the warning should go once sent');
      assert.strictEqual(await p3.textContent('#soBtn'), 'Sign out');
    });
    await step('sign out anyway: a second tap with a spend waiting signs out', async () => {
      await p3.evaluate(() => { localStorage.setItem('pf_outbox', JSON.stringify([{ id: 'w2', payload: { merchant: 'x' } }])); renderSignOutModal(); });
      await p3.click('#soBtn');
      await p3.click('#soBtn');
      await afterReload(p3);
      assert.deepStrictEqual(await keys(p3), []);
    });
    await c3.close();

    ({ ctx: c3, page: p3 } = await open(phone));
    await step('sign out waits for a save that is still on its way before clearing anything', async () => {
      await p3.evaluate(() => {
        MOCK.nextLatencies = [1500];
        sendNewSpend({ sheetName: activeMonth, account: 'amex', merchant: 'Slow shop', grossAmount: 3, isRefund: false, splits: [], clientId: 'slow1' });
        openSignOutModal();
      });
      await p3.click('#soBtn');
      await p3.waitForTimeout(500);
      const s = await p3.evaluate(() => ({ disabled: document.getElementById('soBtn').disabled, token: !!localStorage.getItem('pf_google_id_token'),
        ended: MOCK.calls.filter(c => c.action === 'addTransactionBundle').map(c => c.end) }));
      assert.ok(s.disabled && s.token && s.ended.length === 1 && s.ended[0] === null, 'signed out before the save finished: ' + JSON.stringify(s));
      await afterReload(p3);
      assert.deepStrictEqual(await keys(p3), []);
    });
    await c3.close();

    ({ ctx: c3, page: p3 } = await open(phone));
    await step('forget this device: if the server says no, nothing is cleared and it says why', async () => {
      await seed(p3);
      await p3.evaluate(() => { MOCK.failNext = 1; openSignOutModal(); });
      await p3.click('#soForgetBtn');
      await p3.waitForFunction(() => /Nothing has been cleared yet/.test(document.getElementById('soMsg').textContent));
      assert.ok(await shown(p3, 'signOutModal') && !(await locked(p3)));
      const k = await keys(p3);
      assert.ok(k.includes('pf_passkey_cid') && k.includes('pf_google_id_token') && k.some(x => x.startsWith('pf_cache_')), JSON.stringify(k));
    });
    await step('forget this device: turns fingerprint off on the server, then clears its link too', async () => {
      await p3.click('#soForgetBtn');
      await afterReload(p3);
      assert.strictEqual(await p3.evaluate(() => sessionStorage.getItem('mock_passkey_removed')), 'cid-test');
      assert.deepStrictEqual(await keys(p3), ['pf_passkey_offer_dismissed', 'pf_theme_mode']);
      assert.strictEqual(await p3.evaluate(() => getComputedStyle(document.getElementById('passkeyUnlockBtn')).display), 'none');
    });
    await c3.close();

    ({ ctx: c3, page: p3 } = await open(desk));
    await step('desktop: Sign out sits under Open Sheet in the sidebar and opens the same sheet', async () => {
      assert.ok(await visible(p3, '#sideSignOutBtn'));
      const order = await p3.evaluate(() => { const a = document.getElementById('rawSheetBtn'), b = document.getElementById('sideSignOutBtn'); return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); });
      assert.ok(order, 'should come after Open Sheet');
      await p3.click('#sideSignOutBtn');
      assert.ok(await shown(p3, 'signOutModal'));
      await p3.click('#signOutModal', { position: { x: 5, y: 5 } });
      assert.ok(!(await shown(p3, 'signOutModal')), 'tapping outside should close it');
    });
    await c3.close();

    ({ ctx: c3, page: p3 } = await open({ ...phone, viewport: { width: 344, height: 780 } }));
    await step('sign out sheet fits a 344px phone: no button label wraps, even "Tap again"', async () => {
      await seed(p3);
      await p3.evaluate(() => { localStorage.setItem('pf_outbox', JSON.stringify([{ id: 'w3', payload: { merchant: 'x' } }])); openSignOutModal(); });
      await p3.click('#soBtn');
      const lines = await p3.evaluate(() => ['soBtn', 'soForgetBtn', 'soSendBtn'].map(id => {
        const r = document.createRange(); r.selectNodeContents(document.getElementById(id));
        return id + ':' + new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top))).size;
      }));
      assert.deepStrictEqual(lines.filter(x => !/:1$/.test(x)), [], lines.join(' '));
    });
    await c3.close();
  }

  // ---------------- first open, nothing saved on this device, slow reply ----------------
  {
    const c9 = await browser.newContext(phone);
    const p9 = watch(await c9.newPage());
    await step('first open with nothing saved: "£—" and "Loading…" until the figures arrive, never a false £0.00', async () => {
      try {
        await p9.goto(`http://localhost:${PORT}/tests/harness.html?demo=1&latency=1500`);
        await p9.waitForFunction(() => window.MOCK && MOCK.calls.length > 0 && typeof renderAll === 'function');
        const shown = () => p9.evaluate(() => ({
          kpis: ['kpiSurplus', 'kpiAmex', 'kpiBarclays', 'kpiNCA', 'kpiMarcus'].map(id => document.getElementById(id).textContent),
          bills: document.getElementById('budLeftVal').textContent,
          owed: document.getElementById('panel_pending').textContent.trim(),
          saved: Object.keys(localStorage).filter(k => k.startsWith('pf_cache_'))
        }));
        await p9.evaluate(() => renderAll());   // anything that redraws while waiting
        assert.deepStrictEqual(await shown(), { kpis: ['£—', '£—', '£—', '£—', '£—'], bills: 'Loading…', owed: 'Loading…', saved: [] });
        await p9.waitForFunction(() => /£\d/.test(document.getElementById('kpiNCA').textContent));
        const after = await shown();
        assert.ok(after.kpis.every(t => /£\d/.test(t)) && after.bills !== 'Loading…' && after.owed !== 'Loading…' && after.saved.length === 1, JSON.stringify(after));
      } finally { await c9.close(); }
    });
  }

  // ---------------- a Google account the server turns down ----------------
  {
    const c2 = await browser.newContext(desk);
    const p2 = watch(await c2.newPage());
    await p2.goto(`http://localhost:${PORT}/tests/harness.html?demo=1&token=none&latency=50`);
    await p2.waitForFunction(() => window.MOCK && typeof MOCK.gsiCallback === 'function');
    await step('a browser that refuses to save the sign-in says so plainly and sends nothing', async () => {
      const s = await p2.evaluate(() => {
        const P = Storage.prototype, real = P.setItem;
        P.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
        try { MOCK.gsiCallback({ credential: MOCK.makeToken('owner@example.com') }); } finally { P.setItem = real; }
        return { msg: document.getElementById('authLockMsg').textContent, calls: MOCK.calls.length };
      });
      assert.ok(s.msg.includes("won't let PaydayFlow save anything"), s.msg);
      assert.strictEqual(s.calls, 0, 'sent a request without a saved sign-in');
    });
    await step('Google sign-in the server turns down: says why and which account, keeps no token, does not loop', async () => {
      // Google would sign this account back in by itself (auto select) every time the lock screen asks.
      await p2.evaluate(() => { MOCK.authError = "FORBIDDEN: This Google account can't open PaydayFlow."; MOCK.gsiAccount = 'someone@example.com'; MOCK.gsiCallback({ credential: MOCK.makeToken('someone@example.com') }); });
      await p2.waitForFunction(() => /can't open PaydayFlow/.test(document.getElementById('authLockMsg').textContent));
      await p2.waitForTimeout(1500);
      const s = await p2.evaluate(() => ({ msg: document.getElementById('authLockMsg').textContent, token: localStorage.getItem('pf_google_id_token'),
        off: MOCK.gsi.disableAutoSelect, calls: MOCK.calls.length, locked: getComputedStyle(document.getElementById('authLockScreen')).display !== 'none' }));
      assert.ok(s.locked, 'should stay on the lock screen');
      assert.ok(s.msg.startsWith('Access Denied') && s.msg.includes('someone@example.com') && !/FORBIDDEN/.test(s.msg), s.msg);
      assert.strictEqual(s.token, null, 'the refused token was kept');
      assert.ok(s.off >= 1, 'automatic Google sign-in was not stopped');
      assert.strictEqual(s.calls, 1, 'signed itself in again: ' + s.calls + ' requests');
      assert.strictEqual(await p2.evaluate(() => MOCK.gsi.initialize), 1, "Google's sign-in should be set up once per page load");
    });
    await step("Google sign-in the server can't check just now: says try again (not Access Denied) and keeps no token", async () => {
      await p2.evaluate(() => { MOCK.authError = "AUTH_UNAVAILABLE: Couldn't check the Google sign-in just now. Try again in a minute."; MOCK.gsiCallback({ credential: MOCK.makeToken('owner@example.com') }); });
      await p2.waitForFunction(() => /Couldn't reach the server/.test(document.getElementById('authLockMsg').textContent));
      const s = await p2.evaluate(() => ({ msg: document.getElementById('authLockMsg').textContent, token: localStorage.getItem('pf_google_id_token'), locked: lockScreenShowing() }));
      assert.ok(s.locked && !/Access Denied/.test(s.msg), JSON.stringify(s));
      assert.strictEqual(s.token, null, 'a token the server never checked was kept, so a reload would open the app with it');
    });
    await step('then picking the right account on the button gets straight in, and sends a spend saved offline', async () => {
      await p2.evaluate(() => {
        const payload = { sheetName: MOCK.MONTH, account: 'amex', merchant: 'Sent after sign-in', grossAmount: 3, isRefund: false, splits: [], clientId: 'signin1' };
        localStorage.setItem('pf_outbox', JSON.stringify([{ id: 'signin1', payload }]));
        MOCK.authError = null;
        MOCK.gsiCallback({ credential: MOCK.makeToken('owner@example.com') });
      });
      await p2.waitForFunction(() => getComputedStyle(document.getElementById('authLockScreen')).display === 'none' && /£\d/.test(document.getElementById('kpiNCA').textContent));
      await p2.waitForFunction(() => MOCK.calls.some(c => c.action === 'addTransactionBundle' && c.payload.clientId === 'signin1'), null, { timeout: 3000 });
    });
    await c2.close();
  }

  // ---------------- daily amount, vs last month, Owed message, home-screen shortcuts ----------------
  {
    // Opens the test page with "today" fixed (timers keep running), like open() above.
    const openAt = async (opts, when, query = 'demo=1') => {
      const c = await browser.newContext(opts);
      const p = watch(await c.newPage());
      if (when) await p.clock.setFixedTime(new Date(when));
      await p.goto(`http://localhost:${PORT}/tests/harness.html?${query}&latency=50`);
      await p.waitForFunction(() => document.getElementById('kpiNCA') && /£\d/.test(document.getElementById('kpiNCA').textContent));
      await p.waitForTimeout(400);
      return { c, p };
    };
    const txt = (p, sel) => p.evaluate(s => document.querySelector(s).textContent.replace(/\s+/g, ' ').trim(), sel);
    const isShown = (p, id) => p.evaluate(i => !document.getElementById(i).classList.contains('hidden'), id);

    let { c, p } = await openAt(phone, '2026-11-02T10:00:00');
    await step('daily amount: Money Left spread over the days to payday (30 Nov), with the payday date', async () => {
      const left = await p.evaluate(() => state.summary.eomSavingsJ);
      assert.ok(left > 0, 'test set-up: Money Left should be positive');
      assert.ok(await isShown(p, 'dailyStrip'));
      const want = '£' + (Math.floor(left / 28 * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' a day';
      assert.strictEqual(await txt(p, '#dailyLeft'), want);
      assert.strictEqual(await txt(p, '#dailyPayday'), 'Payday Mon 30 Nov');
    });
    await step('Money Left: one quiet line says what it is; no Breakdown button or drawer', async () => {
      assert.strictEqual(await txt(p, '#heroNote'), 'After cards and bills to pay');
      assert.ok(!(await p.$('#mathDrawer')), 'the Breakdown drawer is still on the page');
      assert.ok(!(await p.$('#heroSection button')), 'the Money Left card still has a button');
    });
    await step('What-If: skipping a bill shows the badge and takes it out of Money Left and the Bills total', async () => {
      const before = await p.evaluate(() => ({ left: state.summary.eomSavingsJ, bills: document.getElementById('budLeftVal').textContent }));
      const b = await p.evaluate(() => state.budgets.find(x => Number(x.amount) < 0));
      await p.click(`#upcomingBudgetsList button[aria-label="Simulate skipping ${b.name}"]`);
      const after = await p.evaluate(() => ({ left: state.summary.eomSavingsJ, bills: document.getElementById('budLeftVal').textContent, badge: !document.getElementById('simBadge').classList.contains('hidden') }));
      await p.click(`#upcomingBudgetsList button[aria-label="Simulate skipping ${b.name}"]`);
      assert.ok(after.badge, 'no What-If badge');
      assert.strictEqual(Math.round((after.left - before.left) * 100), Math.round(-b.amount * 100));
      assert.ok(/ to pay$/.test(after.bills) && after.bills !== before.bills, JSON.stringify([before, after]));
      assert.strictEqual(await txt(p, '#heroNote'), 'After cards and bills to pay');
    });
    await step('daily amount: over budget says how much over; payday itself says so; older months show none', async () => {
      await p.evaluate(() => renderDailyStrip(-12.3));
      assert.strictEqual(await txt(p, '#dailyLeft'), '£12.30 over');
      await p.evaluate(() => renderDailyStrip(state.summary.eomSavingsJ));
      await p.evaluate(() => switchMonth(MOCK.MONTH2));
      await p.waitForFunction(() => activeMonth === MOCK.MONTH2 && /£\d/.test(document.getElementById('kpiSurplus').textContent));
      await p.waitForTimeout(300);
      assert.ok(!(await isShown(p, 'dailyStrip')), 'an older month should not show a daily amount');
    });
    await c.close();
    ({ c, p } = await openAt(phone, '2026-11-30T09:00:00'));
    await step('daily amount: on payday it just says "Payday today"', async () => {
      assert.strictEqual(await txt(p, '#dailyLeft'), 'Payday today');
      assert.strictEqual(await txt(p, '#dailyPayday'), '');
    });
    await c.close();
    ({ c, p } = await openAt({ ...phone, viewport: { width: 344, height: 780 } }, '2026-11-02T10:00:00'));
    await step('daily amount fits a 344px phone on one line', async () => {
      const lines = await p.evaluate(() => { const r = document.getElementById('dailyStrip').getBoundingClientRect(); return Math.round(r.height); });
      assert.ok(lines <= 34, 'the strip wrapped: ' + lines + 'px tall');
    });
    await c.close();

    ({ c, p } = await openAt(phone, '2026-11-02T10:00:00'));
    await step('vs last month: fetched once, quietly, then a note on every category; the month on screen is untouched', async () => {
      const before = await p.evaluate(() => ({ month: activeMonth, last: localStorage.getItem('pf_last_month'), surplus: document.getElementById('kpiSurplus').textContent }));
      // A slow reply, and the dialog opened again (and redrawn) while it is still on its way.
      await p.evaluate(() => { MOCK.nextLatencies = [900]; openSpendModal(); });
      await p.waitForTimeout(150);
      await p.evaluate(() => { closeSpendModal(); openSpendModal(); renderSpend(); });
      await p.waitForFunction(() => /vs last month|Same as last month| · New/.test(document.getElementById('spendBody').textContent));
      await p.evaluate(() => { closeSpendModal(); openSpendModal(); });
      await p.waitForTimeout(300);
      const asked = await p.evaluate(() => MOCK.calls.filter(x => x.action === 'getCachedSheetState' && x.payload.sheetName === MOCK.MONTH2).length);
      assert.strictEqual(asked, 1, 'last month should be fetched once, not ' + asked + ' times');
      const notes = await p.$$eval('#spendBody button[data-cat] .text-xs', els => els.map(e => e.textContent));
      assert.ok(notes.length && notes.every(n => /vs last month|Same as last month| · New$/.test(n)), JSON.stringify(notes));
      const after = await p.evaluate(() => ({ month: activeMonth, last: localStorage.getItem('pf_last_month'), surplus: document.getElementById('kpiSurplus').textContent }));
      assert.deepStrictEqual(after, before);
    });
    await step('vs last month: the oldest month has nothing to compare with, so no notes', async () => {
      await p.evaluate(() => { closeSpendModal(); switchMonth(MOCK.MONTH2); });
      await p.waitForFunction(() => activeMonth === MOCK.MONTH2);
      await p.waitForTimeout(400);
      await p.evaluate(() => openSpendModal());
      await p.waitForTimeout(400);
      assert.ok(!/vs last month|Same as| · New/.test(await txt(p, '#spendBody')));
    });
    await c.close();

    ({ c, p } = await openAt(phone, null));
    await step('Owed: the share button sends a plain message with each item and the total', async () => {
      await p.evaluate(() => {
        window.__shared = null;
        Object.defineProperty(navigator, 'share', { configurable: true, value: d => { window.__shared = d.text; return Promise.resolve(); } });
        setView('pending');
      });
      const g = await p.evaluate(() => owedGroupsShown[0]);
      await p.click(`#panel_pending button[aria-label="Send ${g.name} what they owe"]`);
      await p.waitForFunction(() => window.__shared);
      const want = `Hi ${g.name}, here's what you owe me:\n\n` + g.items.map(r => r.what + '  £' + Number(r.amount).toFixed(2)).join('\n')
        + '\n\nTotal  £' + g.total.toFixed(2) + '\n\nThanks!';
      assert.strictEqual(await p.evaluate(() => window.__shared), want);
    });
    await step('Owed: without a share sheet (a computer), the message is copied and the page says so', async () => {
      await p.evaluate(() => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__copied = t; return Promise.resolve(); } } });
      });
      const name = await p.evaluate(() => owedGroupsShown[0].name);
      await p.click(`#panel_pending button[aria-label="Send ${name} what they owe"]`);
      await p.waitForFunction(() => window.__copied);
      assert.ok((await txt(p, '#toast')).startsWith('Copied. Paste it into a message to ' + name));
    });
    await step('Owed: cancelling the share sheet shows no error', async () => {
      await p.evaluate(() => {
        document.getElementById('toast').classList.add('hidden');
        Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })) });
      });
      const name = await p.evaluate(() => owedGroupsShown[0].name);
      await p.click(`#panel_pending button[aria-label="Send ${name} what they owe"]`);
      await p.waitForTimeout(300);
      assert.ok(await p.evaluate(() => document.getElementById('toast').classList.contains('hidden')), 'a toast appeared');
    });
    await step('Owed: if the browser refuses the share sheet (e.g. inside Apps Script), the message is copied instead', async () => {
      await p.evaluate(() => {
        window.__copied = null;
        Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' })) });
      });
      const name = await p.evaluate(() => owedGroupsShown[0].name);
      await p.click(`#panel_pending button[aria-label="Send ${name} what they owe"]`);
      await p.waitForFunction(() => window.__copied);
      assert.ok((await txt(p, '#toast')).startsWith('Copied.'));
    });
    await c.close();

    for (const [go, check, label] of [
      ['add', "!document.getElementById('addModal').classList.contains('hidden')", 'the Add form'],
      ['owed', "document.body.dataset.view === 'pending'", 'the Owed tab'],
      ['spending', "!document.getElementById('spendModal').classList.contains('hidden')", 'Spending details'],
    ]) {
      ({ c, p } = await openAt(phone, null, 'demo=1&go=' + go));
      await step(`shortcut ?go=${go} opens ${label}, and the address no longer carries it`, async () => {
        assert.ok(await p.evaluate(check), label + ' did not open');
        assert.ok(!(await p.evaluate(() => location.search)).includes('go='), 'the address still says go=');
      });
      await c.close();
    }
    {
      const c2 = await browser.newContext(phone);
      const p2 = watch(await c2.newPage());
      await p2.goto(`http://localhost:${PORT}/tests/harness.html?demo=1&token=none&go=owed&latency=50`);
      await p2.waitForFunction(() => window.MOCK && typeof MOCK.gsiCallback === 'function');
      await step('shortcut while signed out: the screen opens once you have signed in', async () => {
        assert.notStrictEqual(await p2.evaluate(() => document.body.dataset.view), 'pending');
        await p2.evaluate(() => MOCK.gsiCallback({ credential: MOCK.makeToken('owner@example.com') }));
        await p2.waitForFunction(() => document.body.dataset.view === 'pending');
      });
      await c2.close();
    }
    await step('the manifest offers the three shortcuts, all on this site', async () => {
      const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
      assert.deepStrictEqual(m.shortcuts.map(s => [s.name, s.url]), [['Add spend', '/?go=add'], ['Owed', '/?go=owed'], ['Spending', '/?go=spending']]);
    });
    // Chrome on Android picks a shortcut's icon from the ordinary ("any") ones: with only a maskable one the menu showed
    // blank squares. The same full-bleed picture is listed both ways, so it fills the circle either way.
    await step('each shortcut has its own full-bleed icon, listed as ordinary and maskable (192x192 PNG, on the site)', async () => {
      const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
      const srcs = m.shortcuts.map(s => {
        assert.deepStrictEqual(s.icons.map(i => i.purpose), ['any', 'maskable'], s.name + ': needs an ordinary icon (Chrome shows a blank square without one) and a maskable one');
        assert.strictEqual(s.icons[0].src, s.icons[1].src, s.name + ': both entries should be the same picture');
        const ic = s.icons[0];
        assert.strictEqual(ic.sizes, '192x192');
        const png = fs.readFileSync(path.join(root, ic.src));
        assert.strictEqual(png.toString('latin1', 1, 4), 'PNG', ic.src);
        assert.deepStrictEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [192, 192], ic.src + ' is not 192x192');
        return ic.src;
      });
      assert.strictEqual(new Set(srcs).size, 3, 'the shortcuts should not share an icon');
    });
  }

  // ---------------- the copy of the page Apps Script serves ----------------
  {
    const { ctx: cg, page: pg } = await open(phone, 'demo=1&gas=1');
    const gasOutbox = () => pg.evaluate(() => loadOutbox());
    const gasRows = m => pg.evaluate(m => Object.values(MOCK.db).filter(Array.isArray).flat().filter(r => r && r.desc === m).length, m);
    const gasSettled = v => pg.waitForFunction(v => apiInflight === 0 && document.getElementById('syncBtn').dataset.sync === v, v, { timeout: 8000 });
    const gasAdd = async (amount, merchant) => {
      await pg.click('nav button[aria-label="Add transaction"]');
      await pg.fill('#inpAmount', amount);
      await pg.fill('#inpMerchant', merchant);
      await pg.click('#btnSubmitTx');
    };
    await step('Apps Script copy: starts through google.script.run, with no sign-out', async () => {
      assert.ok(await pg.evaluate(() => !!IS_GAS_ENV && MOCK.calls.length > 0));
      assert.ok(await pg.evaluate(() => ['menuSignOutItem', 'sideSignOutBtn'].every(id => document.getElementById(id).classList.contains('hidden'))));
    });
    await step('Apps Script copy: a spend the sheet turns down is kept and shown in red (not lost); a tap sends it again', async () => {
      const from = errors.length;
      try {
        await pg.evaluate(() => { MOCK.failWith = 'Invalid amount.'; MOCK.failNext = 1; });
        await gasAdd('2.75', 'Gas refused shop');
        await gasSettled('failed');
        const o = await gasOutbox();
        assert.ok(o.length === 1 && o[0].setAside === 'Invalid amount.', JSON.stringify(o));
        assert.ok((await pg.textContent('#toast span')).startsWith("Couldn't send Gas refused shop £2.75"));
        await pg.click('#syncBtn');
        await gasSettled('synced');
        assert.deepStrictEqual(await gasOutbox(), []);
        assert.strictEqual(await gasRows('Gas refused shop'), 1);
      } finally { await pg.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; }); dropExpectedSyncErrors(from); }
    });
    await step('Apps Script copy: a lost connection (NetworkError) keeps the spend waiting, in amber; a tap sends it, saved once', async () => {
      const from = errors.length;
      try {
        await pg.evaluate(() => { MOCK.dropNext = 1; });
        await gasAdd('1.95', 'Gas lost shop');
        await gasSettled('waiting');
        const o = await gasOutbox();
        assert.ok(o.length === 1 && !o[0].setAside && o[0].sentAt > 0, JSON.stringify(o));
        assert.ok((await pg.textContent('#toast span')).startsWith('No connection'), await pg.textContent('#toast span'));
        await pg.click('#syncBtn');
        await gasSettled('synced');
        assert.deepStrictEqual(await gasOutbox(), []);
        assert.strictEqual(await gasRows('Gas lost shop'), 1);
      } finally { dropExpectedSyncErrors(from); }
    });
    await step('Apps Script copy: saved, but the figures could not be read back: not kept, in the sheet once', async () => {
      const from = errors.length;
      try {
        const syncs = await sheetReads(pg);
        await failSavedNoState(pg);
        await gasAdd('0.85', 'Gas read back shop');
        await pg.waitForFunction(n => apiInflight === 0 && MOCK.calls.filter(c => c.action === 'getCachedSheetState').length > n, syncs);
        await gasSettled('synced');
        assert.deepStrictEqual(await gasOutbox(), []);
        assert.strictEqual(await gasRows('Gas read back shop'), 1);
      } finally { await resetFailures(pg); dropExpectedSyncErrors(from); }
    });
    await cg.close();
  }

  await step('shown inside another website\'s frame, the page stays blank and never starts (even if guard.js never arrives)', async () => {
    const c4 = await browser.newContext(desk);
    const p4 = await c4.newPage();
    for (const query of ['demo=1', 'demo=1&noguard=1']) {
      await p4.setContent(`<iframe src="http://localhost:${PORT}/tests/harness.html?${query}&latency=50" style="width:1200px;height:700px"></iframe>`);
      await p4.waitForFunction(() => document.querySelector('iframe').contentWindow.frames !== undefined);
      await p4.waitForTimeout(2000);
      const f = p4.frames().find(x => x.url().includes('harness.html'));
      const s = await f.evaluate(() => ({ framed: window.PF_FRAMED, display: getComputedStyle(document.documentElement).display,
        calls: window.MOCK ? MOCK.calls.length : -1, gsi: window.MOCK ? MOCK.gsi.initialize : -1, icons: document.querySelectorAll('svg').length,
        guard: [...document.scripts].some(x => /guard\.js/.test(x.src)) }));
      assert.deepStrictEqual(s, { framed: true, display: 'none', calls: 0, gsi: 0, icons: 0, guard: query === 'demo=1' }, query);
    }
    await c4.close();
  });
  await step('no page errors anywhere (nothing refused by the security policy either)', async () => {
    assert.deepStrictEqual(errors, [], JSON.stringify(errors));
  });
  await step('nothing was fetched from anywhere but this site (no Google Fonts)', async () => {
    assert.deepStrictEqual(offSite, [], JSON.stringify(offSite.slice(0, 5)));
  });

  await browser.close();
  server.close();
  finish();
})().catch(e => { console.error(e); process.exit(1); });
