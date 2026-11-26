import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

// #359 This file's own copy of the test DB (undefined without TEST_DATABASE_URL: the DB tests are skipped).
const url = await testDatabase();

type Periods = {
  unit: string;
  periods: { start: string; end: string; income: number; expense: number; balance: number }[];
};

test('day and week totals against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  await pool.query('TRUNCATE ledger_categories RESTART IDENTITY CASCADE');
  await runMigration(pool, '002_ledger_categories.sql');
  const add = (date: string, kind: string, amount: number) =>
    pool.query('INSERT INTO ledger_entries (entry_date, kind, amount) VALUES ($1, $2, $3)', [
      date,
      kind,
      amount,
    ]);
  const periods = async (query: string) => {
    let result: Periods | undefined;
    await withApi(pool, async (call) => {
      const response = await call(`/api/ledger/periods?${query}`);
      assert.equal(response.status, 200, JSON.stringify(response.data));
      result = response.data as unknown as Periods;
    });
    return result!;
  };

  await add('2026-11-21', 'expense', 9999); // the Saturday before the week
  await add('2026-11-22', 'income', 3000000); // Sunday
  await add('2026-11-22', 'expense', 10000);
  await add('2026-11-24', 'expense', 20000);
  await add('2026-11-28', 'expense', 5000); // Saturday
  await add('2026-11-29', 'income', 777); // the Sunday after

  await t.test('seven days, empty days as 0', async () => {
    const result = await periods('from=2026-11-22&unit=day&count=7');
    assert.equal(result.periods.length, 7);
    assert.deepEqual(
      result.periods.map((row) => row.start),
      [
        '2026-11-22',
        '2026-11-23',
        '2026-11-24',
        '2026-11-25',
        '2026-11-26',
        '2026-11-27',
        '2026-11-28',
      ],
    );
    assert.deepEqual(result.periods[0], {
      start: '2026-11-22',
      end: '2026-11-22',
      income: 3000000,
      expense: 10000,
      balance: 2990000,
    });
    assert.deepEqual(result.periods[1], {
      start: '2026-11-23',
      end: '2026-11-23',
      income: 0,
      expense: 0,
      balance: 0,
    });
    assert.equal(result.periods[6].expense, 5000);
  });

  await t.test('weeks start on Sunday, whatever day `from` is', async () => {
    const result = await periods('from=2026-11-25&unit=week&count=2');
    assert.deepEqual(result.periods, [
      { start: '2026-11-22', end: '2026-11-28', income: 3000000, expense: 35000, balance: 2965000 },
      { start: '2026-11-29', end: '2026-12-05', income: 777, expense: 0, balance: 777 },
    ]);
  });
});
