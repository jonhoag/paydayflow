// Screen tests, real Chrome: month summaries for the Year view. Starting a new month saves the month just finished, in a
// few figures worked out from the sheet's own copy of it (and of the month before, for carried-over owed rows): card
// spending as charged and your share by category, what was paid back, Saved (yours and in all) and Money Left.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/year.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const { uiSuite, phone, calls, failSavedNoState, resetFailures } = require('../lib/ui');

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
});
