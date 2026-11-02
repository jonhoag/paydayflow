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
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
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

(async () => {
  await new Promise(r => server.listen(PORT, r));
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
    assert.deepStrictEqual(names, ['Kim', 'Sam', 'Robin', 'Lee'], 'biggest amount owed first: ' + JSON.stringify(names));
    await page.click('.owed-groups button[aria-label="Mark Sam Lidl paid back"]');
    await page.waitForTimeout(250);
    const t = (await calls(page, 'toggleNeedFlag')).pop();
    assert.ok(t && t.setNeed === false, JSON.stringify(t));
    assert.strictEqual(await page.textContent('#cntPending'), '23');
  });

  await step('owed tab: "All paid back" for one person saves only their items', async () => {
    const before = await page.evaluate(() => state.checking.filter(r => r.need && /^robin/i.test(r.desc)).map(r => r.row).sort());
    await page.click('.owed-groups button[data-person="robin"]');
    await page.waitForTimeout(250);
    const s = (await calls(page, 'settleAllNeeds')).pop();
    assert.deepStrictEqual(s.rows.slice().sort(), before);
    assert.strictEqual(await page.textContent('#cntPending'), String(23 - before.length), 'count after: ' + (await page.textContent('#cntPending')) + ' rows ' + JSON.stringify(before));
    const left = await page.evaluate(() => state.checking.filter(r => r.need && /^robin/i.test(r.desc)).length);
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
  await step('the Inter font comes from this site and is in use', async () => {
    const font = await page.evaluate(async () => { await document.fonts.ready; return { loaded: document.fonts.check('600 16px Inter'), family: getComputedStyle(document.body).fontFamily }; });
    assert.ok(font.loaded, 'Inter did not load');
    assert.ok(/^"?Inter/.test(font.family), font.family);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(html), 'the page still points at Google Fonts');
  });
  await step('the page carries its security policy: only this site, the backend and Google sign-in', async () => {
    const csp = await page.evaluate(() => (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || '');
    ['default-src \'self\'', 'connect-src \'self\' https://script.google.com https://script.googleusercontent.com https://accounts.google.com/gsi/',
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
    });
    await step('then picking the right account on the button gets straight in', async () => {
      await p2.evaluate(() => { MOCK.authError = null; MOCK.gsiCallback({ credential: MOCK.makeToken('owner@example.com') }); });
      await p2.waitForFunction(() => getComputedStyle(document.getElementById('authLockScreen')).display === 'none' && /£\d/.test(document.getElementById('kpiNCA').textContent));
    });
    await c2.close();
  }

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
