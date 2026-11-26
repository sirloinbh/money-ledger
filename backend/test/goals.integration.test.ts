import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { resetDatabase, withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

// #297 Savings goals against the real database. Skipped (not passed) without TEST_DATABASE_URL.
const url = await testDatabase();

type Goal = {
  id: number;
  name: string;
  targetAmount: number;
  targetDate: string | null;
  source: 'surplus' | 'asset';
  assetId: number | null;
  assetName: string | null;
  startMonth: string;
  finished: boolean;
  saved: number | null;
  remaining: number | null;
  percent: number | null;
  reached: boolean;
  overdue: boolean;
  monthsLeft: number | null;
  monthlyNeeded: number | null;
  issue: string | null;
};

test('savings goals against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const today = '2026-11-26';
  let incomeId = 0;
  let expenseId = 0;
  const reset = async () => {
    await resetDatabase(pool);
    const { rows } = await pool.query<{ id: number; kind: string }>(
      'SELECT DISTINCT ON (kind) id, kind FROM ledger_categories ORDER BY kind, id',
    );
    incomeId = Number(rows.find((row) => row.kind === 'income')!.id);
    expenseId = Number(rows.find((row) => row.kind === 'expense')!.id);
  };
  const entry = (date: string, kind: 'income' | 'expense', amount: number) =>
    pool.query(
      'INSERT INTO ledger_entries (entry_date, kind, amount, category_id) VALUES ($1, $2, $3, $4)',
      [date, kind, amount, kind === 'income' ? incomeId : expenseId],
    );
  const asset = async (name: string, type: string, valueKrw: number) =>
    Number(
      (
        await pool.query<{ id: string }>(
          'INSERT INTO portfolio_assets (name, asset_type, value_krw) VALUES ($1, $2, $3) RETURNING id',
          [name, type, valueKrw],
        )
      ).rows[0].id,
    );
  const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    let result: { status: number; data: Record<string, unknown> } | undefined;
    await withApi(
      pool,
      async (api) => {
        result = await api(path, init);
      },
      { today: () => today },
    );
    return result!;
  };
  const create = async (body: Record<string, unknown>) => {
    const response = await call('/api/goals', { method: 'POST', body });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.goal as Goal;
  };
  const list = async () => {
    const response = await call('/api/goals');
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data.goals as Goal[];
  };

  await t.test(
    'a surplus goal counts income minus expenses from its start month through today',
    async () => {
      await reset();
      // Before the start month and after today are not counted.
      await entry('2026-10-31', 'income', 9_000_000);
      await entry('2026-11-01', 'income', 3_000_000);
      await entry('2026-11-10', 'expense', 1_200_000);
      await entry('2026-12-01', 'income', 5_000_000);
      const goal = await create({
        name: 'Emergency fund',
        targetAmount: 6_000_000,
        targetDate: '2027-02-15',
        source: 'surplus',
      });
      assert.equal(goal.startMonth, '2026-11');
      assert.equal(goal.saved, 1_800_000);
      assert.equal(goal.remaining, 4_200_000);
      assert.equal(goal.percent, 30);
      // Nov 26 → Feb 15 counts Nov, Dec, Jan, Feb after this month: 3 months → 1,400,000 a month.
      assert.equal(goal.monthsLeft, 3);
      assert.equal(goal.monthlyNeeded, 1_400_000);
    },
  );

  await t.test('a month that spends more than it earns never shows negative progress', async () => {
    await reset();
    await entry('2026-11-05', 'income', 100_000);
    await entry('2026-11-06', 'expense', 700_000);
    const goal = await create({ name: 'Trip', targetAmount: 1_000_000, source: 'surplus' });
    assert.equal(goal.saved, 0);
    assert.equal(goal.remaining, 1_000_000);
    assert.equal(goal.percent, 0);
    assert.equal(goal.monthlyNeeded, null, 'no target date');
  });

  await t.test(
    'an asset goal follows the account value and refuses debts and missing accounts',
    async () => {
      await reset();
      const savings = await asset('Savings account', 'cash', 2_500_000);
      const debt = await asset('Loan', 'debt', 8_000_000);
      const goal = await create({
        name: 'Travel fund',
        targetAmount: 5_000_000,
        source: 'asset',
        assetId: savings,
      });
      assert.equal(goal.saved, 2_500_000);
      assert.equal(goal.assetName, 'Savings account');
      assert.equal(goal.percent, 50);
      // The value follows the account.
      await pool.query('UPDATE portfolio_assets SET value_krw = 5_500_000 WHERE id = $1', [
        savings,
      ]);
      const again = (await list())[0];
      assert.equal(again.saved, 5_500_000);
      assert.equal(again.reached, true);
      assert.equal(again.remaining, 0);

      const base = { name: 'Bad', targetAmount: 1_000_000, source: 'asset' };
      assert.equal(
        (await call('/api/goals', { method: 'POST', body: { ...base, assetId: debt } })).status,
        422,
      );
      assert.equal(
        (await call('/api/goals', { method: 'POST', body: { ...base, assetId: 99_999 } })).status,
        422,
      );
      assert.equal((await call('/api/goals', { method: 'POST', body: base })).status, 422);
      assert.equal(
        (
          await call('/api/goals', {
            method: 'POST',
            body: { ...base, source: 'surplus', assetId: savings },
          })
        ).status,
        422,
      );
      assert.equal((await list()).length, 1);
    },
  );

  await t.test(
    'deleting the asset keeps the goal, with no progress until another account is chosen',
    async () => {
      await reset();
      const first = await asset('Old account', 'cash', 1_000_000);
      const second = await asset('New account', 'cash', 3_000_000);
      const goal = await create({
        name: 'House',
        targetAmount: 10_000_000,
        source: 'asset',
        assetId: first,
      });
      await pool.query('DELETE FROM portfolio_assets WHERE id = $1', [first]);
      const orphan = (await list())[0];
      assert.equal(orphan.saved, null);
      assert.equal(orphan.issue, 'no_asset');
      // It can still be renamed without choosing an account.
      const renamed = await call(`/api/goals/${goal.id}`, {
        method: 'PATCH',
        body: { name: 'House fund' },
      });
      assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
      // Changing the source without an account is refused; choosing one works.
      assert.equal(
        (await call(`/api/goals/${goal.id}`, { method: 'PATCH', body: { source: 'asset' } }))
          .status,
        422,
      );
      const fixed = await call(`/api/goals/${goal.id}`, {
        method: 'PATCH',
        body: { assetId: second },
      });
      assert.equal((fixed.data.goal as Goal).saved, 3_000_000);
    },
  );

  await t.test('edit, finish, reopen and delete', async () => {
    await reset();
    await entry('2026-11-02', 'income', 500_000);
    const goal = await create({
      name: 'Laptop',
      targetAmount: 2_000_000,
      targetDate: '2026-10-01',
      source: 'surplus',
    });
    assert.equal(goal.overdue, true);
    const edited = await call(`/api/goals/${goal.id}`, {
      method: 'PATCH',
      body: { name: 'New laptop', targetAmount: 1_000_000, targetDate: '2027-03-31' },
    });
    const changed = edited.data.goal as Goal;
    assert.equal(changed.name, 'New laptop');
    assert.equal(changed.targetAmount, 1_000_000);
    assert.equal(changed.overdue, false);
    assert.equal(changed.monthsLeft, 4);
    // Removing the date.
    const noDate = (
      await call(`/api/goals/${goal.id}`, { method: 'PATCH', body: { targetDate: null } })
    ).data.goal as Goal;
    assert.equal(noDate.targetDate, null);
    // Finish: it goes after the open ones and needs no monthly amount.
    const open = await create({
      name: 'Another',
      targetAmount: 100_000_000,
      targetDate: '2030-01-01',
      source: 'surplus',
    });
    const finished = (
      await call(`/api/goals/${goal.id}`, { method: 'PATCH', body: { finished: true } })
    ).data.goal as Goal;
    assert.equal(finished.finished, true);
    assert.deepEqual(
      (await list()).map((item) => item.id),
      [open.id, goal.id],
    );
    const reopened = (
      await call(`/api/goals/${goal.id}`, { method: 'PATCH', body: { finished: false } })
    ).data.goal as Goal;
    assert.equal(reopened.finished, false);
    assert.equal((await call(`/api/goals/${goal.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await call(`/api/goals/${goal.id}`, { method: 'DELETE' })).status, 404);
    assert.equal((await call('/api/goals/abc', { method: 'DELETE' })).status, 400);
    assert.equal(
      (await call(`/api/goals/${goal.id}`, { method: 'PATCH', body: { name: 'x' } })).status,
      404,
    );
    assert.equal(
      (
        await call('/api/goals', {
          method: 'POST',
          body: { name: '', targetAmount: 5, source: 'surplus' },
        })
      ).status,
      400,
    );
  });

  await t.test('switching from an account to the surplus counts it from this month', async () => {
    await reset();
    await entry('2026-09-10', 'income', 4_000_000);
    await entry('2026-11-10', 'income', 700_000);
    const account = await asset('Savings account', 'cash', 1_000_000);
    const goal = await create({
      name: 'Fund',
      targetAmount: 3_000_000,
      source: 'asset',
      assetId: account,
    });
    const switched = (
      await call(`/api/goals/${goal.id}`, { method: 'PATCH', body: { source: 'surplus' } })
    ).data.goal as Goal;
    assert.equal(switched.assetId, null);
    assert.equal(switched.startMonth, '2026-11');
    assert.equal(switched.saved, 700_000);
  });
});
