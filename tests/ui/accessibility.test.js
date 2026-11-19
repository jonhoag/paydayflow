// Screen tests, real Chrome: small accessibility fixes (audit 4.6, 4.11): the split summary at 344px, names that
// screen readers read out, a page heading, a visible focus mark, and less motion when the device asks for it.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/accessibility.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const { uiSuite, phone, desk } = require('../lib/ui');

const narrow = { ...phone, viewport: { width: 344, height: 847 } };

uiSuite(async ({ open, step }) => {
  {
    const { ctx, page } = await open(narrow);
    // The summary may run onto a second line, but every part is whole and inside the box, and "Add to Owed" stays one line.
    const pill = () => page.evaluate(() => {
      const p = document.getElementById('cleanSplitPill'), box = p.getBoundingClientRect();
      const parts = [...p.querySelectorAll(':scope > span')].map(s => { const r = s.getBoundingClientRect(); return { text: s.textContent, inside: r.left >= box.left - 1 && r.right <= box.right + 1, oneLine: r.height < 24 }; });
      const tick = document.getElementById('needToggleWrap').getBoundingClientRect();
      return { text: p.textContent, overflows: p.scrollWidth > p.clientWidth + 1, parts, tickOneLine: tick.height < 30, tickRight: tick.left > box.right - 1 };
    });
    for (const [what, setup, want] of [
      ['half split', () => selectSplit('half'), ['You pay: £71.25', 'Kim: £71.25']],
      ['group of three', () => { selectSplit('custom'); togglePersonChip('lee'); togglePersonChip('robin'); }, ['You pay: £35.61', '3 people owe: £106.89']],
      ['refund, half', () => { setTxDirection('refund'); selectSplit('half'); }, ['You keep: +£71.25', 'Pay Kim: −£71.25']],
    ]) {
      await step(`344px split summary (${what}): nothing cut off, it wraps between parts, the name is capitalised`, async () => {
        try {
          await page.evaluate(() => openAddModal());
          await page.fill('#inpAmount', '142.50');
          await page.evaluate(setup);
          const r = await pill();
          assert.deepStrictEqual(r.parts.map(p => p.text), want, r.text);
          assert.ok(!r.overflows, 'the summary is cut off: ' + r.text);
          assert.ok(r.parts.every(p => p.inside && p.oneLine), JSON.stringify(r.parts));
          assert.ok(r.tickOneLine && r.tickRight, '"Add to Owed" should stay on one line, to the right');
        } finally { await page.evaluate(() => { setTxDirection('spend'); closeAddModal(); document.getElementById('inpAmount').value = ''; }); }
      });
    }
    await step('the ✕ on a split row says whose share it takes off', async () => {
      try {
        await page.evaluate(() => { openAddModal(); selectSplit('custom'); });
        assert.strictEqual(await page.getAttribute('#dynamicSplitRows [data-action="removePersonRow"]', 'aria-label'), 'Take Kim off the split');
      } finally { await page.evaluate(() => closeAddModal()); }
    });
    await ctx.close();
  }
  {
    const { ctx, page } = await open(desk);
    await step('one page heading, for screen readers', async () => {
      assert.deepStrictEqual(await page.$$eval('h1', h => h.map(x => x.textContent.trim())), ['PaydayFlow']);
    });
    await step('Activity rows read out the amount and account, not just the name', async () => {
      const labels = await page.$$eval('#txListContainer [data-action="openEditTxForRow"]', b => b.map(x => x.getAttribute('aria-label')));
      assert.ok(labels.length > 0, 'no Activity rows');
      for (const l of labels) assert.match(l, /^Edit .+, [+−]?£[\d,]+\.\d\d, (Amex|Barclays|Nationwide|Marcus)$/);
    });
    await step('month picker and Activity search show where the keyboard is', async () => {
      await page.evaluate(() => { if (document.getElementById('txFilterPanel').classList.contains('hidden')) toggleTxFilters(); });
      for (const id of ['monthSelector', 'txSearch']) {
        const border = () => page.$eval('#' + id, el => getComputedStyle(el).borderTopColor);
        const before = await border();
        await page.focus('#' + id);
        const after = await border();
        await page.evaluate(() => document.activeElement.blur());
        assert.notStrictEqual(after, before, id + ' looks the same with and without focus');
      }
    });
    await step('normal motion: smooth scrolling and sheet transitions stay', async () => {
      assert.strictEqual(await page.evaluate(() => scrollMotion()), 'smooth');
      assert.ok(await page.$eval('#btnSubmitTx', b => parseFloat(getComputedStyle(b).transitionDuration) > 0.05));
    });
    await ctx.close();
  }
  {
    const { ctx, page } = await open({ ...desk, reducedMotion: 'reduce' });
    await step('less motion when the device asks: no smooth scrolling, transitions near instant', async () => {
      assert.strictEqual(await page.evaluate(() => scrollMotion()), 'auto');
      assert.ok(await page.$eval('#btnSubmitTx', b => parseFloat(getComputedStyle(b).transitionDuration) < 0.001));
      // The sync icon still spins while a sync is under way: besides its colour, it is the only sign of one.
      const spin = await page.$eval('#syncBtn svg', svg => { svg.classList.add('animate-spin'); const d = parseFloat(getComputedStyle(svg).animationDuration); svg.classList.remove('animate-spin'); return d; });
      assert.ok(spin > 0.5, 'the sync icon stopped spinning: ' + spin + 's');
    });
    await ctx.close();
  }
}).catch(e => { console.error(e); process.exit(1); });
