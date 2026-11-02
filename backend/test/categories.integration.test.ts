import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { Pool } from 'pg';

import { withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
const prefix = '통합테스트';

type Category = { id: number; kind: string; name: string; hidden: boolean };

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('categories keep their rules against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  const cleanUp = () => pool.query('DELETE FROM categories WHERE name LIKE $1', [`${prefix}%`]);
  await cleanUp();
  t.after(async () => {
    await cleanUp();
    await pool.end();
  });

  await withApi(pool, async (call) => {
    const names = async (kind: string, query = '') => {
      const { data } = await call(`/api/categories${query}`);
      return (data.categories as Category[])
        .filter((category) => category.kind === kind && !category.name.startsWith(prefix))
        .map((category) => category.name);
    };

    await t.test('the default categories are stored in order with intact Korean', async () => {
      assert.deepEqual(await names('expense'), [
        '식비',
        '교통',
        '주거',
        '통신',
        '생활',
        '의료',
        '여가',
        '기타',
      ]);
      assert.deepEqual(await names('income'), ['급여', '부수입', '기타']);
    });

    const first = `${prefix}-A`;
    const second = `${prefix}-B`;
    let id = 0;

    await t.test('a name is unique within a kind but free across kinds', async () => {
      const created = await call('/api/categories', {
        method: 'POST',
        body: { kind: 'expense', name: first },
      });
      assert.equal(created.status, 201);
      id = (created.data.category as Category).id;
      assert.equal(typeof id, 'number');

      const duplicate = await call('/api/categories', {
        method: 'POST',
        body: { kind: 'expense', name: first },
      });
      assert.equal(duplicate.status, 409);
      assert.deepEqual(duplicate.data, { error: '같은 종류에 같은 이름의 카테고리가 있습니다' });

      const otherKind = await call('/api/categories', {
        method: 'POST',
        body: { kind: 'income', name: first },
      });
      assert.equal(otherKind.status, 201);
    });

    await t.test('renaming onto an existing name is refused and changes nothing', async () => {
      await call('/api/categories', { method: 'POST', body: { kind: 'expense', name: second } });
      const renamed = await call(`/api/categories/${id}`, {
        method: 'PATCH',
        body: { name: second },
      });
      assert.equal(renamed.status, 409);
      const { rows } = await pool.query('SELECT name FROM categories WHERE id = $1', [id]);
      assert.equal(rows[0].name, first);
    });

    await t.test(
      'a hidden category leaves the entry list, stays listed, and can return',
      async () => {
        const listed = async (query = '') => {
          const { data } = await call(`/api/categories${query}`);
          return (data.categories as Category[]).find((category) => category.id === id);
        };
        const hidden = await call(`/api/categories/${id}`, {
          method: 'PATCH',
          body: { hidden: true },
        });
        assert.equal(hidden.status, 200);
        assert.equal(await listed(), undefined);
        assert.equal((await listed('?includeHidden=true'))?.hidden, true);

        await call(`/api/categories/${id}`, { method: 'PATCH', body: { hidden: false } });
        assert.equal((await listed())?.name, first);
      },
    );

    await t.test('re-running the migration does not restore a renamed default', async () => {
      const file = path.join(import.meta.dirname, '../../database/migrations/002_categories.sql');
      const renamed = `${prefix}-식비`;
      await pool.query(`UPDATE categories SET name = $1 WHERE kind = 'expense' AND name = '식비'`, [
        renamed,
      ]);
      try {
        await pool.query(await readFile(file, 'utf8'));
        const { rowCount } = await pool.query(
          `SELECT 1 FROM categories WHERE kind = 'expense' AND name = '식비'`,
        );
        assert.equal(rowCount, 0);
      } finally {
        await pool.query(`UPDATE categories SET name = '식비' WHERE name = $1`, [renamed]);
      }
    });
  });
});
