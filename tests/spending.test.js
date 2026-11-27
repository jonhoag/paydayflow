// Tests the spending-summary maths in app.js (the block between the <spending-core> markers).
// Run: node tests/spending.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const m = app.match(/\/\/ <spending-core>([\s\S]*?)\/\/ <\/spending-core>/);
if (!m) { console.log('  FAIL  could not find the <spending-core> block in app.js'); process.exit(1); }
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(m[1] + '\nthis.api = { guessCategory, categoryFor, summariseSpend, spendKey, setSpendWords, SPEND_CATEGORIES, paydayIn, nextPayday, compareSpend };', sandbox);
const { guessCategory, categoryFor, summariseSpend, setSpendWords, SPEND_CATEGORIES, paydayIn, nextPayday, compareSpend } = sandbox.api;

const { step: test, finish } = require('./lib/steps').makeSteps();

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
  'Corner shop': 'Other', 'Misc': 'Other',
  // 4.12 (2026-11-25): general words that used to land in Other. "airport parking" stays Travel (Travel comes first);
  // "hp" only as a word, so "shop" or "chips" can't match it.
  'Greggs': 'Eating out', 'Chipotle': 'Eating out', 'Fish and chips': 'Eating out', 'gym breakfast': 'Eating out',
  'Stagecoach': 'Transport', 'Hospital parking': 'Transport', 'Asian shop sachets': 'Groceries', 'beer hawk': 'Groceries',
  'Claude': 'Bills & subscriptions', 'Card yearly fee': 'Bills & subscriptions', 'Hp': 'Bills & subscriptions',
  'WoW subscription': 'Bills & subscriptions', 'WoW expansions pack': 'Entertainment', 'Music festival': 'Entertainment',
  'South cliff dental': 'Health', 'Vision Express': 'Health', 'haircut': 'Health', 'gym': 'Health',
  'Tk maxx': 'Shopping', 'Sostrene Greens': 'Shopping', 'Smiths': 'Shopping', 'Shelter shop': 'Shopping', 'Whpp shop': 'Other',
  'Locksmiths': 'Other', 'Sparking plugs': 'Other'
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
  assert.strictEqual(s.charged, +(60.25 + 39.5 + 14.2 + 40.75 - 6.5 + 7.3).toFixed(2));
});

test('same merchant in different spelling is grouped, and counted twice', () => {
  const groc = summariseSpend(st, {}).categories.find(c => c.cat === 'Groceries');
  assert.strictEqual(groc.merchants.length, 1);
  assert.strictEqual(groc.merchants[0].count, 2);
  assert.strictEqual(groc.charged, 99.75);
});

test('a refund reduces its category rather than adding to it', () => {
  const shop = summariseSpend(st, {}).categories.find(c => c.cat === 'Shopping');
  assert.strictEqual(shop.charged, +(40.75 - 6.5).toFixed(2));
});

