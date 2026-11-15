import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

type Budget = {
  categoryId: number;
  name: string;
  hidden: boolean;
  spent: number;
  budget: number | null;
  budgetMonth: string | null;
  remaining: number | null;
  over: number | null;
  percent: string | null;
};

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('monthly budgets against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  let ids: Record<string, number> = {};
  const reset = async () => {
    await pool.query('TRUNCATE ledger_categories RESTART IDENTITY CASCADE');
    await runMigration(pool, '002_ledger_categories.sql');
    await runMigration(pool, '017_ledger_budgets.sql');
    const { rows } = await pool.query<{ id: string; kind: string; name: string }>(
      'SELECT id, kind, name FROM ledger_categories',
    );
    ids = Object.fromEntries(rows.map((row) => [`${row.kind}/${row.name}`, Number(row.id)]));
  };
  const spend = (date: string, categoryId: number | null, amount: number, kind = 'expense') =>
    pool.query(
      'INSERT INTO ledger_entries (entry_date, kind, amount, category_id) VALUES ($1, $2, $3, $4)',
      [date, kind, amount, categoryId],
    );
  const call = async (path: string, init?: { method?: string; body?: unknown }) => {
    let result: { status: number; data: unknown } | undefined;
    await withApi(pool, async (api) => {
      result = await api(path, init);
    });
    return result!;
  };
  const save = async (categoryId: number, month: string, amount: number) => {
    const response = await call(`/api/ledger/budgets/${categoryId}`, {
      method: 'PUT',
      body: { month, amount },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
  };
  const list = async (month: string) => {
    const response = await call(`/api/ledger/budgets?month=${month}`);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const data = response.data as { month: string; budgets: Budget[] };
    assert.equal(data.month, month);
    return Object.fromEntries(data.budgets.map((budget) => [budget.name, budget]));
  };

  await t.test('spending against the budget: under, exactly, over, and no budget', async () => {
    await reset();
    const food = ids['expense/식비'];
    const traffic = ids['expense/교통'];
    const housing = ids['expense/주거'];
    await save(food, '2026-11', 300000);
    await save(traffic, '2026-11', 50000);
    await save(housing, '2026-11', 80000);
    await spend('2026-10-31', food, 99999); // the month before
    await spend('2026-11-01', food, 120000);
    await spend('2026-11-30', food, 217500); // last day
    await spend('2026-12-01', food, 77777); // the month after
    await spend('2026-11-15', traffic, 50000);
    await spend('2026-11-15', housing, 1000);
    await spend('2026-11-20', null, 5000); // uncategorized: not in budgets
    await spend('2026-11-20', ids['income/급여'], 3000000, 'income'); // income: not in budgets

    assert.deepEqual(
      (await call('/api/ledger/budgets?month=2026-11')).data,
      (await call('/api/ledger/budgets?month=2026-11')).data,
    );
    const budgets = await list('2026-11');
    // Over budget: the excess, no rest, the percentage over 100.
    assert.deepEqual(budgets['식비'], {
      categoryId: food,
      name: '식비',
      hidden: false,
      spent: 337500,
      budget: 300000,
      budgetMonth: '2026-11',
      remaining: 0,
      over: 37500,
      percent: '112.5',
    });
    // Exactly the budget: neither rest nor excess.
    assert.deepEqual(
      [budgets['교통'].remaining, budgets['교통'].over, budgets['교통'].percent],
      [0, 0, '100.0'],
    );
    // Rounding to one decimal: 1000 / 80000 = 1.25 → 1.3 (half away from zero).
    assert.deepEqual(
      [budgets['주거'].remaining, budgets['주거'].over, budgets['주거'].percent],
      [79000, 0, '1.3'],
    );
    // No budget: Not set, with the spending still shown.
    assert.deepEqual(budgets['통신'], {
      categoryId: ids['expense/통신'],
      name: '통신',
      hidden: false,
      spent: 0,
      budget: null,
      budgetMonth: null,
      remaining: null,
      over: null,
      percent: null,
    });
    // Expense categories only, in their usual order.
    assert.deepEqual(Object.keys(budgets), [
      '식비',
      '교통',
      '주거',
      '통신',
      '생활',
      '의료',
      '여가',
      '기타',
    ]);
  });

  await t.test(
    'a month without its own budget carries on from the latest earlier one',
    async () => {
      await reset();
      const food = ids['expense/식비'];
      await save(food, '2026-08', 300000);
      await save(food, '2026-10', 250000);

      assert.equal((await list('2026-07'))['식비'].budget, null); // before any budget
      assert.deepEqual(
        [(await list('2026-08'))['식비'].budget, (await list('2026-08'))['식비'].budgetMonth],
        [300000, '2026-08'],
      );
      assert.deepEqual(
        [(await list('2026-09'))['식비'].budget, (await list('2026-09'))['식비'].budgetMonth],
        [300000, '2026-08'],
      );
      assert.deepEqual(
        [(await list('2027-03'))['식비'].budget, (await list('2027-03'))['식비'].budgetMonth],
        [250000, '2026-10'],
      );
      // Nothing was copied: only the two saved months have rows.
      const { rows } = await pool.query('SELECT 1 FROM ledger_budgets');
      assert.equal(rows.length, 2);

      // Changing an earlier month moves the months that carry on from it, not the ones with their own row.
      await save(food, '2026-08', 320000);
      assert.equal((await list('2026-09'))['식비'].budget, 320000);
      assert.equal((await list('2026-11'))['식비'].budget, 250000);

      // Saving the same month again replaces it.
      await save(food, '2026-10', 260000);
      assert.equal((await list('2026-10'))['식비'].budget, 260000);
    },
  );

  await t.test('0 means no budget from that month on', async () => {
    await reset();
    const food = ids['expense/식비'];
    await save(food, '2026-08', 300000);
    await save(food, '2026-10', 0);
    await spend('2026-11-03', food, 1000);
    assert.equal((await list('2026-09'))['식비'].budget, 300000);
    const november = (await list('2026-11'))['식비'];
    assert.deepEqual(
      [november.budget, november.budgetMonth, november.spent, november.percent],
      [null, null, 1000, null],
    );
    await save(food, '2026-12', 100000);
    assert.equal((await list('2027-01'))['식비'].budget, 100000);
  });

  await t.test(
    'a hidden category is listed only with spending or a budget this month',
    async () => {
      await reset();
      const hide = (name: string) =>
        pool.query('UPDATE ledger_categories SET hidden = true WHERE id = $1', [
          ids[`expense/${name}`],
        ]);
      await hide('통신');
      await hide('여가');
      await hide('기타');
      await spend('2026-11-05', ids['expense/여가'], 7000);
      await save(ids['expense/기타'], '2026-11', 10000);
      const budgets = await list('2026-11');
      assert.equal(budgets['통신'], undefined);
      assert.deepEqual([budgets['여가'].hidden, budgets['여가'].spent], [true, 7000]);
      assert.deepEqual([budgets['기타'].hidden, budgets['기타'].budget], [true, 10000]);
    },
  );

  await t.test('only an existing expense category takes a budget', async () => {
    await reset();
    for (const categoryId of [ids['income/급여'], 999999]) {
      const response = await call(`/api/ledger/budgets/${categoryId}`, {
        method: 'PUT',
        body: { month: '2026-11', amount: 1000 },
      });
      assert.equal(response.status, 404);
      assert.deepEqual(response.data, { error: 'Expense category not found' });
    }
    const { rows } = await pool.query('SELECT 1 FROM ledger_budgets');
    assert.equal(rows.length, 0);
  });

  await t.test('the table refuses what the API never writes', async () => {
    await reset();
    const food = ids['expense/식비'];
    await assert.rejects(
      pool.query(
        `INSERT INTO ledger_budgets (category_id, month, amount) VALUES ($1, '2026-11-02', 1)`,
        [food],
      ),
      /ledger_budgets_month_check/,
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO ledger_budgets (category_id, month, amount) VALUES ($1, '2026-11-01', -1)`,
        [food],
      ),
      /ledger_budgets_amount_check/,
    );
  });

  await t.test('the 1900 and 2100 ends', async () => {
    await reset();
    await save(ids['expense/식비'], '1900-01', 5);
    await spend('2100-12-31', ids['expense/식비'], 10);
    const last = (await list('2100-12'))['식비'];
    assert.deepEqual(
      [last.budget, last.budgetMonth, last.over, last.percent],
      [5, '1900-01', 5, '200.0'],
    );
  });
});
