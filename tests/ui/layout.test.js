// Screen tests, real Chrome: Layout at every width the app is used at (344 to 1280 px, folded and unfolded): no
// sideways scrolling, no wrapping labels, hit areas, contrast.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/layout.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const { uiSuite, phone, monthBars, SEED_OWED, calls, lineCounts, hitAreas } = require('../lib/ui');

// The page never scrolls sideways, and no balance spills out of its card.
const noSideways = page => page.evaluate(() => ({ width: innerWidth, sideways: document.documentElement.scrollWidth > innerWidth,
  kpi: [...document.querySelectorAll('.kpi-figure')].filter(e => e.getClientRects().length && e.scrollWidth > e.clientWidth).map(e => e.id) }));
// How the screen is laid out: rows of account cards, and columns of main sections.
const layoutShape = page => page.evaluate(() => ({
  cardRows: new Set([...document.querySelectorAll('#tilesSection > div')].map(x => Math.round(x.getBoundingClientRect().top))).size,
  cols: getComputedStyle(document.getElementById('mainGrid')).gridTemplateColumns.split(' ').length }));
// WCAG contrast ratio of an element's text against the first solid background behind it.
const contrastOf = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  let bg = null;
  for (let n = el; n && !bg; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] === 1)) bg = c.slice(0, 3); }
  bg = bg || rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3);
  const fg = rgb(getComputedStyle(el).color).slice(0, 3);
  const [l1, l2] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return Math.round((l1 + 0.05) / (l2 + 0.05) * 100) / 100;
}, sel);

