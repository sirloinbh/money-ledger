import type { Pool, PoolClient } from 'pg';
import { z } from 'zod/v4';

import { MAX_WON } from '../contract.js';
import { inTransaction } from '../db.js';
import { HttpError } from '../standard/http.js';

// #292 Split one payment into parts, each with its own category and amount.
// The entry keeps its own total; the parts must add up to it exactly (checked here with a message, and again by a
// trigger at commit). The entry's category_id is the category of its largest part (the first on a tie), so the
// classification list, merchant suggestions and rules that read it still see a category. Category totals read the
// parts through the view ledger_entry_parts.

const maxParts = 10;

const splitPart = z.object(
  {
    categoryId: z
      .number({ error: 'Choose a category for each part' })
      .int('Choose a category for each part')
      .positive('Choose a category for each part'),
    amount: z
      .number({ error: 'Enter each part as a number' })
      .max(MAX_WON, { error: 'A part is too large', abort: true })
      .int('Enter each part as a whole number of won')
      .min(1, 'Each part must be ₩1 or more'),
  },
  { error: 'Each part needs a category and an amount' },
);
export type SplitPart = z.infer<typeof splitPart>;

/** `splits` in an entry body: 2 to 10 parts. */
export const splitsBody = z
  .array(splitPart, { error: 'The parts must be a list' })
  .max(maxParts, `Split into at most ${maxParts} parts`);

type Db = Pick<Pool, 'query'> | PoolClient;

/** The parts of the given entries, in order, by entry id. */
export async function loadSplits(db: Db, ids: number[]) {
  const result = new Map<number, { categoryId: number; categoryName: string; amount: number }[]>();
  if (ids.length === 0) return result;
  const { rows } = await db.query<{
    entry_id: number;
    category_id: number;
    name: string;
    amount: string;
  }>(
    `SELECT s.entry_id, s.category_id, c.name, s.amount::text AS amount
     FROM ledger_entry_splits s JOIN ledger_categories c ON c.id = s.category_id
     WHERE s.entry_id = ANY($1::bigint[]) ORDER BY s.entry_id, s.position`,
    [ids],
  );
  for (const row of rows) {
    const list = result.get(row.entry_id) ?? [];
    list.push({ categoryId: row.category_id, categoryName: row.name, amount: Number(row.amount) });
    result.set(row.entry_id, list);
  }
  return result;
}

/** Checks the parts against the payment total and returns them with the category of the largest. */
function checkParts(parts: SplitPart[], total: number) {
  if (parts.length < 2) throw new HttpError(400, 'Split a payment into at least 2 parts');
  if (new Set(parts.map((part) => part.categoryId)).size !== parts.length) {
    throw new HttpError(
      400,
      'Use each category once. Add the amounts of the same category together',
    );
  }
  const sum = parts.reduce((acc, part) => acc + part.amount, 0);
  if (sum !== total) {
    throw new HttpError(
      400,
      `The parts add up to ₩${sum.toLocaleString('en-US')} but the payment is ₩${total.toLocaleString('en-US')}`,
    );
  }
  let main = parts[0];
  for (const part of parts) if (part.amount > main.amount) main = part;
  return main.categoryId;
}

type Written = {
  date: string;
  amount: number;
  merchant: string;
  memo: string;
  paymentMethod?: string | null;
};

/**
 * Saves a split entry in one transaction: the entry row, then its parts. `id` null creates the entry. Every part's
 * category must exist, be an expense category and be visible, except one the entry already uses.
 */
export async function writeSplitEntry(
  pool: Pool,
  id: number | null,
  body: Written,
  parts: SplitPart[],
) {
  const main = checkParts(parts, body.amount);
  return inTransaction(pool, async (client) => {
    let keep = new Set<number>();
    if (id !== null) {
      const current = await client.query<{ category_id: number | null; kind: string }>(
        'SELECT category_id, kind FROM ledger_entries WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!current.rows[0]) throw new HttpError(404, 'Entry not found');
      const old = await loadSplits(client, [id]);
      keep = new Set((old.get(id) ?? []).map((part) => part.categoryId));
      if (current.rows[0].category_id !== null) keep.add(current.rows[0].category_id);
    }
    const { rows: categories } = await client.query<{ id: number; kind: string; hidden: boolean }>(
      'SELECT id, kind, hidden FROM ledger_categories WHERE id = ANY($1::bigint[]) FOR SHARE',
      [parts.map((part) => part.categoryId)],
    );
    const byId = new Map(categories.map((category) => [category.id, category]));
    for (const part of parts) {
      const category = byId.get(part.categoryId);
      if (!category) throw new HttpError(400, 'Category not found');
      if (category.kind !== 'expense')
        throw new HttpError(400, 'Only expense categories can be used in a split');
      if (category.hidden && !keep.has(part.categoryId)) {
        throw new HttpError(400, 'Cannot add a new part to a hidden category');
      }
    }
    let entryId = id;
    if (id === null) {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO ledger_entries (entry_date, kind, amount, category_id, merchant, memo, payment_method)
         VALUES ($1::date, 'expense', $2::bigint, $3::bigint, $4::text, $5::text, $6::text) RETURNING id`,
        [body.date, body.amount, main, body.merchant, body.memo, body.paymentMethod ?? null],
      );
      entryId = inserted.rows[0].id;
    } else {
      await client.query(
        `UPDATE ledger_entries
         SET entry_date = $2::date, kind = 'expense', amount = $3::bigint, category_id = $4::bigint,
             merchant = $5::text, memo = $6::text,
             payment_method = CASE WHEN $7::boolean THEN $8::text ELSE payment_method END,
             updated_at = now()
         WHERE id = $1`,
        [
          id,
          body.date,
          body.amount,
          main,
          body.merchant,
          body.memo,
          body.paymentMethod !== undefined,
          body.paymentMethod ?? null,
        ],
      );
      await client.query('DELETE FROM ledger_entry_splits WHERE entry_id = $1', [id]);
    }
    await client.query(
      `INSERT INTO ledger_entry_splits (entry_id, position, category_id, amount)
       SELECT $1::bigint, p.position, p.category_id, p.amount
       FROM unnest($2::int[], $3::bigint[], $4::bigint[]) AS p(position, category_id, amount)`,
      [
        entryId,
        parts.map((_, index) => index + 1),
        parts.map((part) => part.categoryId),
        parts.map((part) => part.amount),
      ],
    );
    return entryId as number;
  });
}

/** Removes the parts of an entry (undo the split). The entry keeps its own category. */
export async function clearSplits(db: Db, id: number) {
  await db.query('DELETE FROM ledger_entry_splits WHERE entry_id = $1', [id]);
}

/** True when the entry has parts. */
export async function isSplit(db: Db, id: number) {
  const { rowCount } = await db.query(
    'SELECT 1 FROM ledger_entry_splits WHERE entry_id = $1 LIMIT 1',
    [id],
  );
  return (rowCount ?? 0) > 0;
}
