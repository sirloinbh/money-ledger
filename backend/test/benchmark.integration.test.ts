import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

// #294 Time-weighted return of a mock account. #184: this file's own copy of the test DB (skipped without one).
const url = await testDatabase();

type Return = {
  startDate: string | null;
  endDate: string | null;
  startValueKrw: number | null;
  endValueKrw: number | null;
  netCashFlowKrw: number;
  days: number;
  returnPct: string | null;
};

type Benchmark = { id: string; name: string; annualPct: string | null; returnPct: string | null };

test('time-weighted account return against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  // The account starts on 2026-11-02 (KST) with ₩10,000,000, so its first known value is dated 2026-11-01.
  const seed = async (
    snapshots: [string, number][],
    flows: [string, number][] = [],
  ): Promise<number> => {
    await pool.query(
      'TRUNCATE mock_cash_flows, mock_snapshots, mock_holdings, mock_orders, mock_accounts RESTART IDENTITY CASCADE',
    );
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO mock_accounts (initial_cash_krw, cash_krw, created_at)
       VALUES (10000000, 10000000, '2026-11-02T01:00:00Z') RETURNING id`,
    );
    const id = rows[0].id;
    for (const [date, total] of snapshots) {
      await pool.query(
        `INSERT INTO mock_snapshots (account_id, snapshot_date, cash_krw, value_krw, total_krw, profit_krw, return_pct)
         VALUES ($1, $2, $3, 0, $3, 0, 0)`,
        [id, date, total],
      );
    }
    for (const [date, amount] of flows) {
      await pool.query(
        'INSERT INTO mock_cash_flows (account_id, flow_date, amount_krw) VALUES ($1, $2, $3)',
        [id, date, amount],
      );
    }
    return id;
  };
  const get = async (id: number, query = '') => {
    let result: Return | undefined;
    let benchmarks: Benchmark[] = [];
    let status = 0;
    await withApi(pool, async (call) => {
      const response = await call(`/api/mock/accounts/${id}/return${query}`);
      status = response.status;
      result = response.data.account as Return | undefined;
      benchmarks = (response.data.benchmarks ?? []) as Benchmark[];
    });
    return { status, result, benchmarks };
  };

  await t.test('is empty until a day after the start is saved', async () => {
    const id = await seed([]);
    const { status, result } = await get(id);
    assert.equal(status, 200);
    assert.equal(result?.returnPct, null);
    assert.equal(result?.days, 0);
    assert.equal(result?.startValueKrw, 10_000_000);
  });

  await t.test('chains the daily returns: +5% then +10% is +15.50%', async () => {
    const id = await seed([
      ['2026-11-02', 10_500_000],
      ['2026-11-03', 11_550_000],
    ]);
    const { result } = await get(id);
    assert.deepEqual(result, {
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      startValueKrw: 10_000_000,
      endValueKrw: 11_550_000,
      netCashFlowKrw: 0,
      days: 2,
      returnPct: '15.50',
    });
  });

  await t.test('a deposit is not counted as a gain', async () => {
    // Day 3 ends at ₩11,550,000; ₩5,000,000 is added on day 4, and the money already there grows 2%.
    const id = await seed(
      [
        ['2026-11-02', 10_500_000],
        ['2026-11-03', 11_550_000],
        ['2026-11-04', 16_781_000],
      ],
      [['2026-11-04', 5_000_000]],
    );
    const { result } = await get(id);
    assert.equal(result?.returnPct, '17.81'); // 1.05 × 1.10 × 1.02 − 1; the plain gain would read 67.81%
    assert.equal(result?.netCashFlowKrw, 5_000_000);
    assert.equal(result?.endValueKrw, 16_781_000);
  });

  await t.test('a withdrawal is not counted as a loss', async () => {
    // ₩2,000,000 leaves on day 2 and the account ends at ₩9,000,000: (9,000,000 + 2,000,000) / 10,000,000 = 1.10.
    const id = await seed([['2026-11-02', 9_000_000]], [['2026-11-02', -2_000_000]]);
    assert.equal((await get(id)).result?.returnPct, '10.00');
  });

  await t.test('a period starts at the last value on or before its start', async () => {
    const id = await seed([
      ['2026-11-02', 10_500_000],
      ['2026-11-03', 11_550_000],
      ['2026-11-04', 11_781_000],
    ]);
    // From the 3rd: 11,781,000 / 11,550,000 = +2.00%.
    const from3 = await get(id, '?from=2026-11-03');
    assert.equal(from3.result?.startDate, '2026-11-03');
    assert.equal(from3.result?.returnPct, '2.00');
    // Nothing after the start inside the period: no return yet.
    assert.equal((await get(id, '?from=2026-11-03&to=2026-11-03')).result?.returnPct, null);
    // An end date cuts the period short.
    assert.equal((await get(id, '?to=2026-11-02')).result?.returnPct, '5.00');
    // A start before the account began still starts at its initial cash.
    assert.equal((await get(id, '?from=2026-01-01')).result?.startDate, '2026-11-01');
  });

  await t.test('rounds half away from zero and handles a loss', async () => {
    // 10,000,000 → 9,999,500 is exactly −0.005%, which rounds to −0.01 (half away from zero).
    const half = await seed([['2026-11-02', 9_999_500]]);
    assert.equal((await get(half)).result?.returnPct, '-0.01');
    const loss = await seed([['2026-11-02', 7_000_000]]);
    assert.equal((await get(loss)).result?.returnPct, '-30.00');
  });

  await t.test('rejects a missing account and bad dates', async () => {
    const id = await seed([]);
    assert.equal((await get(id + 99)).status, 404);
    assert.equal((await get(id, '?from=2026-13-01')).status, 400);
    assert.equal((await get(id, '?from=2026-11-05&to=2026-11-01')).status, 400);
  });

  await t.test(
    'the benchmarks cover the same days: deposit at a changing base rate, 20% and 66% a year',
    async () => {
      // An account that started on 2025-01-02 (first value 2025-01-01) and was last valued on 2025-12-31: 364 days.
      await pool.query('TRUNCATE base_rates');
      await pool.query(
        `INSERT INTO base_rates (effective_date, rate_pct, source, fetched_at) VALUES
         ('2024-01-01', 2.5, 'TEST', now()), ('2025-07-01', 3.5, 'TEST', now())`,
      );
      const id = await seed([['2025-12-31', 11_000_000]]);
      await pool.query(
        "UPDATE mock_accounts SET created_at = '2025-01-02T01:00:00Z' WHERE id = $1",
        [id],
      );
      const { result, benchmarks } = await get(id, '?from=2025-01-01&to=2025-12-31');
      assert.equal(result?.startDate, '2025-01-01');
      assert.equal(result?.endDate, '2025-12-31');
      assert.equal(result?.returnPct, '10.00');
      // 180 days at 2.5% then 184 days at 3.5%, compounded daily: (1 + 2.5/36500)^180 × (1 + 3.5/36500)^184 − 1.
      // The fixed rates: 1.2^(364/365) − 1 and 1.66^(364/365) − 1.
      assert.deepEqual(
        benchmarks.map(({ id: key, annualPct, returnPct }) => ({ key, annualPct, returnPct })),
        [
          { key: 'deposit', annualPct: '3.5000', returnPct: '3.04' },
          { key: 'buffett', annualPct: '20', returnPct: '19.94' },
          { key: 'renaissance', annualPct: '66', returnPct: '65.77' },
        ],
      );
    },
  );

  await t.test(
    'the deposit is unknown without a base rate on the start day; fixed rates still show',
    async () => {
      await pool.query('TRUNCATE base_rates');
      await pool.query(
        "INSERT INTO base_rates (effective_date, rate_pct, source, fetched_at) VALUES ('2026-06-01', 3, 'TEST', now())",
      );
      const id = await seed([['2026-11-02', 10_500_000]]); // the period starts on 2026-11-01
      const early = await get(id);
      assert.equal(early.benchmarks[0].returnPct !== null, true); // 2026-06-01 is before the start: known
      await pool.query('TRUNCATE base_rates');
      const none = await get(id);
      assert.equal(none.benchmarks[0].returnPct, null);
      assert.equal(none.benchmarks[0].annualPct, null);
      assert.notEqual(none.benchmarks[1].returnPct, null);
    },
  );

  await t.test('without a later day there is no period, so every benchmark is null', async () => {
    const id = await seed([]);
    const { benchmarks } = await get(id);
    assert.deepEqual(
      benchmarks.map((item) => item.returnPct),
      [null, null, null],
    );
  });
});
