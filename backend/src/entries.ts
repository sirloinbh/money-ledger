import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { inTransaction } from './db.js';
import { merchantText, ruleCategorySql } from './rules.js';
import { HttpError, parseId } from './standard/http.js';

// #38 Income and expense entries: whole-won amounts, a date in the service calendar, a category of the same kind.
// #60 An entry may have a merchant and may be uncategorized (category NULL, "미분류"). Saved without a
// category, it gets the category of the matching keyword rule if there is one; a chosen category is kept.

const date = z
  .string({ error: '날짜를 YYYY-MM-DD 형식으로 입력하세요' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: '날짜를 YYYY-MM-DD 형식으로 입력하세요', abort: true })
  // PostgreSQL has no year 0, and far-off years are typos: keep dates in a range a ledger can mean.
  .refine(
    (value) => {
      const year = Number(value.slice(0, 4));
      return year >= 1900 && year <= 2100;
    },
    { error: '날짜는 1900년부터 2100년 사이로 입력하세요', abort: true },
  )
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, '없는 날짜입니다');

const amount = z
  .number({ error: '금액을 숫자로 입력하세요' })
  .int('금액은 원 단위 정수로 입력하세요')
  .min(0, '금액은 0원 이상이어야 합니다')
  .max(Number.MAX_SAFE_INTEGER, '금액이 너무 큽니다');

const categoryId = z
  .number({ error: '카테고리를 고르세요' })
  .int('카테고리를 고르세요')
  .positive('카테고리를 고르세요');

const objectBody = { error: '요청 본문은 JSON 객체여야 합니다' };

const entryBody = z.object(
  {
    date,
    kind: z.enum(['income', 'expense'], { error: '종류는 수입 또는 지출 중에서 고르세요' }),
    amount,
    // null or left out: uncategorized unless a rule matches the merchant.
    categoryId: categoryId.nullable().default(null),
    merchant: merchantText('가맹점은').default(''),
    memo: z
      .string({ error: '메모는 글자로 입력하세요' })
      .trim()
      .max(200, '메모는 200자 이하로 입력하세요')
      .default(''),
  },
  objectBody,
);
type EntryBody = z.infer<typeof entryBody>;

const listQuery = z.object({
  // `uncategorized=true` lists only entries without a category: the bulk classification list.
  uncategorized: z.enum(['true'], { error: 'uncategorized는 true만 쓸 수 있습니다' }).optional(),
});

const maxClassify = 200;
const classifyBody = z.object(
  {
    entryIds: z
      .array(
        z
          .number({ error: '내역 ID가 올바르지 않습니다' })
          .int()
          .positive('내역 ID가 올바르지 않습니다'),
        {
          error: '분류할 내역을 고르세요',
        },
      )
      .min(1, '분류할 내역을 고르세요')
      .max(maxClassify, `한 번에 ${maxClassify}건까지 분류할 수 있습니다`),
    categoryId,
    // Also save each merchant of the classified entries as a rule for this category.
    remember: z.boolean({ error: '규칙 저장 여부가 올바르지 않습니다' }).default(false),
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
 * entry may keep the hidden category it already has (`keep`). This gives the Korean message; the write
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
  if (!category) throw new HttpError(400, '카테고리를 찾을 수 없습니다');
  if (category.kind !== body.kind) {
    throw new HttpError(400, '카테고리의 종류가 내역의 종류와 다릅니다');
  }
  if (category.hidden && body.categoryId !== keep) {
    throw new HttpError(400, '숨긴 카테고리에는 새 내역을 넣을 수 없습니다');
  }
}

// Backstop only: the write's own conditions already require a category of the same kind. If the foreign key
// ever fails anyway, answer like the check does instead of with a 500.
async function writing<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if ((error as { code?: unknown }).code === '23503') {
      throw new HttpError(400, '카테고리의 종류가 내역의 종류와 다릅니다');
    }
    throw error;
  }
}

const changedMeanwhile = '카테고리가 방금 바뀌었습니다. 다시 시도하세요';

async function findEntry(pool: Pool, id: number) {
  const { rows } = await pool.query<Row>(`${select} WHERE e.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, '내역을 찾을 수 없습니다');
  return rows[0];
}

type Chosen = EntryBody & { categoryId: number };
const chosen = (body: EntryBody): body is Chosen => body.categoryId !== null;

export function entriesRouter(pool: Pool) {
  const router = Router();

  // The latest entries first. Period and category filters come with #39.
  router.get('/', async (req, res) => {
    const query = listQuery.parse(req.query);
    const { rows } = await pool.query<Row>(
      query.uncategorized
        ? `${select} WHERE e.category_id IS NULL ORDER BY e.entry_date DESC, e.id DESC LIMIT ${maxClassify}`
        : `${select} ORDER BY e.entry_date DESC, e.id DESC LIMIT 100`,
    );
    res.json({ entries: rows.map(toEntry) });
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
      if (!category) throw new HttpError(400, '카테고리를 찾을 수 없습니다');
      if (category.hidden) throw new HttpError(400, '숨긴 카테고리로는 분류할 수 없습니다');
      const other = await client.query(
        'SELECT 1 FROM ledger_entries WHERE id = ANY($1::bigint[]) AND kind <> $2 LIMIT 1',
        [ids, category.kind],
      );
      if (other.rowCount) throw new HttpError(400, '고른 카테고리와 종류가 다른 내역이 있습니다');
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
    const id = parseId(req.params.id, '내역');
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
      if (!rows[0]) throw new HttpError(404, '내역을 찾을 수 없습니다');
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
    const id = parseId(req.params.id, '내역');
    const { rowCount } = await pool.query('DELETE FROM ledger_entries WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, '내역을 찾을 수 없습니다');
    res.status(204).end();
  });

  return router;
}
