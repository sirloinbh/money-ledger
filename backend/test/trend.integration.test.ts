import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

type Trend = {
  from: string;
  to: string;
  months: { month: string; income: number; expense: number; balance: number }[];
};

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('monthly trend against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async () => {
    await pool.query('TRUNCATE ledger_categories RESTART IDENTITY CASCADE');
    await runMigration(pool, '002_ledger_categories.sql');
  };
  const add = (date: string, kind: string, amount: number) =>
    pool.query('INSERT INTO ledger_entries (entry_date, kind, amount) VALUES ($1, $2, $3)', [
      date,
      kind,
      amount,
    ]);
  const trend = async (db: Pool, from: string, to: string) => {
    let result: Trend | undefined;
    await withApi(db, async (call) => {
      const response = await call(`/api/ledger/trend?from=${from}&to=${to}`);
      assert.equal(response.status, 200, JSON.stringify(response.data));
      result = response.data as unknown as Trend;
    });
    return result!;
  };

  await t.test(
    'every month of the period, empty ones as 0, each equal to its own entries',
    async () => {
      await reset();
      await add('2026-07-31', 'expense', 99999); // before the period
      await add('2026-08-01', 'income', 3000000);
      await add('2026-08-01', 'expense', 10000);
      await add('2026-08-31', 'expense', 20000);
      // September has no entries.
      await add('2026-10-15', 'expense', 900000); // a month that spends more than it earns
      await add('2026-11-30', 'income', 50000);
      await add('2026-12-01', 'income', 77777); // after the period

      const result = await trend(pool, '2026-08', '2026-11');
      assert.equal(result.from, '2026-08');
      assert.equal(result.to, '2026-11');
      assert.deepEqual(result.months, [
        { month: '2026-08', income: 3000000, expense: 30000, balance: 2970000 },
        { month: '2026-09', income: 0, expense: 0, balance: 0 },
        { month: '2026-10', income: 0, expense: 900000, balance: -900000 },
        { month: '2026-11', income: 50000, expense: 0, balance: 50000 },
      ]);

      // The same numbers straight from the entries, month by month.
      const { rows } = await pool.query<{ month: string; kind: string; total: string }>(
        `SELECT to_char(entry_date, 'YYYY-MM') AS month, kind, sum(amount)::text AS total
       FROM ledger_entries WHERE entry_date BETWEEN '2026-08-01' AND '2026-11-30' GROUP BY 1, 2`,
      );
      for (const row of rows) {
        const month = result.months.find((item) => item.month === row.month)!;
        assert.equal(month[row.kind as 'income' | 'expense'], Number(row.total));
      }
    },
  );

  await t.test('a period across the year, and a single month', async () => {
    await reset();
    await add('2025-12-31', 'expense', 1000);
    await add('2026-01-01', 'expense', 2000);
    const across = await trend(pool, '2025-11', '2026-02');
    assert.deepEqual(
      across.months.map((item) => [item.month, item.expense]),
      [
        ['2025-11', 0],
        ['2025-12', 1000],
        ['2026-01', 2000],
        ['2026-02', 0],
      ],
    );
    const single = await trend(pool, '2026-01', '2026-01');
    assert.deepEqual(single.months, [
      { month: '2026-01', income: 0, expense: 2000, balance: -2000 },
    ]);
  });

  await t.test('24 months, and the 1900 and 2100 ends', async () => {
    await reset();
    assert.equal((await trend(pool, '2024-12', '2026-11')).months.length, 24);
    await add('1900-01-01', 'income', 5);
    await add('2100-12-31', 'expense', 7);
    assert.deepEqual((await trend(pool, '1900-01', '1900-01')).months[0].income, 5);
    assert.deepEqual((await trend(pool, '2100-12', '2100-12')).months[0].expense, 7);
  });

  // Month ends are Seoul dates: entry_date holds the date in Asia/Seoul, so a session in another time zone must
  // not move an entry on the 1st or the last day into the next or previous month.
  for (const zone of ['Asia/Seoul', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    await t.test(
      `month ends stay in their Seoul month with the DB session in ${zone}`,
      async () => {
        await reset();
        await add('2026-10-31', 'expense', 1);
        await add('2026-11-01', 'expense', 10);
        await add('2026-11-30', 'expense', 100);
        await add('2026-12-01', 'expense', 1000);
        const zoned = new Pool({ connectionString: url, options: `-c TimeZone=${zone}` });
        try {
          const result = await trend(zoned, '2026-10', '2026-12');
          assert.deepEqual(
            result.months.map((item) => [item.month, item.expense]),
            [
              ['2026-10', 1],
              ['2026-11', 110],
              ['2026-12', 1000],
            ],
          );
        } finally {
          await zoned.end();
        }
      },
    );
  }
});
