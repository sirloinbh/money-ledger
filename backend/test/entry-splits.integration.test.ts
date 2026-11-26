import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { createApp } from '../src/app.js';
import { listen, withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

const url = await testDatabase();

type Part = { categoryId: number; amount: number };
type Entry = {
  id: number;
  amount: number;
  categoryId: number | null;
  splits: { categoryId: number; categoryName: string; amount: number }[];
};

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test(
  'split payments: saving, the sum check, undoing, totals and CSV',
  { skip: !url },
  async (t) => {
    const pool = new Pool({ connectionString: url });
    t.after(() => pool.end());
    await pool.query('TRUNCATE ledger_categories RESTART IDENTITY CASCADE');
    const category = async (name: string, kind = 'expense', hidden = false) =>
      (
        await pool.query<{ id: number }>(
          'INSERT INTO ledger_categories (kind, name, hidden) VALUES ($1, $2, $3) RETURNING id',
          [kind, name, hidden],
        )
      ).rows[0].id;
    const food = await category('Food');
    const home = await category('Household');
    const fun = await category('Fun');
    const old = await category('Old', 'expense', true);
    const salary = await category('Salary', 'income');

    // Read raw, not as JSON: the export is a CSV file.
    const exportedRows = async () => {
      const { server, port } = await listen(createApp(pool, { today: () => '2026-11-16' }));
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/ledger/entries/csv`);
        assert.equal(response.status, 200);
        return (await response.text()).split('\r\n').filter(Boolean).slice(1);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    };

    await withApi(pool, async (api) => {
      const save = (body: Record<string, unknown>, id?: number) =>
        api(id ? `/api/ledger/entries/${id}` : '/api/ledger/entries', {
          method: id ? 'PUT' : 'POST',
          body: { date: '2026-11-03', kind: 'expense', merchant: 'Coupang', ...body },
        });
      const entry = (result: { data: unknown }) => (result.data as { entry: Entry }).entry;
      const parts = (...list: [number, number][]): Part[] =>
        list.map(([categoryId, amount]) => ({ categoryId, amount }));

      // Saved: the parts keep the order, the entry's category is the largest part.
      const created = await save({ amount: 30000, splits: parts([food, 10000], [home, 20000]) });
      assert.equal(created.status, 201);
      const split = entry(created);
      assert.equal(split.amount, 30000);
      assert.equal(split.categoryId, home);
      assert.deepEqual(
        split.splits.map((part) => [part.categoryName, part.amount]),
        [
          ['Food', 10000],
          ['Household', 20000],
        ],
      );

      // The sum check and the other rules, each with a message.
      const bad = async (body: Record<string, unknown>, id?: number) => {
        const result = await save(body, id);
        assert.equal(result.status, 400, JSON.stringify(result.data));
        return (result.data as { error: string }).error;
      };
      assert.match(
        await bad({ amount: 30000, splits: parts([food, 10000], [home, 19999]) }),
        /add up to ₩29,999/,
      );
      assert.match(await bad({ amount: 30000, splits: parts([food, 30000]) }), /at least 2 parts/);
      assert.match(
        await bad({ amount: 30000, splits: parts([food, 10000], [food, 20000]) }),
        /each category once/i,
      );
      assert.match(
        await bad({ amount: 30000, splits: parts([food, 0], [home, 30000]) }),
        /₩1 or more/,
      );
      assert.match(
        await bad({ amount: 30000, splits: parts([food, 10000], [salary, 20000]) }),
        /expense categories/,
      );
      assert.match(
        await bad({ amount: 30000, splits: parts([food, 10000], [old, 20000]) }),
        /hidden/,
      );
      assert.match(
        await bad({ amount: 30000, kind: 'income', splits: parts([food, 10000], [home, 20000]) }),
        /expense/,
      );
      // A split entry is edited with its parts: leaving them out is refused.
      assert.match(await bad({ amount: 31000, categoryId: food }, split.id), /is split/);

      // Another entry without a split, plus one more split: totals count the parts, not the payments.
      await save({ amount: 5000, categoryId: food, merchant: 'Cafe' });
      await save({ amount: 9000, splits: parts([fun, 4000], [home, 5000]) });
      const summary = (await api('/api/ledger/summary?month=2026-11')).data as {
        expense: number;
        categories: { name: string; amount: number }[];
      };
      assert.equal(summary.expense, 44000);
      assert.deepEqual(
        Object.fromEntries(summary.categories.map((row) => [row.name, row.amount])),
        { Household: 25000, Food: 15000, Fun: 4000 },
      );
      const spent = async () =>
        Object.fromEntries(
          (
            (await api('/api/ledger/budgets?month=2026-11')).data as {
              budgets: { name: string; spent: number }[];
            }
          ).budgets.map((row) => [row.name, row.spent]),
        );
      assert.equal((await spent()).Household, 25000);

      // The category filter finds an entry by any of its parts.
      const listed = async (query: string) =>
        ((await api(`/api/ledger/entries?${query}`)).data as { entries: Entry[] }).entries;
      assert.equal((await listed(`category=${food}`)).length, 2); // the split's Food part and the plain Food entry
      assert.equal((await listed(`category=${fun}`)).length, 1);

      // CSV: one row per part, so the rows add up per category.
      const rows = await exportedRows();
      assert.equal(rows.length, 5);
      assert.ok(rows.includes('2026-11-03,expense,20000,Household,Coupang,'));
      assert.ok(rows.includes('2026-11-03,expense,10000,Food,Coupang,'));

      // Replaced with new parts, then undone: the entry keeps one category and the parts are gone.
      const again = await save(
        { amount: 30000, splits: parts([fun, 12000], [food, 18000]) },
        split.id,
      );
      assert.equal(again.status, 200);
      assert.equal(entry(again).categoryId, food);
      const undone = await save({ amount: 30000, categoryId: home, splits: null }, split.id);
      assert.equal(undone.status, 200);
      assert.equal(entry(undone).categoryId, home);
      assert.deepEqual(entry(undone).splits, []);
      assert.equal(
        (await pool.query('SELECT 1 FROM ledger_entry_splits WHERE entry_id = $1', [split.id]))
          .rowCount,
        0,
      );
      assert.equal(
        ((await api('/api/ledger/summary?month=2026-11')).data as { expense: number }).expense,
        44000,
      );

      // Deleting an entry deletes its parts.
      const other = entry(await save({ amount: 700, splits: parts([food, 300], [home, 400]) }));
      await api(`/api/ledger/entries/${other.id}`, { method: 'DELETE' });
      assert.equal(
        (await pool.query('SELECT 1 FROM ledger_entry_splits WHERE entry_id = $1', [other.id]))
          .rowCount,
        0,
      );
    });

    // The weekly report ranks categories by their parts (the week of Sun 2026-11-08 to Sat 11-14).
    await pool.query('TRUNCATE ledger_entries RESTART IDENTITY CASCADE');
    await withApi(
      pool,
      async (api) => {
        const post = (body: Record<string, unknown>) =>
          api('/api/ledger/entries', {
            method: 'POST',
            body: { date: '2026-11-10', kind: 'expense', ...body },
          });
        await post({
          amount: 10000,
          splits: [
            { categoryId: food, amount: 3000 },
            { categoryId: fun, amount: 7000 },
          ],
        });
        await post({ amount: 1000, categoryId: food });
        const made = await api('/api/reports/generate', { method: 'POST' });
        assert.equal(made.status, 200);
        const created = (made.data as { created: { id: number; period: string }[] }).created;
        const week = created.find((item) => item.period === 'week')!;
        const report = (
          (await api(`/api/reports/${week.id}`)).data as {
            report: { total: number; topCategories: { name: string; amount: number }[] };
          }
        ).report;
        assert.equal(report.total, 11000);
        assert.deepEqual(
          report.topCategories.map((item) => [item.name, item.amount]),
          [
            ['Fun', 7000],
            ['Food', 4000],
          ],
        );
      },
      { today: () => '2026-11-16' },
    );

    // The database refuses parts that do not add up, whatever wrote them.
    const direct = (
      await pool.query<{ id: number }>(
        `INSERT INTO ledger_entries (entry_date, kind, amount, category_id) VALUES ('2026-11-04', 'expense', 100, $1) RETURNING id`,
        [food],
      )
    ).rows[0].id;
    await assert.rejects(
      pool.query(
        'INSERT INTO ledger_entry_splits (entry_id, position, category_id, amount) VALUES ($1, 1, $2, 60), ($1, 2, $3, 30)',
        [direct, food, home],
      ),
      /add up to 90 but its amount is 100/,
    );
  },
);
