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
vm.runInContext(m[1] + '\nthis.api = { guessCategory, categoryFor, summariseSpend, spendKey, setSpendWords, SPEND_CATEGORIES, paydayIn, nextPayday, compareSpend };', sandbox);
const { guessCategory, categoryFor, summariseSpend, setSpendWords, SPEND_CATEGORIES, paydayIn, nextPayday, compareSpend } = sandbox.api;

const results = [];
function test(name, fn) {
  try { fn(); results.push([true, name]); }
  catch (e) { results.push([false, name + '\n      ' + String(e.message).split('\n')[0]]); }
}

// Made-up merchant spellings, one or more per category rule, including the ones where order matters
// ("uber eats" is eating out but "uber" is transport; "sains petrol" is transport; "train ticket" is transport).
const expected = {
  'Grocer and co': 'Groceries', 'Sainsburys local': 'Groceries', 'tesco express': 'Groceries', 'lidl': 'Groceries', 'M&s food': 'Groceries',
  'sains petrol': 'Transport', 'Tfl': 'Transport', 'train ticket': 'Transport', 'bus fare': 'Transport', 'taxi home': 'Transport', 'uber': 'Transport',
  'uber eats': 'Eating out', 'deliveroo': 'Eating out', 'mcdonalds': 'Eating out', 'burger van': 'Eating out', 'spoons': 'Eating out', 'tea room': 'Eating out',
  'airport parking': 'Travel', 'hotel stay': 'Travel',
  'sky tv': 'Bills & subscriptions', 'ee broadband': 'Bills & subscriptions', 'o2 bill': 'Bills & subscriptions', 'news sub': 'Bills & subscriptions', 'yt premium': 'Bills & subscriptions', 'Spotify': 'Bills & subscriptions', 'vpn subscription': 'Bills & subscriptions',
  'amazon': 'Shopping', 'Ebay': 'Shopping', 'vinted': 'Shopping', 'Primark': 'Shopping', 'Home Bargains': 'Shopping', 'DHL': 'Shopping',
  'comedy club': 'Entertainment', 'cinema': 'Entertainment', 'High st pharmacy': 'Health', 'boots': 'Health',
  'Corner shop': 'Other', 'Misc': 'Other'
};
Object.keys(expected).forEach(desc => {
  test(`"${desc}" is ${expected[desc]}`, () => assert.strictEqual(guessCategory(desc.toLowerCase()), expected[desc]));
});

test('every guessed category is one the menu offers', () => {
  Object.keys(expected).forEach(d => assert.ok(SPEND_CATEGORIES.indexOf(guessCategory(d.toLowerCase())) !== -1));
});

// A made-up month.
const st = {
  amex: [
    { desc: 'lidl', amount: -60.25 }, { desc: 'Lidl', amount: -39.5 }, { desc: 'Payment', amount: 1200 },
    { desc: 'Balance', amount: 10 }, { desc: 'Start', amount: -80 }, { desc: 'uber eats', amount: -14.2 }
  ],
  barclays: [{ desc: 'Ebay refund', amount: 6.5 }, { desc: 'Ebay', amount: -40.75 }, { desc: 'Amex payment', amount: -1200 }, { desc: 'tfl', amount: -7.3 }],
  checking: [{ desc: 'mortgage', amount: -800 }, { desc: 'sam lidl', amount: 30 }]
};

test('payments, balance and start rows are not spending; checking is ignored', () => {
  const s = summariseSpend(st, {});
  assert.strictEqual(s.total, +(60.25 + 39.5 + 14.2 + 40.75 - 6.5 + 7.3).toFixed(2));
});

test('same merchant in different spelling is grouped, and counted twice', () => {
  const groc = summariseSpend(st, {}).categories.find(c => c.cat === 'Groceries');
  assert.strictEqual(groc.merchants.length, 1);
  assert.strictEqual(groc.merchants[0].count, 2);
  assert.strictEqual(groc.total, 99.75);
});

