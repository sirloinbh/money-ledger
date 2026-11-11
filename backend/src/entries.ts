import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { inTransaction } from './db.js';
import { merchantText, ruleCategorySql } from './rules.js';
import { HttpError, parseId } from './standard/http.js';

// #38 Income and expense entries: whole-won amounts, a date in the service calendar, a category of the same kind.
// #60 An entry may have a merchant and may be uncategorized (category NULL, "Uncategorized"). Saved without a
// category, it gets the category of the matching keyword rule if there is one; a chosen category is kept.

export const date = z
  .string({ error: 'Enter the date as YYYY-MM-DD' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Enter the date as YYYY-MM-DD', abort: true })
  // PostgreSQL has no year 0, and far-off years are typos: keep dates in a range a ledger can mean.
  .refine(
    (value) => {
      const year = Number(value.slice(0, 4));
      return year >= 1900 && year <= 2100;
    },
    { error: 'Enter a date between 1900 and 2100', abort: true },
  )
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'That date does not exist');

const amount = z
  .number({ error: 'Enter the amount as a number' })
  .int('Enter the amount as a whole number of won')
  .min(0, 'The amount must be ₩0 or more')
  .max(Number.MAX_SAFE_INTEGER, 'The amount is too large');

const categoryId = z
  .number({ error: 'Choose a category' })
  .int('Choose a category')
  .positive('Choose a category');

const objectBody = { error: 'The request body must be a JSON object' };

const entryBody = z.object(
  {
    date,
    kind: z.enum(['income', 'expense'], { error: 'Choose income or expense as the kind' }),
    amount,
    // null or left out: uncategorized unless a rule matches the merchant.
    categoryId: categoryId.nullable().default(null),
    merchant: merchantText('The merchant').default(''),
    memo: z
      .string({ error: 'The note must be text' })
      .trim()
      .max(200, 'The note must be 200 characters or fewer')
      .default(''),
  },
  objectBody,
);
type EntryBody = z.infer<typeof entryBody>;

const pageSizes = { default: 50, max: 100 };
const positiveInt = (message: string) =>
  z
    .string({ error: message })
    .regex(/^[1-9]\d{0,8}$/, { error: message })
    .transform(Number);

// #39 Filters for the entry list. Every parameter is optional; `from` and `to` both include their own day.
const listQuery = z
  .object({
    // `uncategorized=true` lists only entries without a category: the bulk classification list.
    uncategorized: z.enum(['true'], { error: 'uncategorized can only be true' }).optional(),
    from: date.optional(),
    to: date.optional(),
    kind: z
      .enum(['income', 'expense'], { error: 'Choose income or expense as the kind' })
      .optional(),
    // A category id, or `none` for Uncategorized.
    category: z
      .union([z.literal('none'), positiveInt('The category is not valid')], {
        error: 'The category is not valid',
      })
      .optional(),
    // Searched in the merchant and the memo, ignoring letter case.
    q: z
      .string({ error: 'The search term must be text' })
      .trim()
      .max(50, 'The search term must be 50 characters or fewer')
      .optional(),
    page: positiveInt('The page number is not valid').optional(),
    size: positiveInt('The page size is not valid')
      .pipe(z.number().max(pageSizes.max, `You can view at most ${pageSizes.max} entries per page`))
      .optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    error: 'The start date is after the end date',
  });
type ListQuery = z.infer<typeof listQuery>;

/** `%`, `_` and `\` typed by the user are matched as themselves in ILIKE (default escape `\`). */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/** WHERE conditions and their parameters for the list filters. */
function listFilter(query: ListQuery) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (sql: (n: string) => string, value: unknown) => {
    params.push(value);
    conditions.push(sql(`$${params.length}`));
  };
  if (query.from) add((n) => `e.entry_date >= ${n}::date`, query.from);
  if (query.to) add((n) => `e.entry_date <= ${n}::date`, query.to);
  if (query.kind) add((n) => `e.kind = ${n}::text`, query.kind);
  if (query.category === 'none') conditions.push('e.category_id IS NULL');
  else if (query.category !== undefined) add((n) => `e.category_id = ${n}::bigint`, query.category);
  if (query.q) add((n) => `(e.merchant ILIKE ${n} OR e.memo ILIKE ${n})`, likePattern(query.q));
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

const maxClassify = 200;
const classifyBody = z.object(
  {
    entryIds: z
      .array(
        z
          .number({ error: 'The entry ID is not valid' })
          .int()
          .positive('The entry ID is not valid'),
        {
          error: 'Select the entries to classify',
        },
      )
      .min(1, 'Select the entries to classify')
      .max(maxClassify, `You can classify at most ${maxClassify} entries at a time`),
    categoryId,
    // Also save each merchant of the classified entries as a rule for this category.
    remember: z.boolean({ error: 'The save-as-rule flag is not valid' }).default(false),
  },
  objectBody,
);

type Row = {
  id: string;
  entry_date: string;
  kind: 'income' | 'expense';
  amount: string;
  category_id: string | null;
  category_name: string | null;
  merchant: string;
  memo: string;
};

const select = `SELECT e.id, e.entry_date, e.kind, e.amount, e.category_id, c.name AS category_name,
    e.merchant, e.memo
  FROM ledger_entries e LEFT JOIN ledger_categories c ON c.id = e.category_id`;

// pg returns bigint as a string; amounts stay exact as long as they are safe integers.
function won(value: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`amount out of safe range: ${value}`);
  return parsed;
}

