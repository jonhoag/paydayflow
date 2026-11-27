// Screen tests, real Chrome: The phone screens: balances, bills, owed, activity and spending; adding, editing and
// deleting a spend; the sync status, spends saved offline, and the server's error codes.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/phone.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const { uiSuite, phone, SEED_OWED, calls, failSavedNoState, resetFailures, sheetReads, visible, owedCount, toastParts, LOCK_TIMEOUT, BUSY, sendsAndSettles } = require('../lib/ui');

uiSuite(async ({ errors, open, step, dropExpectedSyncErrors }) => {
  const { ctx, page } = await open(phone);

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
    assert.deepStrictEqual(await expanded(), ['Bills|budgetsBody|true', 'Owed|pendingBody|true', 'Activity|activityBody|true']);
    await page.click('#chevActivity');
    assert.ok(!(await visible(page, '#activityBody')), 'the ▾ on Home should still fold a section');
    assert.strictEqual((await expanded())[2], 'Activity|activityBody|false', 'a screen reader should hear it is folded');
    await page.click('#chevActivity');
    assert.strictEqual((await expanded())[2], 'Activity|activityBody|true');
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
    const paid = await sendsAndSettles(page, 'updateBudgetRow', () => page.click('#upcomingBudgetsList button[aria-label^="Mark"]'));
    assert.ok(paid && paid.newAmount === 0, 'expected updateBudgetRow with 0, got ' + JSON.stringify(paid));
    const name = first.replace(/^Mark | paid$/g, '');
    assert.ok((await page.textContent('#clearedBudgetsList')).includes(name), 'bill should move to Paid');
    await page.evaluate(() => document.querySelector('#clearedBudgetsList').closest('details').open = true);
    const restored = await sendsAndSettles(page, 'updateBudgetRow', () => page.click('#clearedBudgetsList button:has-text("Restore")'));
    assert.ok(restored && restored.newAmount < 0, 'Restore should put the amount back: ' + JSON.stringify(restored));
  });

  await step('bills: editing a paid bill (a new name) keeps it paid; its form shows the amount it would go back to', async () => {
    await page.evaluate(() => setView('home'));
    await sendsAndSettles(page, 'updateBudgetRow', () => page.click('#upcomingBudgetsList button[aria-label^="Mark"]'));
    const bill = await page.evaluate(() => { const b = state.budgets.find(x => Number(x.amount) === 0 && x.originalBudget && !x.pending); return { row: b.row, name: b.name, orig: b.originalBudget }; });
    await page.evaluate(() => { document.querySelector('#clearedBudgetsList').closest('details').open = true; });
    await page.click(`#clearedBudgetsList button[data-action="openBudgetFormForRow"][data-row="${bill.row}"]`);   // its name in the Paid list
    assert.strictEqual(Number(await page.inputValue('#inpBudAmt')), Math.abs(bill.orig), 'the form should show the amount to restore');
    assert.ok(await visible(page, '#budPaidTag'), 'the form of a paid bill should say Paid');
    await page.fill('#inpBudName', bill.name + ' x');
    const saved = await sendsAndSettles(page, 'saveBudgetItem', () => page.click('#budSaveBtn'));
    assert.ok(saved && saved.paid === true && saved.amount === bill.orig, 'expected a save as still paid: ' + JSON.stringify(saved));
    const now = () => page.evaluate(r => { const b = state.budgets.find(x => x.row === r); return [b.name, Number(b.amount), b.originalBudget]; }, bill.row);
    assert.deepStrictEqual(await now(), [bill.name + ' x', 0, bill.orig], 'the bill was un-paid');
    await sendsAndSettles(page, 'updateBudgetRow', () => page.evaluate(r => restoreBudget(r), bill.row));   // back as it was, for the steps after
    assert.strictEqual((await now())[1], bill.orig);
  });

  await step('bills: tapping a name opens its edit form; What if shows switches only while it is on', async () => {
    await page.click('#upcomingBudgetsList button[aria-label^="Edit"]');
    assert.ok(await visible(page, '#budgetModal'), 'edit form did not open');
    assert.ok(/^Edit /.test(await page.textContent('#budFormTitle')));
    assert.ok(!(await visible(page, '#budPaidTag')), 'an unpaid bill\'s form says Paid');
    await page.click('#budgetModal button[aria-label="Close"]');
    assert.strictEqual(await page.$$eval('#upcomingBudgetsList [role="switch"]', s => s.length), 0, 'switches without What if');
    await page.click('#bf_whatif');
    assert.ok(await visible(page, '#whatIfHint'), 'no hint in What if mode');
    await page.click('#upcomingBudgetsList button[role="switch"]');
    assert.ok(await visible(page, '#simBadge'), 'What-If badge should show');
    // A bill left out, then marked Paid: nothing is left out any more, so the badge goes (and Restore brings it back counted).
    const sw = await page.$$eval('#upcomingBudgetsList button[role="switch"]', s => s.map(b => [b.dataset.row, b.getAttribute('aria-checked')]));
    const off = Number(sw.find(([, on]) => on === 'false')[0]);
    await sendsAndSettles(page, 'updateBudgetRow', () => page.evaluate(r => markBudgetPaid(r), off));
    assert.ok(!(await visible(page, '#simBadge')), 'the What-If badge stays lit for a bill that is now paid');
    await sendsAndSettles(page, 'updateBudgetRow', () => page.evaluate(r => restoreBudget(r), off));   // back as it was
    assert.strictEqual(await page.getAttribute(`#upcomingBudgetsList button[role="switch"][data-row="${off}"]`, 'aria-checked'), 'true', 'restored bill came back left out');
    await page.click('#bf_whatif');   // off again: every bill counts again
    assert.ok(!(await visible(page, '#simBadge')) && !(await visible(page, '#whatIfHint')), 'What if left something behind');
    assert.strictEqual(await page.$$eval('#upcomingBudgetsList [role="switch"]', s => s.length), 0, 'switches still showing');
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
    const t = await sendsAndSettles(page, 'toggleNeedFlag', () => page.click('.owed-groups button[aria-label="Mark Sam Lidl paid back"]'));
    assert.ok(t && t.setNeed === false, JSON.stringify(t));
    assert.strictEqual(await owedCount(page), 23);
  });

  await step('owed tab: with several people owing, the header "All paid back" shows', async () => {
    assert.ok(await visible(page, '#btnSettleAll'), 'should show while 4 people owe');
  });

  await step('owed tab: "All paid back" for one person saves only their items', async () => {
    const before = await page.evaluate(() => state.checking.filter(r => r.need && /^robin/i.test(r.desc)).map(r => r.row).sort());
    const s = await sendsAndSettles(page, 'settleAllNeeds', () => page.click('.owed-groups button[data-person="robin"]'));
    assert.deepStrictEqual(s.rows.slice().sort(), before);
    assert.strictEqual(await owedCount(page), 23 - before.length, 'rows ' + JSON.stringify(before));
    const left = await page.evaluate(() => state.checking.filter(r => r.need && /^robin/i.test(r.desc)).length);
    assert.strictEqual(left, 0);
  });

  await step('owed tab: Paid back list has Undo, which puts an item back', async () => {
    await page.click('#pill_settled');
    assert.ok(await visible(page, '#panel_settled'));
    const n = await owedCount(page);
    const t = await sendsAndSettles(page, 'toggleNeedFlag', () => page.click('#panel_settled button:has-text("Undo")'));
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
    assert.ok((await page.textContent('#actSpend')).includes('Groceries, your share'));
    await page.click('#actSpend button[data-cat="Groceries"]');
    assert.ok((await page.textContent('#actSpend')).includes('Your spending this month'));
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

  await step('spending details: Mine | Total, open a category, change a shop\'s category, Escape closes', async () => {
    await page.click('nav [data-nav="activity"]');
    await page.click('#actSpend button:has-text("Details")');
    assert.ok(await visible(page, '#spendModal'));
    assert.strictEqual(await page.getAttribute('#sv_mine', 'aria-pressed'), 'true');
    assert.ok(!(await page.$('#spendModal svg circle')), 'the ring is gone');
    await page.click('#spendBody button[data-cat="Groceries"]');
    const c = await sendsAndSettles(page, 'setCategoryChoice', () => page.selectOption('#spendBody select', 'Shopping'));
    assert.ok(c && c.category === 'Shopping', JSON.stringify(c));
    await page.keyboard.press('Escape');
    assert.ok(!(await visible(page, '#spendModal')), 'Escape should close it');
  });

  await step('add a spend: saves and appears in activity', async () => {
    await page.click('nav button[aria-label="Add spend"]');
    await page.fill('#inpMerchant', 'Flow test shop');
    await page.fill('#inpAmount', '7.25');
    const a = await sendsAndSettles(page, 'addTransactionBundle', () => page.click('#btnSubmitTx'));
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
      await page.click('nav button[aria-label="Add spend"]');
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
    await page.click('nav button[aria-label="Add spend"]');
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
    await page.click('nav button[aria-label="Add spend"]');
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
      await page.waitForTimeout(2500);   // kept on purpose (nothing must happen): long enough for several rounds if setting it aside started another
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
  await step('edit then delete a transaction (with what the row should contain), and Undo', async () => {
    await page.click('#txListContainer > .tx-row:has-text("Flow test shop")');
    assert.ok(await visible(page, '#editTxModal'));
    await page.fill('#editTxDesc', 'Flow test shop 2');
    const e = await sendsAndSettles(page, 'editOrMoveTransaction', () => page.click('#editTxModal button:has-text("Save")'));
    assert.ok(e && e.newDesc === 'Flow test shop 2' && e.expect && e.expect.desc === 'Flow test shop', JSON.stringify(e));
    await page.click('#txListContainer > .tx-row:has-text("Flow test shop 2")');
    const d = await sendsAndSettles(page, 'deleteTransactionRow', () => page.click('#editTxModal button:has-text("Delete")'));
    assert.ok(d && d.expect && d.expect.desc === 'Flow test shop 2', JSON.stringify(d));
    const u = await sendsAndSettles(page, 'addTransactionBundle', () => page.click('#toastAction'));
    assert.ok((await page.textContent('#txListContainer')).includes('Flow test shop 2'), 'Undo should bring it back');
    assert.ok(u && u.merchant === 'Flow test shop 2' && u.clientId, 'Undo is sent as a spend with a clientId: ' + JSON.stringify(u));
  });
  await ctx.close();
}).catch(e => { console.error(e); process.exit(1); });
