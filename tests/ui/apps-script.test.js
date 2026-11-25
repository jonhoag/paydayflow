// Screen tests, real Chrome: The copy of the page Apps Script serves, and the page inside another website's frame.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/apps-script.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const { uiSuite, phone, desk, calls, failSavedNoState, resetFailures, sheetReads, BUSY } = require('../lib/ui');

uiSuite(async ({ browser, errors, open, step, PORT, dropExpectedSyncErrors }) => {
  // ---------------- the copy of the page Apps Script serves ----------------
  {
    const { ctx: cg, page: pg } = await open(phone, 'demo=1&gas=1');
    const gasOutbox = () => pg.evaluate(() => loadOutbox());
    const gasRows = m => pg.evaluate(m => Object.values(MOCK.db).filter(Array.isArray).flat().filter(r => r && r.desc === m).length, m);
    const gasSettled = v => pg.waitForFunction(v => apiInflight === 0 && document.getElementById('syncBtn').dataset.sync === v, v, { timeout: 8000 });
    const gasAdd = async (amount, merchant) => {
      await pg.click('nav button[aria-label="Add spend"]');
      await pg.fill('#inpAmount', amount);
      await pg.fill('#inpMerchant', merchant);
      await pg.click('#btnSubmitTx');
    };
    await step('Apps Script copy: starts through google.script.run, with no sign-out', async () => {
      assert.ok(await pg.evaluate(() => !!IS_GAS_ENV && MOCK.calls.length > 0));
      assert.ok(await pg.evaluate(() => ['menuSignOutItem', 'sideSignOutBtn'].every(id => document.getElementById(id).classList.contains('hidden'))));
    });
    await step('Apps Script copy: a spend the sheet turns down is kept and shown in red (not lost); a tap sends it again', async () => {
      const from = errors.length;
      try {
        await pg.evaluate(() => { MOCK.failWith = 'Invalid amount.'; MOCK.failNext = 1; });
        await gasAdd('2.75', 'Gas refused shop');
        await gasSettled('failed');
        const o = await gasOutbox();
        assert.ok(o.length === 1 && o[0].setAside === 'Invalid amount.', JSON.stringify(o));
        assert.ok((await pg.textContent('#toast span')).startsWith("Couldn't send Gas refused shop £2.75"));
        await pg.click('#syncBtn');
        await gasSettled('synced');
        assert.deepStrictEqual(await gasOutbox(), []);
        assert.strictEqual(await gasRows('Gas refused shop'), 1);
      } finally { await pg.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; }); dropExpectedSyncErrors(from); }
    });
    await step("Apps Script copy: the code in front of the message decides: BUSY in other words waits, and isn't shown", async () => {
      const from = errors.length;
      try {
        await pg.evaluate(() => { MOCK.failWith = { code: 'BUSY', error: 'Mock server failure: another save is under way.' }; MOCK.failNext = 1; });
        await gasAdd('2.65', 'Gas busy shop');
        await gasSettled('waiting');
        const o = await gasOutbox();
        assert.ok(o.length === 1 && !o[0].setAside, 'BUSY should wait: ' + JSON.stringify(o));
        await pg.click('#syncBtn');
        await gasSettled('synced');
        assert.strictEqual(await gasRows('Gas busy shop'), 1);
        await pg.evaluate(() => { MOCK.failWith = { code: 'ERROR', error: 'Lock timeout: words only.' }; MOCK.failNext = 1; });
        await gasAdd('2.85', 'Gas uncoded shop');
        await gasSettled('failed');
        const o2 = await gasOutbox();
        assert.ok(o2.length === 1 && o2[0].setAside === 'Lock timeout: words only.', 'set aside, without the [code]: ' + JSON.stringify(o2));
        await pg.click('#syncBtn');
        await gasSettled('synced');
        assert.deepStrictEqual(await gasOutbox(), []);
      } finally { await pg.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; }); dropExpectedSyncErrors(from); }
    });
    await step('Apps Script copy: a lost connection (NetworkError) keeps the spend waiting, in amber; a tap sends it, saved once', async () => {
      const from = errors.length;
      try {
        await pg.evaluate(() => { MOCK.dropNext = 1; });
        await gasAdd('1.95', 'Gas lost shop');
        await gasSettled('waiting');
        const o = await gasOutbox();
        assert.ok(o.length === 1 && !o[0].setAside && o[0].sentAt > 0, JSON.stringify(o));
        assert.ok((await pg.textContent('#toast span')).startsWith('No connection'), await pg.textContent('#toast span'));
        await pg.click('#syncBtn');
        await gasSettled('synced');
        assert.deepStrictEqual(await gasOutbox(), []);
        assert.strictEqual(await gasRows('Gas lost shop'), 1);
      } finally { dropExpectedSyncErrors(from); }
    });
    await step('Apps Script copy: saved, but the figures could not be read back: not kept, in the sheet once', async () => {
      const from = errors.length;
      try {
        const syncs = await sheetReads(pg);
        await failSavedNoState(pg);
        await gasAdd('0.85', 'Gas read back shop');
        await pg.waitForFunction(n => apiInflight === 0 && MOCK.calls.filter(c => c.action === 'getCachedSheetState').length > n, syncs);
        await gasSettled('synced');
        assert.deepStrictEqual(await gasOutbox(), []);
        assert.strictEqual(await gasRows('Gas read back shop'), 1);
      } finally { await resetFailures(pg); dropExpectedSyncErrors(from); }
    });
    await cg.close();
  }

  await step('shown inside another website\'s frame, the page stays blank and never starts (even if guard.js never arrives)', async () => {
    const c4 = await browser.newContext(desk);
    const p4 = await c4.newPage();
    for (const query of ['demo=1', 'demo=1&noguard=1']) {
      await p4.setContent(`<iframe src="http://localhost:${PORT}/tests/harness.html?${query}&latency=50" style="width:1200px;height:700px"></iframe>`);
      const frame = await (await p4.waitForSelector('iframe')).contentFrame();
      await frame.waitForLoadState('load');
      await p4.waitForTimeout(300);   // kept on purpose (nothing must happen): past load, when the app would have started
      const f = p4.frames().find(x => x.url().includes('harness.html'));
      const s = await f.evaluate(() => ({ framed: window.PF_FRAMED, display: getComputedStyle(document.documentElement).display,
        calls: window.MOCK ? MOCK.calls.length : -1, gsi: window.MOCK ? MOCK.gsi.initialize : -1, icons: document.querySelectorAll('svg').length,
        guard: [...document.scripts].some(x => /guard\.js/.test(x.src)) }));
      assert.deepStrictEqual(s, { framed: true, display: 'none', calls: 0, gsi: 0, icons: 0, guard: query === 'demo=1' }, query);
    }
    await c4.close();
  });
}).catch(e => { console.error(e); process.exit(1); });
