import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { won } from '../money.js';
import { merchantKey, sameMerchant } from './suggestions.js';

// #291 Recurring payments suggested as fixed costs. A merchant is recurring when, in each of the last `months`
// complete months, it has exactly one expense entry and every amount stays within `tolerancePct` of the median
// amount. Merchants that already match a fixed cost (any state) and merchants the user dismissed are left out.
// The current month is not counted: this month's charge may not have happened yet. Entries that fixed costs
// added themselves are ignored. Nothing is registered here: the screen registers a suggestion with the existing
// POST /api/ledger/fixed-costs, using the `register` body each suggestion carries (starting next month, so this
// month's real charge is not added a second time).
// The rule (3 of the last 3 months, within 10%) is the recommendation of the issue.

const recurringRule = { months: 3, minMonths: 3, tolerancePct: 10 };

type Entry = {
  id: number;
  date: string;
  amount: number;
  merchant: string;
  categoryId: number;
  categoryName: string;
};

export type Suggestion = {
  merchantKey: string;
  /** The merchant as written on the latest entry. */
  merchant: string;
  /** The amount to register: the latest one. */
  amount: number;
  /** The amounts differ between months, so the fixed cost should be variable. */
  variable: boolean;
  categoryId: number;
  categoryName: string;
  dayOfMonth: number;
  /** The entries it was found from, oldest first. */
  entries: { id: number; date: string; amount: number }[];
  /** A ready body for POST /api/ledger/fixed-costs. */
  register: {
    name: string;
    categoryId: number;
    amount: number;
    variable: boolean;
    dayOfMonth: number;
    startMonth: string;
  };
};

const monthOf = (date: string) => date.slice(0, 7);
const shiftMonth = (month: string, by: number) => {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
};

/**
 * The suggestions from the expense entries of the complete months before `today`'s month (whole won, so the
 * comparison `|amount - median| * 100 <= median * tolerance` is exact integer arithmetic). `fixedNames` are the
 * names of every fixed cost; `dismissed` the merchant keys the user dismissed.
 */
export function detectRecurring(
  entries: Entry[],
  today: string,
  fixedNames: string[],
  dismissed: Set<string>,
  rule = recurringRule,
): Suggestion[] {
  const thisMonth = monthOf(today);
  const firstMonth = shiftMonth(thisMonth, -rule.months);
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const month = monthOf(entry.date);
    if (month < firstMonth || month >= thisMonth || entry.amount <= 0) continue;
    const key = merchantKey(entry.merchant);
    if (key.length < 2 || dismissed.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const found: Suggestion[] = [];
  for (const [key, group] of groups) {
    const byMonth = new Map<string, Entry[]>();
    for (const entry of group) {
      byMonth.set(monthOf(entry.date), [...(byMonth.get(monthOf(entry.date)) ?? []), entry]);
    }
    // Two or more charges in one month is a shop you visit, not a bill.
    if ([...byMonth.values()].some((list) => list.length > 1)) continue;
    if (byMonth.size < rule.minMonths) continue;
    const ordered = [...group].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const mid = median(ordered.map((entry) => entry.amount));
    if (ordered.some((entry) => Math.abs(entry.amount - mid) * 100 > mid * rule.tolerancePct))
      continue;
    const latest = ordered.at(-1)!;
    if (fixedNames.some((name) => sameMerchant(name, latest.merchant))) continue;
    const variable = new Set(ordered.map((entry) => entry.amount)).size > 1;
    const dayOfMonth = median(ordered.map((entry) => Number(entry.date.slice(8, 10))));
    found.push({
      merchantKey: key,
      merchant: latest.merchant,
      amount: latest.amount,
      variable,
      categoryId: latest.categoryId,
      categoryName: latest.categoryName,
      dayOfMonth,
      entries: ordered.map(({ id, date, amount }) => ({ id, date, amount })),
      register: {
        name: latest.merchant.slice(0, 30).trim(),
        categoryId: latest.categoryId,
        amount: latest.amount,
        variable,
        dayOfMonth,
        startMonth: shiftMonth(thisMonth, 1),
      },
    });
  }
  return found.sort((a, b) => b.amount - a.amount || a.merchant.localeCompare(b.merchant));
}

export const dismissBody = z.object(
  {
    merchantKey: z
      .string({ error: 'The merchant is not valid' })
      .min(1, 'The merchant is not valid')
      .max(100, 'The merchant is not valid'),
  },
  { error: 'The request body must be a JSON object' },
);

type Row = {
  id: number;
  entry_date: string;
  amount: string;
  merchant: string;
  category_id: number;
  category_name: string;
};

export function recurringRouter(pool: Pool, today: () => string) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const now = today();
    const from = `${shiftMonth(monthOf(now), -recurringRule.months)}-01`;
    const [entries, fixed, dismissed] = await Promise.all([
      pool.query<Row>(
        `SELECT e.id, e.entry_date::text AS entry_date, e.amount::text AS amount, e.merchant,
                e.category_id, c.name AS category_name
         FROM ledger_entries e JOIN ledger_categories c ON c.id = e.category_id
         WHERE e.kind = 'expense' AND e.merchant <> '' AND e.entry_date >= $1::date
           AND NOT EXISTS (SELECT 1 FROM ledger_fixed_cost_runs r WHERE r.entry_id = e.id)`,
        [from],
      ),
      pool.query<{ name: string }>('SELECT name FROM ledger_fixed_costs'),
      pool.query<{ merchant_key: string }>('SELECT merchant_key FROM ledger_recurring_dismissals'),
    ]);
    const suggestions = detectRecurring(
      entries.rows.map((row) => ({
        id: row.id,
        date: row.entry_date,
        amount: won(row.amount),
        merchant: row.merchant,
        categoryId: row.category_id,
        categoryName: row.category_name,
      })),
      now,
      fixed.rows.map((row) => row.name),
      new Set(dismissed.rows.map((row) => row.merchant_key)),
    );
    res.json({ rule: recurringRule, suggestions });
  });

  router.post('/dismiss', async (req, res) => {
    const body = dismissBody.parse(req.body);
    await pool.query(
      'INSERT INTO ledger_recurring_dismissals (merchant_key) VALUES ($1) ON CONFLICT DO NOTHING',
      [body.merchantKey],
    );
    res.status(204).end();
  });

  return router;
}
