import type { Express } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { HttpError, parseId } from '../standard/http.js';

const kindSchema = z.enum(['income', 'expense'], { error: '종류는 수입 또는 지출이어야 합니다' });
const nameSchema = z
  .string({ error: '이름을 입력하세요' })
  .trim()
  .min(1, '이름을 입력하세요')
  .max(30, '이름은 30자 이내로 입력하세요');

const listQuery = z.object({
  includeHidden: z
    .enum(['true', 'false'], { error: '숨김 포함 여부가 올바르지 않습니다' })
    .optional(),
});
const createBody = z.object({ kind: kindSchema, name: nameSchema });
const updateBody = z
  .object({
    name: nameSchema.optional(),
    hidden: z.boolean({ error: '숨김 여부가 올바르지 않습니다' }).optional(),
  })
  .refine((body) => body.name !== undefined || body.hidden !== undefined, {
    error: '바꿀 내용을 입력하세요',
  });

type CategoryRow = { id: string; kind: string; name: string; hidden: boolean };

// pg returns bigint as a string; ids stay within 15 digits, so a JS number is exact.
const toCategory = (row: CategoryRow) => ({ ...row, id: Number(row.id) });

function withDuplicateMessage(error: unknown): unknown {
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : '';
  return code === '23505'
    ? new HttpError(409, '같은 종류에 같은 이름의 카테고리가 있습니다')
    : error;
}

export function registerCategoriesRoutes(app: Express, pool: Pool) {
  // Hidden categories stay out by default so a new entry can never pick one.
  app.get('/api/categories', async (req, res) => {
    const { includeHidden } = listQuery.parse(req.query);
    const { rows } = await pool.query<CategoryRow>(
      `SELECT id, kind, name, hidden FROM categories
       WHERE $1::boolean OR NOT hidden
       ORDER BY kind, id`,
      [includeHidden === 'true'],
    );
    res.json({ categories: rows.map(toCategory) });
  });

  app.post('/api/categories', async (req, res) => {
    const { kind, name } = createBody.parse(req.body);
    const { rows } = await pool
      .query<CategoryRow>(
        'INSERT INTO categories (kind, name) VALUES ($1, $2) RETURNING id, kind, name, hidden',
        [kind, name],
      )
      .catch((error: unknown) => {
        throw withDuplicateMessage(error);
      });
    res.status(201).json({ category: toCategory(rows[0]) });
  });

  // The kind stays fixed: entries already recorded under a category must keep their meaning.
  app.patch('/api/categories/:id', async (req, res) => {
    const id = parseId(req.params.id, '카테고리');
    const { name, hidden } = updateBody.parse(req.body);
    const { rows } = await pool
      .query<CategoryRow>(
        `UPDATE categories
         SET name = COALESCE($2::text, name),
             hidden = COALESCE($3::boolean, hidden),
             updated_at = now()
         WHERE id = $1
         RETURNING id, kind, name, hidden`,
        [id, name ?? null, hidden ?? null],
      )
      .catch((error: unknown) => {
        throw withDuplicateMessage(error);
      });
    if (rows.length === 0) throw new HttpError(404, '카테고리를 찾을 수 없습니다');
    res.json({ category: toCategory(rows[0]) });
  });
}
