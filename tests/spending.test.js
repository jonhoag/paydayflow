// Tests the spending-summary maths in index.html (the block between the <spending-core> markers).
// Run: node tests/spending.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/\/\/ <spending-core>([\s\S]*?)\/\/ <\/spending-core>/);
if (!m) { console.log('  FAIL  could not find the <spending-core> block in index.html'); process.exit(1); }
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(m[1] + '\nthis.api = { guessCategory, categoryFor, summariseSpend, spendKey, SPEND_CATEGORIES };', sandbox);
const { guessCategory, categoryFor, summariseSpend, SPEND_CATEGORIES } = sandbox.api;

const results = [];
function test(name, fn) {
  try { fn(); results.push([true, name]); }
  catch (e) { results.push([false, name + '\n      ' + String(e.message).split('\n')[0]]); }
}

// Typical merchant spellings, one or more per category rule.
const expected = {
  'waitrose': 'Groceries', 'Sainsburys': 'Groceries', 'tesco': 'Groceries', 'lidl': 'Groceries', 'M&s': 'Groceries',
  'sains petrol': 'Transport', 'Tfl': 'Transport', 'Southern rail': 'Transport', 'bus in': 'Transport', 'Work taxi thurs': 'Transport',
  'uber eats': 'Eating out', 'deliveroo': 'Eating out', 'mcdonalds': 'Eating out', 'Wolf 1': 'Eating out', 'spoons': 'Eating out', 'garden tea': 'Eating out',
  'airport parking': 'Travel',
  'sky tv': 'Bills & subscriptions', 'ee broadband': 'Bills & subscriptions', 'o2 bill': 'Bills & subscriptions', 'avios sub': 'Bills & subscriptions', 'yt premium': 'Bills & subscriptions', 'Spotify': 'Bills & subscriptions', 'windscribe': 'Bills & subscriptions',
  'amazon': 'Shopping', 'Ebay': 'Shopping', 'vinted': 'Shopping', 'Primark': 'Shopping', 'home bargins': 'Shopping', 'DHL': 'Shopping',
  'comedy club': 'Entertainment', 'High st pharmacy': 'Health', 'boots': 'Health',
  'Corner shop': 'Other', 'Misc': 'Other'
};
Object.keys(expected).forEach(desc => {
  test(`"${desc}" is ${expected[desc]}`, () => assert.strictEqual(guessCategory(desc.toLowerCase()), expected[desc]));
});

test('every guessed category is one the menu offers', () => {
  Object.keys(expected).forEach(d => assert.ok(SPEND_CATEGORIES.indexOf(guessCategory(d.toLowerCase())) !== -1));
});

const st = {
  amex: [
    { desc: 'waitrose', amount: -95.17 }, { desc: 'Waitrose', amount: -95.44 }, { desc: 'Payment', amount: 1434.16 },
    { desc: 'Balance', amount: 12 }, { desc: 'Start', amount: -93.16 }, { desc: 'uber eats', amount: -15.47 }
  ],
  barclays: [{ desc: 'Dhl refund', amount: 8.42 }, { desc: 'DHL', amount: -50.53 }, { desc: 'Amex payment', amount: -1434.16 }, { desc: 'tfl', amount: -8.9 }],
  checking: [{ desc: 'mortgage', amount: -800 }, { desc: 'amanda waitrose', amount: 40 }]
};

test('payments, balance and start rows are not spending; checking is ignored', () => {
  const s = summariseSpend(st, {});
  assert.strictEqual(s.total, +(95.17 + 95.44 + 15.47 + 50.53 - 8.42 + 8.9).toFixed(2));
});

test('same merchant in different spelling is grouped, and counted twice', () => {
  const groc = summariseSpend(st, {}).categories.find(c => c.cat === 'Groceries');
  assert.strictEqual(groc.merchants.length, 1);
  assert.strictEqual(groc.merchants[0].count, 2);
  assert.strictEqual(groc.total, 190.61);
});

test('a refund reduces its category rather than adding to it', () => {
  const shop = summariseSpend(st, {}).categories.find(c => c.cat === 'Shopping');
  assert.strictEqual(shop.total, +(50.53 - 8.42).toFixed(2));
});

test('categories come back largest first', () => {
  const totals = summariseSpend(st, {}).categories.map(c => c.total);
  assert.deepStrictEqual(totals, totals.slice().sort((a, b) => b - a));
});

test('your own category choice beats the guess', () => {
  const s = summariseSpend(st, { 'uber eats': 'Transport' });
  assert.ok(s.categories.find(c => c.cat === 'Transport').merchants.some(x => x.key === 'uber eats'));
  assert.ok(!(s.categories.find(c => c.cat === 'Eating out')));
});

test('an unknown saved category is ignored (falls back to the guess)', () => {
  assert.strictEqual(categoryFor('waitrose', { waitrose: 'Made up' }), 'Groceries');
});

test('empty or missing data gives a zero total, not an error', () => {
  assert.strictEqual(summariseSpend(null, {}).total, 0);
  assert.strictEqual(summariseSpend({ amex: [], barclays: [] }, {}).categories.length, 0);
});

let failed = 0;
results.forEach(([ok, name]) => { if (!ok) failed++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name); });
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
