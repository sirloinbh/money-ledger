import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod/v4';

import { inTransaction } from './db.js';
import { monthField, won } from './month.js';
import { HttpError, parseId } from './standard/http.js';

// #43 Fixed costs (decisions 2026-11-15, database/migrations/020_ledger_fixed_costs.sql). Each item adds one
// expense entry a month on its day (a day past the month's end means the last day). The app calls POST /generate
// when it opens: every due month without a run gets its entry, skipped months included. A variable item's entry
// is an estimate (the last confirmed amount, or the item's amount the first time) until the user confirms it.
// Changing an item only affects entries added later.

const objectBody = { error: 'The request body must be a JSON object' };

const name = z
  .string({ error: 'Enter a name' })
  .trim()
  .min(1, 'Enter a name')
  .max(30, 'The name must be 30 characters or fewer');
const amount = z
  .number({ error: 'Enter the amount as a number' })
  // First: a number past the safe range is not a safe integer either, and only "too large" is useful.
  .max(Number.MAX_SAFE_INTEGER, { error: 'The amount is too large', abort: true })
  .int('Enter the amount as a whole number of won')
  .min(0, 'The amount must be ₩0 or more');
const categoryId = z
  .number({ error: 'Choose an expense category' })
  .int('Choose an expense category')
  .positive('Choose an expense category');
const dayOfMonth = z
  .number({ error: 'Enter the day of the month as a number' })
  .int('Enter the day of the month as a whole number')
  .min(1, 'Enter a day between 1 and 31')
  .max(31, 'Enter a day between 1 and 31');
const variable = z.boolean({ error: 'variable must be true or false' });

export const createBody = z.object(
  { name, categoryId, amount, variable, dayOfMonth, startMonth: monthField('the start month') },
  objectBody,
);
export const updateBody = z
  .object(
    {
      name: name.optional(),
      categoryId: categoryId.optional(),
      amount: amount.optional(),
      variable: variable.optional(),
      dayOfMonth: dayOfMonth.optional(),
      active: z.boolean({ error: 'active must be true or false' }).optional(),
    },
    objectBody,
  )
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    error: 'Nothing to change',
  });
export const confirmBody = z.object({ amount }, objectBody);
export const monthQuery = z.object({ month: monthField('the month') });

type ItemRow = {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  amount: string;
  variable: boolean;
  day_of_month: number;
  start_month: string;
  active: boolean;
  entry_id: string | null;
  entry_date: string | null;
  entry_amount: string | null;
  confirmed: boolean | null;
};

const itemSql = `
  SELECT f.id::text, f.name, f.category_id::text, c.name AS category_name, f.amount::text, f.variable,
         f.day_of_month, to_char(f.start_month, 'YYYY-MM') AS start_month, f.active,
         r.entry_id::text, e.entry_date, e.amount::text AS entry_amount, r.confirmed
  FROM ledger_fixed_costs f
  JOIN ledger_categories c ON c.id = f.category_id
  LEFT JOIN ledger_fixed_cost_runs r ON r.fixed_cost_id = f.id AND r.month = $1::date
  LEFT JOIN ledger_entries e ON e.id = r.entry_id`;

const toItem = (row: ItemRow) => ({
  id: Number(row.id),
  name: row.name,
  categoryId: Number(row.category_id),
  categoryName: row.category_name,
  amount: Number(row.amount),
  variable: row.variable,
  dayOfMonth: row.day_of_month,
  startMonth: row.start_month,
  active: row.active,
  // This month's entry, or null when it is not due yet, was not added (stopped), or was deleted.
  entry:
    row.entry_id === null
      ? null
      : {
          id: Number(row.entry_id),
          date: row.entry_date!,
          amount: Number(row.entry_amount),
          // true while a variable amount is still the estimate.
          estimated: row.confirmed === false,
        },
});

const thisMonth = (today: string) => `${today.slice(0, 7)}-01`;

/** How far back a new item may start. */
const maxPastMonths = 24;
/** "2026-11" or "2026-11-16" → a month count, so two months can be compared and subtracted. */
const monthIndex = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));

