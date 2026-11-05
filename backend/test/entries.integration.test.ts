import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

type Entry = {
  id: number;
  date: string;
  kind: string;
  amount: number;
  categoryId: number | null;
  categoryName: string | null;
  merchant: string;
  memo: string;
};

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
// Each test empties the ledger tables and re-runs 002 (default categories) and 003.
test('ledger entries against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async () => {
    await pool.query('TRUNCATE ledger_categories RESTART IDENTITY CASCADE');
    await runMigration(pool, '002_ledger_categories.sql');
    await runMigration(pool, '003_ledger_entries.sql');
  };

  // Default category ids by "kind/name", e.g. ids['expense/식비'].
  const categoryIds = async () => {
    const { rows } = await pool.query<{ id: string; kind: string; name: string }>(
      'SELECT id, kind, name FROM ledger_categories',
    );
    return Object.fromEntries(rows.map((row) => [`${row.kind}/${row.name}`, Number(row.id)]));
  };

  await t.test('an entry is saved, listed newest first and shows its category', async () => {
    await reset();
    const ids = await categoryIds();
    await withApi(pool, async (call) => {
      const older = await call('/api/ledger/entries', {
        method: 'POST',
        body: {
          date: '2026-11-01',
          kind: 'income',
          amount: 3000000,
          categoryId: ids['income/급여'],
        },
      });
      assert.equal(older.status, 201);
      const added = await call('/api/ledger/entries', {
        method: 'POST',
        body: {
          date: '2026-11-03',
          kind: 'expense',
          amount: 12500,
          categoryId: ids['expense/식비'],
          memo: '  점심 ',
        },
      });
      assert.equal(added.status, 201);
      const entry = added.data.entry as Entry;
      assert.deepEqual(
        { ...entry, id: 0 },
        {
          id: 0,
          date: '2026-11-03',
          kind: 'expense',
          amount: 12500,
          categoryId: ids['expense/식비'],
          categoryName: '식비',
          merchant: '',
          memo: '점심',
        },
      );
      assert.equal((older.data.entry as Entry).memo, '');

      const { data } = await call('/api/ledger/entries');
      assert.deepEqual(
        (data.entries as Entry[]).map((listed) => listed.date),
        ['2026-11-03', '2026-11-01'],
      );
    });
  });

  await t.test('the largest safe amount round-trips exactly', async () => {
    await reset();
    const ids = await categoryIds();
    await withApi(pool, async (call) => {
      const { data } = await call('/api/ledger/entries', {
        method: 'POST',
        body: {
          date: '2026-11-03',
          kind: 'income',
          amount: Number.MAX_SAFE_INTEGER,
          categoryId: ids['income/기타'],
        },
      });
      assert.equal((data.entry as Entry).amount, Number.MAX_SAFE_INTEGER);
    });
  });

  await t.test('a category of the other kind is refused by the server and the DB', async () => {
    await reset();
    const ids = await categoryIds();
    await withApi(pool, async (call) => {
      const response = await call('/api/ledger/entries', {
        method: 'POST',
        body: { date: '2026-11-03', kind: 'income', amount: 1000, categoryId: ids['expense/식비'] },
      });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error: '카테고리의 종류가 내역의 종류와 다릅니다' });
    });
    await assert.rejects(
      pool.query(
        "INSERT INTO ledger_entries (entry_date, kind, amount, category_id) VALUES ('2026-11-03', 'income', 1, $1)",
        [ids['expense/식비']],
      ),
      { code: '23503' },
    );
  });

  await t.test('editing keeps a hidden category but cannot choose another one', async () => {
    await reset();
    const ids = await categoryIds();
    await withApi(pool, async (call) => {
      const { data } = await call('/api/ledger/entries', {
        method: 'POST',
        body: {
          date: '2026-11-02',
          kind: 'expense',
          amount: 5000,
          categoryId: ids['expense/여가'],
        },
      });
      const entry = data.entry as Entry;
      await call(`/api/ledger/categories/${ids['expense/여가']}`, {
        method: 'PATCH',
        body: { hidden: true },
      });
      await call(`/api/ledger/categories/${ids['expense/의료']}`, {
        method: 'PATCH',
        body: { hidden: true },
      });

      const kept = await call(`/api/ledger/entries/${entry.id}`, {
        method: 'PUT',
        body: {
          date: '2026-11-03',
          kind: 'expense',
          amount: 7000,
          categoryId: ids['expense/여가'],
          memo: '영화',
        },
      });
      assert.equal(kept.status, 200);
      assert.deepEqual(
        {
          date: (kept.data.entry as Entry).date,
          amount: (kept.data.entry as Entry).amount,
          memo: (kept.data.entry as Entry).memo,
        },
        { date: '2026-11-03', amount: 7000, memo: '영화' },
      );

      const otherHidden = await call(`/api/ledger/entries/${entry.id}`, {
        method: 'PUT',
        body: {
          date: '2026-11-03',
          kind: 'expense',
          amount: 7000,
          categoryId: ids['expense/의료'],
        },
      });
      assert.equal(otherHidden.status, 400);
      assert.deepEqual(otherHidden.data, { error: '숨긴 카테고리에는 새 내역을 넣을 수 없습니다' });

      const newOnHidden = await call('/api/ledger/entries', {
        method: 'POST',
        body: { date: '2026-11-03', kind: 'expense', amount: 1, categoryId: ids['expense/여가'] },
      });
      assert.equal(newOnHidden.status, 400);
    });
  });

  await t.test('a deleted entry is gone and a second delete is a 404', async () => {
    await reset();
    const ids = await categoryIds();
    await withApi(pool, async (call) => {
      const { data } = await call('/api/ledger/entries', {
        method: 'POST',
        body: {
          date: '2026-11-03',
          kind: 'expense',
          amount: 1000,
          categoryId: ids['expense/교통'],
        },
      });
      const entry = data.entry as Entry;
      const removed = await call(`/api/ledger/entries/${entry.id}`, { method: 'DELETE' });
      assert.equal(removed.status, 204);
      const again = await call(`/api/ledger/entries/${entry.id}`, { method: 'DELETE' });
      assert.equal(again.status, 404);
      assert.deepEqual(again.data, { error: '내역을 찾을 수 없습니다' });
      const missing = await call(`/api/ledger/entries/${entry.id}`, {
        method: 'PUT',
        body: { date: '2026-11-03', kind: 'expense', amount: 1, categoryId: ids['expense/교통'] },
      });
      assert.equal(missing.status, 404);
      const { data: list } = await call('/api/ledger/entries');
      assert.deepEqual(list.entries, []);
    });
  });
});
