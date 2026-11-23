// Unit tests for small pieces of page logic in app.js that need no screen: reading an amount, equal split shares,
// the next month's name, what a failed request means, when a read is sent again, what a fingerprint failure says, and the month's figures. Each is read out of app.js by its name (appPart), so the
// tests check the code the page runs, wherever it sits in the file. (The spending maths is one block between markers
// instead, tested by spending.test.js; these helpers are spread through the file, and moving them together just for
// the tests would be churn.) To test another function: add its name to UNDER_TEST, and anything it needs to NEEDS.
// Run: node tests/page-logic.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { step: test, finish } = require('./lib/steps').makeSteps();

const UNDER_TEST = ['parseAmount', 'equalShares', 'getNextMonthName', 'failureKind', 'serverError', 'describePasskeyError', 'sheetFigures', 'usableMonth', 'splitPersonKey', 'owedPerson'];
const NEEDS = ['displayName', 'MONTHS', 'isConnectionError', 'ACCTS', 'MONTH_LISTS', 'sumAmounts'];

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
// One part of app.js by its name, as written there: a function (from "function name(" to the closing brace at the
// same indent) or a const on one line. There must be exactly one, so the test can't pick up the wrong one.
function appPart(name) {
  const found = [...app.matchAll(new RegExp('^( *)(?:async )?function ' + name + '\\(.*\\n[\\s\\S]*?^\\1\\}$', 'gm')),
    ...app.matchAll(new RegExp('^ *const ' + name + ' = .*;(?: *//.*)?$', 'gm'))];
  if (found.length !== 1) throw new Error('found ' + name + ' ' + found.length + ' times in app.js (expected once)');
  return found[0][0];
}
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(NEEDS.concat(UNDER_TEST).map(appPart).join('\n') + '\nthis.api = { ' + UNDER_TEST.join(', ') + ' };', sandbox);
const { parseAmount, equalShares, getNextMonthName, failureKind, serverError, describePasskeyError, sheetFigures, usableMonth, splitPersonKey, owedPerson } = sandbox.api;

const same = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b);   // arrays made inside the sandbox

// ---- parseAmount: what is typed in an amount box ----
const amounts = { '12.50': 12.5, '£1,234.50': 1234.5, '£ 3': 3, ' 7 ': 7, '.5': 0.5, '12.': 12, '0': 0, '1,234,567.89': 1234567.89,
  '': 0, '   ': 0, '£': 0 };   // a lone £ is an empty box
Object.keys(amounts).forEach(t => test(`amount "${t}" is ${amounts[t]}`, () => assert.strictEqual(parseAmount(t), amounts[t])));
test('no amount at all is 0', () => { assert.strictEqual(parseAmount(null), 0); assert.strictEqual(parseAmount(undefined), 0); });
['12,50', '-4', '12.5e3', '1,23', '1,2345', 'abc', '1.2.3', '0x10', '1 000', '+5', 'Infinity'].forEach(t =>
  test(`amount "${t}" is not an amount (NaN, never some other number)`, () => assert.ok(Number.isNaN(parseAmount(t)), String(parseAmount(t)))));

// ---- equalShares: a group split shared equally, in pence ----
test('£10 between three, you included: 250p each (your share is the rest)', () => same(equalShares(1000, 3, true), [250, 250, 250]));
test('£10 between three, you not included: the last takes the odd penny', () => same(equalShares(1000, 3, false), [333, 333, 334]));
test('a few pence between many: no share below 0', () => {
  same(equalShares(2, 4, false), [0, 0, 0, 2]);
  same(equalShares(1, 3, false), [0, 0, 1]);
  same(equalShares(5, 4, false), [1, 1, 1, 2]);
});
test('nobody to share with: no shares', () => { same(equalShares(1000, 0, false), []); same(equalShares(1000, 0, true), []); });
test('without you, the shares always add up to the amount and none is below 0', () => {
  for (let pence = 0; pence <= 600; pence++) for (let n = 1; n <= 6; n++) {
    const s = equalShares(pence, n, false);
    assert.strictEqual(s.length, n);
    assert.strictEqual(s.reduce((a, b) => a + b, 0), pence, `${pence}p between ${n}`);
    assert.ok(s.every(x => x >= 0 && Number.isInteger(x)), `${pence}p between ${n}: ${s}`);
  }
});
test('with you, everyone has the same share, within half a penny of a fair one', () => {
  for (let pence = 0; pence <= 600; pence++) for (let n = 1; n <= 6; n++) {
    const s = equalShares(pence, n, true);
    assert.ok(s.length === n && s.every(x => x === s[0]), `${pence}p between ${n}: ${s}`);
    assert.ok(Math.abs(s[0] - pence / (n + 1)) <= 0.5, `${pence}p between ${n}: ${s}`);
  }
});

