import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod/v4';

import { MAX_WON, MAX_WON_TEXT } from './contract.js';
import { inTransaction } from './db.js';
import { monthField } from './ledger/month.js';
import { won } from './money.js';
import { assetQuery, type Row } from './portfolio/asset-valuation.js';
import { HttpError, parseId } from './standard/http.js';

// #297 Savings goals (migration 050). A goal has a target amount, an optional target date and a progress source:
// - 'surplus': income minus expenses of the entries dated from the goal's start month through today, never below 0;
// - 'asset': the current value (KRW) of one asset account, valued by the same query as the asset screen.
// Progress, the amount left and the monthly amount needed are computed on every read, not stored.

const objectBody = { error: 'The request body must be a JSON object' };

const name = z
  .string({ error: 'Enter a name' })
  .trim()
  .min(1, 'Enter a name')
  .max(30, 'The name must be 30 characters or fewer');
const targetAmount = z
  .number({ error: 'Enter the target amount as a number' })
  .max(MAX_WON, { error: `Enter a target of ${MAX_WON_TEXT} or less`, abort: true })
  .int('Enter the target amount as a whole number of won')
  .min(1, 'The target amount must be ₩1 or more');
const targetDate = z
  .string({ error: 'Enter the target date as YYYY-MM-DD' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Enter the target date as YYYY-MM-DD', abort: true })
  .refine(
    (value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      const year = Number(value.slice(0, 4));
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().startsWith(value) &&
        year >= 1900 &&
        year <= 2100
      );
    },
    { error: 'Enter a real date between 1900 and 2100' },
  );
const source = z.enum(['surplus', 'asset'], { error: 'Choose where the progress comes from' });
const assetId = z
  .number({ error: 'Choose an asset account' })
  .int('Choose an asset account')
  .positive('Choose an asset account');

export const createBody = z.object(
  {
    name,
    targetAmount,
    targetDate: targetDate.nullable().optional(),
    source,
    assetId: assetId.nullable().optional(),
    startMonth: monthField('the start month').optional(),
  },
  objectBody,
);
export const updateBody = z
  .object(
    {
      name: name.optional(),
      targetAmount: targetAmount.optional(),
      targetDate: targetDate.nullable().optional(),
      source: source.optional(),
      assetId: assetId.nullable().optional(),
      finished: z.boolean({ error: 'finished must be true or false' }).optional(),
    },
    objectBody,
  )
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    error: 'Nothing to change',
  });

type GoalRow = {
  id: number;
  name: string;
  target_amount: string;
  target_date: string | null;
  source: 'surplus' | 'asset';
  asset_id: number | null;
  asset_name: string | null;
  asset_type: string | null;
  start_month: string;
  finished_at: string | null;
  surplus: string;
};

const goalSql = `
  SELECT g.id, g.name, g.target_amount::text, to_char(g.target_date, 'YYYY-MM-DD') AS target_date, g.source,
         g.asset_id, a.name AS asset_name, a.asset_type, to_char(g.start_month, 'YYYY-MM') AS start_month,
         g.finished_at,
         -- Surplus of the entries from the start month through today, in SQL numeric: income minus expenses.
         greatest(coalesce((
           SELECT sum(CASE e.kind WHEN 'income' THEN e.amount ELSE -e.amount END) FROM ledger_entries e
           WHERE g.source = 'surplus' AND e.entry_date >= g.start_month AND e.entry_date <= $1::date
         ), 0), 0)::text AS surplus
  FROM savings_goals g
  LEFT JOIN portfolio_assets a ON a.id = g.asset_id`;

/** "2026-11" or "2026-11-16" → a month count, so two months can be subtracted. */
const monthIndex = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));

/** The month `today` is in, as the first day ("2026-11-26" → "2026-11-01"). */
const thisMonth = (today: string) => `${today.slice(0, 7)}-01`;

/** The current value of each asset account, by id. A value that cannot be counted (no price, no rate) is null. */
async function assetValues(db: Pool | PoolClient, ids: number[], today: string) {
  const values = new Map<number, string | null>();
  if (ids.length === 0) return values;
  const { rows } = await db.query<Pick<Row, 'id' | 'current_value_krw'>>(
    assetQuery('a.id = ANY($2::bigint[])'),
    [today, ids],
  );
  for (const row of rows) values.set(row.id, row.current_value_krw);
  return values;
}

/**
 * Progress for one goal. `saved` is null when it cannot be known: the asset account is gone or cannot be valued.
 * The amount left and the percentage use BigInt, so no won amount goes through floating point.
 */
export function toGoal(row: GoalRow, assetValue: string | null | undefined, today: string) {
  const target = BigInt(row.target_amount);
  let saved: bigint | null = null;
  let issue: 'no_asset' | 'no_value' | null = null;
  if (row.source === 'surplus') saved = BigInt(row.surplus);
  else if (row.asset_id === null) issue = 'no_asset';
  else if (assetValue === null || assetValue === undefined) issue = 'no_value';
  else saved = BigInt(assetValue);

  const remaining = saved === null ? null : saved >= target ? 0n : target - saved;
  const percent = saved === null ? null : Number(saved >= target ? 100n : (saved * 100n) / target);
  const finished = row.finished_at !== null;
  const overdue = row.target_date !== null && row.target_date < today;
  // The months from this one to the target's month, counting this month (at least 1). Rounded up, so paying it every
  // month reaches the target.
  let monthsLeft: number | null = null;
  let monthlyNeeded: number | null = null;
  if (row.target_date !== null && !overdue) {
    monthsLeft = Math.max(1, monthIndex(row.target_date) - monthIndex(today));
    if (remaining !== null && remaining > 0n && !finished) {
      const months = BigInt(monthsLeft);
      monthlyNeeded = Number((remaining + months - 1n) / months);
    }
  }
  return {
    id: row.id,
    name: row.name,
    targetAmount: won(row.target_amount),
    targetDate: row.target_date,
    source: row.source,
    assetId: row.asset_id,
    assetName: row.asset_name,
    startMonth: row.start_month,
    finished,
    saved: saved === null ? null : Number(saved),
    remaining: remaining === null ? null : Number(remaining),
    percent,
    reached: saved !== null && saved >= target,
    overdue: overdue && !finished && !(saved !== null && saved >= target),
    monthsLeft,
    monthlyNeeded,
    issue,
  };
}

