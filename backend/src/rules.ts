import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { HttpError, parseId } from './standard/http.js';

// #60 Keyword rules: a merchant that contains the keyword (ignoring letter case) gets the rule's category.
// Rules fill only entries saved without a category; a category the user chose is never replaced.

/**
 * SQL for the category the rules give an entry, or NULL: the longest matching keyword of the same kind whose
 * category is not hidden. `kind` and `merchant` are SQL expressions (parameters or columns).
 */
export const ruleCategorySql = (kind: string, merchant: string) => `(
  SELECT r.category_id FROM ledger_category_rules r
  JOIN ledger_categories rc ON rc.id = r.category_id AND NOT rc.hidden
  WHERE r.kind = ${kind} AND ${merchant} <> '' AND strpos(lower(${merchant}), lower(r.keyword)) > 0
  ORDER BY char_length(r.keyword) DESC, r.id
  LIMIT 1
)`;

/** Merchant names and keywords (`subject`, e.g. "The merchant"): trimmed, NFC (so Hangul pasted from macOS matches), at most 50 characters. */
export const merchantText = (subject: string) =>
  z
    .string({ error: `${subject} must be text` })
    .trim()
    .normalize('NFC')
    .max(50, `${subject} must be 50 characters or fewer`);

const ruleBody = z.object(
  {
    keyword: merchantText('The keyword').min(1, 'Enter a keyword'),
    categoryId: z
      .number({ error: 'Choose a category' })
      .int('Choose a category')
      .positive('Choose a category'),
  },
  { error: 'The request body must be a JSON object' },
);

type Row = {
  id: string;
  keyword: string;
  kind: 'income' | 'expense';
  category_id: string;
  category_name: string;
  category_hidden: boolean;
};

const select = `SELECT r.id, r.keyword, r.kind, r.category_id, c.name AS category_name,
    c.hidden AS category_hidden
  FROM ledger_category_rules r JOIN ledger_categories c ON c.id = r.category_id`;

const toRule = (row: Row) => ({
  id: Number(row.id),
  keyword: row.keyword,
  kind: row.kind,
  categoryId: Number(row.category_id),
  categoryName: row.category_name,
  // A rule for a hidden category is kept but does not apply until the category is shown again.
  categoryHidden: row.category_hidden,
});

const duplicateKeyword = 'A keyword already exists for this kind';

export function rulesRouter(pool: Pool) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const { rows } = await pool.query<Row>(
      `${select} ORDER BY r.kind = 'income', lower(r.keyword), r.id`,
    );
    res.json({ rules: rows.map(toRule) });
  });

  router.post('/', async (req, res) => {
    const body = ruleBody.parse(req.body);
    let inserted;
    try {
      // The kind comes from the category, and a hidden category cannot get a new rule.
      inserted = await pool.query<{ id: string }>(
        `INSERT INTO ledger_category_rules (keyword, kind, category_id)
         SELECT $1::text, c.kind, c.id FROM ledger_categories c WHERE c.id = $2 AND NOT c.hidden
         RETURNING id`,
        [body.keyword, body.categoryId],
      );
    } catch (error) {
      if ((error as { code?: unknown }).code === '23505')
        throw new HttpError(409, duplicateKeyword);
      throw error;
    }
    if (!inserted.rows[0]) {
      const { rowCount } = await pool.query('SELECT 1 FROM ledger_categories WHERE id = $1', [
        body.categoryId,
      ]);
      throw new HttpError(
        400,
        rowCount ? 'Cannot create a rule for a hidden category' : 'Category not found',
      );
    }
    const { rows } = await pool.query<Row>(`${select} WHERE r.id = $1`, [inserted.rows[0].id]);
    res.status(201).json({ rule: toRule(rows[0]) });
  });

  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'rule');
    const { rowCount } = await pool.query('DELETE FROM ledger_category_rules WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, 'Rule not found');
    res.status(204).end();
  });

  return router;
}