// ---- getNextMonthName: the name Start New Month suggests ----
const months = {
  'November Payday 2026': 'December Payday 2026', 'December Payday 2026': 'January Payday 2027',
  'january payday 2027': 'February Payday 2027', '  May Payday 2030 ': 'June Payday 2030',
  'Payday': 'Payday (Next)', '': 'New Payday Month', 'Nov Payday 2026': 'Nov Payday 2026 (Next)'
};
Object.keys(months).forEach(m => test(`after "${m}" comes "${months[m]}"`, () => assert.strictEqual(getNextMonthName(m), months[m])));
test('a month with no year gets this year (December: next year)', () => {
  const y = new Date().getFullYear();
  assert.strictEqual(getNextMonthName('March'), 'April Payday ' + y);
  assert.strictEqual(getNextMonthName('December'), 'January Payday ' + (y + 1));
});
test('no month name at all', () => { assert.strictEqual(getNextMonthName(null), 'New Payday Month'); assert.strictEqual(getNextMonthName(undefined), 'New Payday Month'); });

// ---- failureKind: what a failed request means ----
const coded = (code, text) => Object.assign(new Error(text), { code });
const kinds = [
  ['a sign-in problem', { needsSignIn: true }, 'signin'], ['a sign-in problem (auth)', { auth: true }, 'signin'],
  ['no error at all', null, 'reach'], ['no connection', { network: true }, 'reach'], ['a reply that could not be read', { badReply: true }, 'reach'],
  ['a server that could not check the sign-in', { unavailable: true }, 'reach'],
  // The server's code decides, never its words (audit 3.2).
  ['the sheet busy with another save', coded('BUSY', 'Lock timeout: another process was holding the lock for too long.'), 'busy'],
  ['the sheet busy, in other words', coded('BUSY', 'Another save is under way.'), 'busy'],
  ['saved, figures not read back', coded('SAVED_NO_STATE', 'SAVED_NO_STATE: saved, but the figures could not be read just now.'), 'saved'],
  ['saved, in other words', coded('SAVED_NO_STATE', 'Saved; the figures will follow.'), 'saved'],
  ['the row changed elsewhere', coded('STALE', 'STALE: This entry was changed on another device.'), 'refused'],
  ['any other refusal', coded('ERROR', 'Invalid amount.'), 'refused'],
  ['busy words with no code', new Error('Lock timeout: another process was holding the lock for too long.'), 'refused'],
  ['saved words with another code', coded('ERROR', 'SAVED_NO_STATE: saved, but the figures could not be read just now.'), 'refused'],
  ['a browser error with a number for its code', Object.assign(new Error('x'), { code: 18 }), 'refused'],
  ['a sign-in problem that is also a connection error', { needsSignIn: true, network: true }, 'signin']
];
kinds.forEach(([what, err, kind]) => test(`${what} is '${kind}'`, () => assert.strictEqual(failureKind(err), kind)));

// ---- serverError and the fingerprint messages: the server's code decides, never its words (audit 3.2) ----
test('a refused reply keeps its code and words', () => {
  const e = serverError({ ok: false, code: 'STALE', error: 'STALE: changed' }, 'fallback');
  assert.deepStrictEqual([e.code, e.message], ['STALE', 'STALE: changed']);
});
test('a refused reply with no code is ERROR, with the fallback words if it has none', () => {
  const e = serverError({ ok: false }, 'Sign-in failed');
  assert.deepStrictEqual([e.code, e.message], ['ERROR', 'Sign-in failed']);
});
const pk = (code, error) => describePasskeyError(serverError({ ok: false, code, error }, 'Sign-in failed'), false);
test('an unknown fingerprint device is forgotten, whatever the words', () => assert.strictEqual(pk('AUTH_PASSKEY_UNKNOWN', 'Not set up here.').forget, true));
test('the unknown-device words with no code are not acted on', () => assert.ok(!pk(undefined, 'AUTH_PASSKEY_UNKNOWN: This device is not set up for fingerprint sign-in.').forget));
test('too many tries says it is paused, whatever the words', () => assert.ok(/paused/.test(pk('AUTH_THROTTLED', 'Slow down.').text)));
test('the too-many-tries words with no code are not taken for a pause', () => assert.ok(!/paused/.test(pk(undefined, 'AUTH_THROTTLED: Too many attempts.').text)));

