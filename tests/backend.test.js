// Backend tests: loads Code.js into a sandbox with fake Apps Script services.
// Run: node tests/backend.test.js
const vm = require('vm');
const assert = require('assert');

const { makeEnv, CLIENT_ID, EMAIL } = require('./mock-apps-script');

function post(env, action, payload) {
  const res = vm.runInContext('doPost', env.sandbox)({ postData: { contents: JSON.stringify({ action, payload, idToken: 'tok' }) } });
  return JSON.parse(res.content);
}

const results = [];
function test(name, fn) {
  try { fn(); results.push([true, name]); }
  catch (e) { results.push([false, name + '\n      ' + String(e.message).split('\n')[0]]); }
}

// ---------- Fix 3: unknown sheet name must error, never fall back to another sheet ----------
const writeCalls = [
  ['addTransactionBundle', { sheetName: 'Nope', merchant: 'x', grossAmount: 1, account: 'amex' }],
  ['editOrMoveTransaction', { sheetName: 'Nope', oldAcct: 'amex', newAcct: 'amex', row: 5, newDesc: 'x', newAmount: -1 }],
  ['deleteTransactionRow', { sheetName: 'Nope', acct: 'amex', row: 5 }],
  ['toggleNeedFlag', { sheetName: 'Nope', row: 5, setNeed: true }],
  ['settleAllNeeds', { sheetName: 'Nope', rows: [5] }],
  ['updateBudgetRow', { sheetName: 'Nope', row: 5, newAmount: 0, originalBudget: -10 }],
  ['saveBudgetItem', { sheetName: 'Nope', row: 5, name: 'x', amount: -10, isRecurring: true }],
  ['deleteBudgetItem', { sheetName: 'Nope', row: 5 }],
  ['startNewMonth', { sourceSheetName: 'Nope', newMonthName: 'New', paycheck: 1, savingsAmount: 0 }],
];
writeCalls.forEach(([action, payload]) => {
  test(`${action}: unknown sheet errors and writes nothing`, () => {
    const env = makeEnv();
    const r = post(env, action, payload);
    assert.strictEqual(r.ok, false, 'expected ok:false');
    assert.ok(/Sheet not found/.test(r.error), 'error should mention Sheet not found, got: ' + r.error);
    assert.strictEqual(env.writes.count, 0, 'wrote to a sheet it should not have touched');
  });
});

test('known sheet still works (deleteBudgetItem on "Real Month")', () => {
  const env = makeEnv();
  const r = post(env, 'deleteBudgetItem', { sheetName: 'Real Month', row: 5 });
  assert.strictEqual(r.ok, true, r.error);
  assert.ok(env.writes.count > 0, 'should have written');
});

test('getCachedSheetState with unknown name still falls back to first month (read path unchanged)', () => {
  const env = makeEnv();
  const r = post(env, 'getCachedSheetState', { sheetName: 'Nope', forceRefresh: true });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.data.activeMonth, 'Real Month');
});

// ---------- Fix 2: write actions run under the script lock; reads do not ----------
test('write action takes lock before writing and releases after', () => {
  const env = makeEnv();
  const r = post(env, 'deleteBudgetItem', { sheetName: 'Real Month', row: 5 });
  assert.strictEqual(r.ok, true, r.error);
  const first = env.log.indexOf('write');
  const last = env.log.lastIndexOf('write');
  assert.ok(env.log.indexOf('lock:wait') !== -1 && env.log.indexOf('lock:wait') < first, 'lock must be taken before the first write: ' + env.log.join(','));
  assert.ok(env.log.lastIndexOf('lock:release') > last, 'lock must be released after the last write: ' + env.log.join(','));
});

test('lock is released even when the action fails', () => {
  const env = makeEnv();
  const r = post(env, 'deleteBudgetItem', { sheetName: 'Nope', row: 5 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(env.lockCalls.waits, 1, 'should have taken the lock once');
  assert.strictEqual(env.lockCalls.releases, 1, 'should have released the lock');
});

test('read action (getCachedSheetState) does not take the lock', () => {
  const env = makeEnv();
  const r = post(env, 'getCachedSheetState', { sheetName: 'Real Month', forceRefresh: true });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(env.lockCalls.waits, 0);
});

test('unauthorised token still rejected before any lock or write', () => {
  const env = makeEnv();
  env.sandbox.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ email_verified: 'true', email: 'evil@example.com', aud: CLIENT_ID, exp: '9999999999' }) });
  const r = post(env, 'deleteBudgetItem', { sheetName: 'Real Month', row: 5 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.authError, true);
  assert.strictEqual(env.lockCalls.waits, 0);
  assert.strictEqual(env.writes.count, 0);
});

