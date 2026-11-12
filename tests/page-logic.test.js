// Unit tests for small pieces of page logic in app.js that need no screen: reading an amount, equal split shares,
// the next month's name and what a failed request means. Each is read out of app.js by its name (appPart), so the
// tests check the code the page runs, wherever it sits in the file. (The spending maths is one block between markers
// instead, tested by spending.test.js; these helpers are spread through the file, and moving them together just for
// the tests would be churn.) To test another function: add its name to UNDER_TEST, and anything it needs to NEEDS.
// Run: node tests/page-logic.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { step: test, finish } = require('./lib/steps').makeSteps();

const UNDER_TEST = ['parseAmount', 'equalShares', 'getNextMonthName', 'failureKind'];
const NEEDS = ['MONTHS', 'isConnectionError'];

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
// One part of app.js by its name, as written there: a function (from "function name(" to the closing brace at the
// same indent) or a const on one line. There must be exactly one, so the test can't pick up the wrong one.
function appPart(name) {
  const found = [...app.matchAll(new RegExp('^( *)function ' + name + '\\(.*\\n[\\s\\S]*?^\\1\\}$', 'gm')),
    ...app.matchAll(new RegExp('^ *const ' + name + ' = .*;$', 'gm'))];
  if (found.length !== 1) throw new Error('found ' + name + ' ' + found.length + ' times in app.js (expected once)');
  return found[0][0];
}
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(NEEDS.concat(UNDER_TEST).map(appPart).join('\n') + '\nthis.api = { ' + UNDER_TEST.join(', ') + ' };', sandbox);
const { parseAmount, equalShares, getNextMonthName, failureKind } = sandbox.api;

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
const kinds = [
  ['a sign-in problem', { needsSignIn: true }, 'signin'], ['a sign-in problem (auth)', { auth: true }, 'signin'],
  ['no error at all', null, 'reach'], ['no connection', { network: true }, 'reach'], ['a reply that could not be read', { badReply: true }, 'reach'],
  ['a server that could not check the sign-in', { unavailable: true }, 'reach'],
  ['the sheet busy with another save', new Error('Lock timeout: another process was holding the lock for too long.'), 'busy'],
  ['the sheet busy (any case)', new Error('lock timeout'), 'busy'],
  ['saved, figures not read back', new Error('SAVED_NO_STATE: saved, but the figures could not be read just now.'), 'saved'],
  ['the row changed elsewhere', new Error('STALE: This entry was changed on another device.'), 'refused'],
  ['any other refusal', new Error('Invalid amount.'), 'refused'],
  ['words that only contain "Lock timeout"', new Error('Refused: Lock timeout'), 'refused'],
  ['a sign-in problem that is also a connection error', { needsSignIn: true, network: true }, 'signin']
];
kinds.forEach(([what, err, kind]) => test(`${what} is '${kind}'`, () => assert.strictEqual(failureKind(err), kind)));

finish();