// ---- sheetFigures: every figure on the screen, from the rows (audit 3.3) ----
const month = {
  checking: [{ row: 4, amount: 1000 }, { row: 5, amount: -12.34 }, { row: 6, amount: 0.1 }, { row: 7, amount: 0.2 }],
  marcus: [{ row: 4, amount: 500 }], amex: [{ row: 4, amount: -100 }, { row: 5, amount: -2.5, pending: true }],
  barclays: [{ row: 4, amount: -50.05 }],
  budgets: [{ row: 4, amount: -40 }, { row: 5, amount: -35.5 }, { row: 6, amount: 0 }, { row: 7, amount: '' }],
  summary: { nCA: 9999, mSAV: 9999, amex: 9999, barclays: 9999, budgetRem: 9999, checkingExpected: 9999, eomSavingsJ: 9999 }
};
test("the figures are the rows' sums; the server's summary is not used", () => same(sheetFigures(month, new Set()),
  { nCA: 987.96, mSAV: 500, amex: -102.5, barclays: -50.05, budgetRem: -75.5, checkingExpected: 912.46, eomSavingsJ: 759.91 }));
test('a bill switched off in the what-if view is left out of bills and Money Left only', () => same(sheetFigures(month, new Set([5])),
  { nCA: 987.96, mSAV: 500, amex: -102.5, barclays: -50.05, budgetRem: -40, checkingExpected: 947.96, eomSavingsJ: 795.41 }));
test('no rows at all: every figure is 0', () => same(sheetFigures({}, new Set()),
  { nCA: 0, mSAV: 0, amex: 0, barclays: 0, budgetRem: 0, checkingExpected: 0, eomSavingsJ: 0 }));
const lists = { budgets: [], checking: [], amex: [{ row: 4, amount: -1 }], barclays: [], marcus: [] };
test('a saved month with every list but no summary can be shown (the figures come from the rows)', () =>
  assert.strictEqual(usableMonth({ activeMonth: 'X', ...lists }), true));
test('a cut-short saved month (a list missing, or nothing at all) is passed over, not shown as £0.00', () => {
  assert.strictEqual(usableMonth({ activeMonth: 'X' }), false);
  assert.strictEqual(usableMonth({}), false);
  assert.strictEqual(usableMonth({ ...lists, marcus: undefined }), false);
});
test('a saved month with a row whose amount is not a number is passed over', () =>
  assert.strictEqual(usableMonth({ activeMonth: 'X', ...lists, amex: [{ row: 4, amount: 'lots' }] }), false));
test('a damaged saved month is passed over', () => {
  assert.strictEqual(usableMonth(null), false);
  assert.strictEqual(usableMonth({ budgets: 'damaged' }), false);
  assert.strictEqual(usableMonth({ checking: [null] }), false);
  assert.strictEqual(usableMonth({ availableMonths: 'x' }), false);
});

// ---- splitPersonKey: a name typed for a share, as the sheet keeps it (Owed reads the first word as the person) ----
test('a two-word name is kept as one person on Owed', () => {
  assert.strictEqual(splitPersonKey('  Mary   Jane '), 'mary-jane');
  same(owedPerson(splitPersonKey('Mary Jane') + ' Tesco'), { key: 'mary-jane', name: 'Mary-Jane', what: 'Tesco' });
});
test('a one-word name is just lower-cased; nothing typed is nothing', () => {
  assert.strictEqual(splitPersonKey(' Sam '), 'sam');
  assert.strictEqual(splitPersonKey(''), '');
  assert.strictEqual(splitPersonKey(undefined), '');
});

