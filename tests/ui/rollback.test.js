// Screen tests, real Chrome: A failed save with the sheet out of reach puts the screen and this phone's saved copy
// back (audit 1.1).
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/rollback.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const { uiSuite, phone, desk, calls, SAVED_NO_STATE, resetFailures, sheetReads, visible } = require('../lib/ui');

uiSuite(async ({ browser, errors, watch, open, step, PORT, dropExpectedSyncErrors }) => {
  const { ctx, page } = await open(phone);
  // Audit 1.1: a change is shown straight away. If its save fails and the sheet can't be read either (offline), the
  // screen and this phone's saved copy go back to how they were, instead of keeping a change the sheet never got.
  // A save that did reach the sheet ('saved', only its figures couldn't be read back) is kept.
  const shownNow = () => page.evaluate(() => ({ state: JSON.stringify(state), saved: localStorage.getItem(CACHE_PREFIX + activeMonth),
    screen: document.getElementById('mainGrid').textContent.replace(/\s+/g, ' ') }));
  // The save turned down, or no reply to it; either way the sheet read that follows it gets no reply either.
  const NOT_SAVED = {
    refused: () => page.evaluate(() => { MOCK.failNext = 1; MOCK.dropReadsNext = 1; }),
    reach: () => page.evaluate(() => { MOCK.dropNext = 2; })   // the save, then the read
  };
  // Does `act` (which changes the screen at once), with the save failing as `fail` sets up; returns what was shown
  // before, straight after, and once the save and the sheet read that follows have both failed.
  const failedSave = async (act, fail) => {
    await page.waitForFunction(() => apiInflight === 0);
    const before = await shownNow(), reads = await sheetReads(page);
    await fail();
    await act();
    const changed = await shownNow();
    await page.waitForFunction(n => apiInflight === 0 && MOCK.calls.filter(c => c.action === 'getCachedSheetState').length > n, reads);
    return { before, changed, after: await shownNow() };
  };
  const rolledBack = (r, what) => {
    assert.notStrictEqual(r.changed.state, r.before.state, what + ': the change was not shown at once, so this proves nothing');
    assert.strictEqual(r.after.state, r.before.state, what + ': the screen\'s figures did not go back');
    assert.strictEqual(r.after.saved, r.before.state, what + ': the saved copy does not hold the figures shown before');
    assert.strictEqual(r.after.screen, r.before.screen, what + ': the screen did not go back');
  };
  const rollbackStep = (what, act, kinds = ['refused']) => step('a failed save with the sheet out of reach puts the screen and saved copy back: ' + what, async () => {
    const from = errors.length;
    try {
      for (const kind of kinds) rolledBack(await failedSave(act, NOT_SAVED[kind]), what + ' (' + kind + ')');
    } finally { await resetFailures(page); dropExpectedSyncErrors(from); }
  });
  const openTx = desc => page.click(`#txListContainer > .tx-row:has-text("${desc}")`);
  const firstSavedTx = () => page.evaluate(() => state.amex.find(r => !r.pending).desc);

  await page.evaluate(() => setView('home'));
  await rollbackStep('a transaction edit', async () => {
    await openTx(await firstSavedTx());
    await page.fill('#editTxDesc', 'Rolled back edit');
    await page.click('#editTxModal button:has-text("Save")');
  }, ['refused', 'reach']);
  await rollbackStep('a transaction moved to another card', async () => {
    await openTx(await firstSavedTx());
    await page.click('#etx_barclays');
    await page.click('#editTxModal button:has-text("Save")');
  });
  await rollbackStep('a transaction deleted', async () => {
    await openTx(await firstSavedTx());
    await page.click('#editTxModal button:has-text("Delete")');
  }, ['refused', 'reach']);
  await rollbackStep('a bill marked paid', () => page.click('#upcomingBudgetsList button[aria-label^="Mark"]'));
  await rollbackStep('a bill edited', async () => {
    await page.click('#upcomingBudgetsList button[aria-label^="Edit"]');
    await page.fill('#inpBudAmt', '123.45');
    await page.click('#budSaveBtn');
  });
  await rollbackStep('a new bill', async () => {
    await page.click('#btnAddBill');
    await page.fill('#inpBudName', 'Rolled back bill');
    await page.fill('#inpBudAmt', '9.99');
    await page.click('#budSaveBtn');
  });
  await rollbackStep('a bill deleted', async () => {
    await page.click('#upcomingBudgetsList button[aria-label^="Edit"]');
    await page.click('#budDeleteBtn');
  });
  // Separate from the step above: here the delete itself is saved, and it is the Undo's re-add that fails.
  await step('a failed save with the sheet out of reach puts the screen and saved copy back: a deleted bill brought back by Undo', async () => {
    const from = errors.length;
    let bill = null;
    try {
      await page.click('#upcomingBudgetsList button[aria-label^="Edit"]');
      const name = await page.inputValue('#inpBudName');
      bill = await page.evaluate(n => JSON.parse(JSON.stringify(state.budgets.find(b => b.name === n && !b.pending))), name);
      await page.click('#budDeleteBtn');
      await page.waitForFunction(() => apiInflight === 0);
      rolledBack(await failedSave(() => page.click('#toastAction'), NOT_SAVED.refused), 'Undo of a bill deletion');
    } finally {
      await resetFailures(page);
      // Tidy up: the bill goes back in the pretend sheet (not through the toast: that is what failed).
      if (bill) { await page.evaluate(b => undoDeleteBudget(b, activeMonth), bill); await page.waitForFunction(() => apiInflight === 0); }
      dropExpectedSyncErrors(from);
    }
  });
  await page.evaluate(() => setView('pending'));
  await rollbackStep('an owed item ticked as paid back', () => page.click('.owed-groups button[aria-label^="Mark"][aria-label$="paid back"]'), ['refused', 'reach']);
  await rollbackStep('"All paid back" for one person', () => page.click('.owed-groups button[data-action="handleSettlePerson"]'));
  await step('a save that reached the sheet but whose figures could not be read back is kept on screen and in the saved copy', async () => {
    const from = errors.length;
    try {
      const r = await failedSave(() => page.click('.owed-groups button[aria-label^="Mark"][aria-label$="paid back"]'),
        () => page.evaluate(t => { MOCK.failWith = t; MOCK.failAfterWriteNext = 1; MOCK.dropReadsNext = 2; }, SAVED_NO_STATE));
      assert.notStrictEqual(r.changed.state, r.before.state, 'the tick was not shown at once');
      assert.strictEqual(r.after.state, r.changed.state, 'a saved change was rolled back');
      assert.strictEqual(r.after.saved, r.changed.saved, 'a saved change was taken out of the saved copy');
      await page.waitForFunction(() => MOCK.dropReadsNext === 0 && apiInflight === 0, null, { timeout: 9000 });   // the second try, 5 s later
    } finally { await resetFailures(page); dropExpectedSyncErrors(from); }
  });
  await page.evaluate(() => { setView('home'); forceSyncSheet(); });
  await page.waitForFunction(() => apiInflight === 0);

  await step("bills: Undo of a delete that didn't go through adds nothing (the bill is still in the sheet, so it would be there twice)", async () => {
    const from = errors.length;
    try {
      await page.click('#upcomingBudgetsList button[aria-label^="Edit"]');
      const name = await page.inputValue('#inpBudName');
      const saves = (await calls(page, 'saveBudgetItem')).length;
      await page.evaluate(() => { MOCK.failNext = 1; MOCK.nextLatencies = [600]; });   // slow, so Undo is tapped before the reply
      await page.click('#budDeleteBtn');
      await page.click('#toastAction');
      await page.waitForFunction(() => apiInflight === 0);
      await page.waitForTimeout(200);
      assert.strictEqual((await calls(page, 'saveBudgetItem')).length, saves, 'Undo sent the bill again');
      assert.strictEqual(await page.evaluate(n => MOCK.db.budgets.filter(b => b.name === n).length, name), 1);
      assert.strictEqual(await page.evaluate(n => state.budgets.filter(b => b.name === n).length, name), 1);
    } finally { await resetFailures(page); await page.evaluate(() => { MOCK.nextLatencies = []; }); dropExpectedSyncErrors(from); }
  });
  await step('Edit: saving with no description says so under the box, and sends nothing', async () => {
    const edits = (await calls(page, 'editOrMoveTransaction')).length;
    await openTx(await firstSavedTx());
    await page.fill('#editTxDesc', '  ');
    await page.click('#editTxModal button:has-text("Save")');
    assert.ok(await visible(page, '#editTxDescErr'), 'no message under the box');
    assert.strictEqual(await page.textContent('#editTxDescErr'), 'Add where it was');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'editTxDesc');
    assert.ok(await visible(page, '#editTxModal'), 'the form closed');
    await page.waitForTimeout(150);
    assert.strictEqual((await calls(page, 'editOrMoveTransaction')).length, edits, 'an edit was sent');
    await page.keyboard.press('Escape');
    await openTx(await firstSavedTx());
    assert.ok(!(await visible(page, '#editTxDescErr')), 'the message was still there when Edit opened again');
    await page.keyboard.press('Escape');
  });
  await step('row numbers from the sheet or a saved copy are always numbers (they go into the page markup)', async () => {
    const r = await page.evaluate(() => {
      const s = numberRows({ summary: {}, budgets: [{ row: '7"><b>x' }], amex: [{ row: '12' }] });
      return [Number.isNaN(s.budgets[0].row), s.amex[0].row];
    });
    assert.deepStrictEqual(r, [true, 12]);
  });
  await step("a damaged saved copy of the month doesn't stop the app opening: it is passed over and the figures fetched", async () => {
    const ctx = await browser.newContext(desk);
    await ctx.addInitScript(() => {
      localStorage.setItem('pf_last_month', 'Test Payday 2026');
      localStorage.setItem('pf_cache_Test Payday 2026', JSON.stringify({ activeMonth: 'Test Payday 2026', summary: { nCA: 1 }, budgets: 'damaged', checking: [null] }));
    });
    const from = errors.length;
    try {
      const p = watch(await ctx.newPage());
      await p.goto(`http://localhost:${PORT}/tests/harness.html?demo=1&keep=1&latency=50`);
      await p.waitForFunction(() => window.MOCK && MOCK.MONTH === 'Test Payday 2026' && MOCK.calls.length > 0 && apiInflight === 0 && /£\d/.test(document.getElementById('kpiNCA').textContent));
      assert.deepStrictEqual(errors.slice(from), [], 'the page failed');
      assert.ok(await p.evaluate(() => state.budgets.length > 0), 'the figures were not fetched');
    } finally { await ctx.close(); }
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
}).catch(e => { console.error(e); process.exit(1); });
