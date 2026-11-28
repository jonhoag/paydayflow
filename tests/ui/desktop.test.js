// Screen tests, real Chrome: Awkward text from the sheet, the desktop layout, the page source, and a device never
// sent any names.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/desktop.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { APP_SCRIPTS } = require('../../build-sw');
const { uiSuite, settles, root, appSource, phone, desk, monthBars, SEED_OWED, calls, visible, sendsAndSettles } = require('../lib/ui');

uiSuite(async ({ browser, open, step }) => {
  let ctx, page;
  // ---------------- awkward text ----------------
  ({ ctx, page } = await open(phone, 'evil=1'));
  // Hostile text in every account, a bill, an Owed entry, a month name and a fingerprint device (id and label):
  // every screen that shows it is opened, and nothing may run, add an element, or add a handler.
  // The page has no handlers in its markup (it uses data-action and friends), so any on...= attribute came from text, and
  // so did any action name the page doesn't know.
  const hostile = () => page.evaluate(() => ({
    pwned: window.__pwned || null,
    imgs: document.querySelectorAll('img').length,
    bolds: document.querySelectorAll('b').length,
    protoTouched: 'total' in {} || 'count' in {},
    handlers: [...document.querySelectorAll('*')].flatMap(el => [...el.attributes]
      .filter(a => /^on/i.test(a.name) || (/^data-(action|input|change)$/.test(a.name) && !Object.prototype.hasOwnProperty.call(ACTIONS, a.value)))
      .map(a => el.tagName + ' ' + a.name + '=' + a.value.slice(0, 40)))
  }));
  const CLEAN = { pwned: null, imgs: 0, bolds: 0, protoTouched: false, handlers: [] };
  await step('hostile text (attribute and handler break-outs) on every screen, the month list and the device list: nothing runs', async () => {
    // Each screen must really show the hostile text (as text), or this would prove nothing.
    const shows = { home: 'onmouseover', budgets: 'onmouseover', pending: '<b>bold</b>', activity: 'onmouseover' };
    for (const v of Object.keys(shows)) {
      await page.click('nav [data-nav="' + v + '"]');
      await page.evaluate(() => document.querySelectorAll('button[aria-expanded="false"]').forEach(b => { if (/Show all|Paid \(/.test(b.textContent)) b.click(); }));
      assert.ok((await page.textContent('main')).includes(shows[v]), v + ' should show the hostile text');
      assert.deepStrictEqual(await hostile(), CLEAN, 'on ' + v);
    }
    await page.click('nav [data-nav="pending"]');
    assert.ok(/Constructor/.test(await page.textContent('main')) && /__proto__/i.test(await page.textContent('main')), 'Owed shows people called "constructor" and "__proto__"');
    await page.evaluate(() => openSpendModal());
    await page.click('#spendModal button:has-text("purchases")');   // the category opens to list its shops
    const shops = await page.textContent('#spendModal');
    assert.ok(shops.includes('onmouseover') && /__proto__/i.test(shops) && /constructor/i.test(shops), 'Spending details should list the hostile shops');
    assert.deepStrictEqual(await hostile(), CLEAN, 'Spending details');
    await page.evaluate(() => closeSpendModal());
    const months = await page.$$eval('#monthSelector option', os => os.map(o => o.textContent));
    assert.ok(months.includes('Evil "Month" <img src=x onerror=window.__pwned=4> 2026'), 'the month name shows as text: ' + months.join(' | '));
    await page.evaluate(() => openPasskeyModal());
    await page.waitForFunction(() => document.getElementById('pkDevices').textContent.includes('onmouseover'));
    assert.deepStrictEqual(await hostile(), CLEAN, 'fingerprint device list');
    assert.deepStrictEqual(await page.$$eval('#pkDevices button', bs => bs.map(b => b.dataset.id)), await page.evaluate(() => pkDevices.map(d => d.id)), 'each id reaches its button as data');
    await page.evaluate(() => closePasskeyModal());
  });
  await step('hostile text in a row: its edit sheet shows it exactly, as a value', async () => {
    const t = await page.evaluate(() => state.barclays.find(x => /onerror/.test(x.desc)));
    await page.evaluate(x => openEditTxModal('barclays', x.row, x.desc, x.amount), t);
    assert.strictEqual(await page.inputValue('#editTxDesc'), t.desc);
    assert.deepStrictEqual(await hostile(), CLEAN);
    await page.evaluate(() => closeEditTxModal());
  });
  await ctx.close();

  // ---------------- desktop ----------------
  ({ ctx, page } = await open(desk));
  await page.evaluate(SEED_OWED);
  await step('desktop: the sync button carries the status too; the red caption shows only on a failure', async () => {
    const r = await page.evaluate(() => { const n = document.getElementById('syncStatus'), b = document.getElementById('syncBtn');
      const fine = [b.dataset.sync, n.classList.contains('hidden')];
      lastSyncFailed = 'reach'; updateSyncUi(); const bad = [b.dataset.sync, n.classList.contains('hidden'), n.textContent.trim()];
      lastSyncFailed = null; updateSyncUi(); return { fine, bad }; });
    assert.deepStrictEqual(r, { fine: ['synced', true], bad: ['failed', false, "Couldn't reach your sheet. Tap ↻ to try again."] });
  });
  await step('desktop: every owed item grouped by person, no summary, no Activity-tab extras', async () => {
    assert.ok(await visible(page, '.owed-groups') && !(await visible(page, '.owed-summary')));
    assert.ok(await visible(page, '#owedTabs'));
    assert.ok(!(await visible(page, '#actSpend')));
    const rows = await page.$$eval('#txListContainer > .tx-row', d => d.length);
    assert.strictEqual(rows, 8);
    assert.ok(await visible(page, '#txFilters') && await visible(page, '#txSearch'), 'desktop keeps the Activity filters');
    await page.click('#txf_amex');
    assert.ok(!(await visible(page, '#txFilterBtn')) && !(await visible(page, '#txActive')), 'desktop needs no filter button or chips');
    await page.click('#txf_all');
    assert.ok(await page.$('#sec_activity button:has-text("Show all")'), 'desktop keeps "Show all"');
  });
  await step('desktop: Owed sits under Bills, Activity on the right; no top-bar Add, the sidebar Add is always there', async () => {
    const r = await page.evaluate(() => Object.fromEntries(['sec_budgets', 'sec_pending', 'sec_activity'].map(id => { const b = document.getElementById(id).getBoundingClientRect(); return [id, { l: Math.round(b.left), t: Math.round(b.top), b: Math.round(b.bottom) }]; })));
    assert.strictEqual(r.sec_pending.l, r.sec_budgets.l, JSON.stringify(r));
    assert.ok(r.sec_pending.t > r.sec_budgets.b && r.sec_pending.t - r.sec_budgets.b <= 20, 'Owed should follow Bills: ' + JSON.stringify(r));
    assert.ok(r.sec_activity.l > r.sec_budgets.l && r.sec_activity.t === r.sec_budgets.t, JSON.stringify(r));
    assert.strictEqual(await page.$$eval('header button', bs => bs.filter(b => /Add/.test(b.textContent)).length), 0, 'the top bar still has an Add button');
    for (const w of [1024, 1280, 1600]) {
      await page.setViewportSize({ width: w, height: 800 });
      assert.ok(await visible(page, 'aside button[data-action="openAddModal"]'), 'no Add spend in the sidebar at ' + w + 'px');
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  });
  await step('a section folded on the desktop opens again when the window narrows to its phone tab (which has no ▾)', async () => {
    await page.evaluate(() => setView('activity'));
    await page.click('#chevActivity');
    assert.ok(!(await visible(page, '#activityBody')), 'the ▾ should fold Activity on the desktop');
    await page.setViewportSize({ width: 400, height: 860 });
    await settles(page, () => innerWidth === 400 && document.getElementById('activityBody').getClientRects().length > 0);
    assert.ok(await visible(page, '#activityBody'), 'the Activity tab is stuck folded with no ▾ to open it');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => setView('home'));
  });
  await step('Spending left open while the phone folds or unfolds redraws to the bars that fit (6 wide, 4 narrow)', async () => {
    const bars = () => page.$$eval('#spendBody .items-end > div', els => els.length);
    await page.evaluate(() => {
      window.__realMonths = spendMonthTotals;
      spendMonthTotals = () => ['May', 'June', 'July', 'August', 'September', 'October'].map(m => ({ name: m + ' Payday 2026', total: 1234.56 }));
      openSpendModal();
    });
    try {
      assert.strictEqual(await bars(), 6);
      await page.setViewportSize({ width: 400, height: 860 });
      await settles(page, () => document.querySelectorAll('#spendBody .items-end > div').length === 4);
      assert.strictEqual(await bars(), 4, 'still six bars after narrowing with Spending open');
      await page.setViewportSize({ width: 1280, height: 800 });
      await settles(page, () => document.querySelectorAll('#spendBody .items-end > div').length === 6);
      assert.strictEqual(await bars(), 6, 'still four bars after widening with Spending open');
    } finally {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.evaluate(() => { spendMonthTotals = window.__realMonths; closeSpendModal(); });
    }
  });
  await step('desktop: Spending shows six months, each full amount fitting its own bar', async () => {
    const out = await monthBars(page);
    assert.strictEqual(out.length, 6, JSON.stringify(out));
    assert.ok(out.every(o => o.text === '£1,234.56' && o.lines === 1 && o.fits), JSON.stringify(out));
  });
  await step('desktop: the header "All paid back" shows with several people owing; Bills say "to pay"', async () => {
    assert.ok(await visible(page, '#btnSettleAll'));
    assert.ok(/^£[\d,]+\.\d\d to pay$/.test(await page.textContent('#budLeftVal')), await page.textContent('#budLeftVal'));
  });
  await step('desktop light mode: the sidebar is light too', async () => {
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).backgroundColor);
    assert.strictEqual(bg, 'rgb(255, 255, 255)');
  });
  await step('the Inter font comes from this site and is in use', async () => {
    const font = await page.evaluate(async () => { await document.fonts.ready; return { loaded: document.fonts.check('600 16px Inter'), family: getComputedStyle(document.body).fontFamily }; });
    assert.ok(font.loaded, 'Inter did not load');
    assert.ok(/^"?Inter/.test(font.family), font.family);
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(appSource()), 'the page still points at Google Fonts');
  });
  await step('the page carries its security policy: only this site, the backend and Google sign-in', async () => {
    const csp = await page.evaluate(() => (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || '');
    // Requests may go only to the backend's own address, not to any Apps Script project.
    const exec = fs.readFileSync(path.join(root, 'app.js'), 'utf8').match(/const APPS_SCRIPT_EXEC_URL = '([^']+)'/)[1];
    // Scripts only from this site's own files and Google's sign-in: nothing inline (no 'unsafe-inline').
    ['default-src \'self\'', 'script-src \'self\' https://accounts.google.com/gsi/client;',
      'connect-src \'self\' ' + exec + ' https://script.googleusercontent.com https://accounts.google.com/gsi/;',
      'object-src \'none\'', 'form-action \'none\'', 'font-src \'self\''].forEach(d => assert.ok(csp.includes(d), 'missing: ' + d));
    // So the page itself holds no script: each one is a file of the site's own, asked for by its hash.
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.deepStrictEqual([...html.matchAll(/<script\b[^>]*>/gi)].map(m => m[0].replace(/\?v=[0-9a-f]{10}"/, '?v=HASH"')),
      ['guard.js', ...APP_SCRIPTS].map(f => '<script src="' + f + '?v=HASH">'));
    // The frame guard runs in <head>, before anything is drawn; the app's scripts at the end of <body>, in order
    // (net.js just before app.js, which uses it as it starts).
    assert.ok(html.indexOf('<script src="guard.js') < html.indexOf('</head>'), 'guard.js is not in <head>');
    const atEnd = APP_SCRIPTS.map(f => '<script src="' + f.replace('.', '\\.') + '\\?v=[0-9a-f]{10}"></script>').join('\\s*') + '\\s*</body>';
    assert.ok(new RegExp(atEnd).test(html), APP_SCRIPTS.join(' then ') + ' are not at the end of <body>');
    assert.ok(await page.evaluate(() => typeof ACTIONS === 'object' && window.PF_FRAMED === undefined), 'the scripts did not run');
  });
  await step('no inline handlers in the page: each control names one of its ACTIONS, and every action is used', async () => {
    const html = appSource();
    // on...= followed by a quote, a ${...} or an unquoted call (but not a const/let/var such as `const online = ()`)
    const handler = /(?<!\b(?:const|let|var))(^|[\s"'`])on[a-z]+\s*=\s*(["'`$]|[^\s>="'`]*\()|setAttribute\(\s*['"`]on/gim;
    assert.deepStrictEqual(html.match(handler) || [], [], 'inline handlers left');
    const actions = await page.evaluate(() => Object.keys(ACTIONS));
    // The Activity filter chips are drawn by chip(label, action), so their actions are named in its calls.
    const named = [...html.matchAll(/data-(?:action|input|change)="([^"]*)"/g)].map(m => m[1]).filter(n => n !== '${action}')
      .concat([...html.matchAll(/chip\([^\n]*?, '(\w+)'\)/g)].map(m => m[1]));
    assert.deepStrictEqual(named.filter(n => !actions.includes(n)), [], 'controls name actions that do not exist');
    assert.deepStrictEqual(actions.filter(a => !named.includes(a)), [], 'actions nothing uses');
  });
  await step('taps reach the same places as before: data-stop, data-backdrop, and the menu', async () => {
    const s = await page.evaluate(() => {
      const out = {};
      const chev = () => document.getElementById('chevBudgets').getAttribute('aria-expanded');
      const shown = id => !document.getElementById(id).classList.contains('hidden');
      const was = chev();
      document.getElementById('btnAddBill').click();                  // a button inside the header's data-stop group
      out.addBill = [shown('budgetModal'), chev() === was];
      closeBudgetForm();
      document.getElementById('btnAddBill').parentElement.click();    // the group itself: nothing happens
      out.group = chev() === was;
      document.querySelector('#sec_budgets h2').click();              // the header: folds the section
      out.header = chev() !== was;
      document.querySelector('#sec_budgets h2').click();
      out.headerBack = chev() === was;
      openSpendModal();
      document.getElementById('spendTitle').click();                  // inside the sheet: stays open
      out.inside = shown('spendModal');
      document.getElementById('spendModal').click();                  // the dark area round it: closes
      out.backdrop = !shown('spendModal');
      document.getElementById('menuBtn').click();                     // its data-stop keeps it open
      out.menuOpen = shown('menuPanel');
      document.querySelector('#sec_budgets h2').click();              // any other tap closes it (and folds Bills)
      out.menuClosed = !shown('menuPanel');
      document.querySelector('#sec_budgets h2').click();
      // A tap inside a browser add-on's own panel (an open shadow root) passes by quietly (no page error).
      const host = document.body.appendChild(document.createElement('div'));
      host.attachShadow({ mode: 'open' }).appendChild(document.createElement('button')).click();
      host.remove();
      return out;
    });
    assert.deepStrictEqual(s, { addBill: [true, true], group: true, header: true, headerBack: true, inside: true, backdrop: true, menuOpen: true, menuClosed: true });
  });
  await ctx.close();

  // ---------------- a device that has never been sent any names ----------------
  ({ ctx, page } = await open(desk, 'demo=1&noconfig=1'));
  await step('with no names known yet, the quick-split buttons stay hidden and a split still saves', async () => {
    await page.evaluate(() => { openAddModal(); });
    assert.deepStrictEqual(await page.evaluate(() => whoChoices(false)), ['100_me', 'custom', 'marcus', 'iowe'], 'Half / All offered without a name');
    await page.evaluate(() => selectSplit('half'));
    assert.strictEqual(await page.evaluate(() => formSplit), '100_me', 'a hidden quick split could still be chosen');
    await page.evaluate(() => selectSplit('custom'));
    assert.deepStrictEqual(await page.$$eval('#personChips button[id^="chip_"]', b => b.map(x => x.id)), ['chip_marcus']);
    assert.strictEqual(await page.$$eval('#dynamicSplitRows .split-name', i => i.length), 0, 'nobody should be picked by default');
    await page.click('#personChips button:has-text("Other")');
    await page.fill('#dynamicSplitRows .split-name', 'pat');
    await page.fill('#inpMerchant', 'Split shop');
    await page.fill('#inpAmount', '20');
    await page.click('#dynamicSplitRows .split-amt');
    await page.fill('#dynamicSplitRows .split-amt', '10');
    const a = await sendsAndSettles(page, 'addTransactionBundle', () => page.click('#btnSubmitTx'));
    assert.ok(a && a.splits.length === 1 && a.splits[0].person === 'pat' && a.splits[0].amount === 10, JSON.stringify(a));
  });
  await ctx.close();
}).catch(e => { console.error(e); process.exit(1); });
