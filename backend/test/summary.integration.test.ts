import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

type Summary = {
  month: string;
  income: number;
  expense: number;
  balance: number;
  categories: {
    categoryId: number | null;
    name: string;
    hidden: boolean;
    amount: number;
    share: string;
  }[];
};

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('monthly summary against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async () => {
    await pool.query('TRUNCATE ledger_categories RESTART IDENTITY CASCADE');
    await runMigration(pool, '002_ledger_categories.sql');
  };
  const categoryIds = async () => {
    const { rows } = await pool.query<{ id: string; kind: string; name: string }>(
      'SELECT id, kind, name FROM ledger_categories',
    );
    return Object.fromEntries(rows.map((row) => [`${row.kind}/${row.name}`, Number(row.id)]));
  };
  const add = (date: string, kind: string, amount: number, categoryId: number | null) =>
    pool.query(
      'INSERT INTO ledger_entries (entry_date, kind, amount, category_id) VALUES ($1, $2, $3, $4)',
      [date, kind, amount, categoryId],
    );
  const summary = async (month: string) => {
    let result: Summary | undefined;
    await withApi(pool, async (call) => {
      const response = await call(`/api/ledger/summary?month=${month}`);
      assert.equal(response.status, 200, JSON.stringify(response.data));
      result = response.data as unknown as Summary;
    });
    return result!;
  };

  await t.test('the totals equal the sums of the same month entries, ends included', async () => {
    await reset();
    const ids = await categoryIds();
    await add('2026-10-31', 'expense', 99999, ids['expense/식비']); // the month before
    await add('2026-11-01', 'expense', 30000, ids['expense/식비']);
    await add('2026-11-15', 'expense', 12000, ids['expense/식비']);
    await add('2026-11-20', 'expense', 50000, ids['expense/교통']);
    await add('2026-11-30', 'expense', 8000, null); // 미분류, last day
    await add('2026-11-10', 'income', 3000000, ids['income/급여']);
    await add('2026-11-25', 'income', 50000, null);
    await add('2026-12-01', 'income', 77777, ids['income/급여']); // the month after
    // A hidden category still counts its spending.
    await pool.query('UPDATE ledger_categories SET hidden = true WHERE id = $1', [
      ids['expense/교통'],
    ]);

    const result = await summary('2026-11');
    // The same numbers straight from the entries of November.
    const { rows } = await pool.query<{ kind: string; total: string }>(
      `SELECT kind, sum(amount)::text AS total FROM ledger_entries
       WHERE entry_date BETWEEN '2026-11-01' AND '2026-11-30' GROUP BY kind`,
    );
    const direct = Object.fromEntries(rows.map((row) => [row.kind, Number(row.total)]));
    assert.deepEqual(
      { income: result.income, expense: result.expense, balance: result.balance },
      {
        income: direct.income,
        expense: direct.expense,
        balance: direct.income - direct.expense,
      },
    );
    assert.deepEqual(
      { income: result.income, expense: result.expense, balance: result.balance },
      { income: 3050000, expense: 100000, balance: 2950000 },
    );
    // Largest first; the shares are of the month's expense, rounded half away from zero to one decimal.
    assert.deepEqual(result.categories, [
      { categoryId: ids['expense/교통'], name: '교통', hidden: true, amount: 50000, share: '50.0' },
      {
        categoryId: ids['expense/식비'],
        name: '식비',
        hidden: false,
        amount: 42000,
        share: '42.0',
      },
      { categoryId: null, name: '미분류', hidden: false, amount: 8000, share: '8.0' },
    ]);
    assert.equal(
      result.categories.reduce((sum, category) => sum + category.amount, 0),
      result.expense,
    );
  });

  await t.test('shares round in SQL, and a month without expense has none', async () => {
    await reset();
    const ids = await categoryIds();
    // 1 / 3 and 2 / 3 of the expense: 33.3 and 66.7.
    await add('2026-02-01', 'expense', 1, ids['expense/식비']);
    await add('2026-02-28', 'expense', 2, ids['expense/교통']);
    const february = await summary('2026-02');
    assert.deepEqual(
      february.categories.map((category) => category.share),
      ['66.7', '33.3'],
    );

    // Only zero-won expenses: no division by zero, every share 0.0.
    await add('2026-03-05', 'expense', 0, ids['expense/식비']);
    const march = await summary('2026-03');
    assert.equal(march.expense, 0);
    assert.deepEqual(
      march.categories.map((category) => category.share),
      ['0.0'],
    );

    const empty = await summary('2026-04');
    assert.deepEqual(empty, {
      month: '2026-04',
      income: 0,
      expense: 0,
      balance: 0,
      categories: [],
    });
  });

  await t.test('a month with more spending than income has a negative balance', async () => {
    await reset();
    const ids = await categoryIds();
    await add('2026-05-10', 'income', 1000, ids['income/급여']);
    await add('2026-05-11', 'expense', 2500, ids['expense/식비']);
    const may = await summary('2026-05');
    assert.equal(may.balance, -1500);
  });

  await t.test('the first and last months the API accepts are answered', async () => {
    await reset();
    assert.equal((await summary('1900-01')).expense, 0);
    assert.equal((await summary('2100-12')).expense, 0);
  });
});
