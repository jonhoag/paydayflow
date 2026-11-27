// Screen tests, real Chrome: the Spending sheet asks the server for category choices (made on other devices) at most
// once every 10 minutes, not on every open, and only redraws when they changed.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/spending.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const { uiSuite, phone, calls, settles, toastSays, resetFailures } = require('../lib/ui');

uiSuite(async ({ open, step, errors, dropExpectedSyncErrors }) => {
  const { page } = await open(phone);
  const asked = async () => (await calls(page, 'getCategoryChoices')).length;
  const idle = () => settles(page, () => apiInflight === 0 && MOCK.calls.every(c => c.end), 10000);
  const openSpend = async () => { await page.evaluate(() => openSpendModal()); await idle(); };
  const closeSpend = () => page.evaluate(() => closeSpendModal());

  await step('first open asks for the category choices once', async () => {
    await idle();
    const before = await asked();
    await openSpend();
    assert.strictEqual(await asked(), before + 1);
    await closeSpend();
  });

  await step('opening again within 10 minutes asks nothing more', async () => {
    const before = await asked();
    await openSpend(); await closeSpend();
    await openSpend(); await closeSpend();
    assert.strictEqual(await asked(), before);
  });

  await step('after 10 minutes the next open asks again, and a choice made on another device shows in the open sheet', async () => {
    const before = await asked();
    await page.evaluate(() => { MOCK.categoryChoices['music sub'] = 'Shopping'; categoriesFetchedAt -= CATEGORIES_FRESH_MS + 1; });
    await openSpend();
    assert.strictEqual(await asked(), before + 1);
    assert.strictEqual(await page.evaluate(() => loadSpendOverrides()['music sub']), 'Shopping');
    assert.ok(await page.evaluate(() => /Shopping/.test(document.getElementById('spendBody').textContent)), 'the open sheet was not redrawn');
    await closeSpend();
  });

  await step('an unchanged reply does not redraw the open sheet', async () => {
    await page.evaluate(() => { categoriesFetchedAt = 0; });
    await page.evaluate(() => openSpendModal());
    await page.evaluate(() => { document.getElementById('spendBody').firstElementChild.dataset.mark = '1'; });
    await idle();
    assert.strictEqual(await page.evaluate(() => document.getElementById('spendBody').firstElementChild.dataset.mark), '1', 'the sheet was redrawn');
    await closeSpend();
  });

  await step('a fetch with no reply is tried again on the next open', async () => {
    await page.evaluate(() => { categoriesFetchedAt = 0; MOCK.dropNext = 1; });
    const before = await asked();
    try {
      await openSpend(); await closeSpend();
      await openSpend(); await closeSpend();
      assert.strictEqual(await asked(), before + 2, 'not asked again after the failure');
    } finally { await resetFailures(page); }
  });

  await step('a category change the server refuses goes back to the server copy on the next open', async () => {
    await idle();
    const from = errors.length;
    await page.evaluate(() => { MOCK.failNext = 1; setSpendCategory('music sub', 'Travel'); });
    try {
      await toastSays(page, /Couldn't save that category change/);
      await idle();
      await closeSpend();
      const before = await asked();
      await openSpend();
      assert.strictEqual(await asked(), before + 1, 'did not fetch again after the refused change');
      assert.strictEqual(await page.evaluate(() => loadSpendOverrides()['music sub']), 'Shopping');
      await closeSpend();
    } finally { await resetFailures(page); dropExpectedSyncErrors(from); }
  });

  // Mine | Total: a month with a shared spend (Lidl £73.60 on Amex in the demo) and Kim paying back half of it.
  const sheet = () => page.evaluate(() => ({
    mine: document.getElementById('sv_mine').getAttribute('aria-pressed'),
    head: document.getElementById('spendHead') && document.getElementById('spendHead').innerText.replace(/\s+/g, ' ').trim(),
    groceries: (document.querySelector('#spendBody button[data-cat="Groceries"]') || { innerText: '' }).innerText.match(/£[\d,.]+/)[0],
    act: document.querySelector('#actSpend .text-2xl') && document.querySelector('#actSpend .text-2xl').textContent,
  }));
  const withPayback = () => page.evaluate(() => { state.checking.push({ row: 900, desc: 'kim Lidl', amount: 36.8, need: true }); renderAll(); });
  const tidy = () => page.evaluate(() => { state.checking = state.checking.filter(r => r.row !== 900); setSpendView('mine'); localStorage.removeItem('pf_spend_view'); closeSpendModal(); setView('home'); });
  await step('Mine (the default): a payback on Nationwide comes off its shop; the line says what was charged', async () => {
    try {
      // A device that has never chosen: opened afresh, with nothing stored.
      await page.goto(page.url().replace(/[?&]keep=1/, ''));
      await page.waitForFunction(() => /£\d/.test(document.getElementById('kpiNCA').textContent) && apiInflight === 0);
      await withPayback();
      await openSpend();
      const s = await sheet();
      assert.deepStrictEqual([s.mine, s.groceries], ['true', '£36.80']);
      assert.ok(/^Your spending · .+ £79\.99 of £116\.79 charged/.test(s.head), s.head);
      const bars = await page.$$eval('#spendBody .items-end > div > span:first-child', els => els.map(e => e.textContent));
      assert.ok(bars.includes('£79.99') && !bars.includes('£116.79'), 'month bars should show your share: ' + JSON.stringify(bars));
    } finally { await tidy(); }
  });
  await step('Total: tapped, it shows the cards as charged and what was paid back; the Activity tab follows; tapping Mine goes back', async () => {
    try {
      await withPayback();
      await openSpend();
      await page.click('#sv_total');
      const s = await sheet();
      assert.deepStrictEqual([s.mine, s.groceries], ['false', '£73.60']);
      assert.ok(/^Spent on cards · .+ £116\.79 £36\.80 paid back to you/.test(s.head), s.head);
      await closeSpend();
      await page.evaluate(() => setView('activity'));
      assert.strictEqual((await sheet()).act, '£116.79');
      await openSpend();
      await page.click('#sv_mine');
      await closeSpend();
      assert.strictEqual((await sheet()).act, '£79.99');
    } finally { await tidy(); }
  });
  await step('the choice is kept on this device: after a reload Spending opens on Total', async () => {
    try {
      await openSpend();
      await page.click('#sv_total');
      await page.goto(page.url().replace(/[?&]keep=1/, '') + '&keep=1');
      await page.waitForFunction(() => /£\d/.test(document.getElementById('kpiNCA').textContent) && apiInflight === 0);
      await openSpend();
      assert.strictEqual((await sheet()).mine, 'false');
    } finally { await tidy(); }
  });
  await step('all paid back: the Activity chip goes (and its list filter with it); the sheet still lists the category at £0.00', async () => {
    try {
      await page.evaluate(() => { state.checking.push({ row: 900, desc: 'kim Lidl', amount: 73.6 }); setSpendView('total'); setView('activity'); setActCat('Groceries'); setSpendView('mine'); });
      const r = await page.evaluate(() => ({ cat: actCat, rows: document.querySelectorAll('#txListContainer > .tx-row').length,
        all: ['amex', 'barclays', 'checking', 'marcus'].reduce((n, a) => n + state[a].filter(x => x.desc.toLowerCase() !== 'start').length, 0) }));
      assert.deepStrictEqual([r.cat, r.rows], [null, r.all]);
      await openSpend();   // a category all paid back stays in the sheet, at £0.00, so its shops can still be seen
      assert.strictEqual((await sheet()).groceries, '£0.00');
      const order = () => page.$$eval('#spendBody button[data-cat]', els => els.map(e => e.dataset.cat));
      const mineOrder = await order();
      await page.click('#sv_total');
      const totalOrder = await order();
      assert.deepStrictEqual([mineOrder[0], mineOrder[mineOrder.length - 1], totalOrder[0]], ['Entertainment', 'Groceries', 'Groceries']);
    } finally { await tidy(); }
  });
  await step('no ring and no category colours: one accent, neutral icons', async () => {
    await openSpend();
    const r = await page.evaluate(() => ({
      rings: document.querySelectorAll('#spendModal svg circle, #actSpend svg circle').length,
      tinted: [...document.querySelectorAll('#spendBody [style*="background:#"], #actSpend [style*="background:#"]')].length,
    }));
    assert.deepStrictEqual(r, { rings: 0, tinted: 0 });
    await closeSpend();
  });
});
