import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { won } from '../money.js';

// #359 Income, expense and balance for each day or each week of a range, oldest first. The Week page shows
// 7 days, the 12 weeks page 12 weeks. A week is Sunday to Saturday (as the reports, #62). A day or week
// without entries is a row of zeros. Sums are computed in SQL (numeric), never with JavaScript floats.

const maxCount = { day: 31, week: 26 } as const;

const dateField = z
  .string({ error: 'Enter the start date as YYYY-MM-DD' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Enter the start date as YYYY-MM-DD', abort: true })
  .refine(
    (value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      const year = Number(value.slice(0, 4));
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value &&
        year >= 1900 &&
        year <= 2100
      );
    },
    { error: 'Enter a real start date between 1900 and 2100' },
  );

export const periodsQuery = z
  .object({
    from: dateField,
    unit: z.enum(['day', 'week'], { error: 'Choose the unit: day or week' }),
    count: z
      .string({ error: 'Enter the count as a whole number' })
      .regex(/^[1-9]\d{0,2}$/, { error: 'Enter the count as a whole number' })
      .transform(Number),
  })
  .refine(({ unit, count }) => count <= maxCount[unit], {
    error: `The range can be at most ${maxCount.day} days or ${maxCount.week} weeks`,
  });

type Row = { start: string; end: string; income: string; expense: string; balance: string };

// For a week, `from` is moved back to the Sunday that starts its week. entry_date is already the date in Seoul
// (a plain date), so ranges and text formats do not depend on the session time zone.
const periodsSql = `
  WITH params AS (
    SELECT CASE WHEN $2 = 'week' THEN $1::date - extract(dow FROM $1::date)::int ELSE $1::date END AS first,
           CASE WHEN $2 = 'week' THEN 7 ELSE 1 END AS length
  ),
  slots AS (
    SELECT (first + (n * length))::date AS start, (first + (n * length) + length - 1)::date AS "end"
    FROM params, generate_series(0, $3::int - 1) AS n
  ),
  sums AS (
    SELECT s.start,
           sum(e.amount) FILTER (WHERE e.kind = 'income') AS income,
           sum(e.amount) FILTER (WHERE e.kind = 'expense') AS expense
    FROM slots s
    JOIN ledger_entries e ON e.entry_date BETWEEN s.start AND s."end"
    GROUP BY s.start
  )
  SELECT to_char(s.start, 'YYYY-MM-DD') AS start, to_char(s."end", 'YYYY-MM-DD') AS "end",
         coalesce(m.income, 0)::text AS income, coalesce(m.expense, 0)::text AS expense,
         (coalesce(m.income, 0) - coalesce(m.expense, 0))::text AS balance
  FROM slots s LEFT JOIN sums m USING (start)
  ORDER BY s.start`;

export function periodsRouter(pool: Pool) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { from, unit, count } = periodsQuery.parse(req.query);
    const { rows } = await pool.query<Row>(periodsSql, [from, unit, count]);
    res.json({
      unit,
      periods: rows.map((row) => ({
        start: row.start,
        end: row.end,
        income: won(row.income),
        expense: won(row.expense),
        balance: won(row.balance),
      })),
    });
  });

  return router;
}
