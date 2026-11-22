import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { DAILY_SAVES_QUEUE, dailySavesQueue } from '../src/daily-saves.js';
import { runMigration } from './helpers.js';
import { testDatabase } from './test-database.js';

// #184 This file's own copy of the test DB (undefined without TEST_DATABASE_URL: the DB tests are skipped).
const url = await testDatabase();
const info = { id: 'job-1', queue: DAILY_SAVES_QUEUE, attempt: 1, requestId: null };

// #185 The daily job's real steps against the test DB (all migrations applied). Skipped (not passed) without it.
test('the daily saves job against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  await pool.query('TRUNCATE ledger_categories RESTART IDENTITY CASCADE');
  await pool.query('DROP TABLE IF EXISTS spending_reports, spending_report_changes');
  // The asset tables as the net worth test makes them (other tests drop some of them).
  await pool.query(
    `DROP TABLE IF EXISTS net_worth_snapshots, portfolio_trades, portfolio_prepaid_usages, portfolio_assets,
       mock_snapshots, mock_orders, mock_holdings, mock_accounts, security_prices, fx_rates, price_fetch_state,
       price_api_calls, krx_market_days, securities`,
  );
  for (const file of [
    '004_portfolio_assets.sql',
    '005_mock_accounts.sql',
    '007_depreciable_assets.sql',
    '010_prepaid_assets.sql',
    '013_asset_trades.sql',
    '009_prices.sql',
    '012_krx_listing.sql',
    '024_price_fetch_not_found.sql',
    '015_mock_orders.sql',
    '016_asset_valuation.sql',
    '018_mock_snapshots.sql',
    '019_net_worth_snapshots.sql',
    '025_prepaid_usage_balance.sql',
    '002_ledger_categories.sql',
    '020_ledger_fixed_costs.sql',
    '021_spending_reports.sql',
    '026_spending_report_changes.sql',
  ]) {
    await runMigration(pool, file);
  }
  const { rows: categories } = await pool.query<{ id: string }>(
    `SELECT id FROM ledger_categories WHERE kind = 'expense' ORDER BY id LIMIT 1`,
  );
  // Spending in October, a fixed cost due on the 1st of each month from November, and a bank account.
  await pool.query(
    `INSERT INTO ledger_entries (entry_date, kind, amount, category_id, memo)
     VALUES ('2026-10-15', 'expense', 30000, $1, 'Lunch')`,
    [categories[0].id],
  );
  await pool.query(
    `INSERT INTO ledger_fixed_costs (name, category_id, amount, day_of_month, start_month)
     VALUES ('Rent', $1, 500000, 1, '2026-11-01')`,
    [categories[0].id],
  );
  await pool.query(
    `INSERT INTO portfolio_assets (name, asset_type, currency, value_krw) VALUES ('Bank account', 'cash', 'KRW', 2000000)`,
  );

  // Sunday 2026-11-08 in Seoul: the week of Nov 1-7 and the month of October have ended.
  const queue = dailySavesQueue(
    pool,
    () => '2026-11-08',
    undefined,
    () => undefined,
  );
  await queue.handler({}, info);
  // Running again (the 19:05 run, a retry, or the app opening) adds nothing twice.
  await queue.handler({}, info);

  const entries = await pool.query<{ entry_date: string; amount: string }>(
    `SELECT to_char(entry_date, 'YYYY-MM-DD') AS entry_date, amount::text FROM ledger_entries
     ORDER BY entry_date`,
  );
  assert.deepEqual(entries.rows, [
    { entry_date: '2026-10-15', amount: '30000' },
    { entry_date: '2026-11-01', amount: '500000' },
  ]);

  const reports = await pool.query<{ period: string; start: string; total: string }>(
    `SELECT period, to_char(start_date, 'YYYY-MM-DD') AS start, content->>'total' AS total
     FROM spending_reports ORDER BY period, start_date`,
  );
  // The week's report already counts the fixed cost added before it.
  assert.deepEqual(reports.rows, [
    { period: 'month', start: '2026-10-01', total: '30000' },
    { period: 'week', start: '2026-11-01', total: '500000' },
  ]);

  const snapshots = await pool.query<{ day: string; net: string }>(
    `SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS day, net_krw::text AS net FROM net_worth_snapshots`,
  );
  assert.deepEqual(snapshots.rows, [{ day: '2026-11-08', net: '2000000' }]);
});
