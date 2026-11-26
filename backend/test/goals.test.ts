import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBody, toGoal, updateBody } from '../src/goals.js';

// #297 Progress, the amount left and the monthly amount needed, without a database.

const row = (over: Partial<Parameters<typeof toGoal>[0]> = {}) => ({
  id: 1,
  name: 'Emergency fund',
  target_amount: '1000000',
  target_date: null,
  source: 'surplus' as const,
  asset_id: null,
  asset_name: null,
  asset_type: null,
  start_month: '2026-11',
  finished_at: null,
  surplus: '250000',
  ...over,
});

test('surplus progress: saved, remaining and percent come from the surplus', () => {
  const goal = toGoal(row(), undefined, '2026-11-26');
  assert.equal(goal.saved, 250_000);
  assert.equal(goal.remaining, 750_000);
  assert.equal(goal.percent, 25);
  assert.equal(goal.reached, false);
  assert.equal(goal.monthlyNeeded, null, 'no target date, no monthly amount');
});

test('asset progress uses the account value; a missing value or account shows no progress', () => {
  const asset = { source: 'asset' as const, asset_id: 7, asset_name: 'Savings account' };
  const valued = toGoal(row(asset), '400000', '2026-11-26');
  assert.equal(valued.saved, 400_000);
  assert.equal(valued.percent, 40);
  assert.equal(valued.assetName, 'Savings account');

  const unpriced = toGoal(row(asset), null, '2026-11-26');
  assert.equal(unpriced.saved, null);
  assert.equal(unpriced.issue, 'no_value');
  assert.equal(unpriced.percent, null);

  const gone = toGoal(row({ source: 'asset', asset_id: null }), undefined, '2026-11-26');
  assert.equal(gone.saved, null);
  assert.equal(gone.issue, 'no_asset');
});

test('monthly amount needed is rounded up over the months from this one to the target month', () => {
  // Nov 26 to Feb 10: 3 months (counting the target month), 750,000 left → 250,000 a month.
  const even = toGoal(row({ target_date: '2027-02-10' }), undefined, '2026-11-26');
  assert.equal(even.monthsLeft, 3);
  assert.equal(even.monthlyNeeded, 250_000);
  // 1,000,000 - 250,001 = 749,999 over 3 months rounds up to 250,000.
  const uneven = toGoal(
    row({ target_date: '2027-02-10', surplus: '250001' }),
    undefined,
    '2026-11-26',
  );
  assert.equal(uneven.remaining, 749_999);
  assert.equal(uneven.monthlyNeeded, 250_000);
  // Later this month: one month.
  const soon = toGoal(row({ target_date: '2026-11-30' }), undefined, '2026-11-26');
  assert.equal(soon.monthsLeft, 1);
  assert.equal(soon.monthlyNeeded, 750_000);
});

test('a reached goal has nothing left, a past target date is overdue, a finished goal needs nothing', () => {
  const reached = toGoal(
    row({ surplus: '1500000', target_date: '2027-02-10' }),
    undefined,
    '2026-11-26',
  );
  assert.equal(reached.reached, true);
  assert.equal(reached.remaining, 0);
  assert.equal(reached.percent, 100);
  assert.equal(reached.monthlyNeeded, null);
  assert.equal(reached.overdue, false);

  const late = toGoal(row({ target_date: '2026-10-31' }), undefined, '2026-11-26');
  assert.equal(late.overdue, true);
  assert.equal(late.monthlyNeeded, null);
  assert.equal(late.monthsLeft, null);

  const done = toGoal(
    row({ target_date: '2027-02-10', finished_at: '2026-11-20T00:00:00Z' }),
    undefined,
    '2026-11-26',
  );
  assert.equal(done.finished, true);
  assert.equal(done.monthlyNeeded, null);
});

test('amounts stay exact up to the won cap', () => {
  const goal = toGoal(
    row({ target_amount: '1000000000000', surplus: '333333333333', target_date: '2036-11-30' }),
    undefined,
    '2026-11-26',
  );
  assert.equal(goal.remaining, 666_666_666_667);
  assert.equal(goal.monthlyNeeded, 5_555_555_556);
});

test('the bodies check the name, the target amount and the date', () => {
  const ok = { name: 'Trip', targetAmount: 3_000_000, source: 'surplus' };
  assert.equal(createBody.safeParse(ok).success, true);
  assert.equal(createBody.safeParse({ ...ok, name: '  ' }).success, false);
  assert.equal(createBody.safeParse({ ...ok, targetAmount: 0 }).success, false);
  assert.equal(createBody.safeParse({ ...ok, targetAmount: 1.5 }).success, false);
  assert.equal(createBody.safeParse({ ...ok, targetAmount: 1_000_000_000_001 }).success, false);
  assert.equal(createBody.safeParse({ ...ok, targetDate: '2027-02-30' }).success, false);
  assert.equal(createBody.safeParse({ ...ok, targetDate: '2027-02-28' }).success, true);
  assert.equal(createBody.safeParse({ ...ok, source: 'bank' }).success, false);
  assert.equal(updateBody.safeParse({}).success, false);
  assert.equal(updateBody.safeParse({ targetDate: null }).success, true);
});