test('token issued for a different Google client (wrong audience) is rejected', () => {
  const env = makeEnv();
  env.sandbox.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ email_verified: 'true', email: EMAIL, aud: 'some-other-client.apps.googleusercontent.com', exp: '9999999999' }) });
  const r = post(env, 'deleteBudgetItem', { sheetName: 'Real Month', row: 5 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.authError, true);
  assert.strictEqual(env.writes.count, 0);
});

// ---------- Timestamp storage (one script property per month, capped at ~9KB) ----------
const tsMap = (env, sheet) => JSON.parse(env.props['PF_TS_' + sheet] || '{}');
const record = (env, sheet, acct, row, ts) => vm.runInContext('recordServerTimestamp_', env.sandbox)(sheet, acct, row, ts);

test('timestamps: a busy month keeps recording past the 9KB property limit', () => {
  const env = makeEnv();
  for (let i = 1; i <= 700; i++) record(env, 'Real Month', 'checking', i, 1000 + i);
  const map = tsMap(env, 'Real Month');
  assert.ok((env.props['PF_TS_Real Month'] || '').length <= 9216, 'property exceeded the size limit');
  assert.ok(map['checking|700'] === 1700, 'newest timestamp was not recorded');
  assert.ok(map['checking|699'] === 1699, 'recent timestamp was lost');
});

test('timestamps: when full, the oldest entries are dropped first', () => {
  const env = makeEnv();
  for (let i = 1; i <= 700; i++) record(env, 'Real Month', 'checking', i, 1000 + i);
  const map = tsMap(env, 'Real Month');
  assert.ok(!('checking|1' in map), 'oldest entry should have been dropped');
  assert.ok(Object.keys(map).length > 100, 'should still hold plenty of recent entries');
});

test('timestamps: deleting a transaction removes its timestamp', () => {
  const env = makeEnv();
  record(env, 'Real Month', 'amex', 9, 5000);
  record(env, 'Real Month', 'amex', 10, 5001);
  const r = post(env, 'deleteTransactionRow', { sheetName: 'Real Month', acct: 'amex', row: 9 });
  assert.strictEqual(r.ok, true, r.error);
  const map = tsMap(env, 'Real Month');
  assert.ok(!('amex|9' in map), 'deleted row kept a stale timestamp');
  assert.strictEqual(map['amex|10'], 5001, 'other rows must be untouched');
});

test('timestamps: moving a transaction to another account removes the old timestamp', () => {
  const env = makeEnv();
  record(env, 'Real Month', 'amex', 9, 5000);
  const r = post(env, 'editOrMoveTransaction', { sheetName: 'Real Month', oldAcct: 'amex', newAcct: 'barclays', row: 9, newDesc: 'x', newAmount: -1 });
  assert.strictEqual(r.ok, true, r.error);
  const map = tsMap(env, 'Real Month');
  assert.ok(!('amex|9' in map), 'old position kept a stale timestamp');
  assert.ok(Object.keys(map).some(k => k.startsWith('barclays|')), 'new position should have a timestamp');
});

test('timestamps: editing in place keeps its timestamp', () => {
  const env = makeEnv();
  record(env, 'Real Month', 'amex', 9, 5000);
  const r = post(env, 'editOrMoveTransaction', { sheetName: 'Real Month', oldAcct: 'amex', newAcct: 'amex', row: 9, newDesc: 'x', newAmount: -1 });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(tsMap(env, 'Real Month')['amex|9'], 5000);
});

// ---------- Offline retries: a spend with a clientId that was already saved is ignored ----------
test('addTransactionBundle: a repeated clientId is saved only once', () => {
  const env = makeEnv();
  const spend = { sheetName: 'Real Month', merchant: 'coffee', grossAmount: 3, account: 'amex', splits: [], marcusShare: 0, clientId: 'abc123' };
  const first = post(env, 'addTransactionBundle', spend);
  assert.strictEqual(first.ok, true, first.error);
  const writesAfterFirst = env.writes.count;
  assert.ok(writesAfterFirst > 0, 'first send should write');
  const second = post(env, 'addTransactionBundle', spend);
  assert.strictEqual(second.ok, true, second.error);
  assert.strictEqual(env.writes.count, writesAfterFirst, 'the repeat must not write again');
});

