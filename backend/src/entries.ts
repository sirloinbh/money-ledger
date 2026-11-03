import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { HttpError, parseId } from './standard/http.js';

// #38 Income and expense entries: whole-won amounts, a date in the service calendar, a category of the same kind.

const date = z
  .string({ error: '날짜를 YYYY-MM-DD 형식으로 입력하세요' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: '날짜를 YYYY-MM-DD 형식으로 입력하세요', abort: true })
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, '없는 날짜입니다');

const amount = z
  .number({ error: '금액을 숫자로 입력하세요' })
  .int('금액은 원 단위 정수로 입력하세요')
  .min(0, '금액은 0원 이상이어야 합니다')
  .max(Number.MAX_SAFE_INTEGER, '금액이 너무 큽니다');

const entryBody = z.object(
  {
    date,
    kind: z.enum(['income', 'expense'], { error: '종류는 수입 또는 지출 중에서 고르세요' }),
    amount,
    categoryId: z
      .number({ error: '카테고리를 고르세요' })
      .int('카테고리를 고르세요')
      .positive('카테고리를 고르세요'),
    memo: z
      .string({ error: '메모는 글자로 입력하세요' })
      .trim()
      .max(200, '메모는 200자 이하로 입력하세요')
      .default(''),
  },
  { error: '요청 본문은 JSON 객체여야 합니다' },
);
type EntryBody = z.infer<typeof entryBody>;

type Row = {
  id: string;
  entry_date: string;
  kind: 'income' | 'expense';
  amount: string;
  category_id: string;
  category_name: string;
  memo: string;
};

const select = `SELECT e.id, e.entry_date, e.kind, e.amount, e.category_id, c.name AS category_name, e.memo
  FROM ledger_entries e JOIN ledger_categories c ON c.id = e.category_id`;

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
  categoryId: Number(row.category_id),
  categoryName: row.category_name,
  memo: row.memo,
});

/**
 * The category must exist and match the entry's kind. A hidden category is refused for a new choice, but an
 * entry may keep the hidden category it already has (`keep`).
 */
async function checkCategory(pool: Pool, body: EntryBody, keep?: number) {
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

// A category changed between the check and the write still fails the foreign key: answer the same way.
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

async function findEntry(pool: Pool, id: number) {
  const { rows } = await pool.query<Row>(`${select} WHERE e.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, '내역을 찾을 수 없습니다');
  return rows[0];
}

export function entriesRouter(pool: Pool) {
  const router = Router();

  // The latest entries first. Period and category filters come with #39.
  router.get('/', async (_req, res) => {
    const { rows } = await pool.query<Row>(
      `${select} ORDER BY e.entry_date DESC, e.id DESC LIMIT 100`,
    );
    res.json({ entries: rows.map(toEntry) });
  });

  router.post('/', async (req, res) => {
    const body = entryBody.parse(req.body);
    await checkCategory(pool, body);
    const { rows } = await writing(() =>
      pool.query<{ id: string }>(
        `INSERT INTO ledger_entries (entry_date, kind, amount, category_id, memo)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [body.date, body.kind, body.amount, body.categoryId, body.memo],
      ),
    );
    res.status(201).json({ entry: toEntry(await findEntry(pool, Number(rows[0].id))) });
  });

  router.put('/:id', async (req, res) => {
    const id = parseId(req.params.id, '내역');
    const body = entryBody.parse(req.body);
    const current = await findEntry(pool, id);
    await checkCategory(pool, body, Number(current.category_id));
    await writing(() =>
      pool.query(
        `UPDATE ledger_entries
         SET entry_date = $2, kind = $3, amount = $4, category_id = $5, memo = $6, updated_at = now()
         WHERE id = $1`,
        [id, body.date, body.kind, body.amount, body.categoryId, body.memo],
      ),
    );
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
