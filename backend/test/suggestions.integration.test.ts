import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

type Suggestion = { entryId: number; categoryId: number; categoryName: string; from: string };

// #154 Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
// Each test empties the ledger tables and re-runs 002 (default categories), 003 and 006.
test('category suggestions from past classifications', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async () => {
    await pool.query('TRUNCATE ledger_categories RESTART IDENTITY CASCADE');
    await runMigration(pool, '002_ledger_categories.sql');
    await runMigration(pool, '003_ledger_entries.sql');
    await runMigration(pool, '006_ledger_classification.sql');
    const { rows } = await pool.query<{ id: string; kind: string; name: string }>(
      'SELECT id, kind, name FROM ledger_categories',
    );
    return Object.fromEntries(rows.map((row) => [`${row.kind}/${row.name}`, Number(row.id)]));
  };
  const addEntry = async (
    merchant: string,
    categoryId: number | null,
    more: { kind?: string; date?: string } = {},
  ) => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO ledger_entries (entry_date, kind, amount, category_id, merchant)
       VALUES ($1, $2, 1000, $3, $4) RETURNING id`,
      [more.date ?? '2026-11-05', more.kind ?? 'expense', categoryId, merchant],
    );
    return Number(rows[0].id);
  };
  const categoryOf = async (id: number) =>
    (
      await pool.query<{ category_id: string | null }>(
        'SELECT category_id FROM ledger_entries WHERE id = $1',
        [id],
      )
    ).rows[0].category_id;

  await t.test('the uncategorized list gets suggestions from matching merchants', async () => {
    const ids = await reset();
    const food = ids['expense/식비'];
    const living = ids['expense/생활'];
    await addEntry('스타벅스 강남점', food, { date: '2026-10-01' });
    await addEntry('이마트', living);
    await addEntry('이마트', living);
    await addEntry('이마트 성수점', food);
    const coffee = await addEntry('스타벅스 역삼점', null);
    const mart = await addEntry('이마트 왕십리점', null);
    const unknown = await addEntry('동네 철물점', null);
    const noMerchant = await addEntry('', null);
    const income = await addEntry('스타벅스', null, { kind: 'income' });

    await withApi(pool, async (call) => {
      const response = await call('/api/ledger/entries/suggestions');
      assert.equal(response.status, 200);
      const byEntry = new Map(
        (response.data.suggestions as Suggestion[]).map((item) => [item.entryId, item]),
      );
      assert.deepEqual(byEntry.get(coffee), {
        entryId: coffee,
        categoryId: food,
        categoryName: '식비',
        from: '스타벅스 강남점',
      });
      // "이마트" and "이마트 성수점" have the same key; 생활 has two uses against one.
      assert.equal(byEntry.get(mart)?.categoryId, living);
      for (const id of [unknown, noMerchant, income]) assert.equal(byEntry.has(id), false);
      assert.equal(byEntry.size, 2);
    });
  });

  await t.test('a hidden category is never suggested', async () => {
    const ids = await reset();
    await addEntry('넷플릭스', ids['expense/여가']);
    const entry = await addEntry('넷플릭스', null);
    await pool.query('UPDATE ledger_categories SET hidden = true WHERE id = $1', [
      ids['expense/여가'],
    ]);
    await withApi(pool, async (call) => {
      assert.deepEqual((await call('/api/ledger/entries/suggestions')).data.suggestions, []);
      const applied = await call('/api/ledger/entries/apply-suggestions', {
        method: 'POST',
        body: { entryIds: [entry] },
      });
      assert.deepEqual(applied.data, { classified: 0, skipped: 1 });
    });
    assert.equal(await categoryOf(entry), null);
  });

  await t.test(
    'applying classifies by the suggestion, skips the rest and saves no rule',
    async () => {
      const ids = await reset();
      const food = ids['expense/식비'];
      await addEntry('스타벅스 강남점', food);
      const coffee = await addEntry('스타벅스 역삼점', null);
      const unknown = await addEntry('동네 철물점', null);
      const done = await addEntry('스타벅스 서초점', ids['expense/여가']);

      await withApi(pool, async (call) => {
        const applied = await call('/api/ledger/entries/apply-suggestions', {
          method: 'POST',
          body: { entryIds: [coffee, unknown, done, coffee, 999_999] },
        });
        assert.equal(applied.status, 200);
        // Duplicates count once: the suggestion entry is classified; the others are skipped.
        assert.deepEqual(applied.data, { classified: 1, skipped: 3 });
      });
      assert.equal(Number(await categoryOf(coffee)), food);
      assert.equal(await categoryOf(unknown), null);
      assert.equal(Number(await categoryOf(done)), ids['expense/여가'], 'a chosen category stays');
      const rules = await pool.query('SELECT 1 FROM ledger_category_rules');
      assert.equal(rules.rowCount, 0);
    },
  );

  await t.test('applying refuses a bad body', async () => {
    await reset();
    await withApi(pool, async (call) => {
      for (const body of [{}, { entryIds: [] }, { entryIds: [0] }, { entryIds: 'x' }]) {
        const response = await call('/api/ledger/entries/apply-suggestions', {
          method: 'POST',
          body,
        });
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(typeof response.data.error, 'string');
      }
    });
  });
});
