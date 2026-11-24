import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { comparisonFor } from '../src/kakao/comparison.js';
import { sendDailySummary } from '../src/kakao/daily-summary.js';
import { fakeMessenger } from '../src/kakao/fake.js';
import { createNotifier } from '../src/kakao/notifier.js';
import { testDatabase } from './test-database.js';

const url = await testDatabase();

test('the daily summary comparison against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  // The account starts on 2026-11-02 with ₩10,000,000, so its first known value is dated 2026-11-01.
  const seed = async (snapshots: [string, number][]) => {
    await pool.query(
      'TRUNCATE mock_cash_flows, mock_snapshots, mock_holdings, mock_orders, mock_accounts RESTART IDENTITY CASCADE',
    );
    await pool.query('DELETE FROM base_rates');
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO mock_accounts (initial_cash_krw, cash_krw, created_at)
       VALUES (10000000, 10000000, '2026-11-02T01:00:00Z') RETURNING id`,
    );
    for (const [date, total] of snapshots) {
      await pool.query(
        `INSERT INTO mock_snapshots (account_id, snapshot_date, cash_krw, value_krw, total_krw, profit_krw, return_pct)
         VALUES ($1, $2, $3, 0, $3, 0, 0)`,
        [rows[0].id, date, total],
      );
    }
    return rows[0].id;
  };
  const rate = (date: string, pct: string) =>
    pool.query(
      "INSERT INTO base_rates (effective_date, rate_pct, source, fetched_at) VALUES ($1, $2, 'test', now())",
      [date, pct],
    );

  await t.test('the three benchmarks cover the account’s own period', async () => {
    const id = await seed([
      ['2026-11-01', 10_000_000],
      ['2026-11-15', 10_420_000],
    ]);
    await rate('2026-01-01', '2.5');
    // 14 days from 2026-11-01 to 2026-11-15. By hand: Buffett 1.2^(14/365) - 1 = 0.70%, Renaissance
    // 1.66^(14/365) - 1 = 1.96%, deposit about 14 x 2.5 / 365 = 0.096%, which rounds to 0.10%.
    assert.deepEqual(await comparisonFor(pool, id, '2026-11-24'), {
      depositPct: '0.10',
      buffettPct: '0.70',
      renaissancePct: '1.96',
    });
  });

  await t.test('without a stored base rate only the deposit is unknown', async () => {
    const id = await seed([
      ['2026-11-01', 10_000_000],
      ['2026-11-15', 10_420_000],
    ]);
    assert.deepEqual(await comparisonFor(pool, id, '2026-11-24'), {
      depositPct: null,
      buffettPct: '0.70',
      renaissancePct: '1.96',
    });
  });

  await t.test('an account with no day after its start has no comparison', async () => {
    const id = await seed([['2026-11-01', 10_000_000]]);
    assert.equal(await comparisonFor(pool, id, '2026-11-24'), undefined);
  });

  await t.test(
    'the daily summary carries the comparison, with n/a for an unknown figure',
    async () => {
      await seed([
        ['2026-11-01', 10_000_000],
        ['2026-11-15', 10_420_000],
      ]);
      const messenger = fakeMessenger();
      const notifier = createNotifier(messenger, {
        link: 'https://app',
        log: () => undefined,
        retryDelayMs: 0,
      });
      await sendDailySummary(pool, notifier, '2026-11-24', {
        connected: () => Promise.resolve(true),
        comparison: (accountId, day) => comparisonFor(pool, accountId, day),
        log: () => undefined,
      });
      assert.match(
        String(messenger.sent[0].text),
        /\nDeposit n\/a · Buffett \+0\.70% · Renaissance \+1\.96%$/,
      );
    },
  );
});
