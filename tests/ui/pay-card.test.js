// Screen tests, real Chrome: paying off a card from its tile on Home ("Pay off Barclays" / "Pay off Amex"): money in
// on the card and out of the account it was paid from, as one save.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/pay-card.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const { uiSuite, phone, desk, calls, sendsAndSettles, visible } = require('../lib/ui');

uiSuite(async ({ open, step }) => {
  const { ctx, page } = await open(phone);
  const sheet = () => page.evaluate(() => ({
    open: !document.getElementById('payModal').classList.contains('hidden'),
    title: document.getElementById('payTitle').textContent,
    how: ['whole', 'part'].filter(k => document.getElementById('payHow_' + k).getAttribute('aria-pressed') === 'true'),
    from: [...document.querySelectorAll('#payFromList [role="radio"]')].map(b => b.dataset.arg + (b.getAttribute('aria-checked') === 'true' ? '*' : '')),
    pay: document.getElementById('btnPay').textContent.trim(),
    after: document.getElementById('payAfter').textContent.replace(/\s+/g, ' ').trim(),
    err: document.getElementById('payAmountErr').classList.contains('hidden') ? null : document.getElementById('payAmountErr').textContent,
  }));
  const owes = card => page.evaluate(c => cardOwes(c), card);

  await step('card tiles: tappable with a › while they owe something, the same height as the other tiles', async () => {
    const r = await page.evaluate(() => ({
      enabled: ['payTileAmex', 'payTileBarclays'].map(id => !document.getElementById(id).disabled),
      heights: ['payTileAmex', 'payTileBarclays', 'kpiNCA', 'kpiMarcus'].map(id => Math.round((document.getElementById(id).closest('#tilesSection > *')).getBoundingClientRect().height)),
      label: document.getElementById('payTileBarclays').getAttribute('aria-label'),
    }));
    assert.deepStrictEqual(r.enabled, [true, true]);
    assert.strictEqual(new Set(r.heights).size, 1, JSON.stringify(r.heights));
    assert.ok(/^Barclays −£[\d,.]+, pay it off$/.test(r.label), r.label);
    assert.ok(await visible(page, '#payTileBarclays .pay-cue'), 'no › on the Barclays tile');
  });

  await step('Barclays: opens with the whole balance and Nationwide picked; Marcus is the other choice', async () => {
    const due = await owes('barclays');
    await page.click('#payTileBarclays');
    const s = await sheet();
    assert.deepStrictEqual([s.open, s.title, s.how, s.from], [true, 'Pay off Barclays', ['whole'], ['checking*', 'marcus']]);
    assert.ok(s.pay === 'Pay ' + await page.evaluate(n => fmtGBP(n), due), s.pay);
    assert.ok(/^After this: Barclays £0\.00 • Nationwide /.test(s.after), s.after);
    await page.click('#payFromList [data-arg="marcus"]');
    assert.deepStrictEqual((await sheet()).from, ['checking', 'marcus*']);
    await page.click('#payFromList [data-arg="checking"]');
  });

  await step('Barclays: Pay sends one save (Barclays in, Nationwide out, both "Barclays CC Payment"); the card then owes nothing', async () => {
    const due = await owes('barclays');
    const nwBefore = await page.evaluate(() => balanceOf('checking'));
    const p = await sendsAndSettles(page, 'addCardPayment', () => page.click('#btnPay'));
    assert.deepStrictEqual([p.account, p.payFrom, p.isRefund, p.merchant, Number(p.grossAmount), p.splits, Number(p.marcusShare)],
      ['barclays', 'checking', true, 'Barclays CC Payment', due, [], 0]);
    assert.ok(p.clientId, 'no clientId, so a resend could save it twice');
    assert.ok(!(await sheet()).open, 'the sheet stays open');
    const r = await page.evaluate(() => ({ owes: cardOwes('barclays'), nw: balanceOf('checking'), tile: document.getElementById('payTileBarclays').disabled }));
    assert.deepStrictEqual(r, { owes: 0, nw: +(nwBefore - due).toFixed(2), tile: true });
    assert.ok(!(await visible(page, '#payTileBarclays .pay-cue')), 'the › stays on a card that owes nothing');
    assert.ok(await page.evaluate(() => SPEND_SKIP.test(spendKey('Barclays CC Payment'))), 'a payment would count as spending');
  });

  await step('Amex: Barclays is picked first, then Nationwide; "Part of it" takes a typed amount, never more than the card owes', async () => {
    const sent = (await calls(page, 'addCardPayment')).length;
    const due = await owes('amex');
    await page.click('#payTileAmex');
    assert.deepStrictEqual((await sheet()).from, ['barclays*', 'checking']);
    await page.click('#payHow_part');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'payAmount');
    let s = await sheet();
    assert.deepStrictEqual([s.how, s.pay, s.after], [['part'], 'Pay', 'Type how much you paid.']);
    await page.fill('#payAmount', String(due + 1));
    await page.click('#btnPay');
    s = await sheet();
    assert.ok(s.open && /^That's more than Amex owes/.test(s.err), JSON.stringify(s));
    assert.strictEqual((await calls(page, 'addCardPayment')).length, sent, 'sent a payment bigger than the balance');
    await page.fill('#payAmount', '100');
    s = await sheet();
    assert.ok(s.pay === 'Pay £100.00' && /^After this: Amex /.test(s.after), JSON.stringify(s));
    const p = await sendsAndSettles(page, 'addCardPayment', () => page.click('#btnPay'));
    assert.deepStrictEqual([p.account, p.payFrom, Number(p.grossAmount), p.merchant], ['amex', 'barclays', 100, 'Amex CC Payment']);
    assert.strictEqual(await owes('amex'), +(due - 100).toFixed(2));
  });

  await step('a typed amount with odd pennies is rounded once: the button, the check and what is sent all agree', async () => {
    await page.click('#payTileAmex');
    await page.click('#payHow_part');
    await page.fill('#payAmount', '1,0.244');   // not an amount
    await page.click('#btnPay');
    assert.strictEqual((await sheet()).err, 'Type an amount, like 12.50');
    await page.fill('#payAmount', '10.244');
    assert.strictEqual((await sheet()).pay, 'Pay £10.24');
    const p = await sendsAndSettles(page, 'addCardPayment', () => page.click('#btnPay'));
    assert.strictEqual(Number(p.grossAmount), 10.24);
  });

  await step('offline: the payment waits on this device, and the same card is not offered again until it has gone', async () => {
    const sent = (await calls(page, 'addCardPayment')).length;
    await ctx.setOffline(true);
    try {
      await page.click('#payTileBarclays');
      await page.click('#payHow_part');
      await page.fill('#payAmount', '5');
      await page.click('#btnPay');
      assert.deepStrictEqual(await page.evaluate(() => loadOutbox().map(x => [x.payload.account, x.payload.payFrom])), [['barclays', 'checking']]);
      await page.evaluate(() => { state = JSON.parse(JSON.stringify(state)); state.barclays = state.barclays.filter(r => !r.pending); renderAll(); });   // as after a sync
      await page.click('#payTileBarclays');
      assert.ok(!(await sheet()).open, 'a second payment was offered while the first waits');
      assert.ok(/Barclays payment is still waiting to send/.test(await page.textContent('#toast')));
    } finally { await ctx.setOffline(false); }
    await page.waitForFunction(n => MOCK.calls.filter(c => c.action === 'addCardPayment').length > n && loadOutbox().length === 0, sent, { timeout: 10000 });
  });

  await step('a backend from before card payments refuses one: it is set aside, and nothing is half-saved', async () => {
    const rows = () => page.evaluate(() => ['barclays', 'checking'].map(a => MOCK.db[a].filter(r => r.desc === 'Barclays CC Payment').length));
    const before = await rows();
    await page.evaluate(() => { MOCK.failWith = 'Unknown action: addCardPayment'; MOCK.failNext = 1; });
    try {
      await page.click('#payTileBarclays');
      await page.click('#payHow_part');
      await page.fill('#payAmount', '7');
      await page.click('#btnPay');
      await page.waitForFunction(() => loadOutbox().some(x => x.setAside), null, { timeout: 5000 });
      assert.deepStrictEqual(await rows(), before, 'the sheet changed');
      assert.ok(/Couldn't send Barclays CC Payment/.test(await page.textContent('#toast')));
    } finally {
      await page.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; saveOutbox([]); forceSyncSheet(); });
    }
  });

  await step('a card at £0 or in credit: no ›, the tile does nothing, and the sheet will not open', async () => {
    for (const amount of [0, 25]) {
      await page.evaluate(a => { state.amex = [{ row: 4, desc: 'start', amount: a }]; renderAll(); }, amount);
      assert.ok(await page.evaluate(() => document.getElementById('payTileAmex').disabled), 'tappable at ' + amount);
      assert.ok(!(await visible(page, '#payTileAmex .pay-cue')), '› shown at ' + amount);
      await page.evaluate(() => openPayCard('amex'));
      assert.ok(!(await sheet()).open, 'opened at ' + amount);
    }
    await page.evaluate(() => forceSyncSheet());
  });

  await step('Back / Escape closes the sheet', async () => {
    await page.waitForFunction(() => !document.getElementById('payTileBarclays').disabled || cardOwes('barclays') === 0);
    await page.evaluate(() => { state.barclays.push({ row: 30, desc: 'Shop', amount: -40 }); renderAll(); });
    await page.click('#payTileBarclays');
    await page.keyboard.press('Escape');
    assert.ok(!(await sheet()).open);
  });
  await ctx.close();

  await step('unfolded Fold (749x638): the sheet sits above the bottom bar, not on it', async () => {
    const { ctx: c2, page: p2 } = await open({ ...phone, viewport: { width: 749, height: 638 } });
    try {
      await p2.click('#payTileBarclays');
      await p2.click('#payHow_part');   // the taller form
      // Centred in the space above the bar (not in the whole screen, which would put it ~30px lower), clear of the bar.
      const r = await p2.evaluate(() => { const d = document.querySelector('#payModal [role="dialog"]').getBoundingClientRect();
        return { top: d.top, bottom: d.bottom, bar: document.querySelector('nav.fixed').getBoundingClientRect().top }; });
      assert.ok(r.bottom <= r.bar - 8, JSON.stringify(r));
      assert.ok(Math.abs((r.top + r.bottom) / 2 - r.bar / 2) <= 12, 'not centred above the bar: ' + JSON.stringify(r));
    } finally { await c2.close(); }
  });

  await step('desktop: a mouse over a card tile lights its edge; not over one that cannot be paid', async () => {
    const { ctx: c3, page: p3 } = await open(desk);
    try {
      const edge = id => p3.evaluate(i => getComputedStyle(document.getElementById(i)).borderTopColor, id);
      const before = await edge('payTileBarclays');
      await p3.hover('#payTileBarclays');
      assert.notStrictEqual(await edge('payTileBarclays'), before, 'no hover hint');
      await p3.evaluate(() => { state.amex = [{ row: 4, desc: 'start', amount: 0 }]; renderAll(); });
      const off = await edge('payTileAmex');
      await p3.hover('#payTileAmex');
      assert.strictEqual(await edge('payTileAmex'), off, 'a card that owes nothing lights up');
    } finally { await c3.close(); }
  });
});
