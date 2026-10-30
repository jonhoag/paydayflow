// Backend tests: loads Code.js into a sandbox with fake Apps Script services.
// Run: node tests/backend.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const CLIENT_ID = '1074590107449-b3clq41r6un84qma18lomq7ip2f833pk.apps.googleusercontent.com';
const EMAIL = 'jonfhoag@gmail.com';
const code = fs.readFileSync(path.join(__dirname, '..', 'Code.js'), 'utf8');

function makeEnv() {
  const log = [];            // ordered events: 'lock:wait', 'write', 'lock:release', ...
  const writes = { count: 0 };

  const blankRows = (n, c) => Array.from({ length: n }, () => Array(c).fill(''));
  const range = {
    getValues: () => blankRows(80, 20),
    getNotes: () => Array.from({ length: 80 }, () => ['']),
    getValue: () => '',
  };
  ['setValue', 'setNote', 'clearNote', 'setFontFamily', 'setFontSize', 'setFontWeight',
    'setBackground', 'setFontColor', 'setNumberFormat', 'clearContent'].forEach(m => {
    range[m] = () => { writes.count++; log.push('write'); return range; };
  });
  const mkSheet = name => ({
    getName: () => name, getLastRow: () => 80, getLastColumn: () => 20, getSheetId: () => 1,
    getRange: () => range, getMaxRows: () => 180, getMaxColumns: () => 20,
    deleteRows() {}, deleteColumns() {}, setName() {}, copyTo() { return mkSheet('copy'); },
  });
  const sheets = [mkSheet('Real Month')];
  const ss = {
    getSheets: () => sheets,
    getSheetByName: n => sheets.find(s => s.getName() === n) || null,
    getUrl: () => 'https://example/sheet',
    setActiveSheet() {}, moveActiveSheet() {},
  };

  const props = {};
  const cacheStore = {};
  const lockCalls = { waits: 0, releases: 0 };
  const sandbox = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
    CacheService: { getScriptCache: () => ({
      get: k => cacheStore[k] || null, put: (k, v) => { cacheStore[k] = v; }, remove: k => { delete cacheStore[k]; } }) },
    // Like the real service, refuse values over ~9KB.
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => props[k] || null,
      setProperty: (k, v) => {
        if (String(v).length > 9216) throw new Error('Argument too large: value');
        props[k] = v;
      } }) },
    LockService: { getScriptLock: () => ({
      waitLock: () => { lockCalls.waits++; log.push('lock:wait'); },
      releaseLock: () => { lockCalls.releases++; log.push('lock:release'); } }) },
    ContentService: {
      MimeType: { JSON: 'json', TEXT: 'text' },
      createTextOutput: s => ({ content: s, setMimeType() { return this; } }) },
    Session: { getActiveUser: () => ({ getEmail: () => EMAIL }), getScriptTimeZone: () => 'Europe/London' },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: () => [1, 2, 3],
      base64EncodeWebSafe: () => 'abcdefghijklmnopqrstuvwxyz0123456789', formatDate: () => '000000' },
    UrlFetchApp: { fetch: () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ email_verified: 'true', email: EMAIL, aud: CLIENT_ID, exp: String(Math.floor(Date.now() / 1000) + 600) }) }) },
    HtmlService: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, log, writes, lockCalls, props };
}

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

// ---------- report ----------
let failed = 0;
results.forEach(([ok, name]) => { if (!ok) failed++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name); });
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