test('addTransactionBundle: different clientIds are both saved', () => {
  const env = makeEnv();
  const base = { sheetName: 'Real Month', merchant: 'coffee', grossAmount: 3, account: 'amex', splits: [], marcusShare: 0 };
  post(env, 'addTransactionBundle', Object.assign({ clientId: 'one' }, base));
  const n = env.writes.count;
  post(env, 'addTransactionBundle', Object.assign({ clientId: 'two' }, base));
  assert.ok(env.writes.count > n, 'a new clientId should write');
});

test('addTransactionBundle: no clientId still saves every time (older pages)', () => {
  const env = makeEnv();
  const spend = { sheetName: 'Real Month', merchant: 'coffee', grossAmount: 3, account: 'amex', splits: [], marcusShare: 0 };
  post(env, 'addTransactionBundle', spend);
  const n = env.writes.count;
  post(env, 'addTransactionBundle', spend);
  assert.ok(env.writes.count > n);
});

// ---------- Spending category choices (shared by every device) ----------
test('category choices: start empty, save one, read it back', () => {
  const env = makeEnv();
  assert.deepStrictEqual(post(env, 'getCategoryChoices', {}).data.choices, {});
  const r = post(env, 'setCategoryChoice', { merchant: '  Morgan ', category: 'Groceries' });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(post(env, 'getCategoryChoices', {}).data.choices, { morgan: 'Groceries' });
});

test('category choices: merchant keys are case- and spacing-insensitive', () => {
  const env = makeEnv();
  post(env, 'setCategoryChoice', { merchant: 'Uber   Eats', category: 'Transport' });
  post(env, 'setCategoryChoice', { merchant: 'uber eats', category: 'Eating out' });
  assert.deepStrictEqual(post(env, 'getCategoryChoices', {}).data.choices, { 'uber eats': 'Eating out' });
});

test('category choices: an empty category removes the choice', () => {
  const env = makeEnv();
  post(env, 'setCategoryChoice', { merchant: 'morgan', category: 'Groceries' });
  const r = post(env, 'setCategoryChoice', { merchant: 'morgan', category: '' });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.data.choices, {});
});

test('category choices: an unknown category or a missing merchant is refused and stores nothing', () => {
  const env = makeEnv();
  assert.strictEqual(post(env, 'setCategoryChoice', { merchant: 'x', category: 'Made up' }).ok, false);
  assert.strictEqual(post(env, 'setCategoryChoice', { merchant: '  ', category: 'Other' }).ok, false);
  assert.strictEqual(env.props['PF_CATS'], undefined);
});

test('category choices: when full, the oldest choices are dropped and the newest is kept', () => {
  const env = makeEnv();
  for (let i = 1; i <= 400; i++) post(env, 'setCategoryChoice', { merchant: 'merchant number ' + i, category: 'Shopping' });
  assert.ok(env.props['PF_CATS'].length <= 8000, 'property grew past the cap');
  const choices = post(env, 'getCategoryChoices', {}).data.choices;
  assert.strictEqual(choices['merchant number 400'], 'Shopping');
  assert.ok(!('merchant number 1' in choices), 'oldest should have been dropped');
});

test('category choices: saving takes the lock, reading does not, and a bad token is refused', () => {
  const env = makeEnv();
  post(env, 'getCategoryChoices', {});
  assert.strictEqual(env.lockCalls.waits, 0);
  post(env, 'setCategoryChoice', { merchant: 'x', category: 'Other' });
  assert.strictEqual(env.lockCalls.waits, 1);
  const bad = makeEnv();
  bad.sandbox.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ email_verified: 'true', email: 'evil@example.com', aud: CLIENT_ID, exp: '9999999999' }) });
  const r = post(bad, 'setCategoryChoice', { merchant: 'x', category: 'Other' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.authError, true);
  assert.strictEqual(bad.props['PF_CATS'], undefined);
});

