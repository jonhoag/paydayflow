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
});
