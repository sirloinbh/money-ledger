import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { monthField, won } from './month.js';
import { HttpError, parseId } from './standard/http.js';

// #42 Monthly budgets of expense categories and how much of each is spent. A month uses its own budget row or
// else the latest earlier one (nothing is copied); an amount of 0 means no budget. Sums, the rest, the excess
// and the percentage are computed in SQL (numeric), never with JavaScript floats.

const monthQuery = z.object({ month: monthField('the month') });

const objectBody = { error: 'The request body must be a JSON object' };
const saveBody = z.object(
  {
    month: monthField('the month'),
    amount: z
      .number({ error: 'Enter the budget as a number' })
      // First: a number past the safe range is not a safe integer either, and only "too large" is useful.
      .max(Number.MAX_SAFE_INTEGER, { error: 'The budget is too large', abort: true })
      .int('Enter the budget as a whole number of won')
      .min(0, 'The budget must be ₩0 or more'),
  },
  objectBody,
);

type Row = {
  category_id: string;
  name: string;
  hidden: boolean;
  spent: string;
  budget: string | null;
  budget_month: string | null;
  remaining: string | null;
  over: string | null;
  percent: string | null;
};

// Expense categories in their usual order. A hidden category is listed only when it has spending or a budget
// this month. The budget is the category's latest row up to this month, unless that row is 0 (no budget).
// Uncategorized spending has no category to budget, so it is not here (the monthly summary shows it).
const listSql = `
  WITH spent AS (
    SELECT category_id, sum(amount) AS spent FROM ledger_entries
    WHERE kind = 'expense' AND category_id IS NOT NULL
      AND entry_date >= $1::date AND entry_date < ($1::date + interval '1 month')
    GROUP BY category_id
  ),
  latest AS (
    SELECT DISTINCT ON (category_id) category_id, month, amount FROM ledger_budgets
    WHERE month <= $1::date
    ORDER BY category_id, month DESC
  ),
  rows AS (
    SELECT c.id, c.name, c.hidden, coalesce(s.spent, 0) AS spent,
           CASE WHEN l.amount > 0 THEN l.amount END AS budget,
           CASE WHEN l.amount > 0 THEN l.month END AS budget_month
    FROM ledger_categories c
    LEFT JOIN spent s ON s.category_id = c.id
    LEFT JOIN latest l ON l.category_id = c.id
    WHERE c.kind = 'expense'
  )
  SELECT id::text AS category_id, name, hidden, spent::text AS spent, budget::text AS budget,
         to_char(budget_month, 'YYYY-MM') AS budget_month,
         -- greatest() skips NULL, so a category without a budget is NULL here on purpose, not 0.
         CASE WHEN budget IS NOT NULL THEN greatest(budget - spent, 0) END::text AS remaining,
         CASE WHEN budget IS NOT NULL THEN greatest(spent - budget, 0) END::text AS over,
         round(spent * 100.0 / budget, 1)::text AS percent
  FROM rows
  WHERE NOT hidden OR spent > 0 OR budget IS NOT NULL
  ORDER BY id`;

export function budgetsRouter(pool: Pool) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { month } = monthQuery.parse(req.query);
    const { rows } = await pool.query<Row>(listSql, [`${month}-01`]);
    res.json({
      month,
      budgets: rows.map((row) => ({
        categoryId: Number(row.category_id),
        name: row.name,
        hidden: row.hidden,
        spent: won(row.spent),
        // null: no budget ("Not set"); remaining, over and percent are then null too.
        budget: row.budget === null ? null : won(row.budget),
        // The month the budget was saved for: this month, or an earlier one it carries on from.
        budgetMonth: row.budget_month,
        remaining: row.remaining === null ? null : won(row.remaining),
        over: row.over === null ? null : won(row.over),
        // A decimal string with one digit, e.g. "112.5": shown as text, not recomputed in the browser.
        percent: row.percent,
      })),
    });
  });

  // Saves the budget of one category from a month on (0 = no budget from that month on).
  router.put('/:categoryId', async (req, res) => {
    const categoryId = parseId(req.params.categoryId, 'category');
    const body = saveBody.parse(req.body);
    try {
      await pool.query(
        `INSERT INTO ledger_budgets (category_id, month, amount) VALUES ($1, $2::date, $3)
         ON CONFLICT (category_id, month) DO UPDATE SET amount = excluded.amount, updated_at = now()`,
        [categoryId, `${body.month}-01`, body.amount],
      );
    } catch (error) {
      // The (category, 'expense') key is missing: no such category, or an income one.
      if ((error as { code?: unknown }).code === '23503') {
        throw new HttpError(404, 'Expense category not found');
      }
      throw error;
    }
    res.json({ budget: { categoryId, month: body.month, amount: body.amount } });
  });

  return router;
}
