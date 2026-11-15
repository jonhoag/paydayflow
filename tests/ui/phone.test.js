// Screen tests, real Chrome: The phone screens on one page: adding, editing and deleting, sync status, spends saved
// offline, forms and sheets, failed saves rolled back, Back, tap areas.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/phone.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const { uiSuite, phone, desk, SEED_OWED, calls, SAVED_NO_STATE, failSavedNoState, resetFailures, sheetReads, visible, owedCount, lineCounts, hitAreas, toastParts, LOCK_TIMEOUT, BUSY } = require('../lib/ui');

uiSuite(8141, async ({ browser, errors, watch, open, step, PORT, dropExpectedSyncErrors }) => {
  let ctx, page;
  // ---------------- phone ----------------
  ({ ctx, page } = await open(phone));

  await step('balances: lettered account cards, real minus sign, card never overlaps the figure', async () => {
    const tiles = await page.evaluate(() => ['Amex', 'Barclays', 'Checking', 'Marcus'].map(k => {
      const card = document.querySelector('#logoCard' + k + ' span');
      const fig = document.getElementById('kpi' + (k === 'Checking' ? 'NCA' : k));
      const a = card.getBoundingClientRect(), b = fig.getBoundingClientRect();
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const tile = fig.parentElement.getBoundingClientRect();
      return { label: card.textContent, text: fig.textContent, overlap, fits: b.right <= tile.right + 0.5 };
    }));
    assert.deepStrictEqual(tiles.map(t => t.label), ['AX', 'BC', 'NW', 'MS']);
    tiles.forEach(t => { assert.ok(!t.overlap, t.label + ' card overlaps its balance'); assert.ok(t.fits, t.label + ' balance spills out of its tile'); });
    assert.ok(tiles[1].text.startsWith('\u2212£'), 'Barclays should show a minus sign: ' + tiles[1].text);
  });

  await step('balances still fit on a narrow 344px phone screen', async () => {
    await page.setViewportSize({ width: 344, height: 860 });
    const ok = await page.evaluate(() => ['kpiAmex', 'kpiBarclays', 'kpiNCA', 'kpiMarcus'].every(id => {
      const f = document.getElementById(id); return f.getBoundingClientRect().right <= f.parentElement.getBoundingClientRect().right + 0.5;
    }));
    await page.setViewportSize({ width: 400, height: 860 });
    assert.ok(ok, 'a balance spills out of its tile');
  });

  await step('money helpers: fmtSigned shows + for money in, a real minus for money out', async () => {
    const out = await page.evaluate(() => [fmtSigned(5), fmtSigned(-5), fmtSigned(0), fmtSigned(1234.5)]);
    assert.deepStrictEqual(out, ['+£5.00', '−£5.00', '£0.00', '+£1,234.50']);
  });

  await step('storage helpers: storage that refuses (a private window, or blocked) reads as empty instead of throwing', async () => {
    const out = await page.evaluate(() => {
      localStorage.setItem('pf_test_junk', '{not json');
      const junk = lsJson('pf_test_junk');
      localStorage.removeItem('pf_test_junk');
      const P = Storage.prototype, real = [P.getItem, P.setItem, P.removeItem];
      P.getItem = P.setItem = P.removeItem = () => { throw new DOMException('blocked', 'SecurityError'); };
      try {
        return [junk, lsGet(THEME_KEY), lsSet(THEME_KEY, 'dark'), lsDel(THEME_KEY) === undefined, lsJson(OUTBOX_KEY), loadOutbox().length, getSession(), hasValidGoogleToken()];
      } finally { [P.getItem, P.setItem, P.removeItem] = real; }
    });
    assert.deepStrictEqual(out, [null, null, false, true, null, 0, null, false]);
  });

  await step('a Google sign-in token is read as UTF-8, and anything that is not one reads as nothing', async () => {
    const out = await page.evaluate(() => {
      const part = o => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const p = parseJwtPayload('x.' + part({ what: 'Café ✓ ~~~>>>???', exp: 5 }) + '.y');
      return [p && p.what, p && p.exp, parseJwtPayload('nonsense'), parseJwtPayload('a.!!!.b'), parseJwtPayload(null)];
    });
    assert.deepStrictEqual(out, ['Café ✓ ~~~>>>???', 5, null, null, null]);
  });

  await step('bottom bar reads Home, Bills, Owed, Activity', async () => {
    const labels = await page.$$eval('nav [data-nav]', bs => bs.map(b => b.textContent.trim()));
    assert.deepStrictEqual(labels, ['Home', 'Bills', 'Owed', 'Activity']);
  });

  await step('bills: the paid fold-away is hidden while nothing is paid, and reads "Paid (n)" once something is', async () => {
    assert.strictEqual(await page.evaluate(() => state.budgets.filter(b => Number(b.amount) === 0).length), 0, 'test set-up: a bill is already paid');
    assert.ok(!(await visible(page, '#paidFold')), 'the fold-away shows with nothing in it');
    await page.click('#upcomingBudgetsList button[aria-label^="Mark"]');
    await page.waitForFunction(() => state.budgets.some(b => Number(b.amount) === 0 && !b.pending));
    assert.ok(await visible(page, '#paidFold'));
    assert.strictEqual((await page.textContent('#paidFold summary')).replace(/\s+/g, ' ').replace('▼', '').trim(), 'Paid (1)');
    await page.evaluate(() => { document.getElementById('paidFold').open = true; });
    await page.click('#clearedBudgetsList button:has-text("Restore")');
    await page.waitForFunction(() => !state.budgets.some(b => Number(b.amount) === 0 || b.pending) && MOCK.calls.every(c => c.end));
    assert.ok(!(await visible(page, '#paidFold')), 'the fold-away should go again at 0');
  });

  await step('bills: the header says "to pay" with no minus, and no "rolls to next month" legend', async () => {
    const t = await page.textContent('#budLeftVal');
    assert.ok(/^£[\d,]+\.\d\d to pay$/.test(t), t);
    assert.ok(!/rolls to next month/.test(await page.textContent('#budgetsBody')), 'the legend is back');
  });

  await step('bills: the phone Bills tab lists every unpaid bill (no "Show all"); Home keeps the first 6', async () => {
    const unpaid = await page.evaluate(() => state.budgets.filter(b => Number(b.amount) !== 0).length);
    assert.ok(unpaid > 6, 'test set-up: needs more than 6 unpaid bills');
    const rows = () => page.$$eval('#upcomingBudgetsList button[aria-label^="Mark "]', b => b.length);
    const more = () => page.$('#upcomingBudgetsList button:has-text("Show all")');
    assert.strictEqual(await rows(), 6);
    assert.ok(await more(), 'Home should offer "Show all"');
    await page.click('nav [data-nav="budgets"]');
    assert.strictEqual(await rows(), unpaid, 'the Bills tab should list every unpaid bill');
    assert.ok(!(await more()), 'the Bills tab should have no "Show all"');
    await page.click('nav [data-nav="home"]');
    assert.strictEqual(await rows(), 6);
  });

  await step('tabs: the section that is the whole screen has no ▾ and its header does not fold it; Home keeps them', async () => {
    await page.evaluate(() => setView('home'));   // whatever an earlier failed step left
    const chevs = ['#chevBudgets', '#chevPending', '#chevActivity'];
    for (const c of chevs) assert.ok(await visible(page, c), c + ' should show on Home');
    for (const [nav, chev, body] of [['budgets', '#chevBudgets', '#budgetsBody'], ['pending', '#chevPending', '#pendingBody'], ['activity', '#chevActivity', '#activityBody']]) {
      await page.click(`nav [data-nav="${nav}"]`);
      assert.ok(!(await visible(page, chev)), chev + ' still shows on its own tab');
      await page.click(body.replace('Body', '').replace('#', '#sec_') + ' h2');
      assert.ok(await visible(page, body), 'tapping the header folded the ' + nav + ' tab away');
    }
    await page.click('nav [data-nav="home"]');
    const expanded = () => page.$$eval('#chevBudgets, #chevPending, #chevActivity', els => els.map(e => [e.getAttribute('aria-label'), e.getAttribute('aria-controls'), e.getAttribute('aria-expanded')].join('|')));
    assert.deepStrictEqual(await expanded(), ['Bills & Budgets|budgetsBody|true', 'Owed to you|pendingBody|true', 'Recent Activity|activityBody|true']);
    await page.click('#chevActivity');
    assert.ok(!(await visible(page, '#activityBody')), 'the ▾ on Home should still fold a section');
    assert.strictEqual((await expanded())[2], 'Recent Activity|activityBody|false', 'a screen reader should hear it is folded');
    await page.click('#chevActivity');
    assert.strictEqual((await expanded())[2], 'Recent Activity|activityBody|true');
  });

  await step('owed: with one person owing, the header has no "All paid back" (theirs does the same job)', async () => {
    await page.evaluate(() => setView('home'));
    await page.click('nav [data-nav="pending"]');
    assert.strictEqual(await page.evaluate(() => owedGroupsShown.length), 1, 'test set-up: one person should owe');
    assert.ok(!(await visible(page, '#btnSettleAll')), 'header "All paid back" shows with one person');
    assert.ok(await visible(page, '.owed-groups button[data-person][data-action="handleSettlePerson"]'), "that person's own button is missing");
    await page.click('nav [data-nav="home"]');
  });

  await step('bills: Paid saves the bill as paid, Restore brings it back', async () => {
    await page.evaluate(() => setView('home'));
    const first = await page.$eval('#upcomingBudgetsList button[aria-label^="Mark"]', b => b.getAttribute('aria-label'));
    await page.click('#upcomingBudgetsList button[aria-label^="Mark"]');
    await page.waitForTimeout(250);
    const paid = (await calls(page, 'updateBudgetRow')).pop();
    assert.ok(paid && paid.newAmount === 0, 'expected updateBudgetRow with 0, got ' + JSON.stringify(paid));
    const name = first.replace(/^Mark | paid$/g, '');
    assert.ok((await page.textContent('#clearedBudgetsList')).includes(name), 'bill should move to Paid');
    await page.evaluate(() => document.querySelector('#clearedBudgetsList').closest('details').open = true);
    await page.click('#clearedBudgetsList button:has-text("Restore")');
    await page.waitForTimeout(250);
    const restored = (await calls(page, 'updateBudgetRow')).pop();
    assert.ok(restored && restored.newAmount < 0, 'Restore should put the amount back: ' + JSON.stringify(restored));
  });

  await step('bills: tapping a name opens its edit form; the skip icon still works', async () => {
    await page.click('#upcomingBudgetsList button[aria-label^="Edit"]');
    assert.ok(await visible(page, '#budgetModal'), 'edit form did not open');
    assert.ok(/^Edit /.test(await page.textContent('#budFormTitle')));
    await page.click('#budgetModal button[aria-label="Close"]');
    await page.click('#upcomingBudgetsList button[aria-label^="Simulate skipping"]');
    assert.ok(await visible(page, '#simBadge'), 'What-If badge should show');
    await page.click('#upcomingBudgetsList button[aria-label^="Simulate skipping"]');
  });

  await page.evaluate(SEED_OWED);

  await step('owed on Home: a short summary per person, not every item', async () => {
    assert.ok(await visible(page, '.owed-summary'), 'summary hidden');
    assert.ok(!(await visible(page, '.owed-groups')), 'full list should be hidden on Home');
    assert.ok(!(await visible(page, '#owedTabs')), 'Still owed / Paid back tabs should be hidden on Home');
    const people = await page.$$eval('.owed-summary > button[data-action="setView"][data-arg="pending"]', bs => bs.length);
    assert.strictEqual(people, 4, 'one row per person, and no "See everything owed" button');
    assert.ok(!/See everything/.test(await page.textContent('.owed-summary')), 'the "See everything owed" button is back');
    assert.strictEqual(await owedCount(page), 24);
  });

  await step('owed header: just the total, no count; the tabs say "Still owed" / "Paid back" with no counts', async () => {
    const total = await page.evaluate(() => fmtGBP(state.checking.filter(r => r.need).reduce((a, r) => a + r.amount, 0)));
    assert.strictEqual((await page.textContent('#sec_pending h2 + span')).trim(), total);
    assert.strictEqual((await page.textContent('#pill_pending')).trim(), 'Still owed');
    assert.strictEqual((await page.textContent('#pill_settled')).trim(), 'Paid back');
  });

  await step('owed tab: grouped by person; one tick marks one item paid back', async () => {
    await page.click('.owed-summary > button:has-text("Kim")');
    assert.strictEqual(await page.evaluate(() => document.body.dataset.view), 'pending');
    assert.ok(await visible(page, '.owed-groups') && !(await visible(page, '.owed-summary')));
    assert.ok(await visible(page, '#heroSection') === false, 'Owed tab should show only the Owed section');
    const names = await page.$$eval('.owed-groups .text-sm.font-semibold.truncate', els => els.map(e => e.textContent));
    assert.deepStrictEqual(names, ['Kim', 'Sam', 'Robin', 'Lee'], 'biggest amount owed first: ' + JSON.stringify(names));
    await page.click('.owed-groups button[aria-label="Mark Sam Lidl paid back"]');
    await page.waitForTimeout(250);
    const t = (await calls(page, 'toggleNeedFlag')).pop();
    assert.ok(t && t.setNeed === false, JSON.stringify(t));
    assert.strictEqual(await owedCount(page), 23);
  });

  await step('owed tab: with several people owing, the header "All paid back" shows', async () => {
    assert.ok(await visible(page, '#btnSettleAll'), 'should show while 4 people owe');
  });

  await step('owed tab: "All paid back" for one person saves only their items', async () => {
    const before = await page.evaluate(() => state.checking.filter(r => r.need && /^robin/i.test(r.desc)).map(r => r.row).sort());
    await page.click('.owed-groups button[data-person="robin"]');
    await page.waitForTimeout(250);
    const s = (await calls(page, 'settleAllNeeds')).pop();
    assert.deepStrictEqual(s.rows.slice().sort(), before);
    assert.strictEqual(await owedCount(page), 23 - before.length, 'rows ' + JSON.stringify(before));
    const left = await page.evaluate(() => state.checking.filter(r => r.need && /^robin/i.test(r.desc)).length);
    assert.strictEqual(left, 0);
  });

  await step('owed tab: Paid back list has Undo, which puts an item back', async () => {
    await page.click('#pill_settled');
    assert.ok(await visible(page, '#panel_settled'));
    const n = await owedCount(page);
    await page.click('#panel_settled button:has-text("Undo")');
    await page.waitForTimeout(250);
    const t = (await calls(page, 'toggleNeedFlag')).pop();
    assert.ok(t && t.setNeed === true);
    assert.strictEqual(await owedCount(page), n + 1);
    await page.click('#pill_pending');
  });

  await step('activity tab: spending on top, full list, no "Show all"', async () => {
    await page.click('nav [data-nav="activity"]');
    assert.ok(await visible(page, '#actSpend'), 'spending summary hidden');
    assert.ok(/Activity$/.test((await page.textContent('#sec_activity h2')).trim()) && !(await visible(page, '.act-title-home')));
    const rows = await page.$$eval('#txListContainer > .tx-row', d => d.length);
    const total = await page.evaluate(() => ['amex', 'barclays', 'checking', 'marcus'].reduce((n, a) => n + state[a].filter(r => r.desc.toLowerCase() !== 'start').length, 0));
    assert.strictEqual(rows, total, 'should list every transaction');
    assert.ok(!(await page.$('#sec_activity button:has-text("Show all")')));
  });

  await step('activity tab: tapping a category chip filters the list to that category', async () => {
    await page.click('#actSpend button[data-cat="Groceries"]');
    const names = await page.$$eval('#txListContainer > .tx-row .truncate', els => els.map(e => e.textContent));
    assert.ok(names.length >= 2, 'expected grocery rows, got ' + JSON.stringify(names));
    const cats = await page.evaluate(n => n.map(x => categoryFor(x, loadSpendOverrides())), names);
    assert.ok(cats.every(c => c === 'Groceries'), JSON.stringify(names));
    assert.ok((await page.textContent('#actSpend')).includes('Groceries on cards'));
    await page.click('#actSpend button[data-cat="Groceries"]');
    assert.ok((await page.textContent('#actSpend')).includes('Spent on cards this month'));
  });

  await step('Activity tab: the account filters and search fold away behind one button; each left on shows as a chip that clears it', async () => {
    await page.evaluate(() => setView('activity'));
    const rowCount = () => page.$$eval('#txListContainer > .tx-row', d => d.length);
    assert.ok(!(await visible(page, '#txFilters')) && !(await visible(page, '#txSearch')), 'the filters should start folded away');
    assert.strictEqual(await page.getAttribute('#txFilterBtn', 'aria-expanded'), 'false');
    const all = await rowCount();
    const look = () => page.$eval('#txFilterBtn', b => getComputedStyle(b).color + ' ' + getComputedStyle(b).backgroundColor);
    const closedLook = await look();
    await page.click('#txFilterBtn');
    assert.notStrictEqual(await look(), closedLook, 'the button should look different while its filters are open');
    assert.ok(await visible(page, '#txFilters') && await visible(page, '#txSearch'), 'the button should show the filters');
    assert.strictEqual(await page.getAttribute('#txFilterBtn', 'aria-expanded'), 'true');
    assert.ok(!(await visible(page, '#txActive')), 'no chips while the filters themselves show');
    const word = await page.evaluate(() => state.amex.find(r => r.desc.toLowerCase() !== 'start').desc.slice(0, 4).trim());
    await page.click('#txf_amex');
    await page.fill('#txSearch', word + ' ');   // phone keyboards add a space after a suggestion
    await page.click('#txFilterBtn');
    assert.ok(!(await visible(page, '#txFilters')) && !(await visible(page, '#txSearch')));
    const chips = await page.$$eval('#txActive button', b => b.map(x => x.getAttribute('aria-label')));
    assert.deepStrictEqual(chips, ['Clear filter: Amex only', 'Clear filter: \u201C' + word + '\u201D']);
    const shown = await page.$$eval('#txListContainer > .tx-row', d => d.map(r => r.getAttribute('aria-label')));
    assert.ok(shown.length >= 1 && shown.length < all, 'the list should still be filtered: ' + JSON.stringify(shown));
    await page.click('#txActive button[aria-label="Clear filter: Amex only"]');
    assert.strictEqual(await page.evaluate(() => txFilter), 'all');
    await page.click('#txFilterBtn');
    await page.fill('#txSearch', '   ');   // only spaces: no filter, so every row and no chip
    await page.click('#txFilterBtn');
    assert.strictEqual(await rowCount(), all, 'a search of only spaces hid rows');
    assert.deepStrictEqual(await page.$$eval('#txActive button', b => b.map(x => x.getAttribute('aria-label'))), [], 'no chip for spaces');
    await page.click('#txFilterBtn');
    await page.fill('#txSearch', word);
    await page.click('#txFilterBtn');
    await page.click('#txActive button');   // the search one
    assert.strictEqual(await page.inputValue('#txSearch'), '');
    assert.ok(!(await visible(page, '#txActive')), 'no chips once nothing is left on');
    assert.strictEqual(await rowCount(), all);
  });

  await step('leaving the Activity tab clears its filters; Home shows the latest 4, no filters, and "See all"', async () => {
    await page.click('#actSpend button[data-cat="Groceries"]');
    await page.click('#txFilterBtn');
    await page.click('#txf_amex');
    await page.fill('#txSearch', 'zzz');
    await page.click('nav [data-nav="home"]');
    const rows = await page.$$eval('#txListContainer > .tx-row', d => d.map(r => r.getAttribute('aria-label')));
    assert.strictEqual(rows.length, 4, 'Home should show the latest 4: ' + JSON.stringify(rows));
    assert.ok(!(await visible(page, '#actSpend')));
    assert.ok(!(await visible(page, '#txFilters')) && !(await visible(page, '#txSearch')), 'the filters should not show on Home');
    assert.ok(!(await page.$('#sec_activity button:has-text("Show all")')), 'Home has "See all", not "Show all"');
    await page.click('#sec_activity button:has-text("See all")');
    assert.strictEqual(await page.evaluate(() => document.body.dataset.view), 'activity', '"See all" should open the Activity tab');
    const s = await page.evaluate(() => ({ filter: txFilter, search: document.getElementById('txSearch').value, cat: actCat }));
    assert.deepStrictEqual(s, { filter: 'all', search: '', cat: null }, 'the old filters came back');
    assert.ok(!(await visible(page, '#txFilters')) && !(await visible(page, '#txActive')), 'the filters should be folded away again, with no chips');
    await page.click('nav [data-nav="home"]');
  });

  await step('Home on a phone shows the same latest 4 the Activity tab starts with', async () => {
    const home = await page.$$eval('#txListContainer > .tx-row', d => d.map(r => r.getAttribute('aria-label')));
    await page.click('nav [data-nav="activity"]');
    const tab = await page.$$eval('#txListContainer > .tx-row', d => d.map(r => r.getAttribute('aria-label')));
    await page.click('nav [data-nav="home"]');
    assert.deepStrictEqual(home, tab.slice(0, 4));
  });

  await step('spending details: ring chart, open a category, change a shop\'s category, Escape closes', async () => {
    await page.click('nav [data-nav="activity"]');
    await page.click('#actSpend button:has-text("Details")');
    assert.ok(await visible(page, '#spendModal'));
    assert.ok(await page.$('#spendBody svg circle'));
    await page.click('#spendBody button[data-cat="Groceries"]');
    await page.selectOption('#spendBody select', 'Shopping');
    await page.waitForTimeout(250);
    const c = (await calls(page, 'setCategoryChoice')).pop();
    assert.ok(c && c.category === 'Shopping', JSON.stringify(c));
    await page.keyboard.press('Escape');
    assert.ok(!(await visible(page, '#spendModal')), 'Escape should close it');
  });

  await step('add a spend: saves and appears in activity', async () => {
    await page.click('nav button[aria-label="Add transaction"]');
    await page.fill('#inpMerchant', 'Flow test shop');
    await page.fill('#inpAmount', '7.25');
    await page.click('#btnSubmitTx');
    await page.waitForTimeout(300);
    const a = (await calls(page, 'addTransactionBundle')).pop();
    assert.ok(a && a.merchant === 'Flow test shop' && Number(a.grossAmount) === 7.25, JSON.stringify(a));
    assert.ok((await page.textContent('#txListContainer')).includes('Flow test shop'));
  });

  // The sync button: its colour (data-sync) and label are the status; the red caption is the only text, when a sync failed.
  const syncShown = () => page.evaluate(() => {
    const b = document.getElementById('syncBtn'), n = document.getElementById('syncStatus');
    return { sync: b.dataset.sync, label: b.getAttribute('aria-label'), sameTitle: b.title === b.getAttribute('aria-label'),
      colour: getComputedStyle(b).color, caption: n.classList.contains('hidden') ? null : n.textContent.trim() };
  });
  const syncSettled = sync => page.waitForFunction(v => apiInflight === 0 && document.getElementById('syncBtn').dataset.sync === v, sync, { timeout: 8000 });
  await step('sync status: green when synced, with when in its label; no words on the page', async () => {
    await syncSettled('synced');
    const v = await syncShown();
    assert.ok(/^Synced (just now|\d+ min ago)\. Tap to sync now$/.test(v.label) && v.sameTitle, JSON.stringify(v));
    assert.strictEqual(v.caption, null);
  });
  await step('sync status: no reply turns it red with "Couldn\'t reach your sheet", on one line; the next good sync clears it', async () => {
    const from = errors.length;
    try {
      const green = (await syncShown()).colour;
      await page.evaluate(() => { MOCK.dropNext = 1; });
      await page.click('#syncBtn');
      await syncSettled('failed');
      const v = await syncShown();
      assert.deepStrictEqual([v.caption, v.label], ["Couldn't reach your sheet. Tap ↻ to try again.", "Couldn't reach your sheet. Tap to try again"], JSON.stringify(v));
      assert.notStrictEqual(v.colour, green, 'red should look different from green');
      await page.click('#syncStatus');   // the caption syncs too
      await syncSettled('synced');
      assert.strictEqual((await syncShown()).caption, null);
    } finally { dropExpectedSyncErrors(from); }
  });
  await step('sync status: a spend that could not be sent is amber with no words; tapping the button sends it', async () => {
    const from = errors.length;
    try {
      await page.evaluate(() => { MOCK.dropNext = 1; });
      await page.click('nav button[aria-label="Add transaction"]');
      await page.fill('#inpAmount', '4.10');
      await page.fill('#inpMerchant', 'Waiting shop');
      await page.click('#btnSubmitTx');
      await syncSettled('waiting');
      const v = await syncShown();
      assert.deepStrictEqual([v.label, v.caption], ['1 spend waiting to send. Tap to send now', null], 'waiting comes before the failure, with no words');
      const sent = (await calls(page, 'addTransactionBundle')).length;
      await page.click('#syncBtn');
      await syncSettled('synced');
      const after = await calls(page, 'addTransactionBundle');
      assert.ok(after.length === sent + 1 && after.pop().merchant === 'Waiting shop', 'tapping should send the waiting spend');
      assert.strictEqual(await page.evaluate(() => loadOutbox().length), 0);
    } finally { dropExpectedSyncErrors(from); }
  });
  await step('sync status: offline is grey with no words; a spend saved offline makes it amber; back online it sends', async () => {
    await ctx.setOffline(true);
    await page.waitForFunction(() => document.getElementById('syncBtn').dataset.sync === 'offline');
    const off = await syncShown();
    assert.deepStrictEqual([off.label, off.caption], ['Offline, showing saved figures', null]);
    await page.click('nav button[aria-label="Add transaction"]');
    await page.fill('#inpAmount', '2.50');
    await page.fill('#inpMerchant', 'Offline shop');
    await page.click('#btnSubmitTx');
    await page.waitForFunction(() => document.getElementById('syncBtn').dataset.sync === 'waiting');
    const w = await syncShown();
    assert.deepStrictEqual([w.label, w.caption], ["1 spend waiting to send. It sends when you're back online", null]);
    assert.notStrictEqual(w.colour, off.colour, 'amber should look different from grey');
    await ctx.setOffline(false);
    await syncSettled('synced');
    assert.strictEqual(await page.evaluate(() => loadOutbox().length), 0);
  });
  // Offline spends: kept on this phone until the sheet has them. Only the sheet being busy is tried again by itself
  // (plus no reply, which the server de-duplicates); anything else is set aside in red, with Remove.
  const outbox = () => page.evaluate(() => loadOutbox());
  const rowsNamed = merchant => page.evaluate(m => Object.values(MOCK.db).filter(Array.isArray).flat().filter(r => r && r.desc === m).length, merchant);
  const sentCount = merchant => page.evaluate(m => MOCK.calls.filter(c => c.action === 'addTransactionBundle' && c.payload.merchant === m).length, merchant);
  const addSpend = async (amount, merchant) => {
    await page.click('nav button[aria-label="Add transaction"]');
    await page.fill('#inpAmount', amount);
    await page.fill('#inpMerchant', merchant);
    await page.click('#btnSubmitTx');
  };
  await step('outbox: a reply that cannot be read (Google error page) keeps the spend and sends it again, saved once', async () => {
    const from = errors.length;
    try {
      await page.evaluate(() => { MOCK.badReplyNext = 1; });
      await addSpend('3.30', 'Bad reply shop');
      await syncSettled('waiting');
      const o = await outbox();
      assert.ok(o.length === 1 && o[0].sentAt > 0, 'kept on this phone, noted as maybe sent: ' + JSON.stringify(o));
      assert.ok((await toastParts(page))[0].includes('kept on this device'));
      await page.click('#syncBtn');
      await syncSettled('synced');
      assert.strictEqual((await outbox()).length, 0);
      assert.strictEqual(await rowsNamed('Bad reply shop'), 1, 'the server ignores the repeat, so it is in the sheet once');
    } finally { dropExpectedSyncErrors(from); }
  });
  await step('outbox: the sheet busy (lock timeout) keeps the spend waiting; the next send gets it there', async () => {
    const from = errors.length;
    try {
      await page.evaluate(t => { MOCK.failWith = t; MOCK.failNext = 2; }, BUSY);
      await addSpend('2.20', 'Busy shop');
      await syncSettled('waiting');
      await page.click('#syncBtn');   // the sheet is still busy
      await syncSettled('waiting');
      const o = await outbox();
      assert.ok(o.length === 1 && o[0].tries === 1 && !o[0].setAside && !o[0].sentAt, JSON.stringify(o));
      await page.click('#syncBtn');
      await syncSettled('synced');
      assert.strictEqual((await outbox()).length, 0);
      assert.strictEqual(await rowsNamed('Busy shop'), 1);
    } finally { await page.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; }); dropExpectedSyncErrors(from); }
  });
  // Audit 3.2: the page acts on the server's code, never its words.
  await step("outbox: the server's code decides, not its words: BUSY in other words waits; busy words coded ERROR are set aside", async () => {
    const from = errors.length;
    try {
      await page.evaluate(() => { MOCK.failWith = { code: 'BUSY', error: 'Mock server failure: another save is under way.' }; MOCK.failNext = 1; });
      await addSpend('2.40', 'Coded busy shop');
      await syncSettled('waiting');
      let o = await outbox();
      assert.ok(o.length === 1 && !o[0].setAside && !o[0].sentAt, 'BUSY should wait: ' + JSON.stringify(o));
      await page.click('#syncBtn');
      await syncSettled('synced');
      assert.strictEqual(await rowsNamed('Coded busy shop'), 1);
      await page.evaluate(t => { MOCK.failWith = { code: 'ERROR', error: t }; MOCK.failNext = 1; }, LOCK_TIMEOUT);
      await addSpend('2.50', 'Uncoded busy shop');
      await syncSettled('failed');
      o = await outbox();
      assert.ok(o.length === 1 && /^Lock timeout/.test(o[0].setAside), 'ERROR should be set aside at once: ' + JSON.stringify(o));
      await page.click('#syncBtn');
      await syncSettled('synced');
      assert.deepStrictEqual(await outbox(), []);
      assert.strictEqual(await rowsNamed('Uncoded busy shop'), 1);
    } finally { await page.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; }); dropExpectedSyncErrors(from); }
  });
  await step('outbox: busy OUTBOX_MAX_TRIES times in a row sets it aside in red; the timer leaves it; a tap sends it', async () => {
    const from = errors.length;
    try {
      const max = await page.evaluate(() => OUTBOX_MAX_TRIES);
      await page.evaluate(([t, n]) => { MOCK.failWith = t; MOCK.failNext = n + 1; }, [BUSY, max]);
      await addSpend('1.10', 'Very busy shop');   // the first send isn't counted: then `max` tries
      await syncSettled('waiting');
      await page.evaluate(async n => { for (let i = 0; i < n; i++) await flushOutbox(); }, max);
      await syncSettled('failed');
      const o = await outbox();
      assert.ok(o.length === 1 && /^Lock timeout/.test(o[0].setAside), JSON.stringify(o));
      const v = await syncShown();
      assert.deepStrictEqual([v.caption, v.label], ["A spend couldn't be sent. Tap ↻ to try again.", "A spend saved on this device couldn't be sent. Tap to try again"]);
      await page.evaluate(() => flushOutbox());   // the timer leaves a set-aside spend alone
      assert.strictEqual(await sentCount('Very busy shop'), max + 1);
      await page.click('#syncStatus');
      await syncSettled('synced');
      assert.strictEqual((await outbox()).length, 0);
      assert.strictEqual(await rowsNamed('Very busy shop'), 1);
    } finally { await page.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; }); dropExpectedSyncErrors(from); }
  });
  await step('outbox: any other server error is not sent again by itself: set aside, and the screen shows whether it got there', async () => {
    const from = errors.length;
    try {
      // The server wrote the rows, then failed (so it never noted the spend as saved: a resend would write it twice).
      await page.evaluate(() => { MOCK.failAfterWriteNext = 1; });
      await addSpend('5.40', 'Half done shop');
      await syncSettled('failed');
      assert.strictEqual(await sentCount('Half done shop'), 1, 'sent once, not again');
      assert.strictEqual((await outbox())[0].setAside, 'Mock server failure');
      assert.deepStrictEqual(await toastParts(page), ["Couldn't send Half done shop £5.40: Mock server failure", 'Remove']);
      await page.waitForFunction(() => document.getElementById('txListContainer').textContent.includes('Half done shop'));   // fetched afresh: it is there
      await page.click('#toastAction');   // so remove it from this phone
      await syncSettled('synced');
      assert.strictEqual((await outbox()).length, 0);
      assert.strictEqual(await rowsNamed('Half done shop'), 1, 'Remove only takes it off this phone');
    } finally { await page.evaluate(() => { MOCK.failAfterWriteNext = 0; }); dropExpectedSyncErrors(from); }
  });
  await step('outbox: a spend the sheet turns down is kept and shown in red (not lost); a tap tries it again; Remove takes it off', async () => {
    const from = errors.length;
    try {
      await page.evaluate(() => { MOCK.failWith = 'Invalid amount.'; MOCK.failNext = 2; });
      await addSpend('1.00', 'Refused shop');
      await syncSettled('failed');
      assert.deepStrictEqual(await toastParts(page), ["Couldn't send Refused shop £1.00: Invalid amount.", 'Remove']);
      assert.strictEqual((await outbox())[0].setAside, 'Invalid amount.');
      assert.strictEqual((await syncShown()).caption, "A spend couldn't be sent. Tap ↻ to try again.");
      await page.click('#syncBtn');   // a tap tries it again: still turned down, still kept
      await page.waitForFunction(() => MOCK.failNext === 0 && apiInflight === 0);
      await syncSettled('failed');
      assert.strictEqual(await sentCount('Refused shop'), 2);
      assert.strictEqual((await outbox()).length, 1);
      await page.click('#toastAction');
      await syncSettled('synced');
      assert.strictEqual((await outbox()).length, 0);
      assert.strictEqual(await rowsNamed('Refused shop'), 0);
    } finally { await page.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; }); dropExpectedSyncErrors(from); }
  });
  await step('outbox: a spend whose reply was lost hours ago is not sent again by itself (it may be there); a tap sends it', async () => {
    const payload = { sheetName: await page.evaluate(() => activeMonth), merchant: 'Old lost shop', grossAmount: 6.5, isRefund: false, account: 'amex', splits: [], marcusShare: 0, markNeed: false, clientId: 'old-lost-1' };
    await page.evaluate(p => { saveOutbox([{ id: p.clientId, payload: p, sentAt: Date.now() - RESEND_WITHIN_MS - 60000 }]); return flushOutbox(); }, payload);
    await syncSettled('failed');
    assert.strictEqual(await sentCount('Old lost shop'), 0, 'not sent by itself');
    assert.ok(/may already be in your sheet/.test((await outbox())[0].setAside));
    assert.ok((await toastParts(page))[0].startsWith("Couldn't send Old lost shop £6.50: it may already be in your sheet."));
    await page.click('#syncBtn');
    await syncSettled('synced');
    assert.strictEqual(await sentCount('Old lost shop'), 1);
    assert.strictEqual((await outbox()).length, 0);
  });
  await step("outbox: with this phone's storage full, a turned-down spend is not sent over and over", async () => {
    const from = errors.length;
    try {
      const payload = { sheetName: await page.evaluate(() => activeMonth), merchant: 'Full storage shop', grossAmount: 2, isRefund: false, account: 'amex', splits: [], marcusShare: 0, markNeed: false, clientId: 'full-1' };
      await page.evaluate(p => {
        saveOutbox([{ id: p.clientId, payload: p }]);
        MOCK.failWith = 'Invalid amount.'; MOCK.failNext = 10;
        window.__setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); };   // nothing can be saved now
        return flushOutbox();
      }, payload);
      await page.waitForTimeout(2500);   // long enough for several rounds if setting it aside started another
      await page.waitForFunction(() => apiInflight === 0);
      assert.strictEqual(await sentCount('Full storage shop'), 1);
    } finally {
      await page.evaluate(() => { Storage.prototype.setItem = window.__setItem; MOCK.failWith = 'Mock server failure'; MOCK.failNext = 0; saveOutbox([]); updateSyncUi(); });
      dropExpectedSyncErrors(from);
    }
  });
  await step('saved, but the figures could not be read back: not kept or shown in red; the screen is fetched afresh; in the sheet once', async () => {
    const from = errors.length;
    try {
      const syncs = await sheetReads(page);
      await failSavedNoState(page);
      await page.evaluate(() => { document.querySelector('#toast span').textContent = ''; });
      await addSpend('3.80', 'Read back shop');
      await page.waitForFunction(n => MOCK.calls.filter(c => c.action === 'getCachedSheetState').length > n, syncs);
      await syncSettled('synced');
      assert.deepStrictEqual(await outbox(), [], 'nothing kept on this phone');
      assert.strictEqual(await sentCount('Read back shop'), 1, 'sent once, not again');
      assert.strictEqual(await rowsNamed('Read back shop'), 1);
      assert.ok((await page.textContent('#txListContainer')).includes('Read back shop'));
      assert.ok(!/Couldn't/.test((await toastParts(page))[0]), 'no failure toast: ' + (await toastParts(page))[0]);
      assert.strictEqual((await syncShown()).caption, null);
    } finally { await resetFailures(page); dropExpectedSyncErrors(from); }
  });
  await step('a waiting spend sent again and saved, but the figures could not be read back: it leaves this phone, saved once', async () => {
    const from = errors.length;
    try {
      const payload = { sheetName: await page.evaluate(() => activeMonth), merchant: 'Resent read back shop', grossAmount: 1.25, isRefund: false, account: 'amex', splits: [], marcusShare: 0, markNeed: false, clientId: 'resent-rb-1' };
      const syncs = await sheetReads(page);
      await failSavedNoState(page);
      await page.evaluate(p => { saveOutbox([{ id: p.clientId, payload: p }]); return flushOutbox(); }, payload);
      await syncSettled('synced');
      assert.ok(await sheetReads(page) > syncs, 'the screen was fetched afresh');
      assert.deepStrictEqual(await outbox(), []);
      assert.strictEqual(await sentCount('Resent read back shop'), 1);
      assert.strictEqual(await rowsNamed('Resent read back shop'), 1);
      await page.waitForFunction(() => document.getElementById('txListContainer').textContent.includes('Resent read back shop'));
    } finally { await resetFailures(page); dropExpectedSyncErrors(from); }
  });
  await step('outbox: (tidy up) the spends these steps saved are taken back out of the pretend sheet', async () => {
    await page.evaluate(() => {
      const ours = /^(Bad reply|Busy|Very busy|Coded busy|Uncoded busy|Half done|Old lost|Read back|Resent read back) shop$/;
      Object.values(MOCK.db).filter(Array.isArray).forEach(a => { for (let i = a.length - 1; i >= 0; i--) if (ours.test(a[i].desc)) a.splice(i, 1); });
    });
    await page.click('#syncBtn');
    await syncSettled('synced');
    assert.strictEqual(await rowsNamed('Busy shop'), 0);
  });
  await step("sign-in check unavailable on the server: \"Couldn't reach your sheet\", still signed in, no lock screen", async () => {
    const from = errors.length;
    try {
      const before = await page.evaluate(() => [hasValidToken(), Object.keys(localStorage).filter(k => /token|session/i.test(k)).sort().join()]);
      await page.evaluate(() => { MOCK.authError = { code: 'AUTH_UNAVAILABLE', error: "AUTH_UNAVAILABLE: Couldn't check the Google sign-in just now. Try again in a minute." }; });
      await page.click('#syncBtn');
      await syncSettled('failed');
      assert.strictEqual((await syncShown()).caption, "Couldn't reach your sheet. Tap ↻ to try again.");
      assert.ok(!(await page.evaluate(() => lockScreenShowing())), 'no lock screen');
      assert.deepStrictEqual(await page.evaluate(() => [hasValidToken(), Object.keys(localStorage).filter(k => /token|session/i.test(k)).sort().join()]), before, 'sign-in kept');
      await page.evaluate(() => { MOCK.authError = null; });
      await page.click('#syncBtn');
      await syncSettled('synced');
    } finally { await page.evaluate(() => { MOCK.authError = null; }); dropExpectedSyncErrors(from); }
  });
  await step('sync status: with no caption, Money Left sits the normal gap below the top bar (no empty line left)', async () => {
    await syncSettled('synced');
    await page.evaluate(() => { setView('home'); window.scrollTo(0, 0); });
    const gap = await page.evaluate(() => Math.round(document.getElementById('heroSection').getBoundingClientRect().top - document.querySelector('header').getBoundingClientRect().bottom));
    assert.strictEqual(gap, 14, 'gap above Money Left: ' + gap + 'px (the page padding is 14px)');
  });
  await step('sync status: a request that fails while offline shows grey, and back online the sheet is checked again (no red left)', async () => {
    const from = errors.length;
    try {
      await ctx.setOffline(true);
      await page.evaluate(() => { MOCK.dropNext = 1; });
      await page.click('#syncBtn');
      await page.waitForFunction(() => apiInflight === 0 && lastSyncFailed === 'reach');
      assert.strictEqual((await syncShown()).sync, 'offline', 'offline comes before the failure');
      await ctx.setOffline(false);
      await syncSettled('synced');
      assert.strictEqual((await syncShown()).caption, null);
    } finally { await ctx.setOffline(false); dropExpectedSyncErrors(from); }
  });
  await step('sync status: fingerprint requests never change it', async () => {
    const from = errors.length;
    try {
      await page.evaluate(() => { MOCK.dropNext = 1; return apiCall('passkeyList').catch(() => {}); });
      await syncSettled('synced');
      assert.strictEqual((await syncShown()).caption, null);
    } finally { dropExpectedSyncErrors(from); }
  });

  await step('Add and Edit forms: Amount comes first, full width and large, then Where / Description', async () => {
    const r = await page.evaluate(() => {
      const out = {};
      for (const [modal, a, d] of [['addModal', 'inpAmount', 'inpMerchant'], ['editTxModal', 'editTxAmt', 'editTxDesc']]) {
        document.getElementById(modal).classList.remove('hidden');
        const A = document.getElementById(a), D = document.getElementById(d), ra = A.getBoundingClientRect(), rd = D.getBoundingClientRect();
        out[modal] = { above: ra.bottom <= rd.top, sameWidth: Math.abs(ra.width - rd.width) < 1, size: getComputedStyle(A).fontSize,
          tabOrder: !!(A.compareDocumentPosition(D) & Node.DOCUMENT_POSITION_FOLLOWING) };
        document.getElementById(modal).classList.add('hidden');
      }
      return out;
    });
    const want = { above: true, sameWidth: true, size: '28px', tabOrder: true };
    assert.deepStrictEqual(r, { addModal: want, editTxModal: want });
  });

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
  await step('Add form: (tidy up) the spends these steps saved are taken back out of the pretend sheet', async () => {
    await page.evaluate(() => {
      const ours = /^(Enter key|Card memory) shop$/;
      Object.values(MOCK.db).filter(Array.isArray).forEach(a => { for (let i = a.length - 1; i >= 0; i--) if (ours.test(a[i].desc)) a.splice(i, 1); });
      forceSyncSheet();
    });
    await page.waitForFunction(() => apiInflight === 0 && !document.getElementById('txListContainer').textContent.includes('Card memory shop'));
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
  await step('edit then delete a transaction (with what the row should contain), and Undo', async () => {
    await page.click('#txListContainer > .tx-row:has-text("Flow test shop")');
    assert.ok(await visible(page, '#editTxModal'));
    await page.fill('#editTxDesc', 'Flow test shop 2');
    await page.click('#editTxModal button:has-text("Save")');
    await page.waitForTimeout(300);
    const e = (await calls(page, 'editOrMoveTransaction')).pop();
    assert.ok(e && e.newDesc === 'Flow test shop 2' && e.expect && e.expect.desc === 'Flow test shop', JSON.stringify(e));
    await page.click('#txListContainer > .tx-row:has-text("Flow test shop 2")');
    await page.click('#editTxModal button:has-text("Delete")');
    await page.waitForTimeout(300);
    const d = (await calls(page, 'deleteTransactionRow')).pop();
    assert.ok(d && d.expect && d.expect.desc === 'Flow test shop 2', JSON.stringify(d));
    await page.click('#toastAction');
    await page.waitForTimeout(300);
    assert.ok((await page.textContent('#txListContainer')).includes('Flow test shop 2'), 'Undo should bring it back');
    const u = (await calls(page, 'addTransactionBundle')).pop();
    assert.ok(u && u.merchant === 'Flow test shop 2' && u.clientId, 'Undo is sent as a spend with a clientId: ' + JSON.stringify(u));
  });

  // Audit 1.1: a change is shown straight away. If its save fails and the sheet can't be read either (offline), the
  // screen and this phone's saved copy go back to how they were, instead of keeping a change the sheet never got.
  // A save that did reach the sheet ('saved', only its figures couldn't be read back) is kept.
  const shownNow = () => page.evaluate(() => ({ state: JSON.stringify(state), saved: localStorage.getItem(CACHE_PREFIX + activeMonth),
    screen: document.getElementById('mainGrid').textContent.replace(/\s+/g, ' ') }));
  // The save turned down, or no reply to it; either way the sheet read that follows it gets no reply either.
  const NOT_SAVED = {
    refused: () => page.evaluate(() => { MOCK.failNext = 1; MOCK.dropReadsNext = 1; }),
    reach: () => page.evaluate(() => { MOCK.dropNext = 2; })   // the save, then the read
  };
  // Does `act` (which changes the screen at once), with the save failing as `fail` sets up; returns what was shown
  // before, straight after, and once the save and the sheet read that follows have both failed.
  const failedSave = async (act, fail) => {
    await page.waitForFunction(() => apiInflight === 0);
    const before = await shownNow(), reads = await sheetReads(page);
    await fail();
    await act();
    const changed = await shownNow();
    await page.waitForFunction(n => apiInflight === 0 && MOCK.calls.filter(c => c.action === 'getCachedSheetState').length > n, reads);
    return { before, changed, after: await shownNow() };
  };
  const rolledBack = (r, what) => {
    assert.notStrictEqual(r.changed.state, r.before.state, what + ': the change was not shown at once, so this proves nothing');
    assert.strictEqual(r.after.state, r.before.state, what + ': the screen\'s figures did not go back');
    assert.strictEqual(r.after.saved, r.before.state, what + ': the saved copy does not hold the figures shown before');
    assert.strictEqual(r.after.screen, r.before.screen, what + ': the screen did not go back');
  };
  const rollbackStep = (what, act, kinds = ['refused']) => step('a failed save with the sheet out of reach puts the screen and saved copy back: ' + what, async () => {
    const from = errors.length;
    try {
      for (const kind of kinds) rolledBack(await failedSave(act, NOT_SAVED[kind]), what + ' (' + kind + ')');
    } finally { await resetFailures(page); dropExpectedSyncErrors(from); }
  });
  const openTx = desc => page.click(`#txListContainer > .tx-row:has-text("${desc}")`);
  const firstSavedTx = () => page.evaluate(() => state.amex.find(r => !r.pending).desc);

  await page.evaluate(() => setView('home'));
  await rollbackStep('a transaction edit', async () => {
    await openTx(await firstSavedTx());
    await page.fill('#editTxDesc', 'Rolled back edit');
    await page.click('#editTxModal button:has-text("Save")');
  }, ['refused', 'reach']);
  await rollbackStep('a transaction moved to another card', async () => {
    await openTx(await firstSavedTx());
    await page.click('#etx_barclays');
    await page.click('#editTxModal button:has-text("Save")');
  });
  await rollbackStep('a transaction deleted', async () => {
    await openTx(await firstSavedTx());
    await page.click('#editTxModal button:has-text("Delete")');
  }, ['refused', 'reach']);
  await rollbackStep('a bill marked paid', () => page.click('#upcomingBudgetsList button[aria-label^="Mark"]'));
  await rollbackStep('a bill edited', async () => {
    await page.click('#upcomingBudgetsList button[aria-label^="Edit"]');
    await page.fill('#inpBudAmt', '123.45');
    await page.click('#budSaveBtn');
  });
  await rollbackStep('a new bill', async () => {
    await page.click('#btnAddBill');
    await page.fill('#inpBudName', 'Rolled back bill');
    await page.fill('#inpBudAmt', '9.99');
    await page.click('#budSaveBtn');
  });
  await rollbackStep('a bill deleted', async () => {
    await page.click('#upcomingBudgetsList button[aria-label^="Edit"]');
    await page.click('#budDeleteBtn');
  });
  // Separate from the step above: here the delete itself is saved, and it is the Undo's re-add that fails.
  await step('a failed save with the sheet out of reach puts the screen and saved copy back: a deleted bill brought back by Undo', async () => {
    const from = errors.length;
    let bill = null;
    try {
      await page.click('#upcomingBudgetsList button[aria-label^="Edit"]');
      const name = await page.inputValue('#inpBudName');
      bill = await page.evaluate(n => JSON.parse(JSON.stringify(state.budgets.find(b => b.name === n && !b.pending))), name);
      await page.click('#budDeleteBtn');
      await page.waitForFunction(() => apiInflight === 0);
      rolledBack(await failedSave(() => page.click('#toastAction'), NOT_SAVED.refused), 'Undo of a bill deletion');
    } finally {
      await resetFailures(page);
      // Tidy up: the bill goes back in the pretend sheet (not through the toast: that is what failed).
      if (bill) { await page.evaluate(b => undoDeleteBudget(b, activeMonth), bill); await page.waitForFunction(() => apiInflight === 0); }
      dropExpectedSyncErrors(from);
    }
  });
  await page.evaluate(() => setView('pending'));
  await rollbackStep('an owed item ticked as paid back', () => page.click('.owed-groups button[aria-label^="Mark"][aria-label$="paid back"]'), ['refused', 'reach']);
  await rollbackStep('"All paid back" for one person', () => page.click('.owed-groups button[data-action="handleSettlePerson"]'));
  await step('a save that reached the sheet but whose figures could not be read back is kept on screen and in the saved copy', async () => {
    const from = errors.length;
    try {
      const r = await failedSave(() => page.click('.owed-groups button[aria-label^="Mark"][aria-label$="paid back"]'),
        () => page.evaluate(t => { MOCK.failWith = t; MOCK.failAfterWriteNext = 1; MOCK.dropReadsNext = 2; }, SAVED_NO_STATE));
      assert.notStrictEqual(r.changed.state, r.before.state, 'the tick was not shown at once');
      assert.strictEqual(r.after.state, r.changed.state, 'a saved change was rolled back');
      assert.strictEqual(r.after.saved, r.changed.saved, 'a saved change was taken out of the saved copy');
      await page.waitForFunction(() => MOCK.dropReadsNext === 0 && apiInflight === 0, null, { timeout: 9000 });   // the second try, 5 s later
    } finally { await resetFailures(page); dropExpectedSyncErrors(from); }
  });
  await page.evaluate(() => { setView('home'); forceSyncSheet(); });
  await page.waitForFunction(() => apiInflight === 0);

  await step("bills: Undo of a delete that didn't go through adds nothing (the bill is still in the sheet, so it would be there twice)", async () => {
    const from = errors.length;
    try {
      await page.click('#upcomingBudgetsList button[aria-label^="Edit"]');
      const name = await page.inputValue('#inpBudName');
      const saves = (await calls(page, 'saveBudgetItem')).length;
      await page.evaluate(() => { MOCK.failNext = 1; MOCK.nextLatencies = [600]; });   // slow, so Undo is tapped before the reply
      await page.click('#budDeleteBtn');
      await page.click('#toastAction');
      await page.waitForFunction(() => apiInflight === 0);
      await page.waitForTimeout(200);
      assert.strictEqual((await calls(page, 'saveBudgetItem')).length, saves, 'Undo sent the bill again');
      assert.strictEqual(await page.evaluate(n => MOCK.db.budgets.filter(b => b.name === n).length, name), 1);
      assert.strictEqual(await page.evaluate(n => state.budgets.filter(b => b.name === n).length, name), 1);
    } finally { await resetFailures(page); await page.evaluate(() => { MOCK.nextLatencies = []; }); dropExpectedSyncErrors(from); }
  });
  await step('Edit: saving with no description says so under the box, and sends nothing', async () => {
    const edits = (await calls(page, 'editOrMoveTransaction')).length;
    await openTx(await firstSavedTx());
    await page.fill('#editTxDesc', '  ');
    await page.click('#editTxModal button:has-text("Save")');
    assert.ok(await visible(page, '#editTxDescErr'), 'no message under the box');
    assert.strictEqual(await page.textContent('#editTxDescErr'), 'Add where it was');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'editTxDesc');
    assert.ok(await visible(page, '#editTxModal'), 'the form closed');
    await page.waitForTimeout(150);
    assert.strictEqual((await calls(page, 'editOrMoveTransaction')).length, edits, 'an edit was sent');
    await page.keyboard.press('Escape');
    await openTx(await firstSavedTx());
    assert.ok(!(await visible(page, '#editTxDescErr')), 'the message was still there when Edit opened again');
    await page.keyboard.press('Escape');
  });
  await step('row numbers from the sheet or a saved copy are always numbers (they go into the page markup)', async () => {
    const r = await page.evaluate(() => {
      const s = numberRows({ summary: {}, budgets: [{ row: '7"><b>x' }], amex: [{ row: '12' }] });
      return [Number.isNaN(s.budgets[0].row), s.amex[0].row];
    });
    assert.deepStrictEqual(r, [true, 12]);
  });
  await step("a damaged saved copy of the month doesn't stop the app opening: it is passed over and the figures fetched", async () => {
    const ctx = await browser.newContext(desk);
    await ctx.addInitScript(() => {
      localStorage.setItem('pf_last_month', 'Test Payday 2026');
      localStorage.setItem('pf_cache_Test Payday 2026', JSON.stringify({ activeMonth: 'Test Payday 2026', summary: { nCA: 1 }, budgets: 'damaged', checking: [null] }));
    });
    const from = errors.length;
    try {
      const p = watch(await ctx.newPage());
      await p.goto(`http://localhost:${PORT}/tests/harness.html?demo=1&keep=1&latency=50`);
      await p.waitForFunction(() => window.MOCK && MOCK.MONTH === 'Test Payday 2026' && MOCK.calls.length > 0 && apiInflight === 0 && /£\d/.test(document.getElementById('kpiNCA').textContent));
      assert.deepStrictEqual(errors.slice(from), [], 'the page failed');
      assert.ok(await p.evaluate(() => state.budgets.length > 0), 'the figures were not fetched');
    } finally { await ctx.close(); }
  });

  await step('activity rows: tap to edit like Bills, no pencil; a row is a real button (keyboard works too)', async () => {
    const s = await page.$$eval('#txListContainer > .tx-row', rows => rows.map(r => ({ tag: r.tagName, label: r.getAttribute('aria-label') || '', svgs: r.querySelectorAll('svg').length, wide: r.getBoundingClientRect().width >= r.parentElement.getBoundingClientRect().width })));
    assert.ok(s.length > 0);
    assert.ok(s.every(r => r.tag === 'BUTTON' && r.label.startsWith('Edit ')), JSON.stringify(s.slice(0, 2)));
    assert.ok(s.every(r => r.svgs === 0), 'a pencil (or other icon) is still on a row');
    assert.ok(s.every(r => r.wide), 'a row no longer spans the list');
    await page.focus('#txListContainer > .tx-row');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('editTxModal').classList.contains('hidden'));
    await page.evaluate(() => closeEditTxModal());
  });
  await step('Escape closes the Add form', async () => {
    await page.click('nav button[aria-label="Add transaction"]');
    await page.keyboard.press('Escape');
    assert.ok(!(await visible(page, '#addModal')));
  });
  // ---- Back (Android's Back gesture = the browser going back) ----
  const backState = () => page.evaluate(() => ({ depth: (history.state && history.state.pfDepth) || 0, view: document.body.dataset.view,
    add: !document.getElementById('addModal').classList.contains('hidden'), app: typeof setView === 'function' && location.pathname.endsWith('/tests/harness.html') }));
  // history.back(), then wait until the page has handled it (and any step of its own it took after).
  const backOn = async pg => {
    await pg.evaluate(() => new Promise(r => { addEventListener('popstate', () => setTimeout(r, 0), { once: true }); history.back(); }));
    await pg.waitForFunction(() => !historyMoving);
  };
  const goBack = () => backOn(page);
  await step('Back with the Add form open closes it and stays in the app', async () => {
    await page.click('nav button[aria-label="Add transaction"]');
    assert.deepStrictEqual(await backState(), { depth: 1, view: 'home', add: true, app: true });
    await goBack();
    assert.deepStrictEqual(await backState(), { depth: 0, view: 'home', add: false, app: true });
  });
  await step('Back from the Bills tab goes to Home; with a sheet open over a tab, Back closes the sheet first', async () => {
    await page.click('nav button[data-nav="budgets"]');
    assert.deepStrictEqual(await backState(), { depth: 1, view: 'budgets', add: false, app: true });
    await page.click('nav button[data-nav="activity"]');   // tab to tab: still one step
    assert.strictEqual((await backState()).depth, 1);
    await page.click('nav button[aria-label="Add transaction"]');
    assert.deepStrictEqual(await backState(), { depth: 2, view: 'activity', add: true, app: true });
    await goBack();
    assert.deepStrictEqual(await backState(), { depth: 1, view: 'activity', add: false, app: true });
    await goBack();
    assert.deepStrictEqual(await backState(), { depth: 0, view: 'home', add: false, app: true });
  });
  await step('closing a sheet with ✕, Escape or Save takes its step off too, so the next Back is not wasted', async () => {
    await page.click('nav button[aria-label="Add transaction"]');
    await page.click('#addModal button[aria-label="Close"]');
    await page.waitForFunction(() => !((history.state && history.state.pfDepth) || 0));
    await page.click('nav button[aria-label="Add transaction"]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !((history.state && history.state.pfDepth) || 0));
    await page.click('nav button[data-nav="budgets"]');
    await page.click('nav button[data-nav="home"]');   // Home by tapping: its step is taken off as well
    await page.waitForFunction(() => !((history.state && history.state.pfDepth) || 0));
    await page.click('nav button[aria-label="Add transaction"]');
    await page.fill('#inpAmount', '1.05');
    await page.fill('#inpMerchant', 'Back step shop');
    await page.click('#btnSubmitTx');   // saved: the form closes, and so does its step
    await page.waitForFunction(() => !((history.state && history.state.pfDepth) || 0) && !historyMoving && apiInflight === 0);
    await page.evaluate(() => { const a = MOCK.db.amex; a.splice(a.findIndex(r => r.desc === 'Back step shop'), 1); forceSyncSheet(); });
    // Closing one sheet and opening another straight away still leaves one step for the open one.
    await page.evaluate(() => { openAddModal(); closeAddModal(); openAddModal(); });
    await page.waitForFunction(() => (history.state && history.state.pfDepth) === 1 && !historyMoving);
    assert.deepStrictEqual(await backState(), { depth: 1, view: 'home', add: true, app: true });
    await goBack();
    assert.deepStrictEqual(await backState(), { depth: 0, view: 'home', add: false, app: true });
  });
  await step('screen readers: form boxes have labels, sheets are dialogs with a title, chosen buttons say so', async () => {
    const r = await page.evaluate(() => {
      const unlabelled = ['monthSelector', 'inpAmount', 'inpMerchant', 'editTxAmt', 'editTxDesc', 'nmName', 'nmPaycheck', 'nmSavings', 'inpBudName', 'inpBudAmt', 'txSearch']
        .filter(id => { const el = document.getElementById(id); return !(el.labels && el.labels.length) && !el.getAttribute('aria-label'); });
      const dialogs = SHEETS.map(([id]) => { const d = document.querySelector('#' + id + ' [role="dialog"]'); const t = d && document.getElementById(d.getAttribute('aria-labelledby'));
        return d && d.getAttribute('aria-modal') === 'true' && t && t.textContent.trim() ? 'ok' : id; });
      openAddModal(); selectAcct('barclays');
      const pressed = ACCTS.map(a => document.getElementById('acct_' + a).getAttribute('aria-pressed'));
      selectAcct('amex'); closeAddModal();
      const sameSheets = JSON.stringify([...document.querySelectorAll('.kb-sheet')].map(el => el.id).sort()) === JSON.stringify(SHEETS.map(([id]) => id).sort());
      const live = () => document.getElementById('toast').getAttribute('role') + '/' + document.getElementById('toast').getAttribute('aria-live');
      showToast('x', { kind: 'info' }); const info = live();
      showToast('x'); const failure = live();
      return { unlabelled, dialogs, pressed, sameSheets, current: [...document.querySelectorAll('nav [data-nav]')].map(b => b.getAttribute('aria-current')),
        toast: [info, failure] };
    });
    assert.deepStrictEqual(r, { unlabelled: [], dialogs: Array(7).fill('ok'), pressed: ['false', 'true', 'false', 'false'],
      sameSheets: true, current: ['page', null, null, null], toast: ['status/polite', 'alert/assertive'] });
    await page.click('nav button[data-nav="pending"]');
    assert.deepStrictEqual(await page.$$eval('nav [data-nav]', bs => bs.map(b => b.getAttribute('aria-current'))), [null, null, 'page', null]);
    await page.click('nav button[data-nav="home"]');
  });
  await step('after a reload with a sheet open over a tab (Sign out reloads), the first Back is not wasted', async () => {
    const { ctx: c4, page: p4 } = await open(phone);
    try {
      await p4.click('nav button[data-nav="budgets"]');
      await p4.click('nav button[aria-label="Add transaction"]');
      assert.strictEqual(await p4.evaluate(() => history.state.pfDepth), 2);
      await p4.reload();
      await p4.waitForFunction(() => typeof setView === 'function' && window.MOCK && MOCK.calls.length > 0 && !historyMoving);
      assert.strictEqual(await p4.evaluate(() => (history.state && history.state.pfDepth) || 0), 0);
      await p4.goBack();   // nothing is open, so Back leaves the app at once
      assert.ok(!p4.url().includes('harness.html'), 'still in the app after Back: ' + p4.url());
    } finally { await c4.close(); }
  });
  await step('a window widened past the phone layout on a tab drops its step, and gets it back when narrowed', async () => {
    const { ctx: c5, page: p5 } = await open(phone);
    try {
      const depth = () => p5.evaluate(() => (history.state && history.state.pfDepth) || 0);
      await p5.click('nav button[data-nav="activity"]');
      assert.strictEqual(await depth(), 1);
      await p5.setViewportSize({ width: 1280, height: 860 });
      await p5.waitForFunction(() => !historyMoving && !((history.state && history.state.pfDepth) || 0));
      await p5.setViewportSize({ width: 400, height: 860 });
      await p5.waitForFunction(() => (history.state && history.state.pfDepth) === 1);
      await backOn(p5);
      assert.strictEqual(await p5.evaluate(() => document.body.dataset.view), 'home');
    } finally { await c5.close(); }
  });
  // ---- the bill form is a sheet (like Edit Transaction), so it opens where you are ----
  await step('bills: a bill far down a long list opens its sheet in sight, and the list stays where it was', async () => {
    const { ctx: c6, page: p6 } = await open({ viewport: { width: 411, height: 847 }, deviceScaleFactor: 2.63, isMobile: true, hasTouch: true });
    try {
      await p6.evaluate(() => {
        for (let i = 0; i < 16; i++) MOCK.db.budgets.push({ row: 50 + i, name: 'Long list bill ' + i, amount: -(10 + i), originalBudget: -(10 + i), isRecurring: true });
        forceSyncSheet();
      });
      await p6.waitForFunction(() => apiInflight === 0 && state.budgets.some(b => b.name === 'Long list bill 15'));
      await p6.click('nav button[data-nav="budgets"]');
      const target = '#upcomingBudgetsList button[aria-label="Edit Long list bill 15"]';
      await p6.$eval(target, el => el.scrollIntoView({ block: 'center' }));
      const before = await p6.evaluate(() => scrollY);
      assert.ok(before > 300, 'the bill should be far down the page: ' + before);
      await p6.click(target);
      const r = await p6.evaluate(() => {
        const sheet = document.querySelector('#budgetModal [role="dialog"]').getBoundingClientRect(), amt = document.getElementById('inpBudAmt').getBoundingClientRect();
        return { y: scrollY, inSight: sheet.top >= 0 && sheet.bottom <= innerHeight + 1 && amt.top >= 0 && amt.bottom <= innerHeight,
          title: document.getElementById('budFormTitle').textContent, save: document.getElementById('budSaveBtn').textContent.trim(),
          del: !document.getElementById('budDeleteBtn').classList.contains('hidden'), amount: document.getElementById('inpBudAmt').value,
          depth: (history.state && history.state.pfDepth) || 0 };
      });
      assert.deepStrictEqual(r, { y: before, inSight: true, title: 'Edit Long list bill 15', save: 'Save Changes', del: true, amount: '25', depth: 2 });
      await backOn(p6);   // Back closes the sheet; still on the Bills tab, still scrolled where you were
      assert.deepStrictEqual(await p6.evaluate(() => [document.getElementById('budgetModal').classList.contains('hidden'), document.body.dataset.view, scrollY]), [true, 'budgets', before]);
    } finally { await c6.close(); }
  });
  await step('bills: + Add opens "Add bill" with the cursor in Amount; Enter goes to Name, Enter saves; no name says so', async () => {
    try {
      await page.click('#btnAddBill');
      const f = await page.evaluate(() => ({ title: document.getElementById('budFormTitle').textContent, save: document.getElementById('budSaveBtn').textContent.trim(),
        del: document.getElementById('budDeleteBtn').classList.contains('hidden'), focus: document.activeElement.id }));
      assert.deepStrictEqual(f, { title: 'Add bill', save: 'Save Bill', del: true, focus: 'inpBudAmt' });
      const sent = (await calls(page, 'saveBudgetItem')).length;
      await page.keyboard.type('12.50');
      await page.keyboard.press('Enter');
      assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'inpBudName');
      await page.keyboard.press('Enter');   // no name yet
      assert.strictEqual(await page.textContent('#inpBudNameErr'), 'Add a name');
      assert.strictEqual((await calls(page, 'saveBudgetItem')).length, sent, 'nothing is sent without a name');
      await page.keyboard.type('Sheet test bill');
      await page.keyboard.press('Enter');
      await page.waitForFunction(n => MOCK.calls.filter(c => c.action === 'saveBudgetItem').length === n + 1, sent);
      const sv = (await calls(page, 'saveBudgetItem')).pop();
      assert.ok(sv.name === 'Sheet test bill' && sv.amount === -12.5 && !sv.row, JSON.stringify(sv));
      assert.ok(!(await visible(page, '#budgetModal')), 'the sheet closes once saved');
    } finally {
      await page.evaluate(() => { closeBudgetForm(); const i = MOCK.db.budgets.findIndex(b => b.name === 'Sheet test bill'); if (i > -1) MOCK.db.budgets.splice(i, 1); forceSyncSheet(); });
      await page.waitForFunction(() => apiInflight === 0);
    }
  });
  await step('bills: saved, but the figures could not be read back: no failure message; the sheet is fetched and the bill shows', async () => {
    const from = errors.length;
    try {
      await failSavedNoState(page);
      await page.evaluate(() => { document.querySelector('#toast span').textContent = ''; });
      await page.click('#btnAddBill');
      await page.fill('#inpBudAmt', '9.99');
      await page.fill('#inpBudName', 'Read back bill');
      await page.click('#budSaveBtn');
      await page.waitForFunction(() => MOCK.calls.some(c => c.action === 'saveBudgetItem' && c.payload.name === 'Read back bill' && c.end) && apiInflight === 0);
      assert.strictEqual(await page.textContent('#toast span'), '', 'no message');
      await page.waitForFunction(() => apiInflight === 0 && state.budgets.some(b => b.name === 'Read back bill' && !b.pending));   // fetched afresh
      assert.strictEqual(await page.evaluate(() => MOCK.db.budgets.filter(b => b.name === 'Read back bill').length), 1);
    } finally {
      await resetFailures(page);
      await page.evaluate(() => { closeBudgetForm(); const i = MOCK.db.budgets.findIndex(b => b.name === 'Read back bill'); if (i > -1) MOCK.db.budgets.splice(i, 1); forceSyncSheet(); });
      await page.waitForFunction(() => apiInflight === 0);
      dropExpectedSyncErrors(from);
    }
  });
  await step('delete: saved, but the figures could not be read back: the "Deleted / Undo" message stays, and Undo works', async () => {
    const from = errors.length;
    try {
      await page.evaluate(() => { const a = MOCK.db.amex; a.push({ row: Math.max(...a.map(r => r.row)) + 1, desc: 'Read back delete', amount: -2.5 }); forceSyncSheet(); });
      await page.waitForFunction(() => apiInflight === 0 && state.amex.some(t => t.desc === 'Read back delete'));
      const syncs = await sheetReads(page);
      await failSavedNoState(page);
      await page.evaluate(() => { const t = state.amex.find(x => x.desc === 'Read back delete'); openEditTxModal('amex', t.row, t.desc, t.amount); });
      await page.click('#editTxModal button:has-text("Delete")');
      await page.waitForFunction(n => apiInflight === 0 && MOCK.calls.filter(c => c.action === 'getCachedSheetState').length > n, syncs);
      assert.deepStrictEqual(await toastParts(page), ['Deleted "Read back delete"', 'Undo']);
      assert.ok(!(await page.evaluate(() => MOCK.db.amex.some(t => t.desc === 'Read back delete'))), 'deleted in the sheet');
      await page.click('#toastAction');
      await page.waitForFunction(() => apiInflight === 0 && MOCK.db.amex.filter(t => t.desc === 'Read back delete').length === 1);
    } finally {
      await resetFailures(page);
      await page.evaluate(() => { MOCK.db.amex = MOCK.db.amex.filter(t => t.desc !== 'Read back delete'); forceSyncSheet(); });
      await page.waitForFunction(() => apiInflight === 0);
      dropExpectedSyncErrors(from);
    }
  });
  await step('delete that fails, with Undo tapped before the reply: Undo adds nothing (no second copy)', async () => {
    const from = errors.length;
    try {
      await page.evaluate(() => { const a = MOCK.db.amex; a.push({ row: Math.max(...a.map(r => r.row)) + 1, desc: 'Failed delete', amount: -3.25 }); forceSyncSheet(); });
      await page.waitForFunction(() => apiInflight === 0 && state.amex.some(t => t.desc === 'Failed delete'));
      const adds = (await calls(page, 'addTransactionBundle')).length;
      await page.evaluate(() => { MOCK.failWith = 'Mock server failure'; MOCK.failNext = 1; MOCK.nextLatencies = [800]; const t = state.amex.find(x => x.desc === 'Failed delete'); openEditTxModal('amex', t.row, t.desc, t.amount); });
      await page.click('#editTxModal button:has-text("Delete")');
      assert.deepStrictEqual(await toastParts(page), ['Deleted "Failed delete"', 'Undo']);
      await page.click('#toastAction');   // while the delete is still on its way
      await page.waitForFunction(() => apiInflight === 0 && MOCK.calls.some(c => c.action === 'deleteTransactionRow' && c.end));
      assert.strictEqual(await page.evaluate(() => MOCK.db.amex.filter(t => t.desc === 'Failed delete').length), 1, 'a second copy was added');
      assert.strictEqual((await calls(page, 'addTransactionBundle')).length, adds, 'Undo sent a spend');
      await page.waitForFunction(() => state.amex.filter(t => t.desc === 'Failed delete' && !t.pending).length === 1 && !state.amex.some(t => t.pending));
    } finally {
      await resetFailures(page);
      await page.evaluate(() => { MOCK.db.amex = MOCK.db.amex.filter(t => t.desc !== 'Failed delete'); forceSyncSheet(); });
      await page.waitForFunction(() => apiInflight === 0);
      dropExpectedSyncErrors(from);
    }
  });
  await step('the "Open Sheet" links open only a Google Sheet, in a new tab with no link back', async () => {
    const r = await page.evaluate(() => {
      const before = document.getElementById('rawSheetBtn').href;
      applyServerState({ ...state, sheetUrl: 'javascript:alert(1)' });
      const bad = document.getElementById('rawSheetBtn').href;
      applyServerState({ ...state, sheetUrl: 'https://docs.google.com/spreadsheets/d/x/edit#gid=1' });
      return { kept: bad === before, good: document.getElementById('rawSheetMenuBtn').href,
        rel: ['rawSheetBtn', 'rawSheetMenuBtn'].map(id => document.getElementById(id).rel) };
    });
    assert.deepStrictEqual(r, { kept: true, good: 'https://docs.google.com/spreadsheets/d/x/edit#gid=1', rel: ['noopener noreferrer', 'noopener noreferrer'] });
  });
  await step('bills: the sheet fits a 344px phone (no label wraps), every button has a 44px hit area, boxes are 44px tall', async () => {
    const { ctx: c7, page: p7 } = await open({ viewport: { width: 344, height: 740 }, isMobile: true, hasTouch: true });
    try {
      await p7.evaluate(() => { const b = state.budgets.find(x => !x.pending); openBudgetFormForRow(b.row); });
      const lines = await lineCounts(p7, ['#budFormTitle', '#btype_event', '#btype_bill', '#bsign_neg', '#bsign_pos', 'label[for="inpBudAmt"]', 'label[for="inpBudName"]', '#budDeleteBtn', '#budSaveBtn']);
      assert.deepStrictEqual(lines.filter(x => !/:1$/.test(x)), [], lines.join(' '));
      const hits = await hitAreas(p7, '#budgetModal button');   // sizes only: the rounded corners don't count as misses
      assert.ok(hits.count >= 7 && !hits.bad.filter(x => / is \d/.test(x)).length, JSON.stringify(hits));
      const boxes = await p7.$$eval('#budgetModal input:not([type="hidden"])', els => els.map(e => Math.round(e.getBoundingClientRect().height)));
      assert.ok(boxes.every(h => h >= 44), 'boxes: ' + boxes);
      assert.strictEqual(await p7.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'scrolls sideways');
    } finally { await c7.close(); }
  });
  await step('Add and Edit spend sheets: toggles, cards, Save and Delete are 44px like the bill sheet, and fit at 344px', async () => {
    const { ctx: c8, page: p8 } = await open({ viewport: { width: 344, height: 740 }, isMobile: true, hasTouch: true });
    try {
      const sizesOk = async sel => { const h = await hitAreas(p8, sel); return [h.count, h.bad.filter(x => / is \d/.test(x))]; };
      await p8.evaluate(() => openAddModal());
      assert.deepStrictEqual(await sizesOk('#addModal [id^="dir_"], #addModal [id^="acct_"], #btnSubmitTx'), [7, []]);
      let lines = await lineCounts(p8, ['#dir_spend', '#dir_refund', '#acct_checking', '#btnSubmitTx']);
      await p8.evaluate(() => { closeAddModal(); const r = state.amex.find(x => !x.pending && x.desc !== 'start') || state.checking.find(x => x.desc !== 'start'); openEditTxModal(state.amex.includes(r) ? 'amex' : 'checking', r.row, r.desc, r.amount); });
      assert.deepStrictEqual(await sizesOk('#editTxModal [id^="etsign_"], #editTxModal [id^="etx_"], #btnSaveEditTx, #editTxModal button[data-action="deleteCurrentTx"]'), [8, []]);
      lines = lines.concat(await lineCounts(p8, ['#etsign_neg', '#etsign_pos', '#etx_checking', '#btnSaveEditTx']));
      assert.deepStrictEqual(lines.filter(x => !/:1$/.test(x)), [], lines.join(' '));
    } finally { await c8.close(); }
  });
  // The Add sheet's small split controls (Jon kept their look, 2026-11-08): each has a hidden tap area of at least
  // 24px (as big as it can be, up to 44px, without reaching a neighbour), and adding it changes nothing on screen.
  const SMALL_TAPS = { equal: '#customSplitBox button[data-action="applyEqualGroupSplit"]', includeMe: '#customSplitBox label:has(#chkEqualIncludeMe)',
    remove: '#dynamicSplitRows button[data-action="removePersonRow"]', owed: '#needToggleWrap' };
  // Where each one's tap area is (from its ::after), and every way it could go wrong: too small, a point in it that
  // doesn't reach it, overlapping another control, or taking a tap from one.
  const smallTaps = page => page.evaluate(sels => {
    const out = { sizes: {}, bad: [], boxes: {} };
    const controls = Object.entries(sels).flatMap(([k, sel]) => [...document.querySelectorAll(sel)].map((el, i) => [k + i, el]));
    const others = [...document.querySelectorAll('#addModal :is(button, input, label, select, textarea, a)')]
      .filter(el => el.getClientRects().length && !controls.some(([, c]) => c === el || c.contains(el) || el.contains(c)));
    const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const tapBoxes = controls.map(([k, el]) => {
      const b = el.getBoundingClientRect(), a = getComputedStyle(el, '::after');
      const w = Math.max(b.width, a.content !== 'none' ? parseFloat(a.width) : 0), h = Math.max(b.height, a.content !== 'none' ? parseFloat(a.height) : 0);
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const box = { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
      out.sizes[k] = Math.round(w) + 'x' + Math.round(h);
      out.boxes[k] = box;
      if (w < 24 || h < 24) out.bad.push(k + ' is only ' + out.sizes[k]);
      sample: for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
        const x = box.left + 0.5 + (w - 1) * i / 6, y = box.top + 0.5 + (h - 1) * j / 6, hit = document.elementFromPoint(x, y);
        if (!hit || !el.contains(hit)) { out.bad.push(k + ' misses at ' + Math.round(x) + ',' + Math.round(y) + ' (hits ' + (hit ? hit.tagName + '#' + hit.id : 'nothing') + ')'); break sample; }
      }
      return [k, el, box];
    });
    for (const [k, , box] of tapBoxes) {
      for (const [k2, , box2] of tapBoxes) if (k < k2 && overlap(box, box2)) out.bad.push(k + ' overlaps ' + k2);
      for (const o of others) if (overlap(box, o.getBoundingClientRect())) out.bad.push(k + ' overlaps ' + o.tagName + '#' + o.id + '.' + String(o.className).slice(0, 20));
    }
    // A tick box inside one of them still takes a tap on itself (not the label's area drawn over it).
    for (const [k, el] of controls) for (const box of el.querySelectorAll('input')) {
      const r = box.getBoundingClientRect();
      if (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== box) out.bad.push(k + ' covers its own tick box');
    }
    // Every other control still gets every tap on itself (sampled over its own box).
    for (const o of others) {
      const r = o.getBoundingClientRect();
      sample: for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
        const x = r.left + 1 + (r.width - 2) * i / 4, y = r.top + 1 + (r.height - 2) * j / 4, hit = document.elementFromPoint(x, y);
        const thief = hit && tapBoxes.find(([, el]) => el.contains(hit));
        if (thief) { out.bad.push(thief[0] + ' takes a tap meant for ' + o.tagName + '#' + o.id); break sample; }
      }
    }
    return out;
  }, SMALL_TAPS);
  // Every element's place in the Add sheet, to compare with and without the tap areas.
  const addSheetLayout = page => page.evaluate(() => {
    const d = document.querySelector('#addModal [role="dialog"]');
    return [d.scrollHeight, ...[d, ...d.querySelectorAll('*')].map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(v => Math.round(v * 10) / 10).join(','); })];
  });
  // Where two screenshots of the Add sheet differ: how many pixels, the box round them (page px), the biggest colour
  // difference, and what is drawn there. A difference of up to 8 (of 255) in a colour is too small to see, and Linux
  // Chrome's software drawing makes such specks (it gave 2 at most on GitHub's runner); anything visible is far more.
  const SPECK = 8;
  const pictureDiff = (page, a, b) => page.evaluate(async ([a, b, speck]) => {
    const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const px = i => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
    const da = px(ia), db = px(ib), d = document.querySelector('#addModal [role="dialog"]').getBoundingClientRect();
    let n = 0, max = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let p = 0; p < da.length; p += 4) {
      const m = Math.max(Math.abs(da[p] - db[p]), Math.abs(da[p + 1] - db[p + 1]), Math.abs(da[p + 2] - db[p + 2]));
      if (m <= speck) continue;
      const x = (p / 4) % ia.width, y = Math.floor(p / 4 / ia.width);
      n++; max = Math.max(max, m); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (!n) return '';
    const at = document.elementFromPoint(d.left + (x0 + x1) / 2, d.top + (y0 + y1) / 2);
    return n + ' px differ (max ' + max + ') in ' + [x0 + d.left, y0 + d.top, x1 + d.left, y1 + d.top].map(Math.round).join(',') + ' at ' + (at ? at.tagName + '#' + at.id + '.' + String(at.className).slice(0, 30) : 'nothing');
  }, [a.toString('base64'), b.toString('base64'), SPECK]);
  for (const w of [411, 344]) {
    await step(`${w}px Add sheet, group split: the small split controls have tap areas of 24px+ that reach only them`, async () => {
      const { ctx: c9, page: p9 } = await open({ viewport: { width: w, height: 960 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
      // The Add sheet with £30 split between Kim and Lee (and me).
      const openSplit = async () => {
        await p9.evaluate(() => { closeAddModal(); openAddModal(); document.getElementById('inpAmount').value = '30'; selectSplit('custom'); });
        await p9.click('#chip_lee');
        await p9.evaluate(() => document.activeElement.blur());
      };
      try {
        await openSplit();
        const t = await smallTaps(p9);
        assert.deepStrictEqual(t.bad, [], JSON.stringify(t.sizes));
        // The heights each one is given (widths follow the wording; the ✕ is 32px both ways).
        assert.deepStrictEqual(Object.entries(t.sizes).map(([k, v]) => k + ' ' + (k.startsWith('remove') ? v : v.split('x')[1])),
          ['equal0 36', 'includeMe0 36', 'remove0 32x32', 'remove1 32x32', 'owed0 44']);

        // A tap at the very edge of each tap area (outside the control as drawn) does that control's job.
        const edge = async (k, where) => {
          const { boxes } = await smallTaps(p9), b = boxes[k];
          const pt = { top: [(b.left + b.right) / 2, b.top + 1], bottom: [(b.left + b.right) / 2, b.bottom - 1], left: [b.left + 1, (b.top + b.bottom) / 2] }[where];
          await p9.touchscreen.tap(pt[0], pt[1]);
        };
        await p9.fill('#dynamicSplitRows .split-amt', '5');
        assert.strictEqual(await p9.inputValue('#dynamicSplitRows .split-amt'), '5');
        await edge('equal0', 'top');
        assert.deepStrictEqual(await p9.$$eval('#dynamicSplitRows .split-amt', i => i.map(x => x.value)), ['10', '10'], 'Split Equally');
        const tick = id => p9.evaluate(i => document.getElementById(i).checked, id);
        const me = await tick('chkEqualIncludeMe');
        await edge('includeMe0', 'bottom');
        assert.strictEqual(await tick('chkEqualIncludeMe'), !me, 'Include me');
        const owed = await tick('chkNeed');
        await edge('owed0', 'top');
        assert.strictEqual(await tick('chkNeed'), !owed, 'Add to "Owed"');
        await edge('remove1', 'left');
        assert.deepStrictEqual(await p9.$$eval('#dynamicSplitRows .split-name', i => i.map(x => x.value)), ['kim'], 'the ✕ by Lee');

        // Nothing on screen changes: the same layout and the same picture with the tap areas taken away (last, as the
        // controls written into the page keep their classes off until it reloads).
        await openSplit();
        const sheet = p9.locator('#addModal [role="dialog"]');
        const withTaps = [await addSheetLayout(p9), await sheet.screenshot()];
        await p9.evaluate(sels => Object.values(sels).forEach(sel => document.querySelectorAll(sel).forEach(el => el.classList.remove('hit', 'hit-36', 'hit-32'))), SMALL_TAPS);
        assert.ok(/x16$/.test((await smallTaps(p9)).sizes.owed0), 'the tap areas were not taken away');
        assert.deepStrictEqual(await addSheetLayout(p9), withTaps[0], 'the tap areas move something in the Add sheet');
        const diff = await pictureDiff(p9, withTaps[1], await sheet.screenshot());
        assert.ok(!diff, 'the tap areas change how the Add sheet looks: ' + diff);
      } finally { await c9.close(); }
    });
  }
  await step('bills: a tap outside the sheet does not close it (what was typed is kept)', async () => {
    try {
      await page.click('#btnAddBill');
      await page.keyboard.type('7');
      await page.mouse.click(5, 5);   // the dimmed area above the sheet
      assert.ok(await visible(page, '#budgetModal'), 'the sheet closed');
      assert.strictEqual(await page.inputValue('#inpBudAmt'), '7');
    } finally { await page.evaluate(() => closeBudgetForm()); }
  });
  await step('bills: Restore of a paid bill with no remembered amount puts the cursor in Amount', async () => {
    try {
      await page.evaluate(() => openBudgetForm(4, 'Some bill', 0, true));
      assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'inpBudAmt');
      await page.evaluate(() => { closeBudgetForm(); document.activeElement.blur(); openBudgetForm(4, 'Some bill', -20, true); });
      assert.notStrictEqual(await page.evaluate(() => document.activeElement.id), 'inpBudAmt', 'editing a bill with an amount should not pop the keyboard');
    } finally { await page.evaluate(() => closeBudgetForm()); }
  });
  await ctx.close();
}).catch(e => { console.error(e); process.exit(1); });
