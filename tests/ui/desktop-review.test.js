// Screen tests, real Chrome: Fixes from earlier reviews, checked on a desktop page.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/desktop-review.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const { awayAndBack } = require('../lib/runner');
const { uiSuite, appSource, phone, desk, calls, failSavedNoState, resetFailures, visible, owedCount, toastParts } = require('../lib/ui');

uiSuite(8143, async ({ errors, open, step, dropExpectedSyncErrors }) => {
  let ctx, page;
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

  // Audit 4.1: "All paid back" acts at once, so it gets "Done / Undo" like a delete. 3.9: one toast slot, so an Undo
  // covered by a newer message comes back afterwards; local add-times no longer mix up identical purchases.
  const UNDO_OWED = ['lee Undo cafe', 'jo Undo bus'];
  const sheetOwed = () => page.evaluate(n => MOCK.db.checking.filter(r => n.includes(r.desc)).map(r => r.need), UNDO_OWED);
  const toastHidden = () => page.evaluate(() => document.getElementById('toast').classList.contains('hidden'));
  await step('"All paid back" says what it did, with Undo; Undo marks them owed again, on screen and in the sheet', async () => {
    await page.evaluate(names => {
      const ch = MOCK.db.checking;
      ch.forEach(r => { r.need = false; });
      names.forEach((desc, i) => ch.push({ row: Math.max(...ch.map(r => r.row)) + 1, desc, amount: 4.5 + i, need: true }));
      forceSyncSheet();
    }, UNDO_OWED);
    await page.waitForFunction(() => apiInflight === 0 && state.checking.filter(r => r.need).length === 2);
    const toggles = (await calls(page, 'toggleNeedFlag')).length;
    await page.click('#btnSettleAll');
    assert.deepStrictEqual(await toastParts(page), ['Marked 2 items paid back', 'Undo']);
    await page.waitForFunction(() => apiInflight === 0);
    assert.deepStrictEqual(await sheetOwed(), [false, false], 'not paid back in the sheet');
    await page.click('#toastAction');
    assert.strictEqual(await owedCount(page), 2, 'Undo did not show them owed at once');
    await page.waitForFunction(() => apiInflight === 0);
    assert.deepStrictEqual(await sheetOwed(), [true, true], 'Undo did not mark them owed in the sheet');
    const sent = (await calls(page, 'toggleNeedFlag')).slice(toggles);
    assert.deepStrictEqual(sent.map(t => [t.setNeed, t.expect && t.expect.desc]).sort(), UNDO_OWED.map(d => [true, d]).sort(), JSON.stringify(sent));
    assert.strictEqual(await owedCount(page), 2);
  });
  await step('"All paid back" that didn\'t go through: Undo tapped before the reply sends nothing', async () => {
    const from = errors.length;
    try {
      const toggles = (await calls(page, 'toggleNeedFlag')).length;
      await page.evaluate(() => { MOCK.failNext = 1; MOCK.nextLatencies = [600]; });
      await page.click('#btnSettleAll');
      await page.click('#toastAction');   // while "All paid back" is still on its way
      await page.waitForFunction(() => apiInflight === 0 && MOCK.calls.filter(c => c.action === 'getCachedSheetState' && c.end).length > 0);
      await page.waitForTimeout(300);
      assert.strictEqual((await calls(page, 'toggleNeedFlag')).length, toggles, 'Undo sent ticks for a change that never happened');
      assert.deepStrictEqual(await sheetOwed(), [true, true]);
    } finally { await resetFailures(page); dropExpectedSyncErrors(from); }
  });
  await step('a refused "All paid back": once the failure message goes, its Undo does not come back', async () => {
    const from = errors.length;
    try {
      await page.waitForFunction(() => apiInflight === 0);
      await page.evaluate(() => { toastsAside.length = 0; MOCK.failNext = 1; });   // no older Undo waiting to come back
      await page.click('#btnSettleAll');
      await page.waitForFunction(() => apiInflight === 0 && /^Couldn't save All paid back/.test(document.querySelector('#toast span').textContent));
      await page.evaluate(() => closeToast());   // the failure message goes (an older Undo put aside may come back)
      assert.ok(await toastHidden(), 'the refused change\'s Undo came back: ' + (await toastParts(page)).join(' / '));
      assert.strictEqual(await owedCount(page), 2);
    } finally { await resetFailures(page); dropExpectedSyncErrors(from); }
  });
  await step('an Undo covered by a newer message comes back once that has gone, and still works', async () => {
    await page.waitForFunction(() => apiInflight === 0);
    await page.click('#btnSettleAll');
    await page.evaluate(() => showToast('Something else happened', { kind: 'info', duration: 400 }));
    assert.strictEqual((await toastParts(page))[0], 'Something else happened');
    await page.waitForFunction(() => !document.getElementById('toast').classList.contains('hidden')
      && document.querySelector('#toast span').textContent === 'Marked 2 items paid back', null, { timeout: 3000 });
    await page.waitForFunction(() => apiInflight === 0);
    await page.click('#toastAction');
    await page.waitForFunction(() => apiInflight === 0);
    assert.deepStrictEqual(await sheetOwed(), [true, true], 'the Undo that came back did not work');
  });
  await step('Undo of "All paid back" carries on past a row changed on another device meanwhile', async () => {
    await page.waitForFunction(() => apiInflight === 0);
    await page.click('#btnSettleAll');
    await page.waitForFunction(() => apiInflight === 0);
    // Changed elsewhere: the newest row, so the first one Undo sends (the list is newest first).
    await page.evaluate(d => { MOCK.db.checking.find(r => r.desc === d).amount = 99; }, UNDO_OWED[1]);
    await page.click('#toastAction');
    await page.waitForFunction(() => apiInflight === 0 && MOCK.calls.filter(c => c.action === 'getCachedSheetState').slice(-1)[0].end);
    assert.strictEqual((await calls(page, 'toggleNeedFlag')).slice(-2)[0].expect.desc, UNDO_OWED[1], 'the changed row was not sent first, so this proves nothing');
    assert.deepStrictEqual(await sheetOwed(), [true, false], 'the row after the refused one was not ticked again');
    dropExpectedStale();
    await page.evaluate(d => { const r = MOCK.db.checking.find(x => x.desc === d); r.amount = 5.5; r.need = true; forceSyncSheet(); }, UNDO_OWED[1]);
    await page.waitForFunction(() => apiInflight === 0);
  });
  await step('an Undo put aside never comes back over the lock screen', async () => {
    try {
      await page.evaluate(() => {
        showToast('Deleted "Lock test"', { kind: 'info', actionLabel: 'Undo', keep: true, duration: 9000, onAction() {} });
        showToast('Something else happened', { kind: 'info', duration: 300 });
        showLockScreen('Unlock to continue.', { noAuto: true });
      });
      await page.waitForTimeout(700);
      assert.ok(await toastHidden(), 'a toast shows over the lock screen: ' + (await toastParts(page)).join(' / '));
    } finally { await page.evaluate(() => hideLockScreen()); }
  });
  await step('(tidy up) the owed items these steps added are taken back out of the pretend sheet', async () => {
    await page.evaluate(names => { const ch = MOCK.db.checking; for (let i = ch.length - 1; i >= 0; i--) if (names.includes(ch[i].desc)) ch.splice(i, 1); forceSyncSheet(); }, UNDO_OWED);
    await page.waitForFunction(() => apiInflight === 0 && !state.checking.some(r => r.need));
  });
  await step('a repeat of an earlier purchase goes to the top of Activity; the earlier one keeps its place', async () => {
    await page.evaluate(() => {
      const a = MOCK.db.amex;
      ['Twin cafe', 'Between shop'].forEach((desc, i) => a.push({ row: Math.max(...a.map(r => r.row)) + 1, desc, amount: -3.1 + i }));
      forceSyncSheet();
    });
    await page.waitForFunction(() => apiInflight === 0 && state.amex.some(r => r.desc === 'Between shop'));
    await page.evaluate(() => {
      openAddModal();
      selectAcct('amex');
      document.getElementById('inpMerchant').value = 'Twin cafe';
      document.getElementById('inpAmount').value = '3.10';
      submitExpense();
    });
    await page.waitForFunction(() => apiInflight === 0 && state.amex.filter(r => r.desc === 'Twin cafe' && !r.pending).length === 2);
    const names = await page.$$eval('#txListContainer > .tx-row', els => els.map(e => e.getAttribute('aria-label') || e.textContent));
    assert.strictEqual(names[0], 'Edit Twin cafe', JSON.stringify(names));
    const twin = names.indexOf('Edit Twin cafe', 1), between = names.indexOf('Edit Between shop');
    assert.ok(twin === -1 || (between > -1 && twin > between), 'the earlier purchase jumped to the top too: ' + JSON.stringify(names));
    await page.evaluate(() => { const a = MOCK.db.amex; for (let i = a.length - 1; i >= 0; i--) if (/^(Twin cafe|Between shop)$/.test(a[i].desc)) a.splice(i, 1); forceSyncSheet(); });
    await page.waitForFunction(() => apiInflight === 0 && !state.amex.some(r => r.desc === 'Twin cafe'));
  });
  // Audit 3.5: the pretend server writes a spend and a new month the way the real one does.
  await step('a savings share and a refund split come back as the server writes them (Marcus row, "savings" row, signs)', async () => {
    await page.waitForFunction(() => apiInflight === 0);
    await page.evaluate(() => apiCall('addTransactionBundle', { sheetName: activeMonth, merchant: 'Shape shop', grossAmount: 30, isRefund: true,
      account: 'amex', splits: [{ person: 'Kim', amount: 5, need: true }], marcusShare: 10, markNeed: true, clientId: 'shape-1' }).then(applyServerState));
    await page.waitForFunction(() => apiInflight === 0);
    const rows = await page.evaluate(() => ['amex', 'marcus', 'checking'].flatMap(a => state[a].filter(r => /Shape shop$/.test(r.desc)).map(r => [a, r.desc, r.amount, !!r.need, r.clientTs > 0])));
    assert.deepStrictEqual(rows.sort(), [['amex', 'Shape shop', 30, false, true], ['checking', 'kim Shape shop', -5, true, true],
      ['checking', 'savings Shape shop', -10, true, true], ['marcus', 'Shape shop', 10, false, true]].sort(), JSON.stringify(rows));
    await page.evaluate(() => { Object.values(MOCK.db).filter(Array.isArray).forEach(a => { for (let i = a.length - 1; i >= 0; i--) if (/Shape shop$/.test(a[i].desc)) a.splice(i, 1); }); forceSyncSheet(); });
    await page.waitForFunction(() => apiInflight === 0 && !state.amex.some(r => r.desc === 'Shape shop'));
  });
  await step('Start New Month opens the month it made: balances carried, pay and savings in, owed items and the chosen bills at full amount', async () => {
    await page.waitForFunction(() => apiInflight === 0);
    try {
      await page.evaluate(() => {
        MOCK.db.checking.push({ row: Math.max(...MOCK.db.checking.map(r => r.row)) + 1, desc: 'kim Carried over', amount: 7.25, need: true });
        MOCK.db.budgets[0].amount = 0;   // the first bill paid this month
        forceSyncSheet();
      });
      await page.waitForFunction(() => apiInflight === 0 && state.checking.some(r => r.desc === 'kim Carried over'));
      const was = await page.evaluate(() => ({ s: sheetFigures(state, skippedBudgetRows), owed: state.checking.filter(r => r.need).map(r => [r.desc, r.amount]).sort(),
        bills: state.budgets.filter(b => b.isRecurring).map(b => [b.name, b.originalBudget]),   // repeating bills are ticked to carry over
        oneOff: state.budgets.filter(b => !b.isRecurring).length }));
      assert.ok(was.oneOff > 0, 'no one-off bill to leave behind, so this proves nothing');
      await page.evaluate(() => { openNewMonthModal(); document.getElementById('nmName').value = 'Made Payday 2027'; updateNewMonthName(); });
      const pay = Number(await page.inputValue('#nmPaycheck')), sav = Number(await page.inputValue('#nmSavings'));
      assert.ok(pay > 0 && sav > 0, 'this month has a paycheck and a savings transfer to start from');
      await page.click('#nmCreateBtn');
      await page.waitForFunction(() => apiInflight === 0 && activeMonth === 'Made Payday 2027', null, { timeout: 5000 });
      const now = await page.evaluate(() => ({ months: state.availableMonths.slice(0, 1), s: sheetFigures(state, skippedBudgetRows), owed: state.checking.filter(r => r.need).map(r => [r.desc, r.amount]).sort(),
        pay: state.checking.filter(r => r.desc === 'paycheck').map(r => r.amount), mine: state.marcus.filter(r => r.desc !== 'start').map(r => r.amount),
        bills: state.budgets.map(b => [b.name, b.amount]) }));
      assert.deepStrictEqual(now.months, ['Made Payday 2027'], 'not first in the month list');
      assert.deepStrictEqual(now.owed, was.owed, 'owed items not carried over');
      assert.deepStrictEqual(now.pay, [pay]);
      assert.deepStrictEqual(now.mine, [sav]);
      assert.strictEqual(+now.s.nCA.toFixed(2), +(was.s.nCA + pay - sav).toFixed(2), 'Nationwide does not carry over');
      assert.strictEqual(now.s.mSAV, +(was.s.mSAV + sav).toFixed(2));
      assert.strictEqual(now.s.amex, was.s.amex);
      assert.deepStrictEqual(now.bills, was.bills, 'the chosen bills are not back at their full amounts');
    } finally {
      await page.evaluate(() => {
        closeNewMonthModal();
        const i = MOCK.db.checking.findIndex(r => r.desc === 'kim Carried over');
        if (i > -1) MOCK.db.checking.splice(i, 1);
        MOCK.db.budgets[0].amount = MOCK.db.budgets[0].originalBudget;
        switchMonth(MOCK.MONTH, true);
      });
      await page.waitForFunction(() => apiInflight === 0 && activeMonth === MOCK.MONTH);
    }
  });
  await step('an entry edited in place goes to the top of Activity; an identical one in another row keeps its place', async () => {
    const rows = await page.evaluate(() => {
      const a = MOCK.db.amex, out = [];
      // Edit me in the lowest row, so only its edit time can bring it to the top. Rows well past any used before, so
      // none takes over a time the pretend server still holds for a row an earlier step took out.
      [['Edit me', -2], ['Twin cafe', -2], ['Between shop', -1]].forEach(([desc, amount]) => {
        const row = Math.max(...a.map(r => r.row)) + 20; a.push({ row, desc, amount }); out.push(row);
      });
      forceSyncSheet();
      return out;
    });
    await page.waitForFunction(() => apiInflight === 0 && state.amex.some(r => r.desc === 'Edit me'));
    await page.evaluate(row => openEditTxForRow('amex', row), rows[0]);
    await page.fill('#editTxDesc', 'Twin cafe');
    await page.click('#editTxModal button:has-text("Save")');
    await page.waitForFunction(() => apiInflight === 0 && !state.amex.some(r => r.desc === 'Edit me'));
    const order = await page.$$eval('#txListContainer > .tx-row', els => els.map(e => Number(e.dataset.row) + ' ' + e.getAttribute('aria-label')));
    assert.strictEqual(order[0], rows[0] + ' Edit Twin cafe', 'the edited entry is not at the top: ' + JSON.stringify(order));
    const twin = order.indexOf(rows[1] + ' Edit Twin cafe'), between = order.indexOf(rows[2] + ' Edit Between shop');
    assert.ok(twin === -1 || (between > -1 && twin > between), 'the identical entry in another row moved too: ' + JSON.stringify(order));
    await page.evaluate(() => { const a = MOCK.db.amex; for (let i = a.length - 1; i >= 0; i--) if (/^(Twin cafe|Between shop)$/.test(a[i].desc)) a.splice(i, 1); forceSyncSheet(); });
    await page.waitForFunction(() => apiInflight === 0 && !state.amex.some(r => r.desc === 'Twin cafe'));
  });
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
  await step("a save refused as STALE says 'changed on another device' whatever the words; STALE words coded ERROR do not", async () => {
    const from = errors.length;
    const edit = async (failWith, desc) => {
      await page.evaluate(f => { MOCK.failWith = f; MOCK.failNext = 1; const r = state.amex.find(x => !x.pending); openEditTxForRow('amex', r.row); }, failWith);
      await page.fill('#editTxDesc', desc);
      await page.click('#editTxModal button:has-text("Save")');
      await page.waitForFunction(() => MOCK.failNext === 0 && apiInflight === 0);
      return page.textContent('#toast span');
    };
    try {
      const a = await edit({ code: 'STALE', error: 'Mock server failure: someone got there first.' }, 'Coded stale edit');
      assert.ok(/changed on another device/.test(a), a);
      const b = await edit({ code: 'ERROR', error: 'STALE: This entry was changed on another device.' }, 'Uncoded stale edit');
      assert.ok(/^Couldn't save/.test(b), b);
    } finally {
      await page.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; });
      for (let i = errors.length - 1; i >= from; i--) if (/STALE: This entry was changed|Mock server failure/.test(errors[i])) errors.splice(i, 1);
    }
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
  // Audit 3.3: one source for Money Left and the balances: the rows on screen. The server's own summary is sent off
  // by £1,000 here, and the figures must not move.
  await step("Money Left and the balances come from the rows on screen, never the server's summary (also while saving)", async () => {
    const shown = () => page.evaluate(() => {
      const sum = l => +l.reduce((a, r) => a + Number(r.amount || 0), 0).toFixed(2);
      const nCA = sum(state.checking), amex = sum(state.amex), barclays = sum(state.barclays);
      const bills = sum(state.budgets.filter(b => !skippedBudgetRows.has(b.row)));
      return {
        screen: ['kpiNCA', 'kpiMarcus', 'kpiAmex', 'kpiBarclays', 'kpiSurplus'].map(id => document.getElementById(id).textContent),
        rows: [nCA, sum(state.marcus), amex, barclays, +(nCA + bills + amex + barclays).toFixed(2)].map(fmtGBP)
      };
    });
    const reads = () => page.evaluate(() => MOCK.calls.filter(c => c.action === 'getCachedSheetState' && c.end).length);
    try {
      // First, with the server's summary as it really is: the page's figures are the same as the server's.
      const server = await page.evaluate(async () => JSON.parse(await (await fetch('figures', { body: JSON.stringify({ action: 'getCachedSheetState', payload: { sheetName: activeMonth } }) })).text()).data.summary);
      const fromServer = await page.evaluate(s => [s.nCA, s.mSAV, s.amex, s.barclays, s.eomSavingsJ].map(fmtGBP), server);
      assert.deepStrictEqual((await shown()).screen, fromServer, "the page's figures differ from the server's");
      const n = await reads();
      await page.evaluate(() => { MOCK.summaryOff = 1000; forceSyncSheet(); });
      await page.waitForFunction(n => apiInflight === 0 && MOCK.calls.filter(c => c.action === 'getCachedSheetState' && c.end).length > n, n);
      let v = await shown();
      assert.deepStrictEqual(v.screen, v.rows, 'after a refresh');
      const amexBefore = await page.evaluate(() => state.amex.reduce((a, r) => a + Number(r.amount || 0), 0));
      await page.evaluate(() => { MOCK.nextLatencies = [1500]; openAddModal(); });
      await page.click('#acct_amex');
      await page.fill('#inpAmount', '2.00');
      await page.fill('#inpMerchant', 'Figures test shop');
      await page.click('#btnSubmitTx');
      await page.waitForFunction(() => state.amex.some(r => r.desc === 'Figures test shop' && r.pending));
      v = await shown();
      assert.deepStrictEqual(v.screen, v.rows, 'while saving');
      assert.strictEqual(v.screen[2], await page.evaluate(a => fmtGBP(+(a - 2).toFixed(2)), amexBefore), 'the spend still saving should already be in the Amex balance');
      await page.waitForFunction(() => apiInflight === 0 && state.amex.some(r => r.desc === 'Figures test shop' && !r.pending));
      v = await shown();
      assert.deepStrictEqual(v.screen, v.rows, 'after the save');
    } finally {
      await page.evaluate(() => {
        MOCK.summaryOff = 0;
        MOCK.db.amex = MOCK.db.amex.filter(r => r.desc !== 'Figures test shop');
        forceSyncSheet();
      });
      await page.waitForFunction(() => apiInflight === 0 && !state.amex.some(r => r.desc === 'Figures test shop'));
    }
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

  await step('new month: no reply, but the month was made: the page checks the sheet and opens it, never offering to make it again', async () => {
    await page.evaluate(() => {
      MOCK.badReplyNext = 1;   // the month is made, but its reply is lost
      openNewMonthModal();
      document.getElementById('nmName').value = 'Timed Out Payday 2026';
      updateNewMonthName();
    });
    const syncs = (await calls(page, 'getCachedSheetState')).length;
    await page.click('#nmCreateBtn');
    await page.waitForTimeout(1200);
    const toast = await page.textContent('#toast');
    assert.ok(/Made Timed Out Payday 2026/.test(toast), toast);
    assert.ok((await calls(page, 'getCachedSheetState')).length > syncs, 'should have looked at the sheet');
    assert.ok((await calls(page, 'getCachedSheetState')).some(c => c.sheetName === 'Timed Out Payday 2026'), 'should open the new month');
    await page.evaluate(() => switchMonth(MOCK.MONTH, true));
    await page.waitForTimeout(500);
  });

  await step('new month: no reply and not in the sheet: the page says so instead of "failed"', async () => {
    await page.evaluate(() => {
      MOCK.dropNext = 1;
      openNewMonthModal();
      document.getElementById('nmName').value = 'Never Made Payday 2026';
      updateNewMonthName();
    });
    await page.click('#nmCreateBtn');
    await page.waitForTimeout(1200);
    const toast = await page.textContent('#toast');
    assert.ok(/isn't in your sheet yet/.test(toast), toast);
    assert.ok(!/Couldn't create/.test(toast), toast);
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

  await step("new month: EXISTS in other words still says 'already exists'; its words coded ERROR do not", async () => {
    const from = errors.length;
    const create = async (failWith, name) => {
      await page.evaluate(([f, n]) => {
        MOCK.failWith = f; MOCK.failNext = 1;
        openNewMonthModal();
        document.getElementById('nmName').value = n;
        updateNewMonthName();
      }, [failWith, name]);
      await page.click('#nmCreateBtn');
      await page.waitForFunction(() => MOCK.failNext === 0 && apiInflight === 0);
      return page.textContent('#toast');
    };
    try {
      const a = await create({ code: 'EXISTS', error: 'Mock server failure: that month is there.' }, 'Coded Payday 2026');
      assert.ok(/already exists/.test(a), a);
      const b = await create({ code: 'ERROR', error: 'EXISTS: There is already a month called "Uncoded Payday 2026". Nothing was changed.' }, 'Uncoded Payday 2026');
      assert.ok(/Couldn't create the month/.test(b), b);
    } finally {
      await page.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; });
      dropExpectedSyncErrors(from);
    }
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
}).catch(e => { console.error(e); process.exit(1); });
