// Screen tests, real Chrome: month summaries for the Year view. Starting a new month saves the month just finished, in a
// few figures worked out from the sheet's own copy of it (and of the month before, for carried-over owed rows): card
// spending as charged and your share by category, what was paid back, Saved (yours and in all) and Money Left.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/year.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const { uiSuite, phone, desk, calls, failSavedNoState, resetFailures } = require('../lib/ui');

uiSuite(async ({ open, step, errors, dropExpectedSyncErrors }) => {
  const { page } = await open(phone);
  const idle = () => page.waitForFunction(() => apiInflight === 0 && MOCK.calls.every(c => c.end), null, { timeout: 8000 });
  // The server's own copy of a month gets these rows; the page is brought up to date with it.
  const onServer = async (month, rows) => {
    await page.evaluate(([m, r]) => { Object.keys(r).forEach(acct => MOCK.dbs[m][acct].push(...r[acct])); }, [month, rows]);
    await page.evaluate(() => forceSyncSheet());
    await idle();
  };
  const startMonth = async name => {
    await page.evaluate(n => { openNewMonthModal(); document.getElementById('nmName').value = n; updateNewMonthName(); }, name);
    await page.click('#nmCreateBtn');
    await idle();
  };
  const lastSent = async () => (await calls(page, 'saveMonthSummary')).pop();

  await step('starting a new month saves the finished month\'s summary, from the sheet\'s own figures', async () => {
    const month = await page.evaluate(() => activeMonth);
    // A shared spend paid back by half, your own saving and someone else's in Marcus, and money taken out of it.
    await onServer(month, { checking: [{ row: 900, desc: 'kim Lidl', amount: 36.8, need: true }],
      marcus: [{ row: 901, desc: 'My savings', amount: 200 }, { row: 902, desc: 'kim savings', amount: 150 }, { row: 903, desc: 'Car service', amount: -80 }] });
    const was = await page.evaluate(() => {
      const sum = summariseSpend(state, loadSpendOverrides());
      return { charged: sum.charged, share: sum.share, paidBack: sum.paidBack, left: sheetFigures(state, new Set()).eomSavingsJ,
        marcus: +state.marcus.filter(r => r.desc.toLowerCase() !== 'start').reduce((t, r) => t + Number(r.amount), 0).toFixed(2),
        cats: Object.fromEntries(sum.categories.map(c => [c.cat, [c.charged, c.share]])) };
    });
    // A spend on this device only (not yet on the sheet) must not be in the summary; one the sheet has that this
    // device hasn't seen yet must be.
    await page.evaluate(m => { state.amex.push({ row: 999, desc: 'Not sent yet', amount: -500, pending: true });
      MOCK.dbs[m].amex.push({ row: 998, desc: 'Added elsewhere', amount: -40 }); }, month);
    was.charged = +(was.charged + 40).toFixed(2); was.share = +(was.share + 40).toFixed(2);
    was.cats.Other = was.cats.Other ? [+(was.cats.Other[0] + 40).toFixed(2), +(was.cats.Other[1] + 40).toFixed(2)] : [40, 40];
    was.left = +(was.left - 40).toFixed(2);
    await startMonth('Summary Payday 2027');
    const sent = await lastSent();
    assert.ok(sent, 'no summary was sent');
    assert.strictEqual(sent.sheetName, month);
    const s = sent.summary;
    assert.deepStrictEqual([s.charged, s.share, s.paidBack, s.left], [was.charged, was.share, was.paidBack, was.left]);
    assert.ok(s.paidBack > 0, 'the payback should count');
    assert.deepStrictEqual(s.cats, was.cats);
    assert.strictEqual(s.savedMine, 200, 'only your own saving rows (the config\'s words) count as yours');
    assert.strictEqual(s.savedTotal, was.marcus, 'in all: the raw change in Marcus, money taken out included');
    assert.ok(await page.evaluate(m => !!MOCK.yearSummaries[m], month), 'the pretend server (which refuses what the real one does) kept it');
  });

  await step('an owed payback carried over from the month before (fetched: this device has an out-of-date copy) is not counted again', async () => {
    // "Summary Payday 2027" is now on screen; the month before it is the one just finished. Give both the same owed row,
    // as Start New Month's carry-over does. This device's copy of the earlier month is now out of date (it hasn't the
    // row), so the sheet's copy must be fetched.
    const finished = await page.evaluate(() => monthBefore(activeMonth));
    await onServer(finished, { checking: [{ row: 910, desc: 'kim Tram', amount: 12, need: true }] });
    await onServer('Summary Payday 2027', { amex: [{ row: 911, desc: 'Tram', amount: -30 }], checking: [{ row: 912, desc: 'kim Tram', amount: 12, need: true }] });
    assert.ok(await page.evaluate(m => { const c = JSON.parse(localStorage.getItem('pf_cache_' + m) || 'null'); return !!c && !c.checking.some(r => r.desc === 'kim Tram'); }, finished),
      'this device should hold an out-of-date copy of the month before');
    const fetchedBefore = (await calls(page, 'getCachedSheetState')).filter(p => p.sheetName === finished).length;
    await startMonth('After Payday 2027');
    const sent = await lastSent();
    assert.strictEqual(sent.sheetName, 'Summary Payday 2027');
    assert.deepStrictEqual([sent.summary.cats.Other, sent.summary.paidBack], [[30, 30], 0], JSON.stringify(sent.summary));
    const fetched = (await calls(page, 'getCachedSheetState')).filter(p => p.sheetName === finished).length;
    assert.strictEqual(fetched, fetchedBefore + 1, 'the month before should have been fetched once');
  });

  await step('a month that could not be made sends no summary', async () => {
    const before = (await calls(page, 'saveMonthSummary')).length;
    const from = errors.length;
    try {
      await page.evaluate(() => { MOCK.failNext = 1; });
      await startMonth('Refused Payday 2027');
      assert.strictEqual((await calls(page, 'saveMonthSummary')).length, before);
    } finally { await page.evaluate(() => { MOCK.failNext = 0; closeNewMonthModal(); }); dropExpectedSyncErrors(from); }
  });

  await step('made, but the reply lost on the way back: the summary is still sent', async () => {
    const before = (await calls(page, 'saveMonthSummary')).length;
    const from = errors.length;
    try {
      await failSavedNoState(page);
      await startMonth('Lost Reply Payday 2027');
      assert.strictEqual(await page.evaluate(() => activeMonth), 'Lost Reply Payday 2027', 'the month made should open');
      assert.strictEqual((await calls(page, 'saveMonthSummary')).length, before + 1);
    } finally { await resetFailures(page); dropExpectedSyncErrors(from); }
  });

  await step('a backend that sends no savings words: "Saved" (yours) goes as unknown, not as £0', async () => {
    await page.evaluate(() => { MOCK.config = Object.assign({}, MOCK.config); delete MOCK.config.mySavings; forceSyncSheet(); });
    await idle();
    await startMonth('No Words Payday 2027');
    assert.strictEqual((await lastSent()).summary.savedMine, null);
  });

  // ---------------- The Year view ----------------
  // A made-up year of summaries (the page shows only months still in the sheet).
  const YEAR = Array.from({ length: 12 }, (_, i) => {
    const names = ['November', 'December', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October'];
    const month = names[i] + ' Payday ' + (i < 2 ? 2025 : 2026);
    const eat = i >= 9 ? 150 : 100, travel = i === 9 ? 860 : 0;
    const cats = { Groceries: [300, 160], 'Eating out': [eat, eat * 0.6] };
    if (travel) cats.Travel = [travel, travel / 2];
    const charged = 300 + eat + travel, share = 160 + eat * 0.6 + travel / 2;
    return { month, summary: { charged, share, paidBack: charged - share, savedMine: i === 9 ? 0 : 300, savedTotal: i === 9 ? -200 : 450, left: 100 + i * 10, cats } };
  });
  const openYear = async (rows, current) => {
    await page.evaluate(([rows, current]) => {
      closeSpendModal();
      MOCK.yearSummaries = Object.fromEntries(rows.map(r => [r.month, r.summary]));
      state.availableMonths = [current].concat(rows.map(r => r.month).reverse());
      rows.forEach(r => { MOCK.dbs[r.month] = MOCK.dbs[r.month] || JSON.parse(JSON.stringify(MOCK.db2)); });
      yearAsked = false; yearRows = null; yearPickMonth = yearPickCat = null; yearPeriod = 'last';
      setSpendView('mine'); openSpendModal(); setSpendTab('year');
    }, [rows, current]);
    await idle();
  };
  const yearText = () => page.evaluate(() => document.getElementById('spendBody').innerText.replace(/\s+/g, ' '));
  const bars = () => page.$$eval('#yearChart button[data-action="pickYearMonth"]', els => els.map(e => e.getAttribute('aria-label')));

  await step('Year: reads the kept summaries once and draws a bar for each finished month, oldest first', async () => {
    const before = (await calls(page, 'getYearSummaries')).length;
    await openYear(YEAR, 'November Payday 2026');
    assert.strictEqual((await calls(page, 'getYearSummaries')).length, before + 1);
    const b = await bars();
    assert.strictEqual(b.length, 12);
    assert.ok(/^November 2025 /.test(b[0]) && /^October 2026 /.test(b[11]), JSON.stringify(b));
    const t = await yearText();
    assert.ok(/You spent £[\d,]+ £[\d,]+ a month Saved £3,300 11 months Left at payday £155 on average/.test(t), t.slice(0, 300));
    assert.ok(/What stood out Eating out is up .* A big month for Travel .* Best month: October £210 left at payday/.test(t), t);
    await page.evaluate(() => setSpendTab('year'));   // opened again: from this device, not asked again
    assert.strictEqual((await calls(page, 'getYearSummaries')).length, before + 1);
  });

  await step('Year: Total shows the cards as charged and Marcus in all (a month with money taken out goes negative)', async () => {
    await page.click('#sv_total');
    const t = await yearText();
    assert.ok(/Charged £5,810 £484 a month Saved £4,750 Marcus in all/.test(t), t.slice(0, 300));
    await page.click('#sv_mine');
  });

  await step('Year: tapping a month shows its line and a ✕; tapping a category puts it on its own scale', async () => {
    await page.click('#yearChart button[aria-label^="August 2026"]');
    let t = await yearText();
    assert.ok(/August 2026 £[\d,]+ Saved £0 · left £190 · most on Travel/.test(t), t);
    assert.ok(await page.$('button[data-action="clearYearPick"]'));
    await page.click('button[data-action="clearYearPick"]');
    await page.click('button[data-action="pickYearCat"][data-cat="Eating out"]');
    t = await yearText();
    assert.ok(/Eating out, month by month/.test(t) && /avg £68/.test(t), t.slice(0, 400));
    const labels = await bars();
    assert.ok(/ £60$/.test(labels[0]) && / £90$/.test(labels[11]), JSON.stringify(labels));
    await page.click('button[data-action="pickYearCat"][data-cat="Eating out"]');
    assert.ok(/You spent, month by month/.test(await yearText()));
  });

  await step('Year: a finished month with no summary is worked out and sent once, and shows without a second read', async () => {
    const rows = YEAR.slice(-3), missing = rows[0].month;
    const sentBefore = (await calls(page, 'saveMonthSummary')).length, readBefore = (await calls(page, 'getYearSummaries')).length;
    await openYear(rows.slice(1), 'November Payday 2026');
    await page.evaluate(m => { MOCK.dbs[m] = JSON.parse(JSON.stringify(MOCK.db2)); closeSpendModal();
      state.availableMonths = ['November Payday 2026', 'October Payday 2026', 'September Payday 2026', m]; yearAsked = false; yearRows = null; openSpendModal(); setSpendTab('year'); }, missing);
    await idle();
    const sent = (await calls(page, 'saveMonthSummary')).slice(sentBefore);
    assert.deepStrictEqual(sent.map(p => p.sheetName), [missing]);
    assert.strictEqual((await calls(page, 'getYearSummaries')).length, readBefore + 2, 'no second read: each month lands in the view as it is saved');
    assert.strictEqual((await bars()).length, 3);
  });

  await step('Year: the first months: real months on the left, flat slots for the rest, a line instead of notes', async () => {
    await openYear(YEAR.slice(-2), 'November Payday 2026');
    const r = await page.evaluate(() => ({ bars: document.querySelectorAll('#yearChart button[data-action="pickYearMonth"]').length, slots: document.querySelectorAll('#yearChart div.flex-1').length }));
    assert.deepStrictEqual(r, { bars: 2, slots: 10 });
    const t = await yearText();
    assert.ok(/Since September 2026/.test(t) && /Notes start at 3 months/.test(t) && !/What stood out/.test(t), t);
  });

  await step('Year: a damaged copy on this device is ignored, not drawn', async () => {
    const r = await page.evaluate(() => { setYearRows([{ month: 'X', summary: { charged: 'lots' } }, { month: 1 }, null], false); return yearRows.length; });
    assert.strictEqual(r, 0);
  });

  await step('Year: first open on a new device (nothing kept) says it is getting your months, not that the year has not started', async () => {
    const { page: np } = await open(phone);   // a fresh page: nothing kept on this device
    assert.strictEqual(await np.evaluate(() => yearRows), null);
    await np.evaluate(rows => { MOCK.yearSummaries = Object.fromEntries(rows.map(r => [r.month, r.summary])); state.availableMonths = ['November Payday 2026'].concat(rows.map(r => r.month).reverse());
      categoriesFetchedAt = Date.now(); MOCK.nextLatencies = [1500]; openSpendModal(); setSpendTab('year'); }, YEAR.slice(-3));
    const text = () => np.evaluate(() => document.getElementById('spendBody').innerText.replace(/\s+/g, ' '));
    assert.ok(/Getting your month/.test(await text()), await text());
    await np.waitForFunction(() => apiInflight === 0 && MOCK.calls.every(c => c.end), null, { timeout: 8000 });
    assert.ok(!/Getting your month/.test(await text()) && /You spent £/.test(await text()), await text());
    // An empty list kept from before (a first month): while the read is on its way it still says it is getting them.
    await np.evaluate(() => { closeSpendModal(); yearRows = []; yearAsked = false; MOCK.nextLatencies = [1500]; openSpendModal(); });
    assert.ok(/Getting your month/.test(await text()), await text());
    await np.waitForFunction(() => apiInflight === 0 && MOCK.calls.every(c => c.end), null, { timeout: 8000 });
  });

  await step('Year: a failed read says so, and opening Year again tries again', async () => {
    const before = (await calls(page, 'getYearSummaries')).length;
    await page.evaluate(() => { closeSpendModal(); yearRows = null; yearAsked = false; categoriesFetchedAt = Date.now(); MOCK.dropNext = 1; openSpendModal(); setSpendTab('year'); });   // the choices are fresh, so the Year read is the one dropped
    await idle();
    assert.ok(/Couldn't get your months/.test(await yearText()), JSON.stringify(await page.evaluate(() => MOCK.calls.slice(-5).map(c => [c.action, c.aborted || '', c.payload && c.payload.sheetName]))) + await yearText());
    await page.evaluate(() => { MOCK.dropNext = 0; closeSpendModal(); openSpendModal(); });
    await idle();
    assert.ok(!/Couldn't get your months/.test(await yearText()), 'the message clears once the read works');
    assert.strictEqual((await calls(page, 'getYearSummaries')).length, before + 2, 'asked once when it failed (no loop), once more on the next open');
  });

  await step('Year: a month with nothing saved is noted (yours); in Total, a month Marcus went down', async () => {
    const plain = YEAR.slice(0, 3).map((r, i) => ({ month: r.month, summary: Object.assign({}, r.summary, { left: -10, savedMine: i === 1 ? 0 : 300, savedTotal: i === 1 ? -50 : 300 }) }));
    await openYear(plain, 'February Payday 2026');
    assert.ok(/Nothing saved in December/.test(await yearText()), await yearText());
    await page.click('#sv_total');
    assert.ok(/Marcus went down in December December −£50/.test(await yearText()), await yearText());
    await page.click('#sv_mine');
  });

  await step('Year: a year can be chosen; a chosen year that is no longer in the sheet goes back to the last 12 months', async () => {
    await openYear(YEAR, 'November Payday 2026');
    await page.selectOption('#spendBody select', '2025');
    assert.deepStrictEqual((await bars()).map(b => b.split(' ').slice(0, 2).join(' ')), ['November 2025', 'December 2025']);
    await page.evaluate(() => { state.availableMonths = state.availableMonths.filter(m => !/2025/.test(m)); renderSpend(); });
    assert.strictEqual(await page.evaluate(() => yearPeriod), 'last');
    assert.strictEqual((await bars()).length, 10);
  });

  await step('a finished month opened again, with figures that no longer match its summary, is sent again (once)', async () => {
    await openYear(YEAR.slice(-3), 'November Payday 2026');
    // The server now lists August to October as well; October is the newest, so September is a finished month.
    await page.evaluate(rows => rows.forEach(r => { if (MOCK.monthList.indexOf(r.month) === -1) MOCK.monthList.push(r.month); }), YEAR.slice(-3));
    const m = YEAR[10].month;
    const count = async () => (await calls(page, 'saveMonthSummary')).filter(p => p.sheetName === m).length;
    const before = await count();
    await page.evaluate(m => { closeSpendModal(); switchMonth(m); }, YEAR[9].month); await idle();   // last month first, so this device has it
    await page.evaluate(m => switchMonth(m), m);
    await idle();
    assert.strictEqual(await count(), before + 1, 'the made-up summary differs from the month, so it is sent');
    const sent = (await calls(page, 'saveMonthSummary')).filter(p => p.sheetName === m).pop().summary;
    assert.strictEqual(await page.evaluate(([m, share]) => yearRows.find(r => r.month === m).summary.share === share, [m, sent.share]), true, 'the Year view shows the month as sent');
    await page.evaluate(m => switchMonth(m), YEAR[9].month); await idle();
    await page.evaluate(m => switchMonth(m), m); await idle();
    assert.strictEqual(await count(), before + 1, 'only once a session');
  });

  const { page: dp } = await open(desk);
  await step('desktop: the Year side is wider, with Chart | Table; the table lists each category by month', async () => {
    await dp.evaluate(rows => {
      MOCK.yearSummaries = Object.fromEntries(rows.map(r => [r.month, r.summary]));
      rows.forEach(r => { MOCK.dbs[r.month] = MOCK.dbs[r.month] || JSON.parse(JSON.stringify(MOCK.db2)); });
      state.availableMonths = ['November Payday 2026'].concat(rows.map(r => r.month).reverse());
      openSpendModal(); setSpendTab('year');
    }, YEAR);
    await dp.waitForFunction(() => apiInflight === 0 && document.querySelectorAll('#yearChart button').length >= 12, null, { timeout: 8000 });
    const w = await dp.evaluate(() => document.querySelector('#spendModal [role=dialog]').getBoundingClientRect().width);
    assert.ok(w > 900, 'width ' + w);
    await dp.click('button[data-action="setYearTable"][data-arg="table"]');
    const t = await dp.evaluate(() => document.querySelector('#spendBody table') && document.querySelector('#spendBody table').innerText.replace(/\s+/g, ' '));
    assert.ok(t && /Groceries 160 160/.test(t) && /Left at payday 100 110/.test(t) && !(await dp.$('#yearChart')), t);
  });
});
