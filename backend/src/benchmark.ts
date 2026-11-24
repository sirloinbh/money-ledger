import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { won } from './money.js';
import { HttpError, parseId, serviceTimeZone } from './standard/http.js';

// #294 Time-weighted return of a mock account (user decision 2026-11-24: deposits are not counted as gains).
// The account's value is known once a day (mock_snapshots, #54), plus its initial cash the day before it started.
// Between two known days the return is (value now - cash flows in between) / value before; the period return is the
// product of those, minus 1. A flow dated in (previous day, this day] is taken out of this day's step, so it is
// counted as money added, not earned. All of it runs in SQL `numeric`, rounded half away from zero to 2 places.
//
// The benchmarks (user decision 2026-11-24) are measured over the same days as the account return, from its start day
// to its end day: a deposit at the Bank of Korea base rate in effect on each day (compounded daily as the rate
// changes), and two fixed yearly rates, (1 + rate) ^ (days / 365) - 1.

const date = z
  .string({ error: 'The date is not valid' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'The date must be YYYY-MM-DD')
  .refine(
    (value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
    },
    { error: 'The date does not exist' },
  );

export const returnQuery = z
  .object({ from: date.optional(), to: date.optional() })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    error: 'The start date cannot be after the end date',
    path: ['from'],
  });

type ReturnRow = {
  start_date: string | null;
  end_date: string | null;
  start_value: string | null;
  end_value: string | null;
  net_flow: string | null;
  steps: string;
  twr_pct: string | null;
};

/**
 * The time-weighted return from `from` (default: the account's start) to `to` (default: `today`). The period
 * starts at the last known value on or before `from`, and ends at the last known value on or before `to`.
 * `returnPct` is null when the period holds no day after its start.
 */
export async function accountReturn(
  pool: Pool,
  accountId: number,
  today: string,
  range: { from?: string; to?: string } = {},
) {
  const { rows: found } = await pool.query<{ id: number }>(
    'SELECT id FROM mock_accounts WHERE id = $1',
    [accountId],
  );
  if (!found[0]) throw new HttpError(404, 'Mock trading account not found');
  const { rows } = await pool.query<ReturnRow>(
    `WITH acct AS (
       SELECT id, initial_cash_krw,
              (created_at AT TIME ZONE '${serviceTimeZone}')::date - 1 AS first_day
       FROM mock_accounts WHERE id = $1
     ),
     pts AS (
       SELECT first_day AS d, initial_cash_krw::numeric AS v FROM acct
       UNION ALL
       SELECT s.snapshot_date, s.total_krw::numeric
       FROM mock_snapshots s JOIN acct ON s.account_id = acct.id
       WHERE s.snapshot_date > acct.first_day
     ),
     base AS (
       SELECT d, v FROM pts
       WHERE d <= GREATEST(COALESCE($2::date, (SELECT first_day FROM acct)), (SELECT first_day FROM acct))
       ORDER BY d DESC LIMIT 1
     ),
     win AS (
       SELECT pts.d, pts.v FROM pts, base WHERE pts.d >= base.d AND pts.d <= $3::date
     ),
     steps AS (
       SELECT d, v, lag(d) OVER (ORDER BY d) AS prev_d, lag(v) OVER (ORDER BY d) AS prev_v FROM win
     ),
     flowed AS (
       SELECT steps.*,
              (SELECT COALESCE(sum(f.amount_krw), 0) FROM mock_cash_flows f
               WHERE f.account_id = $1 AND f.flow_date > steps.prev_d AND f.flow_date <= steps.d)::numeric AS flow
       FROM steps WHERE prev_d IS NOT NULL
     )
     SELECT (SELECT d::text FROM base) AS start_date,
            (SELECT max(d)::text FROM win) AS end_date,
            (SELECT v::text FROM base) AS start_value,
            (SELECT v::text FROM win ORDER BY d DESC LIMIT 1) AS end_value,
            (SELECT COALESCE(sum(flow), 0)::text FROM flowed) AS net_flow,
            (SELECT count(*)::text FROM flowed) AS steps,
            (SELECT round((exp(sum(ln(GREATEST((v - flow) / prev_v, 0.000000001)))) - 1) * 100, 2)::text
             FROM flowed WHERE prev_v > 0) AS twr_pct`,
    [accountId, range.from ?? null, range.to && range.to < today ? range.to : today],
  );
  const row = rows[0];
  const steps = Number(row.steps);
  return {
    // The days the figures belong to. The start can be the day before the account began (its initial cash).
    startDate: row.start_date,
    endDate: row.end_date,
    startValueKrw: row.start_value === null ? null : won(row.start_value),
    endValueKrw: row.end_value === null ? null : won(row.end_value),
    netCashFlowKrw: won(row.net_flow ?? '0'),
    days: steps,
    returnPct: steps === 0 ? null : row.twr_pct,
  };
}

