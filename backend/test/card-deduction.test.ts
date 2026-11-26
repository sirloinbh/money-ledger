import assert from 'node:assert/strict';
import { test } from 'node:test';

import { estimateCardDeduction } from '../src/ledger/card-deduction.js';

// Salary 40,000,000 -> threshold 10,000,000, limit 3,000,000.
const base = { salary: 40_000_000, credit: 0, debit: 0, cash: 0 };

test('nothing is deducted while spending is under the threshold', () => {
  const result = estimateCardDeduction({ ...base, credit: 6_000_000, debit: 3_000_000 });
  assert.equal(result.threshold, 10_000_000);
  assert.equal(result.deduction, 0);
  assert.equal(result.toThreshold, 1_000_000);
  assert.equal(result.overThreshold, 0);
});

test('credit card spending past the threshold is deducted at 15%, debit and cash at 30%', () => {
  const result = estimateCardDeduction({
    ...base,
    credit: 12_000_000,
    debit: 1_000_000,
    cash: 1_000_000,
  });
  // (12,000,000 - 10,000,000) * 15% + 2,000,000 * 30%
  assert.equal(result.deduction, 300_000 + 600_000);
  assert.equal(result.overThreshold, 4_000_000);
  assert.equal(result.toThreshold, 0);
});

test('the threshold is used up by credit cards first, then debit and cash', () => {
  const result = estimateCardDeduction({
    ...base,
    credit: 4_000_000,
    debit: 5_000_000,
    cash: 3_000_000,
  });
  // 6,000,000 of the threshold is left after the credit card; 8,000,000 - 6,000,000 at 30%.
  assert.equal(result.deduction, 600_000);
});

test('the deduction is capped by the limit of the salary band', () => {
  assert.equal(estimateCardDeduction({ ...base, debit: 40_000_000 }).deduction, 3_000_000);
  const high = { salary: 100_000_000, credit: 0, debit: 60_000_000, cash: 0 };
  assert.equal(estimateCardDeduction(high).limit, 2_500_000);
  assert.equal(estimateCardDeduction(high).deduction, 2_500_000);
  assert.equal(estimateCardDeduction({ ...high, salary: 130_000_000 }).limit, 2_000_000);
  // The edges belong to the lower band.
  assert.equal(estimateCardDeduction({ ...base, salary: 70_000_000 }).limit, 3_000_000);
  assert.equal(estimateCardDeduction({ ...base, salary: 120_000_000 }).limit, 2_500_000);
});

test('amounts round down to a whole won and zero salary has no threshold', () => {
  assert.equal(estimateCardDeduction({ ...base, salary: 10, credit: 7 }).threshold, 2);
  assert.equal(estimateCardDeduction({ ...base, salary: 10, credit: 7 }).deduction, 0); // 5 * 15% = 0.75
  assert.equal(
    estimateCardDeduction({ salary: 0, credit: 1000, debit: 0, cash: 0 }).deduction,
    150,
  );
});
