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

// The month runs from its first day up to (not including) the first day of the next month.
const inMonth = `e.entry_date >= $1::date AND e.entry_date < ($1::date + interval '1 month')`;

export function summaryRouter(pool: Pool) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { month } = monthQuery.parse(req.query);
    const first = `${month}-01`;
    const [totals, categories] = await Promise.all([
      pool.query<{ income: string; expense: string; balance: string }>(
        `SELECT coalesce(sum(e.amount) FILTER (WHERE e.kind = 'income'), 0)::text AS income,
                coalesce(sum(e.amount) FILTER (WHERE e.kind = 'expense'), 0)::text AS expense,
                (coalesce(sum(e.amount) FILTER (WHERE e.kind = 'income'), 0)
                  - coalesce(sum(e.amount) FILTER (WHERE e.kind = 'expense'), 0))::text AS balance
         FROM ledger_entries e WHERE ${inMonth}`,
        [first],
      ),
      // Expense by category, uncategorized entries as one row (category NULL). The share is a percentage of
      // the month's expense with one decimal; 0 when the month's expense is 0.
      pool.query<{
        category_id: string | null;
        name: string | null;
        hidden: boolean | null;
        amount: string;
        share: string;
      }>(
        `SELECT e.category_id, c.name, c.hidden, sum(e.amount)::text AS amount,
                round(coalesce(sum(e.amount) * 100 / nullif(sum(sum(e.amount)) OVER (), 0), 0), 1)::text
                  AS share
         FROM ledger_entries e LEFT JOIN ledger_categories c ON c.id = e.category_id
         WHERE e.kind = 'expense' AND ${inMonth}
         GROUP BY e.category_id, c.name, c.hidden
         ORDER BY sum(e.amount) DESC, c.name NULLS LAST`,
        [first],
      ),
    ]);
    const row = totals.rows[0];
    res.json({
      month,
      income: won(row.income),
      expense: won(row.expense),
      balance: won(row.balance),
      categories: categories.rows.map((category) => ({
        categoryId: category.category_id === null ? null : Number(category.category_id),
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