const toEntry = (row: Row) => ({
  id: Number(row.id),
  date: row.entry_date,
  kind: row.kind,
  amount: won(row.amount),
  categoryId: row.category_id === null ? null : Number(row.category_id),
  categoryName: row.category_name,
  merchant: row.merchant,
  memo: row.memo,
});

/**
 * The category must exist and match the entry's kind. A hidden category is refused for a new choice, but an
 * entry may keep the hidden category it already has (`keep`). This gives the message; the write
 * repeats the same conditions so a category hidden in between cannot slip through.
 */
async function checkCategory(
  pool: Pool,
  body: { categoryId: number; kind: string },
  keep?: number | null,
) {
  const { rows } = await pool.query<{ kind: string; hidden: boolean }>(
    'SELECT kind, hidden FROM ledger_categories WHERE id = $1',
    [body.categoryId],
  );
  const category = rows[0];
  if (!category) throw new HttpError(400, 'Category not found');
  if (category.kind !== body.kind) {
    throw new HttpError(400, "The category's kind does not match the entry's kind");
  }
  if (category.hidden && body.categoryId !== keep) {
    throw new HttpError(400, 'Cannot add a new entry to a hidden category');
  }
}

// Backstop only: the write's own conditions already require a category of the same kind. If the foreign key
// ever fails anyway, answer like the check does instead of with a 500.
async function writing<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if ((error as { code?: unknown }).code === '23503') {
      throw new HttpError(400, "The category's kind does not match the entry's kind");
    }
    throw error;
  }
}

const changedMeanwhile = 'The category just changed. Try again';

