// Screen tests, real Chrome: Daily amount, vs last month, the Owed message, and the home-screen shortcuts.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/extras.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { uiSuite, root, phone, calls } = require('../lib/ui');

uiSuite(async ({ browser, watch, open, step, PORT }) => {
  // ---------------- daily amount, vs last month, Owed message, home-screen shortcuts ----------------
  {
    // Opens the test page with "today" fixed (timers keep running), like open() in tests/lib/ui.js.
    const openAt = async (opts, when, query = 'demo=1') => {
      const c = await browser.newContext(opts);
      const p = watch(await c.newPage());
      if (when) await p.clock.setFixedTime(new Date(when));
      await p.goto(`http://localhost:${PORT}/tests/harness.html?${query}&latency=50`);
      await p.waitForFunction(() => document.getElementById('kpiNCA') && /£\d/.test(document.getElementById('kpiNCA').textContent));
      await p.waitForTimeout(400);
      return { c, p };
    };
    const txt = (p, sel) => p.evaluate(s => document.querySelector(s).textContent.replace(/\s+/g, ' ').trim(), sel);
    const isShown = (p, id) => p.evaluate(i => !document.getElementById(i).classList.contains('hidden'), id);

    let { c, p } = await openAt(phone, '2026-11-02T10:00:00');
    await step('daily amount: Money Left spread over the days to payday (30 Nov), with the payday date', async () => {
      const left = await p.evaluate(() => sheetFigures(state, skippedBudgetRows).eomSavingsJ);
      assert.ok(left > 0, 'test set-up: Money Left should be positive');
      assert.ok(await isShown(p, 'dailyStrip'));
      const want = '£' + (Math.floor(left / 28 * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' a day';
      assert.strictEqual(await txt(p, '#dailyLeft'), want);
      assert.strictEqual(await txt(p, '#dailyPayday'), 'Payday Mon 30 Nov');
    });
    await step('Money Left: one quiet line says what it is; no Breakdown button or drawer', async () => {
      assert.strictEqual(await txt(p, '#heroNote'), 'After cards and bills to pay');
      assert.ok(!(await p.$('#mathDrawer')), 'the Breakdown drawer is still on the page');
      assert.ok(!(await p.$('#heroSection button')), 'the Money Left card still has a button');
    });
    await step('What-If: skipping a bill shows the badge and takes it out of Money Left and the Bills total', async () => {
      const before = await p.evaluate(() => ({ left: sheetFigures(state, skippedBudgetRows).eomSavingsJ, bills: document.getElementById('budLeftVal').textContent }));
      const b = await p.evaluate(() => state.budgets.find(x => Number(x.amount) < 0));
      await p.click(`#upcomingBudgetsList button[aria-label="Simulate skipping ${b.name}"]`);
      const after = await p.evaluate(() => ({ left: sheetFigures(state, skippedBudgetRows).eomSavingsJ, bills: document.getElementById('budLeftVal').textContent, badge: !document.getElementById('simBadge').classList.contains('hidden') }));
      await p.click(`#upcomingBudgetsList button[aria-label="Simulate skipping ${b.name}"]`);
      assert.ok(after.badge, 'no What-If badge');
      assert.strictEqual(Math.round((after.left - before.left) * 100), Math.round(-b.amount * 100));
      assert.ok(/ to pay$/.test(after.bills) && after.bills !== before.bills, JSON.stringify([before, after]));
      assert.strictEqual(await txt(p, '#heroNote'), 'After cards and bills to pay');
    });
    await step('daily amount: over budget says how much over; payday itself says so; older months show none', async () => {
      await p.evaluate(() => renderDailyStrip(-12.3));
      assert.strictEqual(await txt(p, '#dailyLeft'), '£12.30 over');
      await p.evaluate(() => renderDailyStrip(sheetFigures(state, skippedBudgetRows).eomSavingsJ));
      await p.evaluate(() => switchMonth(MOCK.MONTH2));
      await p.waitForFunction(() => activeMonth === MOCK.MONTH2 && /£\d/.test(document.getElementById('kpiSurplus').textContent));
      await p.waitForTimeout(300);
      assert.ok(!(await isShown(p, 'dailyStrip')), 'an older month should not show a daily amount');
    });
    await c.close();
    ({ c, p } = await openAt(phone, '2026-11-30T09:00:00'));
    await step('daily amount: on payday it just says "Payday today"', async () => {
      assert.strictEqual(await txt(p, '#dailyLeft'), 'Payday today');
      assert.strictEqual(await txt(p, '#dailyPayday'), '');
    });
    await c.close();
    ({ c, p } = await openAt({ ...phone, viewport: { width: 344, height: 780 } }, '2026-11-02T10:00:00'));
    await step('daily amount fits a 344px phone on one line', async () => {
      const lines = await p.evaluate(() => { const r = document.getElementById('dailyStrip').getBoundingClientRect(); return Math.round(r.height); });
      assert.ok(lines <= 34, 'the strip wrapped: ' + lines + 'px tall');
    });
    await c.close();

    ({ c, p } = await openAt(phone, '2026-11-02T10:00:00'));
    await step('vs last month: fetched once, quietly, then a note on every category; the month on screen is untouched', async () => {
      const before = await p.evaluate(() => ({ month: activeMonth, last: localStorage.getItem('pf_last_month'), surplus: document.getElementById('kpiSurplus').textContent }));
      // A slow reply, and the dialog opened again (and redrawn) while it is still on its way.
      await p.evaluate(() => { MOCK.nextLatencies = [900]; openSpendModal(); });
      await p.waitForTimeout(150);
      await p.evaluate(() => { closeSpendModal(); openSpendModal(); renderSpend(); });
      await p.waitForFunction(() => /vs last month|Same as last month| · New/.test(document.getElementById('spendBody').textContent));
      await p.evaluate(() => { closeSpendModal(); openSpendModal(); });
      await p.waitForTimeout(300);
      const asked = await p.evaluate(() => MOCK.calls.filter(x => x.action === 'getCachedSheetState' && x.payload.sheetName === MOCK.MONTH2).length);
      assert.strictEqual(asked, 1, 'last month should be fetched once, not ' + asked + ' times');
      const notes = await p.$$eval('#spendBody button[data-cat] .text-xs', els => els.map(e => e.textContent));
      assert.ok(notes.length && notes.every(n => /vs last month|Same as last month| · New$/.test(n)), JSON.stringify(notes));
      const after = await p.evaluate(() => ({ month: activeMonth, last: localStorage.getItem('pf_last_month'), surplus: document.getElementById('kpiSurplus').textContent }));
      assert.deepStrictEqual(after, before);
    });
    await step('vs last month: the oldest month has nothing to compare with, so no notes', async () => {
      await p.evaluate(() => { closeSpendModal(); switchMonth(MOCK.MONTH2); });
      await p.waitForFunction(() => activeMonth === MOCK.MONTH2);
      await p.waitForTimeout(400);
      await p.evaluate(() => openSpendModal());
      await p.waitForTimeout(400);
      assert.ok(!/vs last month|Same as| · New/.test(await txt(p, '#spendBody')));
    });
    await c.close();

    ({ c, p } = await openAt(phone, null));
    await step('Owed: the share button sends a plain message with each item and the total', async () => {
      await p.evaluate(() => {
        window.__shared = null;
        Object.defineProperty(navigator, 'share', { configurable: true, value: d => { window.__shared = d.text; return Promise.resolve(); } });
        setView('pending');
      });
      const g = await p.evaluate(() => owedGroupsShown[0]);
      await p.click(`#panel_pending button[aria-label="Send ${g.name} what they owe"]`);
      await p.waitForFunction(() => window.__shared);
      const want = `Hi ${g.name}, here's what you owe me:\n\n` + g.items.map(r => r.what + '  £' + Number(r.amount).toFixed(2)).join('\n')
        + '\n\nTotal  £' + g.total.toFixed(2) + '\n\nThanks!';
      assert.strictEqual(await p.evaluate(() => window.__shared), want);
    });
    await step('Owed: without a share sheet (a computer), the message is copied and the page says so', async () => {
      await p.evaluate(() => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__copied = t; return Promise.resolve(); } } });
      });
      const name = await p.evaluate(() => owedGroupsShown[0].name);
      await p.click(`#panel_pending button[aria-label="Send ${name} what they owe"]`);
      await p.waitForFunction(() => window.__copied);
      assert.ok((await txt(p, '#toast')).startsWith('Copied. Paste it into a message to ' + name));
    });
    await step('Owed: cancelling the share sheet shows no error', async () => {
      await p.evaluate(() => {
        document.getElementById('toast').classList.add('hidden');
        Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })) });
      });
      const name = await p.evaluate(() => owedGroupsShown[0].name);
      await p.click(`#panel_pending button[aria-label="Send ${name} what they owe"]`);
      await p.waitForTimeout(300);
      assert.ok(await p.evaluate(() => document.getElementById('toast').classList.contains('hidden')), 'a toast appeared');
    });
    await step('Owed: if the browser refuses the share sheet (e.g. inside Apps Script), the message is copied instead', async () => {
      await p.evaluate(() => {
        window.__copied = null;
        Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' })) });
      });
      const name = await p.evaluate(() => owedGroupsShown[0].name);
      await p.click(`#panel_pending button[aria-label="Send ${name} what they owe"]`);
      await p.waitForFunction(() => window.__copied);
      assert.ok((await txt(p, '#toast')).startsWith('Copied.'));
    });
    await c.close();

    for (const [go, check, label] of [
      ['add', "!document.getElementById('addModal').classList.contains('hidden')", 'the Add form'],
      ['owed', "document.body.dataset.view === 'pending'", 'the Owed tab'],
      ['spending', "!document.getElementById('spendModal').classList.contains('hidden')", 'Spending details'],
    ]) {
      ({ c, p } = await openAt(phone, null, 'demo=1&go=' + go));
      await step(`shortcut ?go=${go} opens ${label}, and the address no longer carries it`, async () => {
        assert.ok(await p.evaluate(check), label + ' did not open');
        assert.ok(!(await p.evaluate(() => location.search)).includes('go='), 'the address still says go=');
      });
      await c.close();
    }
    {
      const c2 = await browser.newContext(phone);
      const p2 = watch(await c2.newPage());
      await p2.goto(`http://localhost:${PORT}/tests/harness.html?demo=1&token=none&go=owed&latency=50`);
      await p2.waitForFunction(() => window.MOCK && typeof MOCK.gsiCallback === 'function');
      await step('shortcut while signed out: the screen opens once you have signed in', async () => {
        assert.notStrictEqual(await p2.evaluate(() => document.body.dataset.view), 'pending');
        await p2.evaluate(() => MOCK.gsiCallback({ credential: MOCK.makeToken('owner@example.com') }));
        await p2.waitForFunction(() => document.body.dataset.view === 'pending');
      });
      await c2.close();
    }
    await step('the manifest offers the three shortcuts, all on this site', async () => {
      const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
      assert.deepStrictEqual(m.shortcuts.map(s => [s.name, s.url]), [['Add spend', '/?go=add'], ['Owed', '/?go=owed'], ['Spending', '/?go=spending']]);
    });
    // Chrome on Android picks a shortcut's icon from the ordinary ("any") ones: with only a maskable one the menu showed
    // blank squares. The same full-bleed picture is listed both ways, so it fills the circle either way.
    await step('each shortcut has its own full-bleed icon, listed as ordinary and maskable (192x192 PNG, on the site)', async () => {
      const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
      const srcs = m.shortcuts.map(s => {
        assert.deepStrictEqual(s.icons.map(i => i.purpose), ['any', 'maskable'], s.name + ': needs an ordinary icon (Chrome shows a blank square without one) and a maskable one');
        assert.strictEqual(s.icons[0].src, s.icons[1].src, s.name + ': both entries should be the same picture');
        const ic = s.icons[0];
        assert.strictEqual(ic.sizes, '192x192');
        const png = fs.readFileSync(path.join(root, ic.src));
        assert.strictEqual(png.toString('latin1', 1, 4), 'PNG', ic.src);
        assert.deepStrictEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [192, 192], ic.src + ' is not 192x192');
        return ic.src;
      });
      assert.strictEqual(new Set(srcs).size, 3, 'the shortcuts should not share an icon');
    });
  }
}).catch(e => { console.error(e); process.exit(1); });
