import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';

import { budgetListSql, type BudgetRow } from './budgets.js';
import { inTransaction } from './db.js';
import { won } from './month.js';
import { HttpError, parseId } from './standard/http.js';

// #62 Weekly and monthly spending reports (decisions 2026-11-16, database/migrations/021_spending_reports.sql).
// Opening the app calls POST /generate, which saves the report of each finished week (Sunday to Saturday) and
// month in the service time zone that has none yet. A report is a snapshot: what it said when it was made. The
// monthly report also lists the categories that reached or passed their budget (#61); budgets are monthly, so
// the weekly one does not. Sums, changes and shares are computed in SQL, never with JavaScript floats.

type Period = 'week' | 'month';

/**
 * How far back missed periods are made when the app was not opened for a while. With no report at all, only the
 * latest finished period is made, so a first open does not fill in history. A period that ended before the first
 * entry is skipped.
 */
const catchUp: Record<Period, number> = { week: 8, month: 12 };
const step: Record<Period, string> = { week: '7 days', month: '1 month' };
// The first day of the latest finished period, from the service date $1.
const latestStart: Record<Period, string> = {
  week: `$1::date - extract(dow FROM $1::date)::int - 7`,
  month: `(date_trunc('month', $1::date) - interval '1 month')::date`,
};

/** The first days of the periods to make, oldest first. */
const startsSql = (period: Period) => `
  WITH latest AS (SELECT ${latestStart[period]} AS d),
  last AS (SELECT max(start_date) AS d FROM spending_reports WHERE period = '${period}')
  SELECT to_char(s, 'YYYY-MM-DD') AS start
  FROM latest, last,
    generate_series(
      greatest(
        coalesce(last.d + interval '${step[period]}', latest.d::timestamp),
        latest.d - interval '${step[period]}' * ${catchUp[period] - 1}
      ),
      latest.d::timestamp,
      interval '${step[period]}'
    ) s`;

// One statement, so every number comes from the same snapshot. $1 and $2 are the period's first and last days,
// $3 the previous period's first day ($1 - 1 is its last). Expense only; uncategorized spending is one row.
const contentSql = `
  WITH cur AS (
    SELECT amount, category_id FROM ledger_entries
    WHERE kind = 'expense' AND entry_date BETWEEN $1::date AND $2::date
  ),
  totals AS (
    SELECT (SELECT coalesce(sum(amount), 0) FROM cur) AS total,
           (SELECT coalesce(sum(amount), 0) FROM ledger_entries
            WHERE kind = 'expense' AND entry_date >= $3::date AND entry_date < $1::date) AS previous
  ),
  top AS (
    SELECT cur.category_id, c.name, c.hidden, sum(cur.amount) AS amount
    FROM cur LEFT JOIN ledger_categories c ON c.id = cur.category_id
    GROUP BY cur.category_id, c.name, c.hidden
    ORDER BY amount DESC, c.name NULLS LAST
    LIMIT 3
  )
  SELECT t.total::text AS total, t.previous::text AS previous, (t.total - t.previous)::text AS change,
    coalesce(
      (SELECT json_agg(json_build_object(
          'categoryId', b.category_id, 'name', b.name, 'hidden', coalesce(b.hidden, false),
          'amount', b.amount::text, 'share', round(b.amount * 100 / nullif(t.total, 0), 1)::text)
        ORDER BY b.amount DESC, b.name NULLS LAST)
       FROM top b),
      '[]'::json) AS top
  FROM totals t`;

type Stored = {
  total: string;
  previous: string;
  change: string;
  top: {
    categoryId: number | null;
    name: string | null;
    hidden: boolean;
    amount: string;
    share: string;
  }[];
  overspending:
    | {
        categoryId: number;
        name: string;
        hidden: boolean;
        spent: string;
        budget: string;
        over: string;
        percent: string;
        status: 'reached' | 'over';
      }[]
    | null;
};

