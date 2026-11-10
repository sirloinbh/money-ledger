import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

// #40 One month of the ledger: income, expense, the balance between them and the expense by category.
// Sums and shares are computed in SQL (numeric), never with JavaScript floats.

const monthQuery = z.object({
  month: z
    .string({ error: '월을 YYYY-MM 형식으로 입력하세요' })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: '월을 YYYY-MM 형식으로 입력하세요', abort: true })
    .refine(
      (value) => {
        const year = Number(value.slice(0, 4));
        return year >= 1900 && year <= 2100;
      },
      { error: '월은 1900년부터 2100년 사이로 입력하세요' },
    ),
});

/** A sum of whole-won amounts from SQL (numeric as text); exact as long as it is a safe integer. */
function won(value: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`sum out of safe range: ${value}`);
  return parsed;
}

type Row = {
  income: string;
  expense: string;
  balance: string;
  categories: {
    category_id: number | null;
    name: string | null;
    hidden: boolean | null;
    amount: string;
    share: string;
  }[];
};

// One statement, so the totals and the category rows come from the same snapshot: an entry saved meanwhile is
// in both or in neither. The month runs from its first day up to (not including) the first of the next month.
// Expense by category: uncategorized entries are one row (category NULL). The share is a percentage of the
// month's expense with one decimal, 0 when that expense is 0. Amounts go out as text, exact.
const summarySql = `
  WITH m AS (
    SELECT e.kind, e.amount, e.category_id FROM ledger_entries e
    WHERE e.entry_date >= $1::date AND e.entry_date < ($1::date + interval '1 month')
  ),
  totals AS (
    SELECT coalesce(sum(amount) FILTER (WHERE kind = 'income'), 0) AS income,
           coalesce(sum(amount) FILTER (WHERE kind = 'expense'), 0) AS expense
    FROM m
  ),
  by_category AS (
    SELECT m.category_id, c.name, c.hidden, sum(m.amount) AS amount
    FROM m LEFT JOIN ledger_categories c ON c.id = m.category_id
    WHERE m.kind = 'expense'
    GROUP BY m.category_id, c.name, c.hidden
  )
  SELECT t.income::text AS income, t.expense::text AS expense, (t.income - t.expense)::text AS balance,
    coalesce(
      (SELECT json_agg(json_build_object(
          'category_id', b.category_id, 'name', b.name, 'hidden', b.hidden, 'amount', b.amount::text,
          'share', round(coalesce(b.amount * 100 / nullif(t.expense, 0), 0), 1)::text)
        ORDER BY b.amount DESC, b.name NULLS LAST)
       FROM by_category b),
      '[]'::json) AS categories
  FROM totals t`;

export function summaryRouter(pool: Pool) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { month } = monthQuery.parse(req.query);
    const { rows } = await pool.query<Row>(summarySql, [`${month}-01`]);
    const row = rows[0];
    res.json({
      month,
      income: won(row.income),
      expense: won(row.expense),
      balance: won(row.balance),
      categories: row.categories.map((category) => ({
        categoryId: category.category_id,
        name: category.name ?? '미분류',
        hidden: category.hidden ?? false,
        amount: won(category.amount),
        // A decimal string, e.g. "35.2": shown as text, not recomputed in the browser.
        share: category.share,
      })),
    });
  });

  return router;
}