async function readGoals(
  db: Pool | PoolClient,
  today: string,
  where = 'true',
  params: unknown[] = [],
) {
  const { rows } = await db.query<GoalRow>(
    `${goalSql} WHERE ${where} ORDER BY (g.finished_at IS NOT NULL), g.target_date NULLS LAST, g.id`,
    [today, ...params],
  );
  const values = await assetValues(
    db,
    rows.flatMap((row) => (row.source === 'asset' && row.asset_id !== null ? [row.asset_id] : [])),
    today,
  );
  return rows.map((row) =>
    toGoal(row, row.asset_id === null ? undefined : values.get(row.asset_id), today),
  );
}

/** A chosen asset account must exist and must not be a debt (a debt is not savings). FOR SHARE until the write. */
async function checkAsset(client: PoolClient, id: number) {
  const { rows } = await client.query<{ asset_type: string }>(
    'SELECT asset_type FROM portfolio_assets WHERE id = $1 FOR SHARE',
    [id],
  );
  if (rows.length === 0) throw new HttpError(422, 'Choose an asset account that exists');
  if (rows[0].asset_type === 'debt') throw new HttpError(422, 'A debt cannot be a savings account');
}

export function goalsRouter(pool: Pool, { today }: { today: () => string }) {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json({ goals: await readGoals(pool, today()) });
  });

  router.post('/', async (req, res) => {
    const body = createBody.parse(req.body);
    if (body.source === 'asset' && !body.assetId) {
      throw new HttpError(422, 'Choose an asset account');
    }
    if (body.source === 'surplus' && body.assetId) {
      throw new HttpError(422, 'A goal that follows the surplus has no asset account');
    }
    const goal = await inTransaction(pool, async (client) => {
      if (body.source === 'asset') await checkAsset(client, body.assetId!);
      const created = await client.query<{ id: number }>(
        `INSERT INTO savings_goals (name, target_amount, target_date, source, asset_id, start_month)
         VALUES ($1, $2, $3, $4, $5, $6::date) RETURNING id`,
        [
          body.name,
          body.targetAmount,
          body.targetDate ?? null,
          body.source,
          body.source === 'asset' ? body.assetId : null,
          body.startMonth ? `${body.startMonth}-01` : thisMonth(today()),
        ],
      );
      return (await readGoals(client, today(), 'g.id = $2', [created.rows[0].id]))[0];
    });
    res.status(201).json({ goal });
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'goal');
    const body = updateBody.parse(req.body);
    const goal = await inTransaction(pool, async (client) => {
      const current = await client.query<{ source: 'surplus' | 'asset'; asset_id: number | null }>(
        'SELECT source, asset_id FROM savings_goals WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (current.rowCount === 0) throw new HttpError(404, 'Goal not found');
      // The source and account after this change.
      const nextSource = body.source ?? current.rows[0].source;
      const nextAsset =
        nextSource === 'surplus'
          ? null
          : body.assetId !== undefined
            ? body.assetId
            : current.rows[0].asset_id;
      // A goal whose account was deleted can still be renamed or finished; only a change of source or account
      // has to name an account.
      const touchesSource = body.source !== undefined || body.assetId !== undefined;
      if (nextSource === 'asset' && nextAsset === null && touchesSource) {
        throw new HttpError(422, 'Choose an asset account');
      }
      if (nextSource === 'surplus' && body.assetId) {
        throw new HttpError(422, 'A goal that follows the surplus has no asset account');
      }
      if (nextSource === 'asset' && nextAsset !== null && nextAsset !== current.rows[0].asset_id) {
        await checkAsset(client, nextAsset);
      }
      // Switching to the surplus counts it from this month, not from a month the goal never followed it.
      const restart = nextSource === 'surplus' && current.rows[0].source !== 'surplus';
      await client.query(
        `UPDATE savings_goals SET
           name = coalesce($2, name),
           target_amount = coalesce($3, target_amount),
           target_date = CASE WHEN $4 THEN $5::date ELSE target_date END,
           source = $6,
           asset_id = $7,
           start_month = CASE WHEN $8 THEN $9::date ELSE start_month END,
           finished_at = CASE WHEN $10::boolean IS NULL THEN finished_at WHEN $10 THEN coalesce(finished_at, now()) END,
           updated_at = now()
         WHERE id = $1`,
        [
          id,
          body.name ?? null,
          body.targetAmount ?? null,
          body.targetDate !== undefined,
          body.targetDate ?? null,
          nextSource,
          nextAsset,
          restart,
          thisMonth(today()),
          body.finished ?? null,
        ],
      );
      return (await readGoals(client, today(), 'g.id = $2', [id]))[0];
    });
    res.json({ goal });
  });

  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'goal');
    const deleted = await pool.query('DELETE FROM savings_goals WHERE id = $1', [id]);
    if (deleted.rowCount === 0) throw new HttpError(404, 'Goal not found');
    res.status(204).end();
  });

  return router;
}
