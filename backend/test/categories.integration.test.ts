import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

type Category = { id: number; kind: string; name: string; hidden: boolean };

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
// Each test empties the table and re-runs 002, which seeds the defaults into an empty table.
test('ledger categories against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async () => {
    await pool.query('TRUNCATE ledger_categories RESTART IDENTITY CASCADE');
    await runMigration(pool, '002_ledger_categories.sql');
  };
  const names = (categories: Category[], kind: string) =>
    categories.filter((category) => category.kind === kind).map((category) => category.name);

  await t.test('the defaults are listed with expense categories first', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const { status, data } = await call('/api/ledger/categories');
      assert.equal(status, 200);
      const categories = data.categories as Category[];
      assert.deepEqual(names(categories, 'expense'), [
        '식비',
        '교통',
        '주거',
        '통신',
        '생활',
        '의료',
        '여가',
        '기타',
      ]);
      assert.deepEqual(names(categories, 'income'), ['급여', '부수입', '기타']);
      assert.equal(categories[0].kind, 'expense');
      assert.equal(typeof categories[0].id, 'number');
      assert.ok(categories.every((category) => !category.hidden));
    });
  });

  await t.test('re-running the migration does not bring back a renamed default', async () => {
    await reset();
    await pool.query(
      "UPDATE ledger_categories SET name = '외식' WHERE kind = 'expense' AND name = '식비'",
    );
    await runMigration(pool, '002_ledger_categories.sql');
    const { rows } = await pool.query("SELECT name FROM ledger_categories WHERE name = '식비'");
    assert.equal(rows.length, 0);
  });

  await t.test('a new category is trimmed and a same-kind duplicate is refused', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const added = await call('/api/ledger/categories', {
        method: 'POST',
        body: { kind: 'expense', name: '  반려동물 ' },
      });
      assert.equal(added.status, 201);
      assert.deepEqual(
        { ...(added.data.category as Category), id: 0 },
        {
          id: 0,
          kind: 'expense',
          name: '반려동물',
          hidden: false,
        },
      );

      const duplicate = await call('/api/ledger/categories', {
        method: 'POST',
        body: { kind: 'expense', name: '반려동물' },
      });
      assert.equal(duplicate.status, 409);
      assert.deepEqual(duplicate.data, { error: '같은 종류에 이미 있는 카테고리 이름입니다' });

      // The other kind may use the same name, as the defaults do with 기타.
      const otherKind = await call('/api/ledger/categories', {
        method: 'POST',
        body: { kind: 'income', name: '반려동물' },
      });
      assert.equal(otherKind.status, 201);
    });
  });

  await t.test('renaming to a name the kind already has is refused', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const { data } = await call('/api/ledger/categories?kind=expense');
      const [food, transport] = data.categories as Category[];
      const clash = await call(`/api/ledger/categories/${transport.id}`, {
        method: 'PATCH',
        body: { name: food.name },
      });
      assert.equal(clash.status, 409);
      assert.deepEqual(clash.data, { error: '같은 종류에 이미 있는 카테고리 이름입니다' });

      const renamed = await call(`/api/ledger/categories/${transport.id}`, {
        method: 'PATCH',
        body: { name: '대중교통' },
      });
      assert.equal(renamed.status, 200);
      assert.equal((renamed.data.category as Category).name, '대중교통');
    });
  });

  await t.test('a hidden category leaves the list for new entries and can come back', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const { data } = await call('/api/ledger/categories?kind=income');
      const side = (data.categories as Category[]).find((category) => category.name === '부수입');
      assert.ok(side);

      const hidden = await call(`/api/ledger/categories/${side.id}`, {
        method: 'PATCH',
        body: { hidden: true },
      });
      assert.equal(hidden.status, 200);
      assert.equal((hidden.data.category as Category).hidden, true);

      const forEntry = await call('/api/ledger/categories?kind=income&visible=true');
      assert.deepEqual(names(forEntry.data.categories as Category[], 'income'), ['급여', '기타']);

      const all = await call('/api/ledger/categories?kind=income');
      const stored = (all.data.categories as Category[]).find(
        (category) => category.id === side.id,
      );
      assert.equal(stored?.hidden, true);

      const shown = await call(`/api/ledger/categories/${side.id}`, {
        method: 'PATCH',
        body: { hidden: false },
      });
      assert.equal((shown.data.category as Category).hidden, false);
    });
  });
});