async function findEntry(pool: Pool, id: number) {
  const { rows } = await pool.query<Row>(`${select} WHERE e.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Entry not found');
  return rows[0];
}

type Chosen = EntryBody & { categoryId: number };
const chosen = (body: EntryBody): body is Chosen => body.categoryId !== null;

export function entriesRouter(pool: Pool) {
  const router = Router();

  // The latest entries first, filtered and split into pages (#39). `total` counts every matching entry.
  router.get('/', async (req, res) => {
    const query = listQuery.parse(req.query);
    if (query.uncategorized) {
      const { rows } = await pool.query<Row>(
        `${select} WHERE e.category_id IS NULL ORDER BY e.entry_date DESC, e.id DESC LIMIT ${maxClassify}`,
      );
      res.json({ entries: rows.map(toEntry) });
      return;
    }
    const page = query.page ?? 1;
    const pageSize = query.size ?? pageSizes.default;
    const { where, params } = listFilter(query);
    const n = params.length;
    const [list, count] = await Promise.all([
      pool.query<Row>(
        `${select} ${where} ORDER BY e.entry_date DESC, e.id DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...params, pageSize, (page - 1) * pageSize],
      ),
      pool.query<{ total: string }>(
        `SELECT count(*) AS total FROM ledger_entries e ${where}`,
        params,
      ),
    ]);
    res.json({
      entries: list.rows.map(toEntry),
      total: Number(count.rows[0].total),
      page,
      pageSize,
    });
  });

  router.post('/', async (req, res) => {
    const body = entryBody.parse(req.body);
    if (!chosen(body)) {
      // Uncategorized unless a rule matches, decided in the same statement as the write.
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO ledger_entries (entry_date, kind, amount, category_id, merchant, memo)
         VALUES ($1::date, $2::text, $3::bigint, ${ruleCategorySql('$2::text', '$4::text')}, $4::text, $5::text)
         RETURNING id`,
        [body.date, body.kind, body.amount, body.merchant, body.memo],
      );
      res.status(201).json({ entry: toEntry(await findEntry(pool, Number(rows[0].id))) });
      return;
    }
    await checkCategory(pool, body);
    // One statement: the row is written only if the category is still visible and of the same kind.
    const { rows } = await writing(() =>
      pool.query<{ id: string }>(
        `INSERT INTO ledger_entries (entry_date, kind, amount, category_id, merchant, memo)
         SELECT $1::date, $2, $3::bigint, c.id, $5::text, $6::text FROM ledger_categories c
         WHERE c.id = $4 AND c.kind = $2 AND NOT c.hidden
         RETURNING id`,
        [body.date, body.kind, body.amount, body.categoryId, body.merchant, body.memo],
      ),
    );
    if (!rows[0]) {
      await checkCategory(pool, body); // names what changed, e.g. the category was just hidden
      throw new HttpError(409, changedMeanwhile);
    }
    res.status(201).json({ entry: toEntry(await findEntry(pool, Number(rows[0].id))) });
  });

  // Bulk classification of uncategorized entries. Entries that got a category meanwhile are left alone.
  router.post('/classify', async (req, res) => {
    const body = classifyBody.parse(req.body);
    const ids = [...new Set(body.entryIds)];
    const result = await inTransaction(pool, async (client) => {
      // FOR SHARE: the category cannot be hidden or changed until this commits.
      const category = (
        await client.query<{ kind: string; hidden: boolean }>(
          'SELECT kind, hidden FROM ledger_categories WHERE id = $1 FOR SHARE',
          [body.categoryId],
        )
      ).rows[0];
      if (!category) throw new HttpError(400, 'Category not found');
      if (category.hidden) throw new HttpError(400, 'Cannot classify into a hidden category');
      const other = await client.query(
        'SELECT 1 FROM ledger_entries WHERE id = ANY($1::bigint[]) AND kind <> $2 LIMIT 1',
        [ids, category.kind],
      );
      if (other.rowCount)
        throw new HttpError(400, 'Some entries are a different kind from the chosen category');
      const updated = await client.query<{ merchant: string }>(
        // Rows are locked in id order first, so two overlapping bulk classifications wait instead of deadlocking.
        `WITH target AS (
           SELECT id FROM ledger_entries WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE
         )
         UPDATE ledger_entries e SET category_id = $2, updated_at = now()
         FROM target WHERE e.id = target.id AND e.kind = $3 AND e.category_id IS NULL
         RETURNING e.merchant`,
        [ids, body.categoryId, category.kind],
      );
      let rulesAdded = 0;
      let rulesUpdated = 0;
      if (body.remember) {
        // One rule per merchant (ignoring letter case); an existing rule for it now points at this category.
        // A rule that already points there is left alone and not counted. `xmax = 0` marks a new row: an
        // implementation detail of PostgreSQL (true for ordinary tables up to 17), not a documented API.
        const saved = await client.query<{ added: boolean }>(
          `INSERT INTO ledger_category_rules (keyword, kind, category_id)
           SELECT DISTINCT ON (lower(m)) m, $2::text, $3::bigint FROM unnest($1::text[]) AS m
           WHERE m <> '' ORDER BY lower(m), m
           ON CONFLICT (kind, lower(keyword))
           DO UPDATE SET category_id = EXCLUDED.category_id, updated_at = now()
           WHERE ledger_category_rules.category_id <> EXCLUDED.category_id
           RETURNING (xmax = 0) AS added`,
          [updated.rows.map((row) => row.merchant), category.kind, body.categoryId],
        );
        rulesAdded = saved.rows.filter((row) => row.added).length;
        rulesUpdated = saved.rows.length - rulesAdded;
      }
      const classified = updated.rowCount ?? 0;
      // Skipped: already categorized, deleted, or changed to the other kind meanwhile.
      return { classified, skipped: ids.length - classified, rulesAdded, rulesUpdated };
    });
    res.json(result);
  });

  // Applies the current rules to uncategorized entries only; categorized entries are never touched.
  router.post('/apply-rules', async (_req, res) => {
    const { rowCount } = await pool.query(
      `UPDATE ledger_entries e SET category_id = m.category_id, updated_at = now()
       FROM (
         SELECT u.id, u.kind, u.merchant, ${ruleCategorySql('u.kind', 'u.merchant')} AS category_id
         FROM ledger_entries u WHERE u.category_id IS NULL AND u.merchant <> ''
       ) m
       -- The kind and merchant are checked again on the row being updated: an edit committed while this runs
       -- must not get a category picked for its old kind or merchant.
       WHERE e.id = m.id AND m.category_id IS NOT NULL AND e.category_id IS NULL
         AND e.kind = m.kind AND e.merchant = m.merchant`,
    );
    res.json({ classified: rowCount ?? 0 });
  });

  router.put('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'entry');
    const body = entryBody.parse(req.body);
    if (!chosen(body)) {
      const { rows } = await pool.query<{ id: string }>(
        `UPDATE ledger_entries
         SET entry_date = $2::date, kind = $3::text, amount = $4::bigint,
             category_id = ${ruleCategorySql('$3::text', '$5::text')}, merchant = $5::text, memo = $6::text,
             updated_at = now()
         WHERE id = $1 RETURNING id`,
        [id, body.date, body.kind, body.amount, body.merchant, body.memo],
      );
      if (!rows[0]) throw new HttpError(404, 'Entry not found');
      res.json({ entry: toEntry(await findEntry(pool, id)) });
      return;
    }
    const current = await findEntry(pool, id);
    await checkCategory(
      pool,
      body,
      current.category_id === null ? null : Number(current.category_id),
    );
    // The hidden-category exception compares with the entry's category at write time, not at the check.
    const { rows } = await writing(() =>
      pool.query<{ id: string }>(
        `UPDATE ledger_entries e
         SET entry_date = $2, kind = $3, amount = $4, category_id = $5, merchant = $6, memo = $7,
             updated_at = now()
         FROM ledger_categories c
         WHERE e.id = $1 AND c.id = $5 AND c.kind = $3
           AND (NOT c.hidden OR c.id = e.category_id)
         RETURNING e.id`,
        [id, body.date, body.kind, body.amount, body.categoryId, body.merchant, body.memo],
      ),
    );
    if (!rows[0]) {
      const latest = await findEntry(pool, id); // 404 if it was deleted meanwhile
      await checkCategory(
        pool,
        body,
        latest.category_id === null ? null : Number(latest.category_id),
      );
      throw new HttpError(409, changedMeanwhile);
    }
    res.json({ entry: toEntry(await findEntry(pool, id)) });
  });

  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'entry');
    const { rowCount } = await pool.query('DELETE FROM ledger_entries WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, 'Entry not found');
    res.status(204).end();
  });

  return router;
}
