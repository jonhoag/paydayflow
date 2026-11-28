// Screen tests, real Chrome: Who's paying as one row and a list (Add and Edit sheets), "Someone paid for me" (an I owe),
// changing who's paying on a saved spend, and Owed showing what you owe apart from what you are owed.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/who-pays.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const { uiSuite, phone, calls, sendsAndSettles, toastSays, lineCounts } = require('../lib/ui');

uiSuite(async ({ open, step, errors, dropExpectedSyncErrors }) => {
  const { page } = await open(phone);
  const row = () => page.evaluate(() => ({
    label: document.getElementById('lblWho').textContent,
    main: document.getElementById('whoMain').textContent,
    sub: document.getElementById('whoSub').textContent,
    right: document.getElementById('whoRight').textContent.trim(),
    disabled: document.getElementById('whoRow').disabled,
    note: document.getElementById('whoNote').classList.contains('hidden') ? '' : document.getElementById('whoNote').textContent,
    tick: !document.getElementById('needToggleWrap').classList.contains('hidden'),
  }));
  const list = () => page.evaluate(() => ({
    open: !document.getElementById('whoListModal').classList.contains('hidden'),
    title: document.getElementById('whoListTitle').textContent,
    rows: [...document.querySelectorAll('#whoListRows [role="radio"]')].filter(b => b.getClientRects().length)
      .map(b => b.dataset.arg + (b.getAttribute('aria-checked') === 'true' ? '*' : '')),
  }));
  const fillAdd = async (amount, where, dir = 'spend') => {
    await page.evaluate(d => { openAddModal(); setTxDirection(d); document.activeElement.blur(); }, dir);
    await page.fill('#inpAmount', amount);
    await page.fill('#inpMerchant', where);
  };
  const pick = async kind => { await page.click('#whoRow'); await page.click(`#whoListRows [data-arg="${kind}"]`); };
  const rowOf = (acct, desc) => page.evaluate(([a, d]) => { const r = state[a].find(x => x.desc === d && !x.pending); return r && { row: r.row, amount: r.amount, need: r.need }; }, [acct, desc]);
  const openEdit = (acct, desc) => page.evaluate(([a, d]) => { const r = state[a].find(x => x.desc === d && !x.pending); openEditTxModal(a, r.row, r.desc, r.amount); document.activeElement.blur(); }, [acct, desc]);

  await step('Add: one row, "Just me · nobody owes you · Change"; no old chips or summary box', async () => {
    await fillAdd('40', 'Grocer');
    assert.deepStrictEqual(await row(), { label: "Who's Paying?", main: 'Just me', sub: 'nobody owes you', right: 'Change', disabled: false, note: '', tick: false });
    assert.strictEqual(await page.evaluate(() => !!document.getElementById('sp_half') || !!document.getElementById('cleanSplitPill')), false);
  });

  await step('a tap on the row opens the list (six choices for money out); one tap picks Half and closes it', async () => {
    await page.click('#whoRow');
    assert.deepStrictEqual(await list(), { open: true, title: "Who's paying?", rows: ['100_me*', 'half', 'all', 'custom', 'marcus', 'iowe'] });
    await page.click('#whoListRows [data-arg="half"]');
    assert.strictEqual((await list()).open, false);
    const r = await row();
    assert.deepStrictEqual([r.main, r.sub, r.tick], ['Half with Kim', 'Kim owes £20.00', true]);
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'whoRow', 'the focus did not go back to the row');
  });

  await step('Save sends the spend with Kim\'s half, in Owed (as before)', async () => {
    const p = await sendsAndSettles(page, 'addTransactionBundle', () => page.click('#btnSubmitTx'));
    assert.deepStrictEqual([p.merchant, Number(p.grossAmount), p.isRefund, p.splits, Number(p.marcusShare)],
      ['Grocer', 40, false, [{ person: 'kim', amount: 20, need: true }], 0]);
    assert.deepStrictEqual(await rowOf('checking', 'kim Grocer'), { row: (await rowOf('checking', 'kim Grocer')).row, amount: 20, need: true });
  });

  await step('Split with others shows the group box under the row; From Marcus says savings pays it', async () => {
    await fillAdd('40', 'Grocer 2');
    await pick('custom');
    await page.click('#chip_lee');
    let r = await row();
    assert.deepStrictEqual([r.main, r.sub, r.tick], ['Split with others', '£26.66 owed', true]);
    assert.ok(await page.evaluate(() => !document.getElementById('customSplitBox').classList.contains('hidden')));
    await pick('marcus');
    r = await row();
    assert.deepStrictEqual([r.main, r.sub], ['From Marcus', 'savings pays it']);
    assert.ok(await page.evaluate(() => document.getElementById('customSplitBox').classList.contains('hidden')));
    await page.evaluate(() => closeAddModal());
  });

  await step('money in: "Whose money is it?", its own five choices (no "Someone paid for me"), Half to Kim', async () => {
    await fillAdd('40', 'Refund', 'refund');
    let r = await row();
    assert.deepStrictEqual([r.label, r.main, r.sub], ['Whose money is it?', 'All mine', 'nothing to pass on']);
    await page.click('#whoRow');
    assert.deepStrictEqual(await list(), { open: true, title: 'Whose money is it?', rows: ['100_me*', 'half', 'all', 'custom', 'marcus'] });
    await page.click('#whoListRows [data-arg="half"]');
    r = await row();
    assert.deepStrictEqual([r.main, r.sub], ['Half to Kim', 'you pay Kim £20.00']);
    await page.evaluate(() => closeAddModal());
  });

  await step('Back (Escape) closes the list first, then the sheet', async () => {
    await fillAdd('10', 'x');
    await page.click('#whoRow');
    await page.keyboard.press('Escape');
    assert.deepStrictEqual([(await list()).open, await page.evaluate(() => !document.getElementById('addModal').classList.contains('hidden'))], [false, true]);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.evaluate(() => !document.getElementById('addModal').classList.contains('hidden')), false);
  });

  await step('Someone paid for me: Done needs who paid; then no card, "Whole bill", "Save: I owe Kim £20.00"', async () => {
    await fillAdd('40', 'Dinner');
    await page.click('#whoRow');
    await page.click('#whoListRows [data-arg="iowe"]');
    assert.deepStrictEqual([(await list()).title, await page.textContent('#lblIOweShare')], ['Someone paid for me', 'Your share of £40.00']);
    await page.click('#btnIOweDone');
    assert.strictEqual(await page.textContent('#iOweNameErr'), 'Pick who paid');
    await page.click('#iOweWho [data-person="kim"]');
    await page.click('#btnIOweDone');
    assert.strictEqual((await list()).open, false);
    const r = await row();
    assert.deepStrictEqual([r.main, r.sub, r.tick], ['Kim paid', 'you owe Kim £20.00', false]);
    assert.deepStrictEqual(await page.evaluate(() => [document.getElementById('addAcctBlock').classList.contains('hidden'),
      document.querySelector('label[for="inpAmount"]').textContent, document.getElementById('btnSubmitTx').textContent]), [true, 'Whole bill (£)', 'Save: I owe Kim £20.00']);
  });

  await step('Save sends addIOwe (your share only, no card); Owed shows "You owe £20.00" apart from what you are owed', async () => {
    const sentBundles = (await calls(page, 'addTransactionBundle')).length;
    const p = await sendsAndSettles(page, 'addIOwe', () => page.click('#btnSubmitTx'));
    assert.deepStrictEqual([p.iOwe, p.person, p.merchant, Number(p.grossAmount), !!p.clientId], [true, 'kim', 'Dinner', 20, true]);
    assert.strictEqual((await calls(page, 'addTransactionBundle')).length, sentBundles, 'an ordinary spend was sent too');
    assert.deepStrictEqual(await rowOf('checking', 'kim Dinner'), { row: (await rowOf('checking', 'kim Dinner')).row, amount: -20, need: true });
    const owed = await page.evaluate(() => ({
      head: [...document.querySelectorAll('#sumPending span')].map(s => s.textContent),
      kim: [...document.querySelectorAll('.owed-groups > div')].map(g => g.textContent.replace(/\s+/g, ' ')).find(t => / Kim /.test(' ' + t + ' ')),
    }));
    assert.strictEqual(owed.head.length, 2, JSON.stringify(owed.head));
    assert.ok(/ owed to you$/.test(owed.head[0]) && owed.head[1] === 'You owe £20.00', JSON.stringify(owed.head));
    // Kim is owed by you £20 for Dinner, and owes you £20 for Grocer: the line says the net in words.
    assert.ok(owed.kim, 'no Kim in Owed');
  });

  await step('Someone paid: a typed name and amount ("Mary Jane", £12.50); money in puts it back to All mine', async () => {
    await fillAdd('30', 'Taxi');
    await page.click('#whoRow');
    await page.click('#whoListRows [data-arg="iowe"]');
    await page.click('#iOweWho [data-person=""]');
    await page.fill('#iOweName', 'Mary Jane');
    await page.click('#iOweShare [data-arg="other"]');
    await page.fill('#iOweAmt', '12.50');
    await page.click('#btnIOweDone');
    assert.strictEqual(await page.textContent('#btnSubmitTx'), 'Save: I owe Mary-Jane £12.50');
    await page.click('#dir_refund');
    assert.deepStrictEqual([(await row()).main, await page.evaluate(() => document.getElementById('addAcctBlock').classList.contains('hidden'))], ['All mine', false]);
    await page.click('#dir_spend');
    await page.click('#whoRow');
    await page.click('#whoListRows [data-arg="iowe"]');
    await page.click('#btnIOweDone');   // the step remembers the name and amount
    const p = await sendsAndSettles(page, 'addIOwe', () => page.click('#btnSubmitTx'));
    assert.deepStrictEqual([p.person, Number(p.grossAmount)], ['mary-jane', 12.5]);
    // Someone you only owe: their line in Owed says so, in words.
    const mj = await page.evaluate(() => [...document.querySelectorAll('.owed-groups > div')].map(g => g.textContent.replace(/\s+/g, ' ')).find(t => /Mary-Jane/.test(t)));
    assert.ok(/1 item · you owe Mary-Jane £12\.50/.test(mj), mj);
  });

  await step('the step\'s choices count only on Done: closing it keeps Kim; the next Add starts with an empty name box', async () => {
    await fillAdd('40', 'Lunch');
    await page.click('#whoRow');
    await page.click('#whoListRows [data-arg="iowe"]');
    assert.strictEqual(await page.evaluate(() => [document.getElementById('iOweName').value, document.getElementById('iOweName').classList.contains('hidden')].join('|')), '|true',
      'the last name typed is still there');
    await page.click('#iOweWho [data-person="kim"]');
    await page.click('#btnIOweDone');
    await page.click('#whoRow');
    await page.click('#whoListRows [data-arg="iowe"]');
    await page.click('#iOweWho [data-person=""]');
    await page.fill('#iOweName', 'savings');
    await page.click('#iOweShare [data-arg="other"]');
    await page.click('[data-action="closeWhoList"]');
    assert.strictEqual(await page.textContent('#btnSubmitTx'), 'Save: I owe Kim £20.00');
    const p = await sendsAndSettles(page, 'addIOwe', () => page.click('#btnSubmitTx'));
    assert.deepStrictEqual([p.person, Number(p.grossAmount)], ['kim', 20]);
  });

  await step('a group split can\'t give a share to "savings" (that row is the Marcus share\'s)', async () => {
    await fillAdd('30', 'Cinema');
    await pick('custom');
    await page.click('#personChips button:has-text("Other")');
    await page.fill('#dynamicSplitRows .split-name >> nth=1', 'Savings');
    await page.fill('#dynamicSplitRows .split-amt >> nth=1', '5');
    const before = (await calls(page, 'addTransactionBundle')).length;
    await page.click('#btnSubmitTx');
    assert.ok(/kept for Marcus/.test(await page.textContent('#dynamicSplitRowsErr')));
    assert.strictEqual((await calls(page, 'addTransactionBundle')).length, before);
    await page.evaluate(() => closeAddModal());
  });

  await step('a share bigger than the whole bill is refused on the sheet', async () => {
    await fillAdd('10', 'Cab');
    await page.click('#whoRow');
    await page.click('#whoListRows [data-arg="iowe"]');
    await page.click('#iOweWho [data-person="lee"]');
    await page.click('#iOweShare [data-arg="other"]');
    await page.fill('#iOweAmt', '12');
    await page.click('#btnIOweDone');
    const before = (await calls(page, 'addIOwe')).length;
    await page.click('#btnSubmitTx');
    assert.ok(/more than the whole bill/.test(await page.textContent('#inpAmountErr')));
    assert.strictEqual((await calls(page, 'addIOwe')).length, before);
    await page.evaluate(() => closeAddModal());
  });

  await step('Edit: the saved Half shows in the same row; picking Just me says what saving does to Owed', async () => {
    await openEdit('amex', 'Grocer');
    let r = await row();
    assert.deepStrictEqual([r.main, r.sub, r.right, r.note], ['Half with Kim', 'Kim owes £20.00', 'Change', '']);
    await page.click('#whoRow');
    assert.deepStrictEqual((await list()).rows, ['100_me', 'half*', 'all', 'custom', 'marcus'], 'Edit offers "Someone paid for me"');
    await page.click('#whoListRows [data-arg="100_me"]');
    r = await row();
    assert.deepStrictEqual([r.main, r.note], ['Just me', "Was Half with Kim. Saving takes Kim's £20.00 off Owed."]);
  });

  await step('Save sends editSpendSplit with the old share as it was; Kim\'s share leaves Owed', async () => {
    const kim = await rowOf('checking', 'kim Grocer');
    const p = await sendsAndSettles(page, 'editSpendSplit', () => page.click('#btnSaveEditTx'));
    assert.deepStrictEqual([p.oldShares, p.splits, Number(p.marcusShare)],
      [[{ acct: 'checking', row: kim.row, expect: { desc: 'kim Grocer', amount: 20, need: true } }], [], 0]);
    assert.strictEqual(await rowOf('checking', 'kim Grocer'), undefined);
  });

  await step('Edit: Just me back to Half, then the amount changed: Kim\'s share follows it', async () => {
    await openEdit('amex', 'Grocer');
    await page.click('#whoRow');
    await page.click('#whoListRows [data-arg="half"]');
    assert.strictEqual((await row()).note, "Saving adds Kim's £20.00 to Owed.");
    assert.strictEqual((await row()).tick, false, 'Edit shows "Add to Owed" (an edit always puts new shares in Owed)');
    await page.fill('#editTxAmt', '60');
    assert.deepStrictEqual([(await row()).sub, (await row()).note], ['Kim owes £30.00', "Saving adds Kim's £30.00 to Owed."]);
    const p = await sendsAndSettles(page, 'editSpendSplit', () => page.click('#btnSaveEditTx'));
    assert.deepStrictEqual([p.oldShares, p.splits, Number(p.newAmount)], [[], [{ person: 'kim', amount: 30, need: true }], -60]);
    assert.deepStrictEqual(await rowOf('checking', 'kim Grocer'), { row: (await rowOf('checking', 'kim Grocer')).row, amount: 30, need: true });
    await openEdit('amex', 'Grocer');
    await page.fill('#editTxAmt', '50');
    assert.deepStrictEqual([(await row()).main, (await row()).note], ['Half with Kim', "Saving makes Kim's share £25.00."]);
    await page.evaluate(() => closeEditTxModal());
  });

  await step('a share paid back locks the row (no list; the note says to untick it in Owed); Save changes only the spend', async () => {
    const kim = await rowOf('checking', 'kim Grocer');
    await page.evaluate(r => toggleSplitNeed(r, false), kim.row);
    await page.waitForFunction(() => apiInflight === 0);
    await openEdit('amex', 'Grocer');
    const r = await row();
    assert.deepStrictEqual([r.main, r.sub, r.right, r.disabled], ['Half with Kim', 'paid back', 'Locked', true]);
    assert.strictEqual(r.note, "Kim's share has been paid back. To change who's paying, untick it under Paid back in Owed first.");
    await page.click('#whoRow', { force: true });
    assert.strictEqual((await list()).open, false);
    const splits = (await calls(page, 'editSpendSplit')).length;
    await page.fill('#editTxAmt', '55');
    await sendsAndSettles(page, 'editOrMoveTransaction', () => page.click('#btnSaveEditTx'));
    assert.strictEqual((await calls(page, 'editSpendSplit')).length, splits);
    assert.deepStrictEqual(await rowOf('checking', 'kim Grocer'), { row: kim.row, amount: 30, need: false });
  });

  await step('locked: a group split\'s box stays shut; renamed and moved in one save is refused; moved alone, the shares go with it as they are', async () => {
    await openEdit('amex', 'Grocer');
    assert.deepStrictEqual([(await row()).main, (await row()).right, await page.evaluate(() => document.getElementById('customSplitBox').classList.contains('hidden'))],
      ['Split with others', 'Locked', true], 'the group box of a locked split is open');
    await page.click('#etx_barclays');
    await page.fill('#editTxDesc', 'Grocers');
    await page.click('#btnSaveEditTx');
    assert.ok(/two saves/.test(await page.textContent('#editTxDescErr')));
    await page.fill('#editTxDesc', 'Grocer');
    const kim = await rowOf('checking', 'kim Grocer');
    const p = await sendsAndSettles(page, 'editSpendSplit', () => page.click('#btnSaveEditTx'));
    assert.deepStrictEqual([p.oldAcct, p.newAcct, p.oldShares, p.splits, Number(p.marcusShare)],
      ['amex', 'barclays', [{ acct: 'checking', row: kim.row, expect: { desc: 'kim Grocer', amount: 30, need: false } }], [{ person: 'kim', amount: 30, need: true }], 0]);
    assert.deepStrictEqual(await rowOf('checking', 'kim Grocer'), { row: kim.row, amount: 30, need: false }, 'the paid-back share changed');
    await openEdit('barclays', 'Grocer');   // found again by the new time
    assert.deepStrictEqual([(await row()).main, (await row()).right], ['Split with others', 'Locked']);
    await page.evaluate(() => closeEditTxModal());
  });

  await step('the server refusing a paid-back change (another device) says so, and the screen goes back', async () => {
    await fillAdd('20', 'Bakery');
    await pick('half');
    await sendsAndSettles(page, 'addTransactionBundle', () => page.click('#btnSubmitTx'));
    await openEdit('amex', 'Bakery');
    await pick('100_me');
    const from = errors.length;
    await page.evaluate(() => { MOCK.failWith = { code: 'SHARE_PAID_BACK', error: "A share of this spend has been paid back, so who's paying can't be changed. Untick it under Paid back in Owed first." }; MOCK.failNext = 1; });
    await page.click('#btnSaveEditTx');
    await toastSays(page, /has been paid back, so who's paying can't be changed/);
    await page.waitForFunction(() => apiInflight === 0);
    await page.evaluate(() => { MOCK.failWith = 'Mock server failure'; });
    assert.deepStrictEqual(await rowOf('checking', 'kim Bakery'), { row: (await rowOf('checking', 'kim Bakery')).row, amount: 10, need: true });
    dropExpectedSyncErrors(from);
    for (let i = errors.length - 1; i >= from; i--) if (/paid back/.test(errors[i])) errors.splice(i, 1);
  });

  await step('an "I owe" or a share itself has no Who\'s paying in Edit', async () => {
    await openEdit('checking', 'kim Dinner');
    assert.strictEqual(await page.evaluate(() => document.getElementById('whoBlock').classList.contains('hidden')), true);
    await page.evaluate(() => closeEditTxModal());
    await page.evaluate(() => openAddModal());
    assert.strictEqual(await page.evaluate(() => !document.getElementById('whoBlock').classList.contains('hidden') && document.getElementById('addModal').contains(document.getElementById('whoBlock'))), true,
      'the row did not go back to the Add sheet');
    await page.evaluate(() => closeAddModal());
  });

  await step('at 344px the row\'s words never wrap (each choice, money out and in, and in Edit)', async () => {
    await page.setViewportSize({ width: 344, height: 847 });
    const lines = [];
    for (const [dir, kinds] of [['spend', ['100_me', 'half', 'all', 'marcus', 'custom']], ['refund', ['100_me', 'half', 'all', 'marcus', 'custom']]]) {
      await fillAdd('1234.56', 'A long shop name');
      await page.evaluate(d => setTxDirection(d), dir);
      for (const k of kinds) {
        await page.evaluate(x => { selectSplit(x); if (x === 'custom') { togglePersonChip('lee'); togglePersonChip('robin'); } }, k);
        lines.push(...(await lineCounts(page, ['#whoMain', '#whoSub', '#whoRight', '#lblWho'])).map(x => dir + ' ' + k + ' ' + x));
        const fits = await page.evaluate(() => { const s = document.getElementById('whoSub'); return s.scrollWidth <= s.clientWidth + 1; });
        if (!fits) lines.push(dir + ' ' + k + ' #whoSub:cut off');
      }
      await page.evaluate(() => closeAddModal());
    }
    assert.deepStrictEqual(lines.filter(l => !/:1$/.test(l)), [], JSON.stringify(lines.filter(l => !/:1$/.test(l))));
    await page.setViewportSize(phone.viewport);
  });
});