// Due months of active items, oldest first, that have no run yet. An entry is due on its day, or the month's last
// day when the day is past the end, once that date is today or earlier.
const dueSql = `
  WITH months AS (
    SELECT f.id, f.name, f.category_id, f.amount, f.variable, m::date AS month,
           (m::date + (least(f.day_of_month,
                             extract(day FROM m + interval '1 month' - interval '1 day')::int) - 1)) AS entry_date
    FROM ledger_fixed_costs f
    -- timestamp, not timestamptz: the session time zone must not move a month.
    CROSS JOIN LATERAL generate_series(
      f.start_month::timestamp, date_trunc('month', $1::date::timestamp), interval '1 month'
    ) AS m
    WHERE f.active
  )
  SELECT id::text, name, category_id::text, amount::text, variable, month, entry_date
  FROM months
  WHERE entry_date <= $1::date
    AND NOT EXISTS (
      SELECT 1 FROM ledger_fixed_cost_runs r WHERE r.fixed_cost_id = months.id AND r.month = months.month
    )
  ORDER BY month, id`;

type DueRow = {
  id: string;
  name: string;
  category_id: string;
  amount: string;
  variable: boolean;
  month: string;
  entry_date: string;
};

/** Adds every due entry that is missing. Returns how many were added. */
async function addDueEntries(client: PoolClient, today: string) {
  const { rows } = await client.query<DueRow>(dueSql, [today]);
  let added = 0;
  for (const due of rows) {
    // Another request adding the same month waits here on the key and then skips it: no month is added twice.
    const run = await client.query(
      `INSERT INTO ledger_fixed_cost_runs (fixed_cost_id, month, confirmed) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [due.id, due.month, !due.variable],
    );
    if (run.rowCount === 0) continue;
    // A variable item starts from its last confirmed entry that still exists, else from its own amount.
    const estimate = due.variable
      ? await client.query<{ amount: string }>(
          `SELECT e.amount::text FROM ledger_fixed_cost_runs r JOIN ledger_entries e ON e.id = r.entry_id
           WHERE r.fixed_cost_id = $1 AND r.confirmed AND r.month < $2
           ORDER BY r.month DESC LIMIT 1`,
          [due.id, due.month],
        )
      : undefined;
    const entry = await client.query<{ id: string }>(
      `INSERT INTO ledger_entries (entry_date, kind, amount, category_id, memo)
       VALUES ($1, 'expense', $2, $3, $4) RETURNING id::text`,
      [due.entry_date, estimate?.rows[0]?.amount ?? due.amount, due.category_id, due.name],
    );
    await client.query(
      'UPDATE ledger_fixed_cost_runs SET entry_id = $3 WHERE fixed_cost_id = $1 AND month = $2',
      [due.id, due.month, entry.rows[0].id],
    );
    added += 1;
  }
  return added;
}

/** A category that is missing or not an expense category breaks the (category_id, kind) key. */
function refuseCategory(error: unknown): never {
  if ((error as { code?: unknown }).code === '23503') {
    throw new HttpError(422, 'Choose an expense category');
  }
  throw error;
}

export function fixedCostsRouter(pool: Pool, { today }: { today: () => string }) {
  const router = Router();

  // The items with this month's entry, and the month's spending split into fixed costs and the rest.
  router.get('/', async (req, res) => {
    const { month } = monthQuery.parse(req.query);
    const first = `${month}-01`;
    const [items, totals] = await Promise.all([
      pool.query<ItemRow>(`${itemSql} ORDER BY f.active DESC, f.day_of_month, f.id`, [first]),
      pool.query<{ fixed: string; other: string }>(
        `SELECT coalesce(sum(e.amount) FILTER (WHERE r.entry_id IS NOT NULL), 0)::text AS fixed,
                coalesce(sum(e.amount) FILTER (WHERE r.entry_id IS NULL), 0)::text AS other
         FROM ledger_entries e
         LEFT JOIN ledger_fixed_cost_runs r ON r.entry_id = e.id
         WHERE e.kind = 'expense'
           AND e.entry_date >= $1::date AND e.entry_date < ($1::date + interval '1 month')`,
        [first],
      ),
    ]);
    res.json({
      month,
      fixedCosts: items.rows.map(toItem),
      // Expense entries dated this month: those added by fixed costs, and all other spending.
      totals: { fixed: won(totals.rows[0].fixed), other: won(totals.rows[0].other) },
    });
  });

  router.post('/', async (req, res) => {
    const body = createBody.parse(req.body);
    // A typo like 2006 for 2026 would add hundreds of entries at once, which the user then has to delete one by one.
    if (monthIndex(body.startMonth) < monthIndex(today()) - maxPastMonths) {
      throw new HttpError(422, `The start month can be at most ${maxPastMonths} months ago`);
    }
    const created = await pool
      .query<{ id: string }>(
        `INSERT INTO ledger_fixed_costs (name, category_id, amount, variable, day_of_month, start_month)
         VALUES ($1, $2, $3, $4, $5, $6::date) RETURNING id::text`,
        [
          body.name,
          body.categoryId,
          body.amount,
          body.variable,
          body.dayOfMonth,
          `${body.startMonth}-01`,
        ],
      )
      .catch(refuseCategory);
    res.status(201).json({ fixedCost: { id: Number(created.rows[0].id), ...body, active: true } });
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'fixed cost');
    const body = updateBody.parse(req.body);
    const updated = await pool
      .query(
        `UPDATE ledger_fixed_costs SET
           name = coalesce($2, name),
           category_id = coalesce($3, category_id),
           amount = coalesce($4, amount),
           variable = coalesce($5, variable),
           day_of_month = coalesce($6, day_of_month),
           -- Started again: from this month on, so the months it was stopped are not added afterwards.
           start_month = CASE WHEN $7 AND NOT active THEN greatest(start_month, $8::date) ELSE start_month END,
           active = coalesce($7, active),
           updated_at = now()
         WHERE id = $1`,
        [
          id,
          body.name ?? null,
          body.categoryId ?? null,
          body.amount ?? null,
          body.variable ?? null,
          body.dayOfMonth ?? null,
          body.active ?? null,
          thisMonth(today()),
        ],
      )
      .catch(refuseCategory);
    if (updated.rowCount === 0) throw new HttpError(404, 'Fixed cost not found');
    const { rows } = await pool.query<ItemRow>(`${itemSql} WHERE f.id = $2`, [
      thisMonth(today()),
      id,
    ]);
    res.json({ fixedCost: toItem(rows[0]) });
  });

  router.post('/generate', async (_req, res) => {
    const added = await inTransaction(pool, (client) => addDueEntries(client, today()));
    res.json({ added });
  });

  // Confirms the actual amount of one month's entry: the entry takes the amount and stops being an estimate.
  router.put('/:id/months/:month', async (req, res) => {
    const id = parseId(req.params.id, 'fixed cost');
    const { month } = monthQuery.parse({ month: req.params.month });
    const body = confirmBody.parse(req.body);
    const entry = await inTransaction(pool, async (client) => {
      const run = await client.query<{ entry_id: string | null }>(
        `SELECT entry_id::text FROM ledger_fixed_cost_runs
         WHERE fixed_cost_id = $1 AND month = $2::date FOR UPDATE`,
        [id, `${month}-01`],
      );
      const entryId = run.rows[0]?.entry_id;
      const missing = 'There is no entry to confirm for that month';
      if (!entryId) throw new HttpError(404, missing);
      // An entry changed to income in the entry list is no longer this fixed cost's expense.
      const changed = await client.query(
        `UPDATE ledger_entries SET amount = $2, updated_at = now() WHERE id = $1 AND kind = 'expense'`,
        [entryId, body.amount],
      );
      if (changed.rowCount === 0) throw new HttpError(404, missing);
      await client.query(
        'UPDATE ledger_fixed_cost_runs SET confirmed = true WHERE fixed_cost_id = $1 AND month = $2::date',
        [id, `${month}-01`],
      );
      return { id: Number(entryId), amount: body.amount, estimated: false };
    });
    res.json({ entry });
  });

  return router;
}