/** The fixed yearly rates in one place: percent a year, compounded as (1 + rate) ^ (days / 365). */
const fixedBenchmarks = [
  { id: 'buffett', name: 'Warren Buffett', annualPct: '20' },
  { id: 'renaissance', name: 'Renaissance fund', annualPct: '66' },
] as const;

type Benchmark = {
  id: 'deposit' | (typeof fixedBenchmarks)[number]['id'];
  name: string;
  /** The yearly rate: the base rate on the end day for the deposit (null while no rate is stored). */
  annualPct: string | null;
  /** The return over the account's period, null when the period or the rate is not known. */
  returnPct: string | null;
};

/**
 * What the same money would have earned over the days from `startDate` to `endDate` (YYYY-MM-DD), or all nulls when
 * the period is unknown. The deposit needs a base rate on or before the start day; without one it is null.
 */
export async function benchmarkReturns(
  pool: Pool,
  startDate: string | null,
  endDate: string | null,
): Promise<Benchmark[]> {
  const known = startDate !== null && endDate !== null && endDate > startDate;
  const deposit: Benchmark = {
    id: 'deposit',
    name: 'Deposit at the Bank of Korea base rate',
    annualPct: null,
    returnPct: null,
  };
  if (!known) {
    return [deposit, ...fixedBenchmarks.map((item) => ({ ...item, returnPct: null }))];
  }
  const { rows } = await pool.query<{ deposit_pct: string | null; rate_pct: string | null }>(
    `WITH days AS (
       SELECT d::date AS d FROM generate_series($1::date + 1, $2::date, interval '1 day') AS g(d)
     ),
     rated AS (
       SELECT days.d,
              (SELECT b.rate_pct FROM base_rates b WHERE b.effective_date <= days.d
               ORDER BY b.effective_date DESC LIMIT 1) AS rate
       FROM days
     )
     SELECT CASE WHEN count(*) = count(rate)
                 THEN round((exp(sum(ln(1 + rate / 36500))) - 1) * 100, 2)::text END AS deposit_pct,
            (SELECT b.rate_pct::text FROM base_rates b WHERE b.effective_date <= $2::date
             ORDER BY b.effective_date DESC LIMIT 1) AS rate_pct
     FROM rated`,
    [startDate, endDate],
  );
  deposit.returnPct = rows[0].deposit_pct;
  deposit.annualPct = rows[0].rate_pct;
  const fixed: Benchmark[] = [];
  for (const item of fixedBenchmarks) {
    const result = await pool.query<{ pct: string }>(
      `SELECT round((power(1 + $1::numeric / 100, ($3::date - $2::date)::numeric / 365) - 1) * 100, 2)::text AS pct`,
      [item.annualPct, startDate, endDate],
    );
    fixed.push({ ...item, returnPct: result.rows[0].pct });
  }
  return [deposit, ...fixed];
}

export function benchmarkRouter(pool: Pool, today: () => string) {
  const router = Router({ mergeParams: true });
  router.get('/', async (req, res) => {
    const accountId = parseId((req.params as { accountId?: string }).accountId, 'mock account');
    const query = returnQuery.parse(req.query);
    const account = await accountReturn(pool, accountId, today(), query);
    // The benchmarks cover the same days, so the three numbers can be read side by side.
    res.json({
      account,
      benchmarks: await benchmarkReturns(pool, account.startDate, account.endDate),
    });
  });
  return router;
}
