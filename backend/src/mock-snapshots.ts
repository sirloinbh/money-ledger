import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';

import { accountValue, won } from './mock-holdings.js';
import { HttpError, parseId, serviceDate, serviceTimeZone } from './standard/http.js';

// #54 Daily value of the mock account, for the return chart (decisions 2026-11-10, issue comment):
// - One row per account and KST day, saved when the daily price fetch finishes and when an order fills. A later
//   save on the same day replaces the row, so a day keeps its last value.
// - Values are the holdings summary of #53 at that moment; they are never recomputed when prices change later.
// - Nothing is filled in for days before snapshots existed: the chart starts at 0% on the account's start day.
// - Only the open account is shown; rows of closed accounts are kept.

/**
 * Saves what the account is worth now as its value for `date`. Skipped (false) when a holding has no close or
 * rate, so no day gets a wrong total.
 */
export async function saveSnapshot(
  db: Pool | PoolClient,
  accountId: number,
  date: string,
  today: string,
) {
  const value = await accountValue(db, accountId, today);
  const { summary } = value ?? {};
  if (!summary || summary.valueKrw === null || summary.returnPct === null) return false;
  await db.query(
    `INSERT INTO mock_snapshots (account_id, snapshot_date, cash_krw, value_krw, total_krw, profit_krw, return_pct)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (account_id, snapshot_date) DO UPDATE SET
       cash_krw = EXCLUDED.cash_krw, value_krw = EXCLUDED.value_krw, total_krw = EXCLUDED.total_krw,
       profit_krw = EXCLUDED.profit_krw, return_pct = EXCLUDED.return_pct, saved_at = now()`,
    [
      accountId,
      date,
      summary.cashKrw,
      summary.valueKrw,
      summary.totalKrw,
      summary.profitKrw,
      summary.returnPct,
    ],
  );
  return true;
}

/** After the daily price fetch: the open account's value for today. */
export async function snapshotOpenAccount(pool: Pool, now: Date) {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM mock_accounts WHERE closed_at IS NULL',
  );
  const today = serviceDate(now);
  for (const row of rows) await saveSnapshot(pool, Number(row.id), today, today);
}

type SnapshotRow = {
  snapshot_date: string;
  total_krw: string;
  profit_krw: string;
  return_pct: string;
};

export function mockSnapshotsRouter(pool: Pool) {
  const router = Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    const accountId = parseId((req.params as { accountId?: string }).accountId, '모의투자 계좌');
    const account = await pool.query<{ start_date: string; initial_cash_krw: string }>(
      `SELECT (created_at AT TIME ZONE '${serviceTimeZone}')::date::text AS start_date, initial_cash_krw
       FROM mock_accounts WHERE id = $1`,
      [accountId],
    );
    const found = account.rows[0];
    if (!found) throw new HttpError(404, '모의투자 계좌를 찾을 수 없습니다');
    // One row a day, so even years of them are a small answer; the screen picks the period.
    const { rows } = await pool.query<SnapshotRow>(
      `SELECT snapshot_date, total_krw, profit_krw, return_pct FROM mock_snapshots
       WHERE account_id = $1 ORDER BY snapshot_date`,
      [accountId],
    );
    res.json({
      startDate: found.start_date,
      initialCashKrw: Number(found.initial_cash_krw),
      snapshots: rows.map((row) => ({
        date: row.snapshot_date,
        totalKrw: won(row.total_krw),
        profitKrw: won(row.profit_krw),
        returnPct: row.return_pct,
      })),
    });
  });

  return router;
}
