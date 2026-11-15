import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { HttpError, parseId } from './standard/http.js';

// #37 Income and expense categories. Categories are hidden instead of deleted, so entries keep them.

const kind = z.enum(['income', 'expense'], { error: 'Choose income or expense as the kind' });
const name = z
  .string({ error: 'Enter a category name' })
  .trim()
  // NFC: Hangul pasted in decomposed form (macOS) must match the composed name for the duplicate check.
  .normalize('NFC')
  .min(1, 'Enter a category name')
  .max(30, 'Enter a category name of 30 characters or fewer');

const objectBody = { error: 'The request body must be a JSON object' };
const createBody = z.object({ kind, name }, objectBody);
const updateBody = z
  .object(
    {
      name: name.optional(),
      hidden: z.boolean({ error: 'The hidden flag is not valid' }).optional(),
    },
    objectBody,
  )
  .refine((body) => body.name !== undefined || body.hidden !== undefined, {
    error: 'Send a new name or a hidden flag',
  });
const listQuery = z.object({
  kind: kind.optional(),
  // `visible=true` leaves out hidden categories: the list for a new entry.
  visible: z.enum(['true'], { error: 'visible can only be true' }).optional(),
});

type Row = { id: string; kind: 'income' | 'expense'; name: string; hidden: boolean };

const columns = 'id, kind, name, hidden';
const toCategory = (row: Row) => ({
  id: Number(row.id),
  kind: row.kind,
  name: row.name,
  hidden: row.hidden,
});

const duplicateName = 'A category with this name already exists for this kind';

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
    const id = parseId(req.params.id, 'category');
    const body = updateBody.parse(req.body);
    const { rows } = await saving(() =>
      pool.query<Row>(
        `UPDATE ledger_categories
         SET name = coalesce($2, name), hidden = coalesce($3, hidden), updated_at = now()
         WHERE id = $1 RETURNING ${columns}`,
        [id, body.name ?? null, body.hidden ?? null],
      ),
    );
    if (!rows[0]) throw new HttpError(404, 'Category not found');
    res.json({ category: toCategory(rows[0]) });
  });

  return router;
}
