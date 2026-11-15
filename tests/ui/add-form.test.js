// Screen tests, real Chrome: The quicker Add form on a phone: Amount first, Enter to move on, splits, and what it
// says when something is missing.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/add-form.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const { uiSuite, phone, calls, visible } = require('../lib/ui');

uiSuite(async ({ watch, open, step }) => {
  const { ctx, page } = await open(phone);
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
  await ctx.close();
}).catch(e => { console.error(e); process.exit(1); });
