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
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

const results = [];
async function step(name, fn) {
  try { await fn(); results.push([true, name]); }
  catch (e) { results.push([false, name + '\n      ' + String(e.message).split('\n')[0]]); }
}

// 21 extra "owed" items (Amanda 10, Napier 4 more, Shannon 4, Nita 3) on top of the demo data.
const SEED_OWED = `(async () => {
  const add = [['amanda Tesco', 23.4], ['amanda Pret', 6.85], ['amanda Uber', 14.2], ['amanda Boots', 9.99], ['amanda Cinema', 12.5],
    ['amanda Deliveroo', 18.75], ['amanda Sainsburys', 31.1], ['amanda Trainline', 22.6], ['amanda Costa', 4.3], ['amanda Zara', 27.5],
    ['napier Nandos', 15.4], ['napier Spoons', 11.2], ['napier Five Guys', 13.95], ['napier Greggs', 3.8],
    ['shannon Airbnb', 64], ['shannon Petrol', 25], ['shannon M&S', 8.45], ['shannon Lidl', 12.3],
    ['nita Gift', 20], ['nita Pizza', 16.7], ['nita Parking', 4.5]];
  const ch = MOCK.db.checking;
  add.forEach(([desc, amount]) => ch.push({ row: Math.max(...ch.map(r => r.row)) + 1, desc, amount, need: true }));
  [['Tesco', -46.8], ['Deliveroo', -37.5], ['Amazon', -32.99]].forEach(([desc, amount]) => MOCK.db.amex.push({ row: Math.max(...MOCK.db.amex.map(r => r.row)) + 1, desc, amount }));
  forceSyncSheet();
  await new Promise(r => setTimeout(r, 900));
})()`;