// ---- postReadToServer: a read with no reply in time is sent once more (a stuck request at Google, 2026-11-20) ----
// Runs the real function against a stand-in postToServer that plays back the given outcomes in turn, on a pretend
// clock: a try that got no reply in time uses up its whole time limit, plus `lateMs` if its limit ran out late (a
// negative lateMs: the phone's clock was put back meanwhile).
// A pretend clock for the sandbox: `Date` to hand it, `at(ms)` / `advance(ms)` to move it.
function fakeClock() {
  const c = { now: 1e6 };
  return { Date: { now: () => c.now }, at: ms => { c.now = 1e6 + ms; }, advance: ms => { c.now += ms; } };
}
function readWith(outcomes) {
  const tries = [];
  const clock = fakeClock();
  const box = { tries, outcomes: outcomes.slice(), Date: clock.Date, advance: clock.advance };
  vm.createContext(box);
  vm.runInContext(['REQUEST_TIMEOUT_MS', 'READ_FIRST_TRY_MS', 'postReadToServer'].map(appPart).join('\n') + `
    async function postToServer(body, opts) {
      tries.push({ body, timeoutMs: opts && opts.timeoutMs });
      const { result, lateMs } = outcomes.shift();
      if (Object.prototype.toString.call(result) === '[object Error]') {   // made outside this sandbox
        if (result.timedOut) advance(opts.timeoutMs + (lateMs || 0));
        throw result;
      }
      return result;
    }
    this.run = body => postReadToServer(body);
    this.limits = { first: READ_FIRST_TRY_MS, all: REQUEST_TIMEOUT_MS };`, box);
  return { run: box.run, tries, limits: box.limits };
}
const noReplyInTime = (afterSleep, lateMs) => ({ lateMs, result: Object.assign(new Error('The server took too long to respond.'), { network: true, timedOut: true, afterSleep: !!afterSleep }) });
const reply = { ok: true, data: { activeMonth: 'X' } };
const answered = { result: reply };
const body = { action: 'getCachedSheetState', payload: { sheetName: 'X' } };
(async () => {
  await test('a read that is answered is sent once, with the short wait', async () => {
    const r = readWith([answered]);
    assert.strictEqual(await r.run(body), reply);
    same(r.tries, [{ body, timeoutMs: r.limits.first }]);
    assert.ok(r.limits.first < r.limits.all);
  });
  await test('a read with no reply in time is sent once more, and the two waits add up to the old limit', async () => {
    const r = readWith([noReplyInTime(), answered]);
    assert.strictEqual(await r.run(body), reply);
    same(r.tries.map(t => t.timeoutMs), [r.limits.first, r.limits.all - r.limits.first]);
    assert.strictEqual(r.tries[1].body, body, 'the very same request is sent again');
  });
  await test('a first time limit that ran out a little late leaves the second try only what is left of the old limit', async () => {
    const r = readWith([noReplyInTime(false, 2500), answered]);
    assert.strictEqual(await r.run(body), reply);
    same(r.tries.map(t => t.timeoutMs), [r.limits.first, r.limits.all - r.limits.first - 2500]);
  });
  await test('the phone clock put back during the first try: the second still waits no longer than usual', async () => {
    const r = readWith([noReplyInTime(false, -60000), answered]);
    assert.strictEqual(await r.run(body), reply);
    same(r.tries.map(t => t.timeoutMs), [r.limits.first, r.limits.all - r.limits.first]);
  });
  await test('a read with no reply twice fails after the second try (not a third)', async () => {
    const r = readWith([noReplyInTime(), noReplyInTime(), answered]);
    await assert.rejects(r.run(body), e => e.timedOut === true);
    assert.strictEqual(r.tries.length, 2);
  });
  await test('a first try given up after the phone slept (dropOverdueRequests) is not sent again', async () => {
    const r = readWith([noReplyInTime(true), answered]);
    await assert.rejects(r.run(body), e => e.timedOut === true);
    assert.strictEqual(r.tries.length, 1);
  });
  await test('no connection at all (a quick failure, not a wait) is not sent again', async () => {
    const r = readWith([{ result: Object.assign(new Error('Failed to fetch'), { network: true, timedOut: false }) }, answered]);
    await assert.rejects(r.run(body), e => e.network === true);
    assert.strictEqual(r.tries.length, 1);
  });
  await test('an unreadable reply is not sent again', async () => {
    const r = readWith([{ result: Object.assign(new Error('unexpected'), { badReply: true }) }, answered]);
    await assert.rejects(r.run(body), e => e.badReply === true);
    assert.strictEqual(r.tries.length, 1);
  });
  await test('a refusal is a reply: passed back as it is, not sent again', async () => {
    const refused = { ok: false, code: 'AUTH_EXPIRED', authError: true };
    const r = readWith([{ result: refused }, answered]);
    assert.strictEqual(await r.run(body), refused);
    assert.strictEqual(r.tries.length, 1);
  });
  test('only the reads (SHEET_READS) go through postReadToServer; saves are sent once with the full wait', () => {
    assert.ok(/SHEET_READS\.includes\(action\) \? postReadToServer\(/.test(app), 'apiCallNow picks by SHEET_READS');
    assert.strictEqual(app.split('postReadToServer(').length - 1, 2, 'defined once and called once');
  });

  // ---- postToServer + dropOverdueRequests: when a given-up request counts as "after the phone slept" ----
  // The real functions, with a pretend clock and timers (run only when a test says so) and a fetch that never answers
  // unless told to. So a test can play out exactly what happens when the phone wakes.
  function wire() {
    const clock = fakeClock();
    const timers = [];
    const fetches = [];
    const box = {
      Date: clock.Date, AbortController,
      setTimeout: (fn, ms) => { const t = { fn, at: clock.Date.now() + ms, done: false }; timers.push(t); return t; },
      clearTimeout: t => { if (t) t.done = true; },
      fetch: (url, opts) => new Promise((resolve, reject) => {
        const f = { answer: text => resolve({ text: async () => text }) };
        fetches.push(f);
        opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    };
    vm.createContext(box);
    vm.runInContext(['APPS_SCRIPT_EXEC_URL', 'REQUEST_TIMEOUT_MS', 'liveRequests', 'DROP_OVERDUE_AFTER_MS', 'LATE_TIMER_MS',
      'chainAbort', 'dropOverdueRequests', 'postToServer'].map(appPart).join('\n') +
      '\nthis.api = { postToServer, dropOverdueRequests, DROP_OVERDUE_AFTER_MS, LATE_TIMER_MS };', box);
    const fire = t => { if (!t.done) { t.done = true; t.fn(); } };
    return {
      ...box.api, timers, fetches,
      at: clock.at,
      // the request's own time limit: the first timer postToServer sets (it sets no other before it)
      ownLimit: () => timers[0],
      // every timer due by now, in order
      runDue: () => timers.filter(t => !t.done && t.at <= clock.Date.now()).sort((a, b) => a.at - b.at).forEach(fire),
      fire,
    };
  }
  const tick = () => new Promise(r => setImmediate(r));
  // Settled at once (a promise given up before the test looks at it must not count as unhandled).
  const send = (w, opts) => { const p = w.postToServer({}, opts); return { p: p.then(v => ({ v }), e => ({ e })) }; };
  const given = async (w, r) => { const { e } = await r.p; assert.ok(e, 'it should have been given up'); return e; };
  const answeredWith = async r => { const { v, e } = await r.p; assert.ok(!e, e && e.message); return v; };

  await test('a time limit that runs out on time is an ordinary wait (the read may be sent again)', async () => {
    const w = wire();
    const p = send(w, { timeoutMs: 15000 });
    w.at(15000); w.runDue(); await tick();
    const e = await given(w, p);
    assert.strictEqual(e.timedOut, true);
    assert.strictEqual(e.afterSleep, false);
  });
  await test('a time limit that ran out over LATE_TIMER_MS late counts as after the phone slept', async () => {
    const w = wire();
    const p = send(w, { timeoutMs: 15000 });
    w.at(15000 + w.LATE_TIMER_MS + 1); w.fire(w.ownLimit()); await tick();
    assert.strictEqual((await given(w, p)).afterSleep, true);
  });
  await test('waking just past the limit: coming back marks it overdue at once, so its own limit running out next counts as after sleep', async () => {
    const w = wire();
    const p = send(w, { timeoutMs: 15000 });
    w.at(15500);
    w.dropOverdueRequests();        // the page comes back into view first...
    w.fire(w.ownLimit());           // ...then the request's own limit, already past, runs out (before the 1.5 s drop)
    await tick();
    const e = await given(w, p);
    assert.strictEqual(e.timedOut, true);
    assert.strictEqual(e.afterSleep, true, 'not an ordinary wait: the read must not be sent again');
  });
  await test('coming back, a reply that arrives within DROP_OVERDUE_AFTER_MS still lands', async () => {
    const w = wire();
    const p = send(w, { timeoutMs: 15000 });
    w.at(15500);
    w.dropOverdueRequests();
    w.fetches[0].answer('{"ok":true,"data":1}');
    const got = await answeredWith(p);
    assert.strictEqual(got.ok, true);
    w.at(15500 + w.DROP_OVERDUE_AFTER_MS); w.runDue();   // the drop finds it already finished: nothing to give up
  });
  await test('coming back, a request still within its limit is left alone', async () => {
    const w = wire();
    const p = send(w, { timeoutMs: 15000 });
    w.at(5000);
    w.dropOverdueRequests();
    w.at(5000 + w.DROP_OVERDUE_AFTER_MS); w.runDue();
    w.fetches[0].answer('{"ok":true}');
    assert.strictEqual((await answeredWith(p)).ok, true);
  });
  finish();
})();