async function makeReport(client: PoolClient, period: Period, start: string) {
  const { rows } = await client.query<{ end: string; previous_start: string }>(
    `SELECT to_char($1::date + interval '${step[period]}' - interval '1 day', 'YYYY-MM-DD') AS end,
            to_char($1::date - interval '${step[period]}', 'YYYY-MM-DD') AS previous_start`,
    [start],
  );
  const { end, previous_start: previousStart } = rows[0];
  // A period before the ledger's first entry is not a report anyone needs: a new user would be told about weeks
  // and months of ₩0 from before they started.
  const started = await client.query(
    'SELECT 1 FROM ledger_entries WHERE entry_date <= $1::date LIMIT 1',
    [end],
  );
  if (started.rowCount === 0) return null;
  const content = (
    await client.query<Omit<Stored, 'overspending'>>(contentSql, [start, end, previousStart])
  ).rows[0];
  let overspending: Stored['overspending'] = null;
  if (period === 'month') {
    const budgets = await client.query<BudgetRow>(budgetListSql, [start]);
    overspending = budgets.rows
      .filter((row) => row.status === 'reached' || row.status === 'over')
      .map((row) => ({
        categoryId: row.category_id,
        name: row.name,
        hidden: row.hidden,
        spent: row.spent,
        budget: row.budget ?? '0',
        over: row.over ?? '0',
        percent: row.percent ?? '0',
        status: row.status as 'reached' | 'over',
      }));
  }
  const stored: Stored = { ...content, overspending };
  const saved = await client.query<{ id: number }>(
    `INSERT INTO spending_reports (period, start_date, end_date, content)
     VALUES ($1, $2::date, $3::date, $4::jsonb)
     ON CONFLICT (period, start_date) DO NOTHING
     RETURNING id`,
    [period, start, end, JSON.stringify(stored)],
  );
  return saved.rows[0] ? { id: saved.rows[0].id, period, startDate: start, endDate: end } : null;
}

type ReportRow = {
  id: number;
  period: Period;
  start_date: string;
  end_date: string;
  made_on: string;
  seen: boolean;
  content: Stored;
};

const columns = `id, period, start_date, end_date,
  to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS made_on, seen_at IS NOT NULL AS seen, content`;

const toListItem = (row: ReportRow) => ({
  id: row.id,
  period: row.period,
  startDate: row.start_date,
  endDate: row.end_date,
  madeOn: row.made_on,
  seen: row.seen,
  total: won(row.content.total),
});

const toReport = (row: ReportRow) => ({
  ...toListItem(row),
  previousTotal: won(row.content.previous),
  // Spending minus the previous period's: negative when it went down.
  change: won(row.content.change),
  topCategories: row.content.top.map((category) => ({
    categoryId: category.categoryId,
    name: category.name ?? 'Uncategorized',
    hidden: category.hidden,
    amount: won(category.amount),
    // A decimal string, e.g. "35.2": shown as text, not recomputed in the browser.
    share: category.share,
  })),
  // null for a weekly report: budgets are monthly.
  overspending:
    row.content.overspending?.map((item) => ({
      ...item,
      spent: won(item.spent),
      budget: won(item.budget),
      over: won(item.over),
    })) ?? null,
});

export function reportsRouter(pool: Pool, { today }: { today: () => string }) {
  const router = Router();

  // Makes the reports of the finished periods that have none yet. Two opens at once wait for each other, and the
  // unique (period, start_date) key keeps a period to one report either way.
  router.post('/generate', async (_req, res) => {
    const created = await inTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('spending_reports'))");
      const made = [];
      for (const period of ['week', 'month'] as const) {
        const starts = await client.query<{ start: string }>(startsSql(period), [today()]);
        for (const { start } of starts.rows) {
          const report = await makeReport(client, period, start);
          if (report) made.push(report);
        }
      }
      return made;
    });
    res.json({ created });
  });

  router.get('/', async (_req, res) => {
    const { rows } = await pool.query<ReportRow>(
      `SELECT ${columns} FROM spending_reports ORDER BY end_date DESC, period = 'week'`,
    );
    res.json({ reports: rows.map(toListItem) });
  });

  router.get('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'report');
    const { rows } = await pool.query<ReportRow>(
      `SELECT ${columns} FROM spending_reports WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new HttpError(404, 'Report not found');
    res.json({ report: toReport(rows[0]) });
  });

  // Opening a report on the screen: its notice goes away. Reading it (GET) changes nothing.
  router.put('/:id/seen', async (req, res) => {
    const id = parseId(req.params.id, 'report');
    const { rowCount } = await pool.query(
      'UPDATE spending_reports SET seen_at = coalesce(seen_at, now()) WHERE id = $1',
      [id],
    );
    if (rowCount === 0) throw new HttpError(404, 'Report not found');
    res.json({ report: { id, seen: true } });
  });

  return router;
}
