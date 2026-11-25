// Screen tests, real Chrome: Android's Back gesture; screen-reader labels; the bill and spend sheets (saving,
// deleting and Undo, saves whose figures couldn't be read back, 44px hit areas and the small split controls' tap
// areas); the "Open Google Sheet" links.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/back-and-sheets.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const { uiSuite, phone, calls, failSavedNoState, resetFailures, sheetReads, visible, lineCounts, hitAreas, toastParts, sendsAndSettles } = require('../lib/ui');

uiSuite(async ({ errors, open, step, dropExpectedSyncErrors }) => {
  const { ctx, page } = await open(phone);
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
    await page.click('nav button[aria-label="Add spend"]');
    assert.deepStrictEqual(await backState(), { depth: 1, view: 'home', add: true, app: true });
    await goBack();
    assert.deepStrictEqual(await backState(), { depth: 0, view: 'home', add: false, app: true });
  });
  await step('Back from the Bills tab goes to Home; with a sheet open over a tab, Back closes the sheet first', async () => {
    await page.click('nav button[data-nav="budgets"]');
    assert.deepStrictEqual(await backState(), { depth: 1, view: 'budgets', add: false, app: true });
    await page.click('nav button[data-nav="activity"]');   // tab to tab: still one step
    assert.strictEqual((await backState()).depth, 1);
    await page.click('nav button[aria-label="Add spend"]');
    assert.deepStrictEqual(await backState(), { depth: 2, view: 'activity', add: true, app: true });
    await goBack();
    assert.deepStrictEqual(await backState(), { depth: 1, view: 'activity', add: false, app: true });
    await goBack();
    assert.deepStrictEqual(await backState(), { depth: 0, view: 'home', add: false, app: true });
  });
  await step('closing a sheet with ✕, Escape or Save takes its step off too, so the next Back is not wasted', async () => {
    await page.click('nav button[aria-label="Add spend"]');
    await page.click('#addModal button[aria-label="Close"]');
    await page.waitForFunction(() => !((history.state && history.state.pfDepth) || 0));
    await page.click('nav button[aria-label="Add spend"]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !((history.state && history.state.pfDepth) || 0));
    await page.click('nav button[data-nav="budgets"]');
    await page.click('nav button[data-nav="home"]');   // Home by tapping: its step is taken off as well
    await page.waitForFunction(() => !((history.state && history.state.pfDepth) || 0));
    await page.click('nav button[aria-label="Add spend"]');
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
      await p4.click('nav button[aria-label="Add spend"]');
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
      assert.deepStrictEqual(r, { y: before, inSight: true, title: 'Edit Long list bill 15', save: 'Save changes', del: true, amount: '25', depth: 2 });
      await backOn(p6);   // Back closes the sheet; still on the Bills tab, still scrolled where you were
      assert.deepStrictEqual(await p6.evaluate(() => [document.getElementById('budgetModal').classList.contains('hidden'), document.body.dataset.view, scrollY]), [true, 'budgets', before]);
    } finally { await c6.close(); }
  });
  await step('bills: + Add opens "Add bill" with the cursor in Amount; Enter goes to Name, Enter saves; no name says so', async () => {
    try {
      await page.click('#btnAddBill');
      const f = await page.evaluate(() => ({ title: document.getElementById('budFormTitle').textContent, save: document.getElementById('budSaveBtn').textContent.trim(),
        del: document.getElementById('budDeleteBtn').classList.contains('hidden'), focus: document.activeElement.id }));
      assert.deepStrictEqual(f, { title: 'Add bill', save: 'Save bill', del: true, focus: 'inpBudAmt' });
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
  await step('the "Open Google Sheet" links open only a Google Sheet, in a new tab with no link back', async () => {
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
  await step('bills: Restore of a paid bill with no remembered amount, then Save, un-pays it with the amount typed', async () => {
    const bill = await page.evaluate(() => {
      const b = state.budgets.find(x => !x.pending && Number(x.amount) !== 0);
      // Paid, with nothing remembered (as on an old sheet), on the page and in the pretend backend alike.
      Object.assign(b, { amount: 0, originalBudget: 0 });
      Object.assign(MOCK.db.budgets.find(x => x.row === b.row), { amount: 0, originalBudget: 0 });
      renderAll();
      return { row: b.row, name: b.name };
    });
    await page.evaluate(r => restoreBudget(r), bill.row);
    assert.ok(await visible(page, '#budgetModal'), 'Restore should open the form to ask for an amount');
    await page.fill('#inpBudAmt', '12.34');
    const saved = await sendsAndSettles(page, 'saveBudgetItem', () => page.click('#budSaveBtn'));
    assert.ok(saved && saved.paid === false && saved.amount === -12.34, 'expected an un-paid save of -12.34: ' + JSON.stringify(saved));
    assert.strictEqual(await page.evaluate(r => Number(state.budgets.find(x => x.row === r).amount), bill.row), -12.34);
  });
  await ctx.close();
}).catch(e => { console.error(e); process.exit(1); });
