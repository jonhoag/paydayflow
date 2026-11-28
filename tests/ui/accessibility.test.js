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
    // The Who's paying row: its words whole (none cut off), each on one line, and "Add to Owed" on one line, at the right.
    const pill = () => page.evaluate(() => {
      const row = document.getElementById('whoRow').getBoundingClientRect(), oneLine = id => document.getElementById(id).getBoundingClientRect().height < 24;
      const sub = document.getElementById('whoSub'), tick = document.querySelector('#needToggleWrap label span').getBoundingClientRect();
      return { parts: [document.getElementById('whoMain').textContent, sub.textContent], text: sub.textContent, overflows: sub.scrollWidth > sub.clientWidth + 1,
        oneLine: oneLine('whoMain') && oneLine('whoSub') && row.height < 60, tickOneLine: tick.height < 30, tickRight: tick.right > row.right - 2 };
    });
    for (const [what, setup, want] of [
      ['half split', () => selectSplit('half'), ['Half with Kim', 'Kim owes £71.25']],
      ['group of three', () => { selectSplit('custom'); togglePersonChip('lee'); togglePersonChip('robin'); }, ['Split with others', '£106.89 owed']],
      ['refund, half', () => { setTxDirection('refund'); selectSplit('half'); }, ['Half to Kim', 'you pay Kim £71.25']],
    ]) {
      await step(`344px Who's paying row (${what}): nothing cut off or wrapped, the name is capitalised`, async () => {
        try {
          await page.evaluate(() => openAddModal());
          await page.fill('#inpAmount', '142.50');
          await page.evaluate(setup);
          const r = await pill();
          assert.deepStrictEqual(r.parts, want, r.text);
          assert.ok(!r.overflows, 'the row is cut off: ' + r.text);
          assert.ok(r.oneLine, 'the row wraps');
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
