// Real-Chrome click-through of the main screens, using the test page (real index.html, pretend backend).
// Checks the redesigned layout and that every button still makes the right save.
//
//   set PW_PATH=C:\Users\JonfH\pf-tools\node_modules\playwright-core
//   node tests/ui-flows.test.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { chromium } = require(process.env.PW_PATH || 'playwright-core');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8129;
const { root, HOST, sendSiteFile } = require('./lib/site-files');
const server = http.createServer(sendSiteFile);

const results = [];
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

async function step(name, fn) {
  try { await fn(); results.push([true, name]); }
  catch (e) { results.push([false, name + '\n      ' + String(e.message).split('\n')[0]]); }
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
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const errors = [];
  const offSite = [];   // every request that leaves this test server (there should be none)
  const open = async (opts, query = 'demo=1') => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    // Anything the page's security policy refuses is reported here too ("Refused to load ...").
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400 && r.url().startsWith('http://localhost')) errors.push(r.status() + ' ' + r.url()); });
    page.on('request', r => { if (!/^(http:\/\/localhost|data:|blob:)/.test(r.url())) offSite.push(r.url()); });
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
    await page.click('#chevActivity');
    assert.ok(!(await visible(page, '#activityBody')), 'the ▾ on Home should still fold a section');
    await page.click('#chevActivity');
  });

  await step('owed: with one person owing, the header has no "All paid back" (theirs does the same job)', async () => {
    await page.evaluate(() => setView('home'));
    await page.click('nav [data-nav="pending"]');
    assert.strictEqual(await page.evaluate(() => owedGroupsShown.length), 1, 'test set-up: one person should owe');
    assert.ok(!(await visible(page, '#btnSettleAll')), 'header "All paid back" shows with one person');
    assert.ok(await visible(page, '.owed-groups button[data-person][onclick^="handleSettlePerson"]'), "that person's own button is missing");
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
    assert.ok(await visible(page, '#budgetFormBox'), 'edit form did not open');
    assert.ok(/^Edit /.test(await page.textContent('#budFormTitle')));
    await page.click('#budgetFormBox button[aria-label="Close"]');
    await page.click('#upcomingBudgetsList button[aria-label^="Simulate skipping"]');
    assert.ok(await visible(page, '#simBadge'), 'What-If badge should show');
    await page.click('#upcomingBudgetsList button[aria-label^="Simulate skipping"]');
  });

  await page.evaluate(SEED_OWED);

  await step('owed on Home: a short summary per person, not every item', async () => {
    assert.ok(await visible(page, '.owed-summary'), 'summary hidden');
    assert.ok(!(await visible(page, '.owed-groups')), 'full list should be hidden on Home');
    assert.ok(!(await visible(page, '#owedTabs')), 'Still owed / Paid back tabs should be hidden on Home');
    const people = await page.$$eval('.owed-summary > button[onclick="setView(\'pending\')"]', bs => bs.length);
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

  await step('leaving the Activity tab clears its filters; Home shows the latest 4, no filters, and "See all"', async () => {
    await page.click('#actSpend button[data-cat="Groceries"]');
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
  await ctx.close();

  // ---------------- layout: widths, wrapping, hit areas, contrast ----------------
  const VIEWS = ['home', 'budgets', 'pending', 'activity'];
  for (const [w, scheme] of [[344, 'dark'], [400, 'light'], [768, 'light']]) {
    ({ ctx, page } = await open({ viewport: { width: w, height: 860 }, isMobile: true, hasTouch: true, colorScheme: scheme }));
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
        bad = bad.concat(await check('#sec_budgets button[onclick="openBudgetForm()"]', 1));
        bad = bad.concat(await check('#chevBudgets, #chevPending, #chevActivity', 3));
        await page.evaluate(() => setView('pending'));
        bad = bad.concat(await check('.owed-groups button[aria-label$=" paid back"]', 10));
        bad = bad.concat(await check('#pill_pending, #pill_settled, #btnSettleAll', 3));
        bad = bad.concat(await check('.owed-groups button[onclick^="handleSettlePerson"]', 3));
        await page.evaluate(() => setView('budgets'));
        await page.evaluate(() => { document.getElementById('paidFold').open = true; });
        bad = bad.concat(await check('#clearedBudgetsList button:not([aria-label])', 1));
        await page.evaluate(() => setView('activity'));
        bad = bad.concat(await check('#txFilters button', 5));
        bad = bad.concat(await check('#actSpend button[data-cat]', 2));
        await page.evaluate(() => setView('home'));
        console.log('      hit areas: ' + report.join(' | '));
        assert.deepStrictEqual(bad, []);
      });
    }
    if (w !== 768) {
      await step(`${w}px ${scheme}: the small captions read at a contrast of at least 4.5:1`, async () => {
        const sels = ['#syncText', '#budClearedCount', '.owed-summary .text-xs'];
        const r = [];
        for (const s of sels) r.push([s, await contrastOf(page, s)]);
        await page.evaluate(() => setView('pending'));
        r.push(['.owed-groups span.block.text-xs', await contrastOf(page, '.owed-groups span.block.text-xs')]);
        await page.evaluate(() => setView('home'));
        console.log('      contrast ' + scheme + ': ' + r.map(x => x.join(' ')).join(', '));
        assert.deepStrictEqual(r.filter(x => x[1] < 4.5), []);
      });
    }
    if (w === 768) {
      await step('768px (unfolded): 4 account cards across; Bills beside Owed + Activity; one column on a tab', async () => {
        const tops = await page.$$eval('#tilesSection > div', d => d.map(x => Math.round(x.getBoundingClientRect().top)));
        assert.strictEqual(new Set(tops).size, 1, 'cards not in one row: ' + tops);
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
    await page.click('#budgetFormBox button:has-text("Save to Budgets")');
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
    assert.ok(await visible(page, '#budgetFormBox'), 'the edit form should open');
    assert.strictEqual(await page.inputValue('#inpBudName'), 'No amount bill');
    assert.strictEqual((await calls(page, 'updateBudgetRow')).length, before, 'should not save a guessed amount');
    await page.click('#budgetFormBox button[aria-label="Close"]');
  });

  await step('split chips come from the names the server sends (Marcus keeps its own colour)', async () => {
    await page.evaluate(() => { openAddModal(); selectSplit('custom'); });
    const ids = await page.$$eval('#personChips button[id^="chip_"]', b => b.map(x => x.id));
    assert.deepStrictEqual(ids, ['chip_kim', 'chip_lee', 'chip_robin', 'chip_sam', 'chip_jo', 'chip_marcus']);
    assert.ok((await page.getAttribute('#chip_kim', 'class')).includes('bg-emerald-500'), 'the quick-split person is picked by default');
    assert.ok((await page.getAttribute('#chip_marcus', 'class')).includes('text-amber-600'));
    await page.click('#chip_lee');
    assert.deepStrictEqual(await page.$$eval('#dynamicSplitRows input[type="text"]', i => i.map(x => x.value)), ['kim', 'lee']);
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
    await page.click('#dynamicSplitRows input[type="number"]');
    await page.keyboard.type('1');
    await page.evaluate(() => forceSyncSheet());
    await page.waitForTimeout(400);
    await page.keyboard.type('2');
    assert.strictEqual(await page.inputValue('#dynamicSplitRows input[type="number"]'), '12', 'the reply interrupted the typing');
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
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(!/[\w.+-]+@[\w-]+\.[\w.-]+/.test(html), 'found an email address in the page');
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

  await step('saved copies of months no longer in the sheet are cleared from this device', async () => {
    await page.evaluate(() => { localStorage.setItem('pf_cache_Gone Payday 2025', '{}'); localStorage.setItem('pf_tx_ts_Gone Payday 2025', '{}'); forceSyncSheet(); });
    await page.waitForTimeout(400);
    const left = await page.evaluate(() => Object.keys(localStorage).filter(k => /^pf_(cache|tx_ts)_/.test(k)));
    assert.ok(!left.some(k => k.includes('Gone')), left.join());
    assert.ok(left.includes('pf_cache_Test Payday 2026'), left.join());
  });

  const awayAndBack = (page, ms) => page.evaluate(away => {
    const realNow = Date.now;
    const vis = s => { Object.defineProperty(document, 'visibilityState', { value: s, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); };
    vis('hidden');
    Date.now = () => realNow() + away;
    try { vis('visible'); } finally { Date.now = realNow; }
  }, ms);

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
  await step('awkward text (quotes, <tags>, &) shows as text everywhere and injects nothing', async () => {
    await page.click('nav [data-nav="pending"]');
    const injected = await page.evaluate(() => document.querySelectorAll('main b').length);
    assert.strictEqual(injected, 0, 'a <b> tag from sheet text was turned into markup');
    const text = await page.textContent('main');
    assert.ok(text.includes('<b>bold</b>'), 'sheet text should appear literally');
    await page.click('nav [data-nav="activity"]');
    assert.strictEqual(await page.evaluate(() => document.querySelectorAll('main b').length), 0);
  });
  await ctx.close();

  // ---------------- desktop ----------------
  ({ ctx, page } = await open(desk));
  await page.evaluate(SEED_OWED);
  await step('desktop: every owed item grouped by person, no summary, no Activity-tab extras', async () => {
    assert.ok(await visible(page, '.owed-groups') && !(await visible(page, '.owed-summary')));
    assert.ok(await visible(page, '#owedTabs'));
    assert.ok(!(await visible(page, '#actSpend')));
    const rows = await page.$$eval('#txListContainer > .tx-row', d => d.length);
    assert.strictEqual(rows, 8);
    assert.ok(await visible(page, '#txFilters') && await visible(page, '#txSearch'), 'desktop keeps the Activity filters');
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
      assert.ok(await visible(page, 'aside button[onclick="openAddModal()"]'), 'no Add Transaction in the sidebar at ' + w + 'px');
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
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(html), 'the page still points at Google Fonts');
  });
  await step('the page carries its security policy: only this site, the backend and Google sign-in', async () => {
    const csp = await page.evaluate(() => (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || '');
    // Requests may go only to the backend's own address, not to any Apps Script project.
    const exec = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/const APPS_SCRIPT_EXEC_URL = '([^']+)'/)[1];
    ['default-src \'self\'', 'connect-src \'self\' ' + exec + ' https://script.googleusercontent.com https://accounts.google.com/gsi/;',
      'object-src \'none\'', 'form-action \'none\'', 'font-src \'self\''].forEach(d => assert.ok(csp.includes(d), 'missing: ' + d));
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
    assert.strictEqual(await page.$$eval('#dynamicSplitRows input[type="text"]', i => i.length), 0, 'nobody should be picked by default');
    await page.click('#personChips button:has-text("Other")');
    await page.fill('#dynamicSplitRows input[type="text"]', 'pat');
    await page.fill('#inpMerchant', 'Split shop');
    await page.fill('#inpAmount', '20');
    await page.click('#dynamicSplitRows input[type="number"]');
    await page.fill('#dynamicSplitRows input[type="number"]', '10');
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

  // ---------------- a Google account the server turns down ----------------
  {
    const c2 = await browser.newContext(desk);
    const p2 = await c2.newPage();
    p2.on('pageerror', e => errors.push(e.message));
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
      const p = await c.newPage();
      p.on('pageerror', e => errors.push(e.message));
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
      const p2 = await c2.newPage();
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

  await step('shown inside another website\'s frame, the page stays blank and never starts', async () => {
    const c4 = await browser.newContext(desk);
    const p4 = await c4.newPage();
    await p4.setContent(`<iframe src="http://localhost:${PORT}/tests/harness.html?demo=1&latency=50" style="width:1200px;height:700px"></iframe>`);
    await p4.waitForFunction(() => document.querySelector('iframe').contentWindow.frames !== undefined);
    await p4.waitForTimeout(2000);
    const f = p4.frames().find(x => x.url().includes('harness.html'));
    const s = await f.evaluate(() => ({ framed: window.PF_FRAMED, display: getComputedStyle(document.documentElement).display,
      calls: window.MOCK ? MOCK.calls.length : -1, gsi: window.MOCK ? MOCK.gsi.initialize : -1, icons: document.querySelectorAll('svg').length }));
    assert.deepStrictEqual(s, { framed: true, display: 'none', calls: 0, gsi: 0, icons: 0 });
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
  let failed = 0;
  results.forEach(([ok, name]) => { if (!ok) failed++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name); });
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
