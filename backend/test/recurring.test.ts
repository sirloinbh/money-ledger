import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectRecurring } from '../src/ledger/recurring.js';

// #291 Which merchants count as a recurring payment: one charge in each of the last 3 complete months, every amount
// within 10% of the median. Today is 2026-11-24, so the months are 2026-08, 09 and 10; November is not counted.
const today = '2026-11-24';
let nextId = 1;
const entry = (date: string, amount: number, merchant: string, categoryId = 7) => ({
  id: nextId++,
  date,
  amount,
  merchant,
  categoryId,
  categoryName: 'Subscriptions',
});
const regular = (merchant: string, amounts = [10_900, 10_900, 10_900], day = '05') => [
  entry(`2026-08-${day}`, amounts[0], merchant),
  entry(`2026-09-${day}`, amounts[1], merchant),
  entry(`2026-10-${day}`, amounts[2], merchant),
];
const detect = (
  entries: ReturnType<typeof entry>[],
  fixedNames: string[] = [],
  dismissed: string[] = [],
) => detectRecurring(entries, today, fixedNames, new Set(dismissed));

test('a merchant charging the same amount in each of the last 3 months is suggested, ready to register', () => {
  const [found, ...rest] = detect(regular('Netflix'));
  assert.equal(rest.length, 0);
  assert.equal(found.merchant, 'Netflix');
  assert.equal(found.amount, 10_900);
  assert.equal(found.variable, false);
  assert.equal(found.dayOfMonth, 5);
  assert.deepEqual(
    found.entries.map((item) => item.date),
    ['2026-08-05', '2026-09-05', '2026-10-05'],
  );
  // Starts next month: this month's real charge is not added a second time.
  assert.deepEqual(found.register, {
    name: 'Netflix',
    categoryId: 7,
    amount: 10_900,
    variable: false,
    dayOfMonth: 5,
    startMonth: '2026-12',
  });
});

test('amounts that differ within 10% are suggested as a variable fixed cost with the latest amount', () => {
  const [found] = detect(regular('KT 통신요금', [52_000, 55_000, 57_000], '25'));
  assert.equal(found.variable, true);
  assert.equal(found.amount, 57_000);
  assert.equal(found.register.variable, true);
});

test('10% from the median is still recurring, one won more is not', () => {
  assert.equal(detect(regular('Edge', [100_000, 100_000, 110_000])).length, 1);
  assert.equal(detect(regular('Edge', [100_000, 100_000, 110_001])).length, 0);
});

test('irregular merchants are not suggested: a missing month, a big drift, or several charges in a month', () => {
  assert.equal(
    detect([entry('2026-08-05', 9_000, 'Gym'), entry('2026-10-05', 9_000, 'Gym')]).length,
    0,
  );
  assert.equal(detect(regular('Delivery', [9_000, 12_000, 30_000])).length, 0);
  const coffee = [...regular('Cafe'), entry('2026-10-20', 4_500, 'Cafe')];
  assert.equal(detect(coffee).length, 0);
});

test('only the last 3 complete months count; this month and older months are ignored', () => {
  const old = [
    entry('2026-06-05', 9_000, 'Old'),
    entry('2026-07-05', 9_000, 'Old'),
    entry('2026-08-05', 9_000, 'Old'),
  ];
  assert.equal(detect(old).length, 0);
  const current = [
    entry('2026-09-05', 9_000, 'New'),
    entry('2026-10-05', 9_000, 'New'),
    entry('2026-11-05', 9_000, 'New'),
  ];
  assert.equal(detect(current).length, 0);
});

test('the same merchant under different branch names counts as one', () => {
  const found = detect([
    entry('2026-08-05', 8_000, '스타벅스 강남점'),
    entry('2026-09-05', 8_000, '스타벅스 역삼점'),
    entry('2026-10-05', 8_000, '스타벅스'),
  ]);
  assert.equal(found.length, 1);
});

test('a merchant that already matches a fixed cost, or was dismissed, is skipped', () => {
  assert.equal(detect(regular('Netflix'), ['Netflix']).length, 0);
  assert.equal(detect(regular('Netflix 구독'), ['netflix']).length, 0);
  assert.equal(detect(regular('Netflix'), ['Rent']).length, 1);
  const key = detect(regular('Netflix'))[0].merchantKey;
  assert.equal(detect(regular('Netflix'), [], [key]).length, 0);
});

test('zero amounts and one-letter merchants are ignored; the biggest suggestion comes first', () => {
  assert.equal(detect(regular('Free', [0, 0, 0])).length, 0);
  assert.equal(detect(regular('A')).length, 0);
  const found = detect([
    ...regular('Small', [3_000, 3_000, 3_000]),
    ...regular('Big', [90_000, 90_000, 90_000]),
  ]);
  assert.deepEqual(
    found.map((item) => item.merchant),
    ['Big', 'Small'],
  );
});