test('categories come back largest first', () => {
  const totals = summariseSpend(st, {}).categories.map(c => c.charged);
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
  assert.strictEqual(JSON.stringify(summariseSpend(null, {})), JSON.stringify({ charged: 0, share: 0, paidBack: 0, categories: [] }));
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

// "Mine": each shop's spending less what was paid back for it on Nationwide (a money-in row ending with the shop's name).
const shared = {
  amex: [{ desc: 'Waitrose', amount: -80 }, { desc: 'Waitrose', amount: -20 }, { desc: 'Dental care', amount: -400 }, { desc: 'Bistro', amount: -60 }],
  barclays: [{ desc: 'Bus', amount: -3 }, { desc: 'Tesco', amount: -10 }],
  checking: [
    { desc: 'kim Waitrose', amount: 50, need: true },        // still owed: counts
    { desc: 'insurer health Dental care', amount: 300 },     // insurance paid back
    { desc: 'kim / lee Bistro', amount: 45 },               // two people, one row
    { desc: 'lee Tesco', amount: 25 },                       // more than the spend: stops at £0
    { desc: 'paycheck', amount: 2000 }, { desc: 'Bus refund', amount: 3 },   // not paybacks
    { desc: 'kim Mortgage', amount: 700 },                   // a Nationwide spend, not a card one: left alone
    { desc: 'kim Bus', amount: -1.5 }                        // money out: not a payback
  ]
};
const shopOf = (s, k) => s.categories.flatMap(c => c.merchants).find(m => m.key === k);
test('your share: paybacks come off their shop; charged, share and paid back for the whole month', () => {
  const s = summariseSpend(shared, {});
  assert.deepStrictEqual(['waitrose', 'dental care', 'bistro', 'tesco', 'bus'].map(k => shopOf(s, k).share), [50, 100, 15, 0, 3]);
  assert.deepStrictEqual(['waitrose', 'tesco'].map(k => shopOf(s, k).charged), [100, 10]);
  assert.deepStrictEqual([s.charged, s.share, s.paidBack], [573, 168, 405]);
  assert.deepStrictEqual(s.categories.map(c => +(c.charged - c.share).toFixed(2)).reduce((a, b) => a + b, 0), 405);
});
test('a payback still owed counts the same as one paid', () => {
  const owed = summariseSpend({ amex: [{ desc: 'Bistro', amount: -40 }], checking: [{ desc: 'kim Bistro', amount: 15, need: true }] }, {});
  const paid = summariseSpend({ amex: [{ desc: 'Bistro', amount: -40 }], checking: [{ desc: 'kim Bistro', amount: 15 }] }, {});
  assert.deepStrictEqual([owed.share, paid.share], [25, 25]);
});
test('several paybacks for one shop add up (and stop at £0)', () => {
  const s = summariseSpend({ amex: [{ desc: 'Bistro', amount: -60 }], checking: [{ desc: 'kim Bistro', amount: 20 }, { desc: 'lee Bistro', amount: 25 }, { desc: 'jo Bistro', amount: 30 }] }, {});
  assert.deepStrictEqual([shopOf(s, 'bistro').share, s.paidBack], [0, 60]);
});
test('a shop with more refunded than spent is not paid back below nothing', () => {
  const s = summariseSpend({ amex: [{ desc: 'Shoes', amount: -20 }, { desc: 'Shoes', amount: 30 }], checking: [{ desc: 'kim Shoes', amount: 10 }] }, {});
  assert.deepStrictEqual([shopOf(s, 'shoes').charged, shopOf(s, 'shoes').share, s.paidBack], [-10, -10, 0]);
});
test('pennies add up exactly', () => {
  const s = summariseSpend({ amex: [{ desc: 'Bistro', amount: -0.3 }], checking: [{ desc: 'kim Bistro', amount: 0.1 }, { desc: 'lee Bistro', amount: 0.2 }] }, {});
  assert.deepStrictEqual([s.share, s.paidBack], [0, 0.3]);
});
test('the longest matching shop wins ("tesco express" before "express")', () => {
  const s = summariseSpend({ amex: [{ desc: 'Express', amount: -10 }, { desc: 'Tesco express', amount: -20 }], checking: [{ desc: 'kim Tesco express', amount: 20 }] }, {});
  assert.deepStrictEqual([shopOf(s, 'express').share, shopOf(s, 'tesco express').share], [10, 0]);
});
test('a payback for a Nationwide spend is not taken off a card shop with a shorter name', () => {
  const s = summariseSpend({ amex: [{ desc: 'Taxi', amount: -15 }], checking: [{ desc: 'Brighton taxi', amount: -40 }, { desc: 'kim Brighton taxi', amount: 20 }] }, {});
  assert.deepStrictEqual([shopOf(s, 'taxi').share, s.paidBack], [15, 0]);
});
test('a row that is only the shop name is not a payback', () => {
  assert.strictEqual(summariseSpend({ amex: [{ desc: 'Tesco', amount: -20 }], checking: [{ desc: 'Tesco', amount: 20 }] }, {}).share, 20);
});
test('an owed payback carried over from last month is not counted again (owed or paid back since); a new one the same is', () => {
  const last = { checking: [{ desc: 'kim Waitrose', amount: 50, need: true }] };
  const now = { amex: [{ desc: 'Waitrose', amount: -90 }], checking: [{ desc: 'kim Waitrose', amount: 50, need: true }, { desc: 'kim Waitrose', amount: 50, need: true }] };
  assert.deepStrictEqual([summariseSpend(now, {}, last).share, summariseSpend(now, {}).share], [40, 0]);
  const paidSince = { amex: now.amex, checking: [{ desc: 'kim Waitrose', amount: 50 }] };   // the carried one paid back this month: still not counted again
  assert.strictEqual(summariseSpend(paidSince, {}, last).share, 90);
});

finish();