test('category choices: the backend and the page offer the same categories', () => {
  const env = makeEnv();
  const backend = vm.runInContext('SPEND_CATEGORIES', env.sandbox);
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/const SPEND_CATEGORIES = (\[[^\]]*\]);/);
  assert.ok(m, 'could not find the page list');
  assert.deepStrictEqual(JSON.parse(m[1].replace(/'/g, '"')), Array.from(backend));
});

// ---------- Stale screens: an edit or delete only touches the row if it still holds what the page showed ----------
const month = env => env.sheets[0];
const put = (env, row, col, v) => { month(env).cells[row + ',' + col] = v; };
const cell = (env, row, col) => month(env).getRange(row, col).getValue();

test('delete: refused when the row now holds a different entry, and nothing is written', () => {
  const env = makeEnv();
  put(env, 9, 9, 'Shell'); put(env, 9, 10, -40);   // amex row 9 was refilled by another device
  const r = post(env, 'deleteTransactionRow', { sheetName: 'Real Month', acct: 'amex', row: 9, expect: { desc: 'Tesco', amount: -12.5 } });
  assert.strictEqual(r.ok, false, 'stale delete went through');
  assert.ok(/^STALE/.test(r.error), r.error);
  assert.strictEqual(env.writes.count, 0);
  assert.strictEqual(cell(env, 9, 9), 'Shell');
});

test('delete: goes ahead when the row still matches', () => {
  const env = makeEnv();
  put(env, 9, 9, 'Tesco'); put(env, 9, 10, -12.5);
  const r = post(env, 'deleteTransactionRow', { sheetName: 'Real Month', acct: 'amex', row: 9, expect: { desc: 'Tesco', amount: -12.5 } });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(cell(env, 9, 9), '');
});

test('edit: refused when the amount changed on another device', () => {
  const env = makeEnv();
  put(env, 9, 9, 'Tesco'); put(env, 9, 10, -15);
  const r = post(env, 'editOrMoveTransaction', { sheetName: 'Real Month', oldAcct: 'amex', newAcct: 'barclays', row: 9, newDesc: 'Tesco', newAmount: -12.5, expect: { desc: 'Tesco', amount: -12.5 } });
  assert.strictEqual(r.ok, false);
  assert.ok(/^STALE/.test(r.error), r.error);
  assert.strictEqual(env.writes.count, 0);
});

test('edit: goes ahead when the row still matches', () => {
  const env = makeEnv();
  put(env, 9, 9, 'Tesco'); put(env, 9, 10, -12.5);
  const r = post(env, 'editOrMoveTransaction', { sheetName: 'Real Month', oldAcct: 'amex', newAcct: 'amex', row: 9, newDesc: 'Tesco Extra', newAmount: -13, expect: { desc: 'Tesco', amount: -12.5 } });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(cell(env, 9, 9), 'Tesco Extra');
  assert.strictEqual(cell(env, 9, 10), -13);
});

// ---------- Text that Sheets would otherwise turn into a formula or a date ----------
test('descriptions are written as plain text, never as a formula or a date', () => {
  const env = makeEnv();
  const r = post(env, 'addTransactionBundle', { sheetName: 'Real Month', merchant: '=IMPORTXML("x")', grossAmount: 5, account: 'amex', splits: [{ person: 'Amanda', amount: 2 }], marcusShare: 1 });
  assert.strictEqual(r.ok, true, r.error);
  const written = Object.values(month(env).cells).filter(v => typeof v === 'string');
  assert.ok(written.length >= 4, 'expected four text cells: ' + JSON.stringify(written));
  written.forEach(v => assert.ok(v[0] === "'", 'not forced to text: ' + v));
  assert.ok(r.data.amex.some(x => x.desc === '=IMPORTXML("x")'), 'should read back as the text typed');
  post(env, 'saveBudgetItem', { sheetName: 'Real Month', row: 6, name: '10/11', amount: -5 });
  assert.strictEqual(month(env).cells['6,14'], "'10/11");
});

// ---------- Bad values and rows are refused before anything is written ----------
const refused = [
  ['addTransactionBundle', { sheetName: 'Real Month', merchant: 'x', grossAmount: 'abc', account: 'amex' }, 'amount that is not a number'],
  ['addTransactionBundle', { sheetName: 'Real Month', merchant: 'x', grossAmount: 5e9, account: 'amex' }, 'absurdly large amount'],
  ['addTransactionBundle', { sheetName: 'Real Month', merchant: '  ', grossAmount: 5, account: 'amex' }, 'empty description'],
  ['addTransactionBundle', { sheetName: 'Real Month', merchant: 'x', grossAmount: 5, account: 'monzo' }, 'unknown account'],
  ['addTransactionBundle', { sheetName: 'Real Month', merchant: 'x', grossAmount: 5, account: 'amex', marcusShare: 'lots' }, 'bad savings share'],
  ['addTransactionBundle', { sheetName: 'Real Month', merchant: 'x', grossAmount: 5, account: 'amex', splits: [{ amount: 2 }] }, 'split with no name (used to half-save)'],
  ['editOrMoveTransaction', { sheetName: 'Real Month', oldAcct: 'amex', newAcct: 'amex', row: 9, newDesc: 'x', newAmount: 'NaN' }, 'edit to a non-number'],
  ['editOrMoveTransaction', { sheetName: 'Real Month', oldAcct: 'amex', newAcct: 'amex', row: 4, newDesc: 'x', newAmount: 1 }, 'edit of the start row'],
  ['deleteTransactionRow', { sheetName: 'Real Month', acct: 'amex', row: 2 }, 'delete of a header row'],
  ['deleteTransactionRow', { sheetName: 'Real Month', acct: 'amex', row: 4 }, 'delete of the start row'],
  ['deleteTransactionRow', { sheetName: 'Real Month', acct: 'amex', row: 'x' }, 'delete with no row number'],
  ['toggleNeedFlag', { sheetName: 'Real Month', row: 0, setNeed: true }, 'flag on row 0'],
  ['settleAllNeeds', { sheetName: 'Real Month', rows: [9, 'x'] }, 'settle with one bad row (none written)'],
  ['deleteBudgetItem', { sheetName: 'Real Month', row: 35 }, 'delete inside the MONEY LEFT box'],
  ['updateBudgetRow', { sheetName: 'Real Month', row: 35, newAmount: 0, originalBudget: -10 }, 'update inside the MONEY LEFT box'],
  ['updateBudgetRow', { sheetName: 'Real Month', row: 5, newAmount: 'x' }, 'bill amount that is not a number'],
  ['saveBudgetItem', { sheetName: 'Real Month', row: 2, name: 'x', amount: -10 }, 'bill in a header row'],
  ['saveBudgetItem', { sheetName: 'Real Month', name: 'x', amount: undefined }, 'bill with no amount'],
  ['startNewMonth', { sourceSheetName: 'Real Month', newMonthName: '  ', paycheck: 1 }, 'new month with no name'],
  ['startNewMonth', { sourceSheetName: 'Real Month', newMonthName: '_hidden', paycheck: 1 }, 'new month named like a backup'],
  ['startNewMonth', { sourceSheetName: 'Real Month', newMonthName: 'Real Month', paycheck: 1 }, 'new month named the same as this one'],
  ['startNewMonth', { sourceSheetName: 'Real Month', newMonthName: 'December', paycheck: 'abc' }, 'paycheck that is not a number'],
];
refused.forEach(([action, payload, what]) => {
  test(`${action}: refuses ${what}, writing nothing`, () => {
    const env = makeEnv();
    const r = post(env, action, payload);
    assert.strictEqual(r.ok, false, 'was accepted');
    assert.strictEqual(env.writes.count, 0, 'wrote before refusing');
  });
});

test('ordinary saves still work (spend with splits, bill, new month)', () => {
  const env = makeEnv();
  assert.strictEqual(post(env, 'addTransactionBundle', { sheetName: 'Real Month', merchant: 'Tesco', grossAmount: '12.50', account: 'barclays', splits: [{ person: 'Amanda', amount: 6.25, need: true }], marcusShare: 0, isRefund: false }).ok, true);
  assert.strictEqual(post(env, 'saveBudgetItem', { sheetName: 'Real Month', row: '', name: 'Gym', amount: -30, isRecurring: true }).ok, true);
  assert.strictEqual(post(env, 'settleAllNeeds', { sheetName: 'Real Month', rows: [5, 6] }).ok, true);
  const nm = post(env, 'startNewMonth', { sourceSheetName: 'Real Month', newMonthName: 'December Payday 2026', paycheck: 2500, savingsAmount: 300 });
  assert.strictEqual(nm.ok, true, nm.error);
});

// ---------- report ----------
let failed = 0;
results.forEach(([ok, name]) => { if (!ok) failed++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name); });
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