test('a refund reduces its category rather than adding to it', () => {
  const shop = summariseSpend(st, {}).categories.find(c => c.cat === 'Shopping');
  assert.strictEqual(shop.total, +(40.75 - 6.5).toFixed(2));
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

// Extra words for local places come from the backend once you're signed in (they are not in the public page).
test('words from the backend put a local shop in its category', () => {
  assert.strictEqual(guessCategory('the noodle bar'), 'Other');
  setSpendWords({ 'Eating out': ['Noodle Bar'], 'Travel': ['ferryport'] });
  assert.strictEqual(guessCategory('the noodle bar'), 'Eating out');
  assert.strictEqual(guessCategory('ferryport car park'), 'Travel');
  setSpendWords(null);
  assert.strictEqual(guessCategory('the noodle bar'), 'Other', 'clearing them should put things back');
});

test('a backend word counts in its own category\'s place, so an earlier category still wins', () => {
  setSpendWords({ 'Entertainment': ['quiz'] });
  assert.strictEqual(guessCategory('quiz night'), 'Entertainment');
  assert.strictEqual(guessCategory('quiz night pub'), 'Eating out', '"pub" (eating out) comes before entertainment');
  setSpendWords(null);
});

test('backend words: unknown categories and non-lists are ignored, and . or ( are taken literally', () => {
  setSpendWords({ 'Made up': ['zzz'], 'Travel': 'not a list', 'Health': ['a.b', 'clinic ('] });
  assert.strictEqual(guessCategory('zzz'), 'Other');
  assert.strictEqual(guessCategory('not a list'), 'Other');
  assert.strictEqual(guessCategory('axb'), 'Other', 'a dot matched any character');
  assert.strictEqual(guessCategory('a.b'), 'Health');
  assert.strictEqual(guessCategory('the clinic (east)'), 'Health');
  setSpendWords(null);
});

// Payday: the 30th (the last day in February), or the Friday before when that falls on a weekend.
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
[[2026, 11, '2026-11-30', 'a Monday: the 30th itself'], [2026, 12, '2026-12-30', 'a Wednesday'],
 [2026, 5, '2026-05-29', 'Saturday the 30th: Friday the 29th'], [2026, 8, '2026-08-28', 'Sunday the 30th: Friday the 28th'],
 [2027, 2, '2027-02-26', 'February: Sunday the 28th, so Friday the 26th'], [2028, 2, '2028-02-29', 'leap-year February: Tuesday the 29th']
].forEach(([y, mo, want, why]) => {
  test(`payday ${y}-${mo}: ${why}`, () => assert.strictEqual(ymd(paydayIn(y, mo - 1)), want));
});

test('days to payday: counted from today, 0 on payday itself, next month once it has passed', () => {
  const p1 = nextPayday(new Date(2026, 10, 2, 9, 30));
  assert.strictEqual(ymd(p1.date), '2026-11-30');
  assert.strictEqual(p1.days, 28);
  const p2 = nextPayday(new Date(2026, 10, 30, 18, 0));
  assert.strictEqual(p2.days, 0);
  const p3 = nextPayday(new Date(2026, 4, 30, 8, 0));   // Saturday 30 May: payday was Friday the 29th
  assert.strictEqual(ymd(p3.date), '2026-06-30');
  const p4 = nextPayday(new Date(2026, 11, 31, 23, 0));   // across the new year
  assert.strictEqual(ymd(p4.date), '2027-01-29');
  assert.strictEqual(p4.days, 29);
});

test('days to payday: the clocks changing (late October) does not throw the count out', () => {
  assert.strictEqual(nextPayday(new Date(2026, 9, 20, 12, 0)).days, 10);   // 30 Oct 2026 is a Friday; clocks go back on the 25th
});

test('vs last month: up, down, the same within 50p, or new', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(compareSpend(120, 85))), { kind: 'up', diff: 35 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(compareSpend(40.5, 52.75))), { kind: 'down', diff: 12.25 });
  assert.strictEqual(compareSpend(20.3, 20).kind, 'same');
  assert.strictEqual(compareSpend(15, 0).kind, 'new');
  assert.strictEqual(compareSpend(15, undefined).kind, 'new');
});

let failed = 0;
results.forEach(([ok, name]) => { if (!ok) failed++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name); });
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
