import express, { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod/v4';

import { inTransaction } from '../db.js';
import { type CardPayment, parseCardSheet } from './card-import-parse.js';
import { ruleCategorySql } from './rules.js';

// #57 Import a Woori Card usage file as expense entries (rules: #56 comment of 2026-11-18).
// The browser sends the file's bytes as they are; the server reads the one sheet, shows a preview, and saves.
// Entries remember only the source, the last 4 card digits and the approval number, so importing the same file
// (or a newer one) again updates the same entries instead of adding twice. The file itself is never stored.

const source = 'woori-card';
const maxFileBytes = 5_000_000;
const maxPayments = 2000;

export const importQuery = z.object(
  {
    kind: z.enum(['domestic', 'foreign'], { error: 'Choose domestic or foreign use' }),
    // Payments that match a hand-entered expense on date and amount are left out when true.
    skipCandidates: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
  },
  { error: 'The query is not valid' },
);

type Action = 'new' | 'update' | 'remove' | 'unchanged' | 'skipped';
type PlanRow = CardPayment & {
  action: Action;
  /** A hand-entered expense with the same date and amount exists, so this may be a duplicate (decision of #56). */
  candidate: boolean;
  entryId: number | null;
};

type Existing = { id: number; card: string; ref: string; amount: string; memo: string };

/** What importing each payment would do, against the entries as they are now. */
async function plan(db: Pool | PoolClient, payments: CardPayment[], lock = false) {
  const { rows: existing } = await db.query<Existing>(
    `SELECT id, source_card AS card, source_ref AS ref, amount::text, memo FROM ledger_entries
     WHERE source = $1 AND (source_card, source_ref) IN (SELECT * FROM unnest($2::text[], $3::text[]))
     ${lock ? 'FOR UPDATE' : ''}`,
    [source, payments.map((p) => p.card), payments.map((p) => p.approval)],
  );
  const known = new Map(existing.map((row) => [`${row.card}/${row.ref}`, row]));
  const { rows: manual } = await db.query<{ entry_date: string; amount: string }>(
    `SELECT DISTINCT entry_date::text, amount::text FROM ledger_entries
     WHERE source IS NULL AND kind = 'expense' AND entry_date = ANY($1::date[])`,
    [payments.map((p) => p.date)],
  );
  const manualKeys = new Set(manual.map((row) => `${row.entry_date}/${row.amount}`));
  return payments.map<PlanRow>((payment) => {
    const found = known.get(`${payment.card}/${payment.approval}`);
    const base = { ...payment, candidate: false, entryId: found?.id ?? null };
    if (found) {
      if (payment.amount === 0) return { ...base, action: 'remove' };
      const same = Number(found.amount) === payment.amount && found.memo === payment.memo;
      return { ...base, action: same ? 'unchanged' : 'update' };
    }
    if (payment.amount === 0) return { ...base, action: 'skipped' };
    return {
      ...base,
      action: 'new',
      candidate: manualKeys.has(`${payment.date}/${payment.amount}`),
    };
  });
}

function read(
  query: unknown,
  body: unknown,
  readSheet: (file: Buffer) => string[][],
):
  | { error: string }
  | {
      payments: CardPayment[];
      authorizations: number;
      problems: { line: number; message: string }[];
    } {
  const parsedQuery = importQuery.safeParse(query);
  if (!parsedQuery.success) return { error: parsedQuery.error.issues[0].message };
  if (!Buffer.isBuffer(body) || body.length === 0)
    return { error: 'Choose the usage history file to import' };
  let sheet: string[][];
  try {
    sheet = readSheet(body);
  } catch {
    return {
      error: 'The file could not be read. Use the .xls file downloaded from the Woori Card website',
    };
  }
  const parsed = parseCardSheet(parsedQuery.data.kind, sheet);
  if ('error' in parsed) return parsed;
  if (parsed.payments.length > maxPayments)
    return { error: `Import at most ${maxPayments} payments at a time` };
  return parsed;
}

export function cardImportRouter(
  pool: Pool,
  { readSheet }: { readSheet: (file: Buffer) => string[][] },
) {
  const router = Router();
  router.use(express.raw({ type: () => true, limit: maxFileBytes }));

  router.post('/preview', async (req, res) => {
    const read1 = read(req.query, req.body, readSheet);
    if ('error' in read1) return void res.status(422).json({ error: read1.error });
    const rows = await plan(pool, read1.payments);
    res.json({ rows, authorizations: read1.authorizations, problems: read1.problems });
  });

  router.post('/import', async (req, res) => {
    const read1 = read(req.query, req.body, readSheet);
    if ('error' in read1) return void res.status(422).json({ error: read1.error });
    if (read1.problems.length > 0) {
      return void res.status(422).json({
        error: `${read1.problems.length} row(s) cannot be read. Nothing was saved`,
        problems: read1.problems,
      });
    }
    const skipCandidates = importQuery.parse(req.query).skipCandidates;
    const result = await inTransaction(pool, async (client) => {
      // One import at a time, so two uploads of the same file cannot both add the same payment.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ledger_entries_import'))");
      const rows = await plan(client, read1.payments, true);
      const count = { added: 0, updated: 0, removed: 0, unchanged: 0, skipped: 0 };
      for (const row of rows) {
        if (row.action === 'new' && !(skipCandidates && row.candidate)) {
          await client.query(
            `INSERT INTO ledger_entries (entry_date, kind, amount, category_id, merchant, memo, source, source_card, source_ref)
             VALUES ($1, 'expense', $2, ${ruleCategorySql("'expense'", '$3::text')}, $3, $4, $5, $6, $7)`,
            [
              row.date,
              row.amount,
              row.merchant.slice(0, 50),
              row.memo,
              source,
              row.card,
              row.approval,
            ],
          );
          count.added += 1;
        } else if (row.action === 'update') {
          await client.query(
            'UPDATE ledger_entries SET amount = $1, memo = $2, updated_at = now() WHERE id = $3',
            [row.amount, row.memo, row.entryId],
          );
          count.updated += 1;
        } else if (row.action === 'remove') {
          await client.query('DELETE FROM ledger_entries WHERE id = $1', [row.entryId]);
          count.removed += 1;
        } else if (row.action === 'unchanged') count.unchanged += 1;
        else count.skipped += 1;
      }
      return count;
    });
    res.json(result);
  });

  return router;
}
