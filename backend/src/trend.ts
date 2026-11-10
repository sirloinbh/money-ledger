import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { monthField, won } from './month.js';

// #41 Income, expense and balance for each month of a period, oldest first. A month without entries is a row of
// zeros, so the trend has no gaps. Sums are computed in SQL (numeric), never with JavaScript floats.

const maxTrendMonths = 24;

/** Months from `from` to `to`, both included: 2026-01..2026-12 is 12. */
const monthCount = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
  Number(to.slice(5)) -
  Number(from.slice(5)) +
  1;

const trendQuery = z
  .object({ from: monthField('시작 월'), to: monthField('끝 월') })
  .refine(({ from, to }) => from <= to, { error: '시작 월이 끝 월보다 늦습니다' })
  .refine(({ from, to }) => monthCount(from, to) <= maxTrendMonths, {
    error: `기간은 ${maxTrendMonths}개월까지 볼 수 있습니다`,
  });

type Row = { month: string; income: string; expense: string; balance: string };

// entry_date is already the date in Seoul (a plain date, no time zone), so its month is taken as text with
// to_char. Every month of the period comes from generate_series and gets 0 when it has no entries; that series
// is of timestamps in the session time zone, but to_char reads each one back in the same zone, so the months
// do not move (tested with sessions in Seoul, UTC, Los Angeles and +14).
const trendSql = `
  WITH months AS (
    SELECT to_char(m, 'YYYY-MM') AS month
    FROM generate_series($1::date, $2::date, interval '1 month') AS m
  ),
  sums AS (
    SELECT to_char(e.entry_date, 'YYYY-MM') AS month,
           sum(e.amount) FILTER (WHERE e.kind = 'income') AS income,
           sum(e.amount) FILTER (WHERE e.kind = 'expense') AS expense
    FROM ledger_entries e
    WHERE e.entry_date >= $1::date AND e.entry_date < ($2::date + interval '1 month')
    GROUP BY 1
  )
  SELECT months.month, coalesce(s.income, 0)::text AS income, coalesce(s.expense, 0)::text AS expense,
         (coalesce(s.income, 0) - coalesce(s.expense, 0))::text AS balance
  FROM months LEFT JOIN sums s USING (month)
  ORDER BY months.month`;

export function trendRouter(pool: Pool) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { from, to } = trendQuery.parse(req.query);
    const { rows } = await pool.query<Row>(trendSql, [`${from}-01`, `${to}-01`]);
    res.json({
      from,
      to,
      months: rows.map((row) => ({
        month: row.month,
        income: won(row.income),
        expense: won(row.expense),
        balance: won(row.balance),
      })),
    });
  });

  return router;
}
