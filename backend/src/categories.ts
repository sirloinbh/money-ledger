import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { HttpError, parseId } from './standard/http.js';

// #37 Income and expense categories. Categories are hidden instead of deleted, so entries keep them.

const kind = z.enum(['income', 'expense'], { error: '종류는 수입 또는 지출 중에서 고르세요' });
const name = z
  .string({ error: '카테고리 이름을 입력하세요' })
  .trim()
  .min(1, '카테고리 이름을 입력하세요')
  .max(30, '카테고리 이름은 30자 이하로 입력하세요');

const objectBody = { error: '요청 본문은 JSON 객체여야 합니다' };
const createBody = z.object({ kind, name }, objectBody);
const updateBody = z
  .object(
    {
      name: name.optional(),
      hidden: z.boolean({ error: '숨김 여부가 올바르지 않습니다' }).optional(),
    },
    objectBody,
  )
  .refine((body) => body.name !== undefined || body.hidden !== undefined, {
    error: '바꿀 이름이나 숨김 여부를 보내세요',
  });
const listQuery = z.object({
  kind: kind.optional(),
  // `visible=true` leaves out hidden categories: the list for a new entry.
  visible: z.enum(['true'], { error: 'visible은 true만 쓸 수 있습니다' }).optional(),
});

type Row = { id: string; kind: 'income' | 'expense'; name: string; hidden: boolean };

const columns = 'id, kind, name, hidden';
const toCategory = (row: Row) => ({
  id: Number(row.id),
  kind: row.kind,
  name: row.name,
  hidden: row.hidden,
});

const duplicateName = '같은 종류에 이미 있는 카테고리 이름입니다';

async function saving<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if ((error as { code?: unknown }).code === '23505') throw new HttpError(409, duplicateName);
    throw error;
  }
}

export function categoriesRouter(pool: Pool) {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = listQuery.parse(req.query);
    const { rows } = await pool.query<Row>(
      `SELECT ${columns} FROM ledger_categories
       WHERE ($1::text IS NULL OR kind = $1) AND ($2::boolean IS NULL OR NOT hidden)
       ORDER BY kind = 'income', id`,
      [query.kind ?? null, query.visible ? true : null],
    );
    res.json({ categories: rows.map(toCategory) });
  });

  router.post('/', async (req, res) => {
    const body = createBody.parse(req.body);
    const { rows } = await saving(() =>
      pool.query<Row>(
        `INSERT INTO ledger_categories (kind, name) VALUES ($1, $2) RETURNING ${columns}`,
        [body.kind, body.name],
      ),
    );
    res.status(201).json({ category: toCategory(rows[0]) });
  });

  router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id, '카테고리');
    const body = updateBody.parse(req.body);
    const { rows } = await saving(() =>
      pool.query<Row>(
        `UPDATE ledger_categories
         SET name = coalesce($2, name), hidden = coalesce($3, hidden), updated_at = now()
         WHERE id = $1 RETURNING ${columns}`,
        [id, body.name ?? null, body.hidden ?? null],
      ),
    );
    if (!rows[0]) throw new HttpError(404, '카테고리를 찾을 수 없습니다');
    res.json({ category: toCategory(rows[0]) });
  });

  return router;
}