const calls = (page, action) => page.evaluate(a => MOCK.calls.filter(c => c.action === a).map(c => c.payload), action);
const visible = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; }, sel);

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const errors = [];
  const open = async (opts, query = 'demo=1') => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400 && r.url().startsWith('http://localhost')) errors.push(r.status() + ' ' + r.url()); });
    await page.goto(`http://localhost:${PORT}/tests/harness.html?${query}&latency=50`);
    await page.waitForFunction(() => document.getElementById('kpiNCA') && /£/.test(document.getElementById('kpiNCA').textContent) && window.MOCK && MOCK.calls.length > 0);
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

  await step('bottom bar reads Home, Bills, Owed, Activity', async () => {
    const labels = await page.$$eval('nav [data-nav]', bs => bs.map(b => b.textContent.trim()));
    assert.deepStrictEqual(labels, ['Home', 'Bills', 'Owed', 'Activity']);
  });

  await step('bills: Paid saves the bill as paid, Restore brings it back', async () => {
    const first = await page.$eval('#upcomingBudgetsList button[aria-label^="Mark"]', b => b.getAttribute('aria-label'));
    await page.click('#upcomingBudgetsList button[aria-label^="Mark"]');
    await page.waitForTimeout(250);
    const paid = (await calls(page, 'updateBudgetRow')).pop();
    assert.ok(paid && paid.newAmount === 0, 'expected updateBudgetRow with 0, got ' + JSON.stringify(paid));
    const name = first.replace(/^Mark | paid$/g, '');
    assert.ok((await page.textContent('#clearedBudgetsList')).includes(name), 'bill should move to Already Paid');
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
    assert.strictEqual(people, 5, 'four people plus the "See everything owed" button');
    assert.strictEqual(await page.textContent('#cntPending'), '24');
  });

  await step('owed tab: grouped by person; one tick marks one item paid back', async () => {
    await page.click('.owed-summary button:has-text("See everything owed")');
    assert.strictEqual(await page.evaluate(() => document.body.dataset.view), 'pending');
    assert.ok(await visible(page, '.owed-groups') && !(await visible(page, '.owed-summary')));
    assert.ok(await visible(page, '#heroSection') === false, 'Owed tab should show only the Owed section');
    const names = await page.$$eval('.owed-groups .text-sm.font-semibold.truncate', els => els.map(e => e.textContent));
    assert.deepStrictEqual(names, ['Amanda', 'Shannon', 'Napier', 'Nita'], 'biggest amount owed first: ' + JSON.stringify(names));
    await page.click('.owed-groups button[aria-label="Mark Shannon Lidl paid back"]');
    await page.waitForTimeout(250);
    const t = (await calls(page, 'toggleNeedFlag')).pop();
    assert.ok(t && t.setNeed === false, JSON.stringify(t));
    assert.strictEqual(await page.textContent('#cntPending'), '23');
  });

  await step('owed tab: "All paid back" for one person saves only their items', async () => {
    const before = await page.evaluate(() => state.checking.filter(r => r.need && /^napier/i.test(r.desc)).map(r => r.row).sort());
    await page.click('.owed-groups button[data-person="napier"]');
    await page.waitForTimeout(250);
    const s = (await calls(page, 'settleAllNeeds')).pop();
    assert.deepStrictEqual(s.rows.slice().sort(), before);
    assert.strictEqual(await page.textContent('#cntPending'), String(23 - before.length), 'count after: ' + (await page.textContent('#cntPending')) + ' rows ' + JSON.stringify(before));
    const left = await page.evaluate(() => state.checking.filter(r => r.need && /^napier/i.test(r.desc)).length);
    assert.strictEqual(left, 0);
  });

  await step('owed tab: Paid back list has Undo, which puts an item back', async () => {
    await page.click('#pill_settled');
    assert.ok(await visible(page, '#panel_settled'));
    const n = Number(await page.textContent('#cntPending'));
    await page.click('#panel_settled button:has-text("Undo")');
    await page.waitForTimeout(250);
    const t = (await calls(page, 'toggleNeedFlag')).pop();
    assert.ok(t && t.setNeed === true);
    assert.strictEqual(Number(await page.textContent('#cntPending')), n + 1);
    await page.click('#pill_pending');
  });

  await step('activity tab: spending on top, full list, no "Show all"', async () => {
    await page.click('nav [data-nav="activity"]');
    assert.ok(await visible(page, '#actSpend'), 'spending summary hidden');
    assert.ok(/Activity$/.test((await page.textContent('#sec_activity h2')).trim()) && !(await visible(page, '.act-title-home')));
    const rows = await page.$$eval('#txListContainer > div', d => d.length);
    const total = await page.evaluate(() => ['amex', 'barclays', 'checking', 'marcus'].reduce((n, a) => n + state[a].filter(r => r.desc.toLowerCase() !== 'start').length, 0));
    assert.strictEqual(rows, total, 'should list every transaction');
    assert.ok(!(await page.$('#sec_activity button:has-text("Show all")')));
  });

  await step('activity tab: tapping a category chip filters the list to that category', async () => {
    await page.click('#actSpend button[data-cat="Groceries"]');
    const names = await page.$$eval('#txListContainer > div .truncate', els => els.map(e => e.textContent));
    assert.ok(names.length >= 2, 'expected grocery rows, got ' + JSON.stringify(names));
    const cats = await page.evaluate(n => n.map(x => categoryFor(x, loadSpendOverrides())), names);
    assert.ok(cats.every(c => c === 'Groceries'), JSON.stringify(names));
    assert.ok((await page.textContent('#actSpend')).includes('Groceries on cards'));
    await page.click('#actSpend button[data-cat="Groceries"]');
    assert.ok((await page.textContent('#actSpend')).includes('Spent on cards this month'));
  });

  await step('leaving the Activity tab clears the filter; Home shows the latest few', async () => {
    await page.click('#actSpend button[data-cat="Groceries"]');
    await page.click('nav [data-nav="home"]');
    const rows = await page.$$eval('#txListContainer > div', d => d.length);
    assert.strictEqual(rows, 8);
    assert.ok(await page.$('#sec_activity button:has-text("Show all")'));
    assert.ok(!(await visible(page, '#actSpend')));
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
    await page.click('#txListContainer > div:has-text("Flow test shop")');
    assert.ok(await visible(page, '#editTxModal'));
    await page.fill('#editTxDesc', 'Flow test shop 2');
    await page.click('#editTxModal button:has-text("Save")');
    await page.waitForTimeout(300);
    const e = (await calls(page, 'editOrMoveTransaction')).pop();
    assert.ok(e && e.newDesc === 'Flow test shop 2' && e.expect && e.expect.desc === 'Flow test shop', JSON.stringify(e));
    await page.click('#txListContainer > div:has-text("Flow test shop 2")');
    await page.click('#editTxModal button:has-text("Delete")');
    await page.waitForTimeout(300);
    const d = (await calls(page, 'deleteTransactionRow')).pop();
    assert.ok(d && d.expect && d.expect.desc === 'Flow test shop 2', JSON.stringify(d));
    await page.click('#toastAction');
    await page.waitForTimeout(300);
    assert.ok((await page.textContent('#txListContainer')).includes('Flow test shop 2'), 'Undo should bring it back');
  });

  await step('Escape closes the Add form', async () => {
    await page.click('nav button[aria-label="Add transaction"]');
    await page.keyboard.press('Escape');
    assert.ok(!(await visible(page, '#addModal')));
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
    const rows = await page.$$eval('#txListContainer > div', d => d.length);
    assert.strictEqual(rows, 8);
  });
  await step('desktop light mode: the sidebar is light too', async () => {
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).backgroundColor);
    assert.strictEqual(bg, 'rgb(255, 255, 255)');
  });
  await ctx.close();

  await step('no page errors anywhere', async () => {
    assert.deepStrictEqual(errors, [], JSON.stringify(errors));
  });

  await browser.close();
  server.close();
  let failed = 0;
  results.forEach(([ok, name]) => { if (!ok) failed++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name); });
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