uiSuite(async ({ open, step }) => {
  let ctx, page;
  // ---------------- layout: widths, wrapping, hit areas, contrast ----------------
  const VIEWS = ['home', 'budgets', 'pending', 'activity'];
  // Jon's Galaxy Z Fold 7 in Chrome, measured: folded 411 x 847, unfolded 749 x 638 CSS px, pixel ratio 2.63.
  // The unfolded layout starts at 720px (index.html), so that edge is checked at the unfolded height too.
  const UNFOLD_FROM = 720, UNFOLDED = 749, FOLD_DPR = 2.63;
  for (const [w, h, scheme] of [[344, 860, 'dark'], [400, 860, 'light'], [411, 847, 'dark'], [UNFOLD_FROM, 638, 'dark'], [UNFOLDED, 638, 'light']]) {
    const dpr = w === 411 || w >= UNFOLD_FROM ? { deviceScaleFactor: FOLD_DPR } : {};
    ({ ctx, page } = await open({ viewport: { width: w, height: h }, ...dpr, isMobile: true, hasTouch: true, colorScheme: scheme }));
    await page.evaluate(SEED_OWED);
    await step(`${w}px: no sideways scroll and no balance spills out, on every tab`, async () => {
      const found = [];
      for (const v of VIEWS) {
        await page.evaluate(x => setView(x), v);
        const m = await noSideways(page);
        if (m.sideways || m.kpi.length) found.push(v + ' ' + JSON.stringify(m));
      }
      await page.evaluate(() => setView('home'));
      assert.deepStrictEqual(found, []);
    });
    await step(`${w}px: the changed labels each fit on one line`, async () => {
      const sels = ['#budLeftVal', '#heroNote', '#sumPending', '#budClearedCount', '#txListContainer > button:not(.tx-row)', '.owed-summary .text-xs'];
      await page.evaluate(() => { markBudgetPaid(state.budgets.find(b => Number(b.amount) < 0).row); });
      await page.waitForFunction(() => !state.budgets.some(b => b.pending));
      let lines = await lineCounts(page, sels.concat('#paidFold summary > span:first-child'));
      await page.evaluate(() => setView('pending'));
      lines = lines.concat(await lineCounts(page, ['#pill_pending', '#pill_settled', '#btnSettleAll', '.owed-groups span.block.text-xs']));
      await page.evaluate(() => setView('home'));
      assert.deepStrictEqual(lines.filter(x => !/:1$/.test(x)), [], lines.join(' '));
    });
    if (w === 344) {
      await step('344px: each red sync caption fits on one line, with no sideways scroll', async () => {
        await page.waitForFunction(() => apiInflight === 0);   // a request in flight would show "syncing" instead
        const r = await page.evaluate(() => Object.keys(SYNC_FAILED).map(k => {
          const saved = localStorage.getItem(OUTBOX_KEY);
          if (k === 'setAside') saveOutbox([{ id: 'fit1', payload: { merchant: 'x' }, setAside: 'test' }]); else lastSyncFailed = k;
          updateSyncUi();
          const n = document.getElementById('syncStatus'), rg = document.createRange(); rg.selectNodeContents(n);
          const out = { k, shown: !n.classList.contains('hidden'), fits: rg.getBoundingClientRect().right <= innerWidth - 14, sideways: document.documentElement.scrollWidth > innerWidth };
          lastSyncFailed = null;
          if (saved === null) localStorage.removeItem(OUTBOX_KEY); else localStorage.setItem(OUTBOX_KEY, saved);
          updateSyncUi();
          return out;
        }));
        assert.strictEqual(r.length, 3, JSON.stringify(r));
        assert.ok(r.every(x => x.shown && x.fits && !x.sideways), JSON.stringify(r));
      });
      await step('344px: Spending shows full amounts (pounds and pence); four big month figures each fit their own bar', async () => {
        const out = await monthBars(page);
        assert.strictEqual(out.length, 4, JSON.stringify(out));
        assert.ok(out.every(o => o.text === '£1,234.56' && o.lines === 1 && o.fits), JSON.stringify(out));
        await page.evaluate(() => setView('activity'));
        const chips = await page.$$eval('#actSpend button[data-cat] .tabular-nums', els => els.map(e => e.textContent));
        await page.evaluate(() => setView('home'));
        assert.ok(chips.length && chips.every(t => /^£[\d,]+\.\d\d$/.test(t)), JSON.stringify(chips));
      });
      await step('344px: the Bills header wording for every sign, never with a minus, on one line', async () => {
        const r = await page.evaluate(() => {
          const saved = state.budgets;
          const show = list => { state.budgets = list; renderAll(); return document.getElementById('budLeftVal').textContent; };
          const out = {
            out: show([{ row: 90, name: 'Rent', amount: -12345.67, isRecurring: true }]),
            none: show([{ row: 90, name: 'Rent', amount: 0, originalBudget: -500, isRecurring: true }]),
            evens: show([{ row: 90, name: 'Out', amount: -50, isRecurring: false }, { row: 91, name: 'In', amount: 50, isRecurring: false }]),
            in: show([{ row: 90, name: 'Refund', amount: 12345.67, isRecurring: false }]),
          };
          const rg = document.createRange(); rg.selectNodeContents(document.getElementById('budLeftVal'));
          out.lines = new Set([...rg.getClientRects()].map(x => Math.round(x.top))).size;
          state.budgets = saved; renderAll();
          return out;
        });
        assert.deepStrictEqual(r, { out: '£12,345.67 to pay', none: 'Nothing to pay', evens: 'Nothing to pay', in: '+£12,345.67 to come in', lines: 1 });
      });
    }
    if (w === 400) {
      await step('400px: small buttons have hit areas of at least 44x44px that reach them and do not overlap', async () => {
        const report = [];
        const check = async (sel, min) => {
          const h = await hitAreas(page, sel);
          assert.ok(h.count >= min, sel + ': expected at least ' + min + ', found ' + h.count);
          report.push(sel + ' ' + [...new Set(h.sizes)].join(','));
          return h.bad;
        };
        await page.waitForFunction(() => MOCK.calls.every(c => c.end) && !state.budgets.some(b => b.pending));
        let bad = [];
        bad = bad.concat(await check('#upcomingBudgetsList button[aria-label^="Mark "]', 6));
        bad = bad.concat(await check('#bf_all, #bf_recurring, #bf_events', 3));
        bad = bad.concat(await check('#btnAddBill', 1));
        bad = bad.concat(await check('#chevBudgets, #chevPending, #chevActivity', 3));
        await page.evaluate(() => setView('pending'));
        bad = bad.concat(await check('.owed-groups button[aria-label$=" paid back"]', 10));
        bad = bad.concat(await check('#pill_pending, #pill_settled, #btnSettleAll', 3));
        bad = bad.concat(await check('.owed-groups button[data-action="handleSettlePerson"]', 3));
        await page.evaluate(() => setView('budgets'));
        await page.evaluate(() => { document.getElementById('paidFold').open = true; });
        bad = bad.concat(await check('#clearedBudgetsList button:not([aria-label])', 1));
        await page.evaluate(() => setView('activity'));
        bad = bad.concat(await check('#txFilterBtn', 1));
        await page.click('#txFilterBtn');
        bad = bad.concat(await check('#txFilters button', 5));
        await page.click('#txf_amex');
        await page.click('#txFilterBtn');
        bad = bad.concat(await check('#txActive button', 1));
        await page.click('#txActive button');
        bad = bad.concat(await check('#actSpend button[data-cat]', 2));
        await page.evaluate(() => setView('home'));
        console.log('      hit areas: ' + report.join(' | '));
        assert.deepStrictEqual(bad, []);
      });
    }
    if (w < UNFOLD_FROM) {
      await step(`${w}px ${scheme}: the small captions read at a contrast of at least 4.5:1`, async () => {
        const sels = ['#syncText', '#budClearedCount', '.owed-summary .text-xs'];
        const r = [];
        await page.evaluate(() => { lastSyncFailed = 'reach'; updateSyncUi(); });   // the red caption
        for (const s of sels) r.push([s, await contrastOf(page, s)]);
        await page.evaluate(() => { lastSyncFailed = null; updateSyncUi(); });
        await page.evaluate(() => setView('pending'));
        r.push(['.owed-groups span.block.text-xs', await contrastOf(page, '.owed-groups span.block.text-xs')]);
        await page.evaluate(() => setView('home'));
        console.log('      contrast ' + scheme + ': ' + r.map(x => x.join(' ')).join(', '));
        assert.deepStrictEqual(r.filter(x => x[1] < 4.5), []);
      });
    }
    if (w < UNFOLD_FROM) {
      await step(`${w}px: account cards 2x2 and one column of sections`, async () => {
        assert.deepStrictEqual(await layoutShape(page), { cardRows: 2, cols: 1 });
      });
    }
    if (w === UNFOLD_FROM) {
      await step(`the unfolded layout starts at exactly ${UNFOLD_FROM}px (${UNFOLD_FROM - 1}px is still the phone layout)`, async () => {
        await page.setViewportSize({ width: UNFOLD_FROM - 1, height: h });
        const below = await layoutShape(page);
        await page.setViewportSize({ width: UNFOLD_FROM, height: h });
        assert.deepStrictEqual(below, { cardRows: 2, cols: 1 });
      });
    }
    if (w >= UNFOLD_FROM) {
      await step(`${w}px (unfolded): the biggest balances still fit 4 cards across`, async () => {
        await page.evaluate(() => document.querySelectorAll('#tilesSection .kpi-figure').forEach(e => { e.textContent = '−£99,999.99'; }));
        const m = await noSideways(page);
        await page.evaluate(() => renderAll());
        assert.deepStrictEqual(m.kpi, [], JSON.stringify(m));
      });
      await step(`${w}px (unfolded): 4 account cards across; Bills beside Owed + Activity; one column on a tab`, async () => {
        assert.deepStrictEqual(await layoutShape(page), { cardRows: 1, cols: 2 });
        const r = await page.evaluate(() => Object.fromEntries(['sec_budgets', 'sec_pending', 'sec_activity'].map(id => { const b = document.getElementById(id).getBoundingClientRect(); return [id, { l: Math.round(b.left), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width) }]; })));
        assert.ok(r.sec_pending.l > r.sec_budgets.l + 100 && r.sec_pending.t === r.sec_budgets.t, JSON.stringify(r));
        assert.ok(r.sec_activity.l === r.sec_pending.l && r.sec_activity.t > r.sec_pending.b && r.sec_activity.t - r.sec_pending.b <= 20, 'Activity should follow Owed: ' + JSON.stringify(r));
        await page.evaluate(() => setView('budgets'));
        const full = await page.evaluate(() => Math.round(document.getElementById('sec_budgets').getBoundingClientRect().width));
        await page.evaluate(() => setView('home'));
        assert.ok(full > r.sec_budgets.w * 1.8, 'the Bills tab should use the full width: ' + full);
      });
    }
    await ctx.close();
  }
}).catch(e => { console.error(e); process.exit(1); });
