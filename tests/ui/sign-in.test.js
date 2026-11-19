// Screen tests, real Chrome: Signing out, the first open, fingerprint unlock after a while away, and Google sign-ins.
// Uses the test page (real index.html, pretend backend) under the app's own script policy; see tests/lib/ui.js.
//
//   node tests/ui/sign-in.test.js   (or: node tests/run-all.js screens)
const assert = require('assert');
const { awayAndBack } = require('../lib/runner');
const { uiSuite, phone, desk, calls, visible } = require('../lib/ui');

uiSuite(async ({ browser, errors, watch, open, step, PORT }) => {
  // ---------------- sign out ----------------
  {
    const keys = p => p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('pf_')).sort());
    const locked = p => p.evaluate(() => getComputedStyle(document.getElementById('authLockScreen')).display !== 'none');
    const shown = (p, id) => p.evaluate(i => !document.getElementById(i).classList.contains('hidden'), id);
    // This device has fingerprint sign-in, a theme and a dismissed offer, on top of the saved figures.
    const seed = p => p.evaluate(() => {
      localStorage.setItem('pf_passkey_cid', 'cid-test');
      localStorage.setItem('pf_theme_mode', 'dark');
      localStorage.setItem('pf_passkey_offer_dismissed', '1');
    });
    const afterReload = async p => {
      await p.waitForLoadState('load');
      await p.waitForFunction(() => window.MOCK && document.getElementById('authLockMsg') && getComputedStyle(document.getElementById('authLockScreen')).display !== 'none');
      await p.waitForTimeout(800);   // long enough for Google (auto select) or the fingerprint to have jumped in
    };

    let { ctx: c3, page: p3 } = await open(phone);
    await step('sign out: in the phone menu, and the sheet says what it clears; fingerprint options only when set up', async () => {
      await p3.click('#menuBtn');
      assert.ok(await visible(p3, '#menuSignOutItem'), 'no Sign out in the menu');
      await p3.click('#menuSignOutItem');
      assert.ok(await shown(p3, 'signOutModal') && !(await shown(p3, 'menuPanel')), 'the sheet should open and the menu close');
      assert.ok(!(await shown(p3, 'soForgetBlock')) && !(await shown(p3, 'soKeepNote')) && !(await shown(p3, 'soWaiting')), 'no fingerprint here, nothing waiting');
      await p3.keyboard.press('Escape');
      assert.ok(!(await shown(p3, 'signOutModal')), 'Escape should close it');
      await seed(p3);
      await p3.evaluate(() => openSignOutModal());
      assert.ok(await shown(p3, 'soForgetBlock') && await shown(p3, 'soKeepNote'), 'fingerprint options missing');
    });
    await step('sign out: clears the figures and sign-in, keeps theme and fingerprint, and locks without asking for the fingerprint', async () => {
      assert.ok((await keys(p3)).some(k => k.startsWith('pf_cache_')), 'test set-up: nothing saved to clear');
      await p3.click('#soBtn');
      await afterReload(p3);
      assert.deepStrictEqual(await keys(p3), ['pf_passkey_cid', 'pf_passkey_offer_dismissed', 'pf_theme_mode']);
      const s = await p3.evaluate(() => ({ msg: document.getElementById('authLockMsg').textContent, calls: MOCK.calls.map(c => c.action),
        off: MOCK.gsi.disableAutoSelect, finger: getComputedStyle(document.getElementById('passkeyUnlockBtn')).display, money: document.getElementById('kpiNCA').textContent }));
      assert.ok(await locked(p3), 'should be locked');
      assert.strictEqual(s.msg, 'Signed out. Nothing is saved on this device any more.');
      assert.deepStrictEqual(s.calls, [], 'nothing should be asked of the server (no fingerprint prompt, no data)');
      assert.ok(s.off >= 1, "Google's automatic sign-in was not stopped");
      assert.strictEqual(s.finger, 'flex', 'the fingerprint button should still be offered');
      assert.ok(!/£\d/.test(s.money), 'figures still on the page: ' + s.money);
    });
    await step('sign out: coming back to the app later still does not ask for the fingerprint by itself', async () => {
      await awayAndBack(p3, 2 * 60 * 1000);
      await p3.waitForTimeout(400);
      assert.deepStrictEqual(await p3.evaluate(() => MOCK.calls.map(c => c.action)), []);
      assert.strictEqual(await p3.textContent('#authLockMsg'), 'Signed out. Nothing is saved on this device any more.');
    });
    await step('sign out: figures a late reply saved just before the reload are cleared when the page opens', async () => {
      await p3.evaluate(() => { localStorage.setItem('pf_cache_' + MOCK.MONTH, '{"late":true}'); localStorage.setItem('pf_last_month', MOCK.MONTH); });
      await p3.reload();
      await afterReload(p3);
      assert.deepStrictEqual(await keys(p3), ['pf_passkey_cid', 'pf_passkey_offer_dismissed', 'pf_theme_mode']);
    });
    await step('sign out: then choosing the account on the Google button gets straight back in', async () => {
      await p3.evaluate(() => MOCK.gsiCallback({ credential: MOCK.makeToken('owner@example.com') }));
      await p3.waitForFunction(() => getComputedStyle(document.getElementById('authLockScreen')).display === 'none' && /£\d/.test(document.getElementById('kpiNCA').textContent));
      assert.strictEqual(await p3.evaluate(() => sessionStorage.getItem('pf_signed_out')), null, 'the signed-out note should go once signed in');
    });
    await c3.close();
    await step('sign out in one tab: another open tab of the app locks too, says so, and keeps no figures', async () => {
      const ctx = await browser.newContext(phone);
      try {
        const [a, b] = [watch(await ctx.newPage()), watch(await ctx.newPage())];
        for (const p of [a, b]) {
          await p.goto(`http://localhost:${PORT}/tests/harness.html?demo=1&keep=1&latency=50`);
          await p.waitForFunction(() => window.MOCK && apiInflight === 0 && /£\d/.test(document.getElementById('kpiNCA').textContent));
        }
        await a.evaluate(() => signOut(false));
        await afterReload(b);
        assert.ok(await locked(b), 'the other tab is still open');
        assert.strictEqual(await b.textContent('#authLockMsg'), 'Signed out. Nothing is saved on this device any more.');
        assert.ok(!/£\d/.test(await b.textContent('#kpiNCA')), 'figures still on the other tab');
        assert.deepStrictEqual((await keys(b)).filter(k => k.startsWith('pf_cache_')), [], 'figures saved again');
      } finally { await ctx.close(); }
    });

    ({ ctx: c3, page: p3 } = await open(phone));
    await step('sign out with a spend still waiting to send: warns, first tap only arms, Send now sends it', async () => {
      await p3.evaluate(() => {
        const payload = { sheetName: activeMonth, account: 'amex', merchant: 'Waiting shop', grossAmount: 7.5, isRefund: false, splits: [], clientId: 'wait1' };
        localStorage.setItem('pf_outbox', JSON.stringify([{ id: 'wait1', payload }]));
        openSignOutModal();
      });
      assert.ok(await shown(p3, 'soWaiting'));
      assert.strictEqual(await p3.textContent('#soWaitingText'), "1 spend saved offline hasn't been sent yet. Signing out would lose it.");
      await p3.click('#soBtn');
      await p3.waitForTimeout(200);
      assert.strictEqual(await p3.textContent('#soBtn'), 'Tap again to sign out anyway');
      assert.ok(!(await locked(p3)) && (await keys(p3)).includes('pf_outbox'), 'one tap must not sign out');
      await p3.click('#soSendBtn');
      await p3.waitForFunction(() => !JSON.parse(localStorage.getItem('pf_outbox') || '[]').length);
      await p3.waitForTimeout(200);
      assert.deepStrictEqual((await calls(p3, 'addTransactionBundle')).map(c => c.merchant), ['Waiting shop']);
      assert.ok(!(await shown(p3, 'soWaiting')), 'the warning should go once sent');
      assert.strictEqual(await p3.textContent('#soBtn'), 'Sign out');
    });
    await step('sign out anyway: a second tap with a spend waiting signs out', async () => {
      await p3.evaluate(() => { localStorage.setItem('pf_outbox', JSON.stringify([{ id: 'w2', payload: { merchant: 'x' } }])); renderSignOutModal(); });
      await p3.click('#soBtn');
      await p3.click('#soBtn');
      await afterReload(p3);
      assert.deepStrictEqual(await keys(p3), []);
    });
    await c3.close();

    ({ ctx: c3, page: p3 } = await open(phone));
    await step('sign out waits for a save that is still on its way before clearing anything', async () => {
      await p3.evaluate(() => {
        MOCK.nextLatencies = [1500];
        sendNewSpend({ sheetName: activeMonth, account: 'amex', merchant: 'Slow shop', grossAmount: 3, isRefund: false, splits: [], clientId: 'slow1' });
        openSignOutModal();
      });
      await p3.click('#soBtn');
      await p3.waitForTimeout(500);
      const s = await p3.evaluate(() => ({ disabled: document.getElementById('soBtn').disabled, token: !!localStorage.getItem('pf_google_id_token'),
        ended: MOCK.calls.filter(c => c.action === 'addTransactionBundle').map(c => c.end) }));
      assert.ok(s.disabled && s.token && s.ended.length === 1 && s.ended[0] === null, 'signed out before the save finished: ' + JSON.stringify(s));
      await afterReload(p3);
      assert.deepStrictEqual(await keys(p3), []);
    });
    await c3.close();

    ({ ctx: c3, page: p3 } = await open(phone));
    await step('forget this device: if the server says no, nothing is cleared and it says why', async () => {
      await seed(p3);
      await p3.evaluate(() => { MOCK.failNext = 1; openSignOutModal(); });
      await p3.click('#soForgetBtn');
      await p3.waitForFunction(() => /Nothing has been cleared yet/.test(document.getElementById('soMsg').textContent));
      assert.ok(await shown(p3, 'signOutModal') && !(await locked(p3)));
      const k = await keys(p3);
      assert.ok(k.includes('pf_passkey_cid') && k.includes('pf_google_id_token') && k.some(x => x.startsWith('pf_cache_')), JSON.stringify(k));
    });
    await step('forget this device: turns fingerprint off on the server, then clears its link too', async () => {
      await p3.click('#soForgetBtn');
      await afterReload(p3);
      assert.strictEqual(await p3.evaluate(() => sessionStorage.getItem('mock_passkey_removed')), 'cid-test');
      assert.deepStrictEqual(await keys(p3), ['pf_passkey_offer_dismissed', 'pf_theme_mode']);
      assert.strictEqual(await p3.evaluate(() => getComputedStyle(document.getElementById('passkeyUnlockBtn')).display), 'none');
    });
    await c3.close();

    ({ ctx: c3, page: p3 } = await open(desk));
    await step('desktop: Sign out sits under Open Sheet in the sidebar and opens the same sheet', async () => {
      assert.ok(await visible(p3, '#sideSignOutBtn'));
      const order = await p3.evaluate(() => { const a = document.getElementById('rawSheetBtn'), b = document.getElementById('sideSignOutBtn'); return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); });
      assert.ok(order, 'should come after Open Sheet');
      await p3.click('#sideSignOutBtn');
      assert.ok(await shown(p3, 'signOutModal'));
      await p3.click('#signOutModal', { position: { x: 5, y: 5 } });
      assert.ok(!(await shown(p3, 'signOutModal')), 'tapping outside should close it');
    });
    await c3.close();

    ({ ctx: c3, page: p3 } = await open(phone));
    await step('sign out everywhere: the first tap only asks again; nothing is sent until the second', async () => {
      await seed(p3);
      await p3.evaluate(() => openSignOutModal());
      assert.ok(await visible(p3, '#soEverywhereBtn'), 'no "Sign out everywhere" in the sheet');
      await p3.click('#soEverywhereBtn');
      assert.strictEqual(await p3.textContent('#soEverywhereBtn'), 'Tap again to sign out everywhere');
      assert.deepStrictEqual(await calls(p3, 'signOutEverywhere'), [], 'sent on the first tap');
      await p3.waitForTimeout(4300);   // the second tap must come within 4 s
      assert.strictEqual(await p3.textContent('#soEverywhereBtn'), 'Sign out everywhere');
    });
    await step('sign out everywhere: if the server refuses, nothing changes here and it says so', async () => {
      const before = await keys(p3);
      await p3.evaluate(() => { MOCK.failNext = 1; });
      await p3.click('#soEverywhereBtn');
      await p3.click('#soEverywhereBtn');
      await p3.waitForFunction(() => !document.getElementById('soMsg').classList.contains('hidden'));
      assert.ok(/Couldn't sign out everywhere .*Nothing was cleared on this device\. Try again\./.test(await p3.textContent('#soMsg')), await p3.textContent('#soMsg'));
      assert.deepStrictEqual(await keys(p3), before, 'something was cleared');
      assert.ok(!(await locked(p3)), 'locked although nothing was signed out');
    });
    await step('sign out everywhere: not while spends wait to be sent (they would be lost); nothing is sent', async () => {
      const sent = (await calls(p3, 'signOutEverywhere')).length;
      await p3.evaluate(() => { localStorage.setItem('pf_outbox', JSON.stringify([{ id: 'w9', payload: { merchant: 'x' } }])); openSignOutModal(); });
      await p3.click('#soEverywhereBtn');
      await p3.click('#soEverywhereBtn');
      assert.ok(/Send the spends waiting on this device first/.test(await p3.textContent('#soMsg')), await p3.textContent('#soMsg'));
      assert.strictEqual((await calls(p3, 'signOutEverywhere')).length, sent, 'sent although spends were waiting');
      assert.ok((await keys(p3)).includes('pf_outbox'), 'the waiting spend was cleared');
      await p3.evaluate(() => { localStorage.removeItem('pf_outbox'); openSignOutModal(); });
    });
    await step('sign out everywhere: tells the server, then signs out here like a plain sign-out (fingerprint kept)', async () => {
      const sent = (await calls(p3, 'signOutEverywhere')).length;
      await p3.click('#soEverywhereBtn');
      await p3.click('#soEverywhereBtn');
      await p3.waitForEvent('load');
      await afterReload(p3);
      assert.ok(await locked(p3), 'should be locked');
      assert.deepStrictEqual(await keys(p3), ['pf_passkey_cid', 'pf_passkey_offer_dismissed', 'pf_theme_mode']);
      assert.strictEqual(await p3.textContent('#authLockMsg'), 'Signed out. Nothing is saved on this device any more.');
      assert.ok(sent >= 1, 'the refused try was not sent, so the step before proves nothing');
    });
    await c3.close();

    ({ ctx: c3, page: p3 } = await open({ ...phone, viewport: { width: 344, height: 780 } }));
    await step('fingerprint dialog: a device waiting for approval is tagged, its status line says so, and the tag shows in full at 344px', async () => {
      await p3.evaluate(() => { localStorage.setItem('pf_passkey_cid', "dev'1"); MOCK.devicePending = true; openPasskeyModal(); });
      await p3.waitForFunction(() => /waiting for approval/.test(document.getElementById('pkDevices').textContent));
      const s = await p3.evaluate(() => {
        const tags = [...document.querySelectorAll('#pkDevices span')];
        const tag = tags.find(e => e.textContent === 'waiting for approval'), mine = tags.find(e => e.textContent === 'this device');
        const box = tag.closest('div').getBoundingClientRect(), r = tag.getBoundingClientRect();
        return { status: document.getElementById('pkStatus').textContent, inside: r.right <= box.right + 0.5 && r.left >= box.left - 0.5,
          oneLine: Math.abs(r.height - mine.getBoundingClientRect().height) < 1, amber: /amber/.test(tag.className) };
      });
      assert.deepStrictEqual(s, { status: 'Fingerprint sign-in on this device is waiting for your approval in the email. No email? Tap "Turn off", then set it up again.', inside: true, oneLine: true, amber: true }, JSON.stringify(s));
      await p3.evaluate(() => { MOCK.devicePending = false; refreshPasskeyDevices(); });
      await p3.waitForFunction(() => document.getElementById('pkStatus').textContent === 'Fingerprint sign-in is on for this device.');
      assert.ok(!/waiting for approval/.test(await p3.textContent('#pkDevices')));
      await p3.evaluate(() => { closePasskeyModal(); localStorage.removeItem('pf_passkey_cid'); });
    });
    await step('sign out sheet fits a 344px phone: no button label wraps, even "Tap again"', async () => {
      await seed(p3);
      await p3.evaluate(() => { localStorage.setItem('pf_outbox', JSON.stringify([{ id: 'w3', payload: { merchant: 'x' } }])); openSignOutModal(); });
      await p3.click('#soBtn');
      await p3.click('#soEverywhereBtn');   // armed: its "Tap again" label must fit too
      const lines = await p3.evaluate(() => ['soBtn', 'soForgetBtn', 'soEverywhereBtn', 'soSendBtn'].map(id => {
        const r = document.createRange(); r.selectNodeContents(document.getElementById(id));
        return id + ':' + new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top))).size;
      }));
      assert.deepStrictEqual(lines.filter(x => !/:1$/.test(x)), [], lines.join(' '));
    });
    await c3.close();
  }

  // ---------------- first open, nothing saved on this device, slow reply ----------------
  {
    const c9 = await browser.newContext(phone);
    const p9 = watch(await c9.newPage());
    await step('first open with nothing saved: "£—" and "Loading…" until the figures arrive, never a false £0.00', async () => {
      try {
        await p9.goto(`http://localhost:${PORT}/tests/harness.html?demo=1&latency=1500`);
        await p9.waitForFunction(() => window.MOCK && MOCK.calls.length > 0 && typeof renderAll === 'function');
        const shown = () => p9.evaluate(() => ({
          kpis: ['kpiSurplus', 'kpiAmex', 'kpiBarclays', 'kpiNCA', 'kpiMarcus'].map(id => document.getElementById(id).textContent),
          bills: document.getElementById('budLeftVal').textContent,
          owed: document.getElementById('panel_pending').textContent.trim(),
          saved: Object.keys(localStorage).filter(k => k.startsWith('pf_cache_'))
        }));
        await p9.evaluate(() => renderAll());   // anything that redraws while waiting
        assert.deepStrictEqual(await shown(), { kpis: ['£—', '£—', '£—', '£—', '£—'], bills: 'Loading…', owed: 'Loading…', saved: [] });
        await p9.waitForFunction(() => /£\d/.test(document.getElementById('kpiNCA').textContent));
        const after = await shown();
        assert.ok(after.kpis.every(t => /£\d/.test(t)) && after.bills !== 'Loading…' && after.owed !== 'Loading…' && after.saved.length === 1, JSON.stringify(after));
      } finally { await c9.close(); }
    });
  }

  // ---------------- fingerprint unlock after a while away (the app sat on the lock screen until a slow read) ----------------
  {
    const c8 = await browser.newContext(phone);
    // Stands in for the phone's fingerprint prompt: answers at once, as if the finger was accepted.
    await c8.addInitScript(() => {
      const buf = s => new TextEncoder().encode(s).buffer;
      navigator.credentials.get = async () => ({ rawId: buf('cid-test'), response: { clientDataJSON: buf('{}'), authenticatorData: buf('a'), signature: buf('s') } });
    });
    const p8 = watch(await c8.newPage());
    const from = errors.length;
    const SLOW = 4000;   // Apps Script waking up after a while: the first sheet read takes seconds
    const shown = () => p8.evaluate(() => ({ locked: lockScreenShowing(), msg: document.getElementById('authLockMsg').textContent,
      reads: MOCK.calls.filter(c => c.action === 'getCachedSheetState').map(c => (c.end ? 'answered' : 'waiting') + (c.aborted ? ' (given up)' : '')),
      fresh: state.amex.some(r => r.desc === 'Fresh from the server'), nca: document.getElementById('kpiNCA').textContent }));
    try {
      await p8.goto(`http://localhost:${PORT}/tests/harness.html?demo=1&latency=50`);
      await p8.waitForFunction(() => window.MOCK && /£\d/.test(document.getElementById('kpiNCA').textContent) && apiInflight === 0);
      await p8.evaluate(() => localStorage.setItem('pf_passkey_cid', 'cid-test'));   // fingerprint sign-in is set up here

      await step('fingerprint unlock after a while away: the app opens at once with the saved figures; the slow first read follows', async () => {
        // Two hours away: the sign-in ran out, and the sheet has changed meanwhile.
        await p8.evaluate(s => {
          localStorage.removeItem('pf_google_id_token'); localStorage.removeItem('pf_session');
          MOCK.db.amex.push({ row: 99, desc: 'Fresh from the server', amount: -7 });
          MOCK.calls.length = 0;
          MOCK.nextLatencies = [50, 50, s];   // begin, finish, then the slow read
        }, SLOW);
        await awayAndBack(p8, 2 * 60 * 60 * 1000);
        await p8.waitForFunction(() => MOCK.calls.some(c => c.action === 'getCachedSheetState'), null, { timeout: 6000 });
        await p8.waitForTimeout(300);
        const now = await shown();
        assert.deepStrictEqual(now.reads, ['waiting'], JSON.stringify(now));
        assert.ok(!now.locked, 'the lock screen waits for the slow read: ' + JSON.stringify(now));
        assert.ok(/£\d/.test(now.nca) && !now.fresh, 'should show the figures saved on this device meanwhile: ' + JSON.stringify(now));
        await p8.waitForFunction(() => state.amex.some(r => r.desc === 'Fresh from the server'), null, { timeout: SLOW + 2000 });
        assert.ok(!(await shown()).locked);
      });

      // What the lock screen shows, and the fingerprint requests sent, while a try runs.
      const unlockNow = () => p8.evaluate(() => ({ locked: lockScreenShowing(), label: document.getElementById('passkeyUnlockLabel').textContent,
        msg: document.getElementById('authLockMsg').textContent, prompts: window.__prompts,
        begins: MOCK.calls.filter(c => c.action === 'passkeyLoginBegin').length,
        finishes: MOCK.calls.filter(c => c.action === 'passkeyLoginFinish').map(c => ({ aborted: !!c.aborted, payload: JSON.stringify(c.payload) })) }));
      const countPrompts = () => p8.evaluate(() => {
        window.__prompts = 0;
        const real = window.__realGet = window.__realGet || navigator.credentials.get;
        navigator.credentials.get = o => { window.__prompts++; return real.call(navigator.credentials, o); };
      });

      await step('fingerprint unlock whose finish reply is slow (9 s): one request, "Signing in…" throughout, then the app opens', async () => {
        await countPrompts();
        await p8.evaluate(() => {
          localStorage.removeItem('pf_google_id_token'); localStorage.removeItem('pf_session');
          MOCK.calls.length = 0;
          MOCK.nextLatencies = [50, 9000];   // begin, then a finish that takes 9 s (under its 10 s limit)
        });
        await awayAndBack(p8, 2 * 60 * 60 * 1000);
        await p8.waitForFunction(() => MOCK.calls.some(c => c.action === 'passkeyLoginFinish'), null, { timeout: 6000 });
        await p8.waitForTimeout(4000);   // well inside the 9 s
        const mid = await unlockNow();
        assert.ok(mid.locked && mid.label === 'Signing in…' && mid.finishes.length === 1, JSON.stringify(mid));
        await p8.waitForFunction(() => !lockScreenShowing() && apiInflight === 0, null, { timeout: 8000 });   // and the first figures are in
        const end = await unlockNow();
        assert.ok(end.prompts === 1 && end.begins === 1 && end.finishes.length === 1 && !end.finishes[0].aborted, JSON.stringify(end));
      });

      await step('fingerprint unlock whose finish reply never arrives: the same answer is sent again after 10 s, no second fingerprint, and the app opens', async () => {
        await countPrompts();
        await p8.evaluate(() => {
          localStorage.removeItem('pf_google_id_token'); localStorage.removeItem('pf_session');
          MOCK.calls.length = 0;
          MOCK.nextLatencies = [50, 60 * 60 * 1000, 2500];   // begin, a finish whose reply is lost, the same again (answers)
        });
        await awayAndBack(p8, 2 * 60 * 60 * 1000);
        await p8.waitForFunction(() => MOCK.calls.filter(c => c.action === 'passkeyLoginFinish').length === 2, null, { timeout: 16000 })
          .catch(async e => { throw new Error(e.message + ' ' + JSON.stringify(await unlockNow())); });
        const mid = await unlockNow();
        assert.ok(mid.locked && mid.label === 'Still signing in…' && /accepted/.test(mid.msg), JSON.stringify(mid));
        await p8.waitForFunction(() => !lockScreenShowing() && apiInflight === 0, null, { timeout: 6000 });   // and the first figures are in
        const end = await unlockNow();
        assert.ok(end.prompts === 1 && end.begins === 1, 'one fingerprint, one begin: ' + JSON.stringify(end));
        assert.ok(end.finishes.length === 2 && end.finishes[0].aborted && end.finishes[1].payload === end.finishes[0].payload, JSON.stringify(end));
      });

      await step('fingerprint unlock whose finish meets a busy server, or a resend the server turns down: busy is tried again; turned down says the reply was lost (not red)', async () => {
        const finishReplies = async replies => {
          await countPrompts();
          await p8.evaluate(r => {
            localStorage.removeItem('pf_google_id_token'); localStorage.removeItem('pf_session');
            MOCK.calls.length = 0;
            const real = window.__realFetch = window.fetch;
            const left = r.slice();
            window.fetch = (url, opts) => {
              const body = JSON.parse(opts.body);
              if (body.action !== 'passkeyLoginFinish' || !left.length) return real(url, opts);
              MOCK.calls.push({ action: 'passkeyLoginFinish', payload: body.payload });
              const next = left.shift();
              if (next === 'lost') return Promise.reject(new TypeError('Failed to fetch'));
              return Promise.resolve({ text: async () => JSON.stringify({ ok: false, code: next, error: next + ': no', authError: next === 'AUTH_FAILED' }) });
            };
          }, replies);
        };
        try {
          await finishReplies(['lost', 'BUSY']);   // then the real (mock) server answers
          await awayAndBack(p8, 2 * 60 * 60 * 1000);
          await p8.waitForFunction(() => !lockScreenShowing() && apiInflight === 0, null, { timeout: 10000 });
          const a = await unlockNow();
          assert.ok(a.prompts === 1 && a.finishes.length === 3, JSON.stringify(a));
        } finally { await p8.evaluate(() => { window.fetch = window.__realFetch; }); }
        try {
          await finishReplies(['lost', 'AUTH_FAILED']);
          await awayAndBack(p8, 2 * 60 * 60 * 1000);
          await p8.waitForFunction(() => /reply didn't arrive/.test(document.getElementById('authLockMsg').textContent), null, { timeout: 10000 });
          const b = await p8.evaluate(() => ({ color: document.getElementById('authLockMsg').style.color, locked: lockScreenShowing(),
            label: document.getElementById('passkeyUnlockLabel').textContent, n: MOCK.calls.filter(c => c.action === 'passkeyLoginFinish').length }));
          assert.ok(b.locked && b.label === 'Unlock with fingerprint' && b.n === 2 && !/248, 113, 113/.test(b.color), JSON.stringify(b));
        } finally { await p8.evaluate(() => { window.fetch = window.__realFetch; }); }
        await p8.evaluate(() => unlockWithPasskey(false));   // a tap gets in
        await p8.waitForFunction(() => !lockScreenShowing() && apiInflight === 0, null, { timeout: 6000 });
      });

      await step('fingerprint unlock whose finish never gets through: once its time is up (110 s from begin) it says the fingerprint was accepted, and a tap asks again', async () => {
        await countPrompts();
        try {
          await p8.evaluate(() => {
            localStorage.removeItem('pf_google_id_token'); localStorage.removeItem('pf_session');
            MOCK.calls.length = 0;
            // The finish fails at once (no connection), and meanwhile the clock passes its 110 s: no more tries.
            const real = window.__realFetch = window.fetch, realNow = window.__realNow = Date.now;
            let skew = 0;
            Date.now = () => realNow() + skew;
            window.fetch = (url, opts) => {
              if (JSON.parse(opts.body).action !== 'passkeyLoginFinish') return real(url, opts);
              MOCK.calls.push({ action: 'passkeyLoginFinish', payload: JSON.parse(opts.body).payload, aborted: true });
              skew += 120 * 1000;
              return Promise.reject(new TypeError('Failed to fetch'));
            };
          });
          await awayAndBack(p8, 2 * 60 * 60 * 1000);
          await p8.waitForFunction(() => /reply didn't arrive/.test(document.getElementById('authLockMsg').textContent), null, { timeout: 8000 });
          await p8.waitForTimeout(4000);   // longer than the automatic prompt's wait: it must not ask again by itself
          const s = await unlockNow();
          assert.ok(s.locked && s.label === 'Unlock with fingerprint' && s.prompts === 1 && s.begins === 1 && s.finishes.length === 1, JSON.stringify(s));
        } finally { await p8.evaluate(() => { window.fetch = window.__realFetch; Date.now = window.__realNow; }); }
        await p8.evaluate(() => unlockWithPasskey(false));   // a tap
        await p8.waitForFunction(() => !lockScreenShowing() && apiInflight === 0, null, { timeout: 6000 });   // and the first figures are in
        assert.strictEqual((await unlockNow()).prompts, 2);
      });

      await step('fingerprint unlock whose first read turns the new session down: "Access Denied", and no prompt round and round', async () => {
        try {
          await p8.evaluate(() => {
            localStorage.removeItem('pf_google_id_token'); localStorage.removeItem('pf_session');
            MOCK.calls.length = 0;
            // Only the sheet read is turned down (as if the server's session key had just changed); the sign-in itself works.
            const real = window.__realFetch = window.fetch;
            window.fetch = (url, opts) => JSON.parse(opts.body).action === 'getCachedSheetState'
              ? Promise.resolve({ text: async () => JSON.stringify({ ok: false, code: 'AUTH_EXPIRED', error: 'AUTH_EXPIRED: Session expired.', authError: true }) })
              : real(url, opts);
          });
          await awayAndBack(p8, 2 * 60 * 60 * 1000);
          await p8.waitForFunction(() => /^Access Denied/.test(document.getElementById('authLockMsg').textContent), null, { timeout: 6000 });
          await p8.waitForTimeout(4000);   // longer than the fingerprint prompt's wait for focus
          const s = await p8.evaluate(() => ({ locked: lockScreenShowing(), msg: document.getElementById('authLockMsg').textContent,
            asks: MOCK.calls.filter(c => c.action === 'passkeyLoginBegin').length, running: !!passkeyAttempt }));
          assert.ok(s.locked && s.asks === 1 && !s.running, JSON.stringify(s));
        } finally { await p8.evaluate(() => { window.fetch = window.__realFetch; }); }
      });

      await step('a device still waiting for approval: the lock screen says to tap Approve in the email (not red), keeps the device, no prompt', async () => {
        try {
          await countPrompts();
          await p8.evaluate(() => {
            localStorage.removeItem('pf_google_id_token'); localStorage.removeItem('pf_session');
            MOCK.calls.length = 0; MOCK.devicePending = true;
          });
          await p8.click('#passkeyUnlockBtn');   // (after the step before, the lock screen doesn't ask by itself)
          await p8.waitForFunction(() => /switched on yet/.test(document.getElementById('authLockMsg').textContent), null, { timeout: 6000 })
            .catch(async e => { throw new Error(e.message + ' | ' + await p8.evaluate(() => document.getElementById('authLockMsg').textContent + ' | ' + JSON.stringify(MOCK.calls.map(c => c.action)))); });
          const s = await p8.evaluate(() => { const m = document.getElementById('authLockMsg');
            return { locked: lockScreenShowing(), msg: m.textContent, red: /rose/.test(m.className), cid: localStorage.getItem('pf_passkey_cid'),
              button: !document.getElementById('passkeyUnlockBtn').classList.contains('hidden'), prompts: window.__prompts }; });
          assert.deepStrictEqual(s, { locked: true, msg: "This device's fingerprint isn't switched on yet. Tap \"Approve\" in the email, then try again.",
            red: false, cid: 'cid-test', button: true, prompts: 0 });
        } finally { await p8.evaluate(() => { MOCK.devicePending = false; }); }
      });

      await step('Google sign-in still waits for the server to check the account, with "Signing in…" on the lock screen', async () => {
        await p8.evaluate(() => {
          clearSession();
          showLockScreen('Unlock to continue.', { noAuto: true });
          MOCK.calls.length = 0;
          MOCK.nextLatencies = [1500];
          MOCK.gsiCallback({ credential: MOCK.makeToken('owner@example.com') });
        });
        await p8.waitForTimeout(300);
        const now = await shown();
        assert.ok(now.locked && now.msg === 'Signing in…' && now.reads.join() === 'waiting', JSON.stringify(now));
        await p8.waitForFunction(() => !lockScreenShowing(), null, { timeout: 3000 });
      });

      await step('coming back after a while, a request sent before the phone slept no longer holds up the new figures', async () => {
        // A read sent just before the phone slept, whose reply never comes (and whose time limit didn't count down).
        await p8.evaluate(() => { MOCK.calls.length = 0; MOCK.nextLatencies = [10 * 60 * 1000]; forceSyncSheet(); });
        await p8.waitForFunction(() => MOCK.calls.length === 1);
        await awayAndBack(p8, 2 * 60 * 1000);
        await p8.waitForFunction(() => MOCK.calls.length === 2 && MOCK.calls[1].end, null, { timeout: 3000 })
          .catch(async () => assert.fail('the new read waited behind the old one: ' + JSON.stringify(await shown())));
        assert.deepStrictEqual((await shown()).reads, ['answered (given up)', 'answered']);
        await p8.waitForFunction(() => apiInflight === 0);
      });

      // Waking up after hours away with the connection still coming back (Jon's phone, 2026-11-17: "No connection yet"
      // under a button stuck on "Waiting for fingerprint…").
      const lock = () => p8.evaluate(() => ({ locked: lockScreenShowing(), msg: document.getElementById('authLockMsg').textContent,
        label: document.getElementById('passkeyUnlockLabel').textContent, running: !!passkeyAttempt,
        begins: MOCK.calls.filter(c => c.action === 'passkeyLoginBegin').map(c => ({ start: c.start, end: c.end })) }));
      const expire = () => p8.evaluate(() => { localStorage.removeItem('pf_google_id_token'); localStorage.removeItem('pf_session'); MOCK.calls.length = 0; });
      const NO_CONNECTION = "No connection yet. Trying again as soon as it's back.";
      // Signed out while away; back with the first request and its quick retry both getting nowhere.
      const backWithNoConnection = async () => {
        await expire();
        await p8.evaluate(() => { MOCK.dropNext = 2; });
        await awayAndBack(p8, 2 * 60 * 60 * 1000);
        await p8.waitForFunction(m => document.getElementById('authLockMsg').textContent === m, NO_CONNECTION, { timeout: 4000 });
      };

      await step('back with no connection yet: the lock screen says so, the button is free to tap, and it asks again by itself once back online', async () => {
        await backWithNoConnection();
        const s = await lock();
        assert.ok(s.locked && s.label === 'Unlock with fingerprint' && !s.running && s.begins.length === 2, JSON.stringify(s));
        // The phone's connection is back. (As on some phones, the page doesn't report focus: being on screen is enough.)
        try {
          await p8.evaluate(() => { document.hasFocus = () => false; window.dispatchEvent(new Event('online')); });
          await p8.waitForFunction(() => !lockScreenShowing(), null, { timeout: 1500 })
            .catch(async () => assert.fail('did not ask again when back online: ' + JSON.stringify(await lock())));
        } finally { await p8.evaluate(() => { delete document.hasFocus; }); }
        assert.strictEqual((await lock()).begins.length, 3);
        await p8.waitForFunction(() => apiInflight === 0);
      });

      await step('still no connection after that (no "online" news, as on a Wi-Fi still connecting): asks again by itself, one try at a time, and gets in', async () => {
        await expire();
        await p8.evaluate(() => { MOCK.dropNext = 3; });   // the first try fails; the next one gets through on its quick retry
        await awayAndBack(p8, 2 * 60 * 60 * 1000);
        await p8.waitForFunction(() => !lockScreenShowing(), null, { timeout: 8000 })
          .catch(async () => assert.fail('never asked again by itself: ' + JSON.stringify(await lock())));
        const { begins } = await lock();
        assert.strictEqual(begins.length, 4, JSON.stringify(begins));
        begins.forEach((b, i) => assert.ok(i === 0 || b.start >= begins[i - 1].end, 'two tries at once: ' + JSON.stringify(begins)));
        await p8.waitForFunction(() => apiInflight === 0);
      });

      await step('a tap while the connection is still coming back: "Connecting…" (never "Waiting for fingerprint…" under "No connection"), then the prompt', async () => {
        await expire();
        await p8.evaluate(() => { MOCK.dropNext = 2; });
        await awayAndBack(p8, 2 * 60 * 60 * 1000);
        await p8.waitForFunction(m => document.getElementById('authLockMsg').textContent === m, NO_CONNECTION, { timeout: 4000 });
        // The tap's first request is slow to answer, and the fingerprint prompt takes a moment.
        await p8.evaluate(() => {
          MOCK.nextLatencies = [1200];
          const real = window.__realGet = navigator.credentials.get;
          navigator.credentials.get = o => new Promise(r => setTimeout(r, 900)).then(() => real.call(navigator.credentials, o));
        });
        try {
          await p8.click('#passkeyUnlockBtn');
          await p8.waitForTimeout(400);
          let s = await lock();
          assert.ok(s.locked && s.label === 'Connecting…' && s.msg === NO_CONNECTION, 'while connecting: ' + JSON.stringify(s));
          await p8.waitForFunction(() => document.getElementById('passkeyUnlockLabel').textContent === 'Waiting for fingerprint…', null, { timeout: 2000 });
          s = await lock();
          assert.ok(s.locked && s.msg === 'Unlock to continue.', 'in the prompt: ' + JSON.stringify(s));
          await p8.waitForFunction(() => !lockScreenShowing(), null, { timeout: 3000 });
          await p8.waitForTimeout(2500);   // past when the automatic try the tap replaced was due
          assert.strictEqual((await lock()).begins.length, 3, 'the automatic try asked as well as the tap');
        } finally { await p8.evaluate(() => { navigator.credentials.get = window.__realGet; }); }
        await p8.waitForFunction(() => apiInflight === 0);
      });

      await step('back while the phone is still offline: "Waiting for a connection…" at once, nothing sent, and in as soon as it is online', async () => {
        await expire();
        await c8.setOffline(true);
        try {
          await awayAndBack(p8, 2 * 60 * 60 * 1000);
          await p8.waitForTimeout(300);
          const s = await lock();
          assert.ok(s.locked && s.msg === 'Waiting for a connection…' && s.begins.length === 0, JSON.stringify(s));
        } finally { await c8.setOffline(false); }
        await p8.waitForFunction(() => !lockScreenShowing(), null, { timeout: 2000 })
          .catch(async () => assert.fail('did not ask once online: ' + JSON.stringify(await lock())));
        await p8.waitForFunction(() => apiInflight === 0);
      });
    } finally {
      await c8.close();
      for (let i = errors.length - 1; i >= from; i--) if (/took too long/.test(errors[i])) errors.splice(i, 1);
    }
  }

  // ---------------- a Google account the server turns down ----------------
  {
    const c2 = await browser.newContext(desk);
    const p2 = watch(await c2.newPage());
    await p2.goto(`http://localhost:${PORT}/tests/harness.html?demo=1&token=none&latency=50`);
    await p2.waitForFunction(() => window.MOCK && typeof MOCK.gsiCallback === 'function');
    await step('a browser that refuses to save the sign-in says so plainly and sends nothing', async () => {
      const s = await p2.evaluate(() => {
        const P = Storage.prototype, real = P.setItem;
        P.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
        try { MOCK.gsiCallback({ credential: MOCK.makeToken('owner@example.com') }); } finally { P.setItem = real; }
        return { msg: document.getElementById('authLockMsg').textContent, calls: MOCK.calls.length };
      });
      assert.ok(s.msg.includes("won't let PaydayFlow save anything"), s.msg);
      assert.strictEqual(s.calls, 0, 'sent a request without a saved sign-in');
    });
    await step('Google sign-in the server turns down: says why and which account, keeps no token, does not loop', async () => {
      // Google would sign this account back in by itself (auto select) every time the lock screen asks.
      await p2.evaluate(() => { MOCK.authError = { code: 'FORBIDDEN', error: "FORBIDDEN: This Google account can't open PaydayFlow." }; MOCK.gsiAccount = 'someone@example.com'; MOCK.gsiCallback({ credential: MOCK.makeToken('someone@example.com') }); });
      await p2.waitForFunction(() => /can't open PaydayFlow/.test(document.getElementById('authLockMsg').textContent));
      await p2.waitForTimeout(1500);
      const s = await p2.evaluate(() => ({ msg: document.getElementById('authLockMsg').textContent, token: localStorage.getItem('pf_google_id_token'),
        off: MOCK.gsi.disableAutoSelect, calls: MOCK.calls.length, locked: getComputedStyle(document.getElementById('authLockScreen')).display !== 'none' }));
      assert.ok(s.locked, 'should stay on the lock screen');
      assert.ok(s.msg.startsWith('Access Denied') && s.msg.includes('someone@example.com') && !/FORBIDDEN/.test(s.msg), s.msg);
      assert.strictEqual(s.token, null, 'the refused token was kept');
      assert.ok(s.off >= 1, 'automatic Google sign-in was not stopped');
      assert.strictEqual(s.calls, 1, 'signed itself in again: ' + s.calls + ' requests');
      assert.strictEqual(await p2.evaluate(() => MOCK.gsi.initialize), 1, "Google's sign-in should be set up once per page load");
    });
    await step("Google sign-in the server can't check just now: says try again (not Access Denied) and keeps no token", async () => {
      await p2.evaluate(() => { MOCK.authError = { code: 'AUTH_UNAVAILABLE', error: "AUTH_UNAVAILABLE: Couldn't check the Google sign-in just now. Try again in a minute." }; MOCK.gsiCallback({ credential: MOCK.makeToken('owner@example.com') }); });
      await p2.waitForFunction(() => /Couldn't reach the server/.test(document.getElementById('authLockMsg').textContent));
      const s = await p2.evaluate(() => ({ msg: document.getElementById('authLockMsg').textContent, token: localStorage.getItem('pf_google_id_token'), locked: lockScreenShowing() }));
      assert.ok(s.locked && !/Access Denied/.test(s.msg), JSON.stringify(s));
      assert.strictEqual(s.token, null, 'a token the server never checked was kept, so a reload would open the app with it');
    });
    await step('then picking the right account on the button gets straight in, and sends a spend saved offline', async () => {
      await p2.evaluate(() => {
        const payload = { sheetName: MOCK.MONTH, account: 'amex', merchant: 'Sent after sign-in', grossAmount: 3, isRefund: false, splits: [], clientId: 'signin1' };
        localStorage.setItem('pf_outbox', JSON.stringify([{ id: 'signin1', payload }]));
        MOCK.authError = null;
        MOCK.gsiCallback({ credential: MOCK.makeToken('owner@example.com') });
      });
      await p2.waitForFunction(() => getComputedStyle(document.getElementById('authLockScreen')).display === 'none' && /£\d/.test(document.getElementById('kpiNCA').textContent));
      await p2.waitForFunction(() => MOCK.calls.some(c => c.action === 'addTransactionBundle' && c.payload.clientId === 'signin1'), null, { timeout: 3000 });
    });
    await c2.close();
  }
}).catch(e => { console.error(e); process.exit(1); });
