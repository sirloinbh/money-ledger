import express, { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod/v4';

import { MAX_WON, MAX_WON_TEXT, serviceDate as date } from '../contract.js';
import { inTransaction } from '../db.js';
import { listFilter, listQuery } from './entries.js';
import { merchantText, ruleCategorySql } from './rules.js';

// #44 Entries as CSV (decisions 2026-11-16). Export: the entry list's filters, oldest first, UTF-8 with a BOM so
// Excel shows Korean, columns date,kind,amount,category,merchant,memo. Import: the browser reads the file and maps
// its columns; the server checks every row (preview) and saves all of them in one transaction or none (import).
// A row with the same date, kind, amount and merchant as an existing entry is a likely duplicate: the preview
// flags it and the user chooses to skip or keep those rows. An empty category lets the keyword rules decide.

const maxImportRows = 2000;
const maxLine = 2_147_483_647;
const header = ['date', 'kind', 'amount', 'category', 'merchant', 'memo'];

/** One CSV field: quoted when it has a comma, quote or line break, and never read as a formula by Excel. */
function csvField(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Undoes csvField's guard, so an exported file imports back as the same text. */
const unguarded = (value: string) => (/^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value);

const rowInput = z.object({
  // The line in the user's file, for the messages.
  // At most the largest `int`: the duplicate check sends the lines as int[] (#200).
  line: z
    .number({ error: 'Each row needs its line number' })
    .int('A line number must be a whole number')
    .positive('A line number must be 1 or more')
    .max(maxLine, `A line number must be ${maxLine} or less`),
  date: z.string(),
  kind: z.string(),
  amount: z.string(),
  category: z.string().default(''),
  merchant: z.string().default(''),
  memo: z.string().default(''),
});
export const importBody = z
  .object(
    {
      rows: z
        .array(rowInput, { error: 'Send the rows to import' })
        .min(1, 'The file has no rows to import')
        .max(maxImportRows, `Import at most ${maxImportRows} rows at a time`),
      // Rows flagged as likely duplicates are left out when true.
      skipDuplicates: z.boolean().default(true),
    },
    { error: 'The request body must be a JSON object' },
  )
  .refine(
    // Duplicates are found by line, so two rows with one line number would both be skipped (#200).
    (body) => new Set(body.rows.map((row) => row.line)).size === body.rows.length,
    { error: 'Each row must have its own line number' },
  );
type RowInput = z.infer<typeof rowInput>;

type Valid = {
  line: number;
  date: string;
  kind: 'income' | 'expense';
  amount: number;
  categoryId: number | null;
  merchant: string;
  memo: string;
};
type Problem = { line: number; message: string };

const merchant = merchantText('The merchant');
const memo = z.string().trim().max(200, 'The note must be 200 characters or fewer');

/**
 * Checks every row against the categories as they are now. Problems name the file's line. Inside the import's
 * transaction (`lock`) the categories are share-locked, so one cannot be hidden or renamed before the INSERT.
 */
async function check(db: Pool | PoolClient, rows: RowInput[], lock = false) {
  const { rows: categories } = await db.query<{ id: number; kind: string; name: string }>(
    `SELECT id, kind, name FROM ledger_categories WHERE NOT hidden${lock ? ' FOR SHARE' : ''}`,
  );
  const byName = new Map(categories.map((c) => [`${c.kind}/${c.name.normalize('NFC')}`, c.id]));
  const valid: Valid[] = [];
  const problems: Problem[] = [];
  for (const row of rows) {
    const fail = (message: string) => problems.push({ line: row.line, message });
    const day = date.safeParse(row.date.trim());
    if (!day.success) {
      fail(`Date "${row.date}": ${day.error.issues[0].message}`);
      continue;
    }
    if (row.kind !== 'income' && row.kind !== 'expense') {
      fail(`Kind "${row.kind}" is not income or expense`);
      continue;
    }
    const digits = row.amount.trim();
    if (!/^\d{1,16}$/.test(digits) || Number(digits) > MAX_WON) {
      fail(`Amount "${row.amount}" is not a whole number of won from 0 to ${MAX_WON_TEXT}`);
      continue;
    }
    const shop = merchant.safeParse(unguarded(row.merchant.trim()));
    if (!shop.success) {
      fail(shop.error.issues[0].message);
      continue;
    }
    const note = memo.safeParse(unguarded(row.memo.trim()));
    if (!note.success) {
      fail(note.error.issues[0].message);
      continue;
    }
    const categoryName = unguarded(row.category.trim()).normalize('NFC');
    let categoryId: number | null = null;
    if (categoryName) {
      const found = byName.get(`${row.kind}/${categoryName}`);
      if (found === undefined) {
        fail(`There is no ${row.kind} category named "${categoryName}" in use`);
        continue;
      }
      categoryId = found;
    }
    valid.push({
      line: row.line,
      date: day.data,
      kind: row.kind,
      amount: Number(digits),
      categoryId,
      merchant: shop.data,
      memo: note.data,
    });
  }
  return { valid, problems };
}

/** Lines of rows that match an existing entry on date, kind, amount and merchant. */
async function duplicates(db: Pool | PoolClient, rows: Valid[]) {
  if (rows.length === 0) return new Set<number>();
  const { rows: found } = await db.query<{ line: number }>(
    `SELECT r.line FROM unnest($1::int[], $2::date[], $3::text[], $4::bigint[], $5::text[])
       AS r(line, entry_date, kind, amount, merchant)
     WHERE EXISTS (
       SELECT 1 FROM ledger_entries e
       WHERE e.entry_date = r.entry_date AND e.kind = r.kind AND e.amount = r.amount AND e.merchant = r.merchant
     )`,
    [
      rows.map((row) => row.line),
      rows.map((row) => row.date),
      rows.map((row) => row.kind),
      rows.map((row) => row.amount),
      rows.map((row) => row.merchant),
    ],
  );
  return new Set(found.map((row) => row.line));
}

export function entryCsvRouter(pool: Pool, { today }: { today: () => string }) {
  const router = Router();
  // Its own limit: 2,000 rows with notes do not fit the app's 256kb default.
  router.use(express.json({ limit: '2mb' }));

  router.get('/', async (req, res) => {
    const query = listQuery.parse(req.query);
    // `uncategorized=true` exports only entries without a category, as it lists them (#200).
    const { where, params } = listFilter(
      query.uncategorized ? { ...query, category: 'none' } : query,
    );
    const { rows } = await pool.query<{
      entry_date: string;
      kind: string;
      amount: string;
      category_name: string | null;
      merchant: string;
      memo: string;
    }>(
      // #292 A split payment is exported as one row per part (its category and amount), so category totals match.
      `SELECT e.entry_date, e.kind, p.amount::text AS amount, c.name AS category_name, e.merchant, e.memo
       FROM ledger_entries e JOIN ledger_entry_parts p ON p.entry_id = e.id
       LEFT JOIN ledger_categories c ON c.id = p.category_id
       ${where} ORDER BY e.entry_date, e.id, p.amount DESC, p.category_id`,
      params,
    );
    const lines = [
      header.join(','),
      ...rows.map((row) =>
        [row.entry_date, row.kind, row.amount, row.category_name ?? '', row.merchant, row.memo]
          .map(csvField)
          .join(','),
      ),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ledger-entries-${today()}.csv"`);
    // The BOM tells Excel the file is UTF-8, so Korean is not garbled.
    res.send(`${String.fromCharCode(0xfeff)}${lines.join('\r\n')}\r\n`);
  });

  router.post('/preview', async (req, res) => {
    const body = importBody.parse(req.body);
    const { valid, problems } = await check(pool, body.rows);
    const duplicate = await duplicates(pool, valid);
    res.json({
      rows: body.rows.length,
      valid: valid.length,
      problems,
      duplicates: [...duplicate].sort((a, b) => a - b),
    });
  });

  router.post('/import', async (req, res) => {
    const body = importBody.parse(req.body);
    type Result = { problems: Problem[] } | { imported: number; skipped: number };
    const result = await inTransaction<Result>(pool, async (client) => {
      // One import at a time, so two imports of the same file cannot both miss each other's rows. An entry saved
      // by hand meanwhile is not locked out: duplicates are a hint for the user, not a constraint.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ledger_entries_import'))");
      const { valid, problems } = await check(client, body.rows, true);
      if (problems.length > 0) return { problems };
      const duplicate = await duplicates(client, valid);
      const saving = body.skipDuplicates ? valid.filter((row) => !duplicate.has(row.line)) : valid;
      if (saving.length > 0) {
        await client.query(
          `INSERT INTO ledger_entries (entry_date, kind, amount, category_id, merchant, memo)
           SELECT src.entry_date, src.kind, src.amount,
                  coalesce(src.category_id, ${ruleCategorySql('src.kind', 'src.merchant')}), src.merchant, src.memo
           FROM unnest($1::date[], $2::text[], $3::bigint[], $4::bigint[], $5::text[], $6::text[])
             WITH ORDINALITY AS src(entry_date, kind, amount, category_id, merchant, memo, n)
           ORDER BY src.n`,
          [
            saving.map((row) => row.date),
            saving.map((row) => row.kind),
            saving.map((row) => row.amount),
            saving.map((row) => row.categoryId),
            saving.map((row) => row.merchant),
            saving.map((row) => row.memo),
          ],
        );
      }
      return { imported: saving.length, skipped: valid.length - saving.length };
    });
    if ('problems' in result) {
      // Nothing was saved: every row must be right first.
      res.status(422).json({
        error: `${result.problems.length} row(s) cannot be imported. Nothing was saved`,
        problems: result.problems,
      });
      return;
    }
    res.json(result);
  });

  return router;
}
