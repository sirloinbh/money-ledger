import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

type Entry = {
  id: number;
  kind: string;
  categoryId: number | null;
  categoryName: string | null;
  merchant: string;
};
type Rule = {
  id: number;
  keyword: string;
  kind: string;
  categoryId: number;
  categoryName: string;
  categoryHidden: boolean;
};

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
// Each test empties the ledger tables and re-runs 002 (default categories), 003 and 006.
test('keyword rules and classification against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async () => {
    await pool.query('TRUNCATE ledger_categories RESTART IDENTITY CASCADE');
    await runMigration(pool, '002_ledger_categories.sql');
    await runMigration(pool, '003_ledger_entries.sql');
    await runMigration(pool, '006_ledger_classification.sql');
    await runMigration(pool, '006_ledger_classification.sql'); // re-running is safe
  };

  const categoryIds = async () => {
    const { rows } = await pool.query<{ id: string; kind: string; name: string }>(
      'SELECT id, kind, name FROM ledger_categories',
    );
    return Object.fromEntries(rows.map((row) => [`${row.kind}/${row.name}`, Number(row.id)]));
  };

  type Call = Parameters<Parameters<typeof withApi>[1]>[0];
  const addEntry = async (call: Call, body: object) => {
    const response = await call('/api/ledger/entries', {
      method: 'POST',
      body: { date: '2026-11-05', kind: 'expense', amount: 1000, ...body },
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.entry as Entry;
  };
  const addRule = async (call: Call, keyword: string, categoryId: number) => {
    const response = await call('/api/ledger/rules', {
      method: 'POST',
      body: { keyword, categoryId },
    });
    return response;
  };

  await t.test(
    'an entry saved without a category gets the matching rule or stays 미분류',
    async () => {
      await reset();
      const ids = await categoryIds();
      await withApi(pool, async (call) => {
        assert.equal((await addRule(call, '스타벅스', ids['expense/식비'])).status, 201);
        // Longer keywords win over shorter ones that also match.
        await addRule(call, '쿠팡', ids['expense/생활']);
        await addRule(call, '쿠팡이츠', ids['expense/식비']);

        const coffee = await addEntry(call, { merchant: 'STARBUCKS 스타벅스 강남점' });
        assert.deepEqual([coffee.categoryId, coffee.categoryName], [ids['expense/식비'], '식비']);
        assert.equal(
          (await addEntry(call, { merchant: '쿠팡이츠 주문' })).categoryId,
          ids['expense/식비'],
        );
        assert.equal(
          (await addEntry(call, { merchant: '쿠팡(주)' })).categoryId,
          ids['expense/생활'],
        );

        const unknown = await addEntry(call, { merchant: '동네 철물점' });
        assert.deepEqual([unknown.categoryId, unknown.categoryName], [null, null]);
        assert.equal((await addEntry(call, { merchant: '' })).categoryId, null);
        // A rule of the other kind never applies.
        assert.equal(
          (await addEntry(call, { kind: 'income', merchant: '스타벅스' })).categoryId,
          null,
        );

        // A category the user chose is kept even when a rule matches the merchant.
        const chosen = await addEntry(call, {
          merchant: '스타벅스',
          categoryId: ids['expense/여가'],
        });
        assert.equal(chosen.categoryId, ids['expense/여가']);
      });
    },
  );

  await t.test('keywords match regardless of letter case and skip hidden categories', async () => {
    await reset();
    const ids = await categoryIds();
    await withApi(pool, async (call) => {
      await addRule(call, 'netflix', ids['expense/여가']);
      assert.equal(
        (await addEntry(call, { merchant: 'NETFLIX.COM' })).categoryId,
        ids['expense/여가'],
      );

      await call(`/api/ledger/categories/${ids['expense/여가']}`, {
        method: 'PATCH',
        body: { hidden: true },
      });
      assert.equal((await addEntry(call, { merchant: 'Netflix' })).categoryId, null);
      const rules = (await call('/api/ledger/rules')).data.rules as Rule[];
      assert.equal(rules[0].categoryHidden, true);
    });
  });

  await t.test('editing without a category applies the rules, a chosen one is kept', async () => {
    await reset();
    const ids = await categoryIds();
    await withApi(pool, async (call) => {
      const entry = await addEntry(call, { merchant: '이마트' });
      assert.equal(entry.categoryId, null);
      await addRule(call, '이마트', ids['expense/생활']);
      const base = { date: '2026-11-05', kind: 'expense', amount: 1000, merchant: '이마트' };
      const ruled = await call(`/api/ledger/entries/${entry.id}`, { method: 'PUT', body: base });
      assert.equal((ruled.data.entry as Entry).categoryId, ids['expense/생활']);
      const kept = await call(`/api/ledger/entries/${entry.id}`, {
        method: 'PUT',
        body: { ...base, categoryId: ids['expense/식비'] },
      });
      assert.equal((kept.data.entry as Entry).categoryId, ids['expense/식비']);
      const missing = await call('/api/ledger/entries/999999', { method: 'PUT', body: base });
      assert.equal(missing.status, 404);
    });
  });

  await t.test(
    'bulk classification fills only uncategorized entries of the same kind',
    async () => {
      await reset();
      const ids = await categoryIds();
      await withApi(pool, async (call) => {
        const a = await addEntry(call, { merchant: '김밥천국' });
        const b = await addEntry(call, { merchant: '김밥천국' });
        const c = await addEntry(call, { merchant: '' });
        const chosen = await addEntry(call, {
          merchant: '김밥천국',
          categoryId: ids['expense/여가'],
        });
        const income = await addEntry(call, { kind: 'income', merchant: '회사' });

        const list = (await call('/api/ledger/entries?uncategorized=true')).data.entries as Entry[];
        assert.deepEqual(
          list.map((entry) => entry.id).sort(),
          [a.id, b.id, c.id, income.id].sort(),
        );

        const mixed = await call('/api/ledger/entries/classify', {
          method: 'POST',
          body: { entryIds: [a.id, income.id], categoryId: ids['expense/식비'] },
        });
        assert.equal(mixed.status, 400);
        assert.deepEqual(mixed.data, { error: '고른 카테고리와 종류가 다른 내역이 있습니다' });

        const done = await call('/api/ledger/entries/classify', {
          method: 'POST',
          body: {
            entryIds: [a.id, b.id, c.id, chosen.id, 999999],
            categoryId: ids['expense/식비'],
          },
        });
        assert.equal(done.status, 200);
        assert.deepEqual(done.data, { classified: 3, skipped: 2, rulesAdded: 0, rulesUpdated: 0 });

        // The entry the user had already categorized keeps its category.
        const { rows } = await pool.query<{ id: string; category_id: string }>(
          'SELECT id, category_id FROM ledger_entries WHERE id = $1',
          [chosen.id],
        );
        assert.equal(Number(rows[0].category_id), ids['expense/여가']);
        assert.equal(((await call('/api/ledger/rules')).data.rules as Rule[]).length, 0);
      });
    },
  );

  await t.test('remember saves one rule per merchant and the next entry uses it', async () => {
    await reset();
    const ids = await categoryIds();
    await withApi(pool, async (call) => {
      await addRule(call, 'gs25', ids['expense/생활']);
      const entries = [
        await addEntry(call, { merchant: 'GS25' }), // matches the existing rule: not uncategorized
        await addEntry(call, { merchant: '올리브영' }),
        await addEntry(call, { merchant: '올리브영' }),
        await addEntry(call, { merchant: '' }),
      ];
      assert.equal(entries[0].categoryId, ids['expense/생활']);
      const gs = await addEntry(call, { merchant: 'GS25', categoryId: ids['expense/식비'] });
      // Reclassify by hand: move GS25 to 식비 via a fresh uncategorized entry.
      await pool.query('UPDATE ledger_entries SET category_id = NULL WHERE id = $1', [gs.id]);

      const done = await call('/api/ledger/entries/classify', {
        method: 'POST',
        body: {
          entryIds: [entries[1].id, entries[2].id, entries[3].id, gs.id],
          categoryId: ids['expense/식비'],
          remember: true,
        },
      });
      assert.deepEqual(done.data, { classified: 4, skipped: 0, rulesAdded: 1, rulesUpdated: 1 });
      const rules = (await call('/api/ledger/rules')).data.rules as Rule[];
      assert.deepEqual(
        rules.map((rule) => [rule.keyword, rule.categoryName]),
        [
          ['gs25', '식비'], // the existing rule now points at the category the user chose
          ['올리브영', '식비'],
        ],
      );
      assert.equal(
        (await addEntry(call, { merchant: '올리브영 강남' })).categoryId,
        ids['expense/식비'],
      );

      // Remembering the same merchant for the same category again changes and counts nothing.
      const again = await addEntry(call, { merchant: '올리브영', categoryId: ids['expense/식비'] });
      await pool.query('UPDATE ledger_entries SET category_id = NULL WHERE id = $1', [again.id]);
      const repeat = await call('/api/ledger/entries/classify', {
        method: 'POST',
        body: { entryIds: [again.id], categoryId: ids['expense/식비'], remember: true },
      });
      assert.deepEqual(repeat.data, { classified: 1, skipped: 0, rulesAdded: 0, rulesUpdated: 0 });
    });
  });

  await t.test('applying rules leaves an entry whose kind changed meanwhile alone', async () => {
    await reset();
    const ids = await categoryIds();
    await withApi(pool, async (call) => {
      const entry = await addEntry(call, { merchant: '편의점' });
      await addRule(call, '편의점', ids['expense/생활']);
      // Hold the row while apply-rules starts, then change its kind before releasing it.
      const editor = await pool.connect();
      try {
        await editor.query('BEGIN');
        await editor.query("UPDATE ledger_entries SET kind = 'income' WHERE id = $1", [entry.id]);
        const applying = call('/api/ledger/entries/apply-rules', { method: 'POST' });
        await new Promise((resolve) => setTimeout(resolve, 300));
        await editor.query('COMMIT');
        const applied = await applying;
        assert.equal(applied.status, 200);
        assert.deepEqual(applied.data, { classified: 0 });
      } finally {
        editor.release();
      }
      const { rows } = await pool.query<{ category_id: string | null }>(
        'SELECT category_id FROM ledger_entries WHERE id = $1',
        [entry.id],
      );
      assert.equal(rows[0].category_id, null);
    });
  });

  await t.test('classifying into a hidden or unknown category is refused', async () => {
    await reset();
    const ids = await categoryIds();
    await withApi(pool, async (call) => {
      const entry = await addEntry(call, { merchant: 'x' });
      await call(`/api/ledger/categories/${ids['expense/여가']}`, {
        method: 'PATCH',
        body: { hidden: true },
      });
      const hidden = await call('/api/ledger/entries/classify', {
        method: 'POST',
        body: { entryIds: [entry.id], categoryId: ids['expense/여가'] },
      });
      assert.deepEqual(
        [hidden.status, hidden.data],
        [400, { error: '숨긴 카테고리로는 분류할 수 없습니다' }],
      );
      const unknown = await call('/api/ledger/entries/classify', {
        method: 'POST',
        body: { entryIds: [entry.id], categoryId: 999999 },
      });
      assert.deepEqual(
        [unknown.status, unknown.data],
        [400, { error: '카테고리를 찾을 수 없습니다' }],
      );
    });
  });

  await t.test('applying rules touches uncategorized entries only', async () => {
    await reset();
    const ids = await categoryIds();
    await withApi(pool, async (call) => {
      const open = await addEntry(call, { merchant: '배달의민족' });
      const other = await addEntry(call, { merchant: '모르는 가게' });
      const chosen = await addEntry(call, {
        merchant: '배달의민족',
        categoryId: ids['expense/여가'],
      });
      await addRule(call, '배달의민족', ids['expense/식비']);

      const applied = await call('/api/ledger/entries/apply-rules', { method: 'POST' });
      assert.deepEqual(applied.data, { classified: 1 });
      const { rows } = await pool.query<{ id: string; category_id: string | null }>(
        'SELECT id, category_id FROM ledger_entries ORDER BY id',
      );
      assert.deepEqual(
        rows.map((row) => [
          Number(row.id),
          row.category_id === null ? null : Number(row.category_id),
        ]),
        [
          [open.id, ids['expense/식비']],
          [other.id, null],
          [chosen.id, ids['expense/여가']],
        ],
      );
    });
  });

  await t.test(
    'rules take their kind from the category and keywords are unique per kind',
    async () => {
      await reset();
      const ids = await categoryIds();
      await withApi(pool, async (call) => {
        const created = await addRule(call, '  월급 ', ids['income/급여']);
        assert.equal(created.status, 201);
        const rule = created.data.rule as Rule;
        assert.deepEqual([rule.keyword, rule.kind, rule.categoryName], ['월급', 'income', '급여']);

        const duplicate = await addRule(call, 'STARBUCKS', ids['expense/식비']);
        assert.equal(duplicate.status, 201);
        const again = await addRule(call, 'starbucks', ids['expense/여가']);
        assert.deepEqual(
          [again.status, again.data],
          [409, { error: '같은 종류에 이미 있는 키워드입니다' }],
        );
        // The same keyword may exist once per kind.
        assert.equal((await addRule(call, 'starbucks', ids['income/급여'])).status, 201);

        await call(`/api/ledger/categories/${ids['expense/여가']}`, {
          method: 'PATCH',
          body: { hidden: true },
        });
        const hidden = await addRule(call, '영화', ids['expense/여가']);
        assert.deepEqual(
          [hidden.status, hidden.data],
          [400, { error: '숨긴 카테고리에는 규칙을 만들 수 없습니다' }],
        );
        const unknown = await addRule(call, '영화', 999999);
        assert.deepEqual(
          [unknown.status, unknown.data],
          [400, { error: '카테고리를 찾을 수 없습니다' }],
        );

        assert.equal(
          (await call(`/api/ledger/rules/${rule.id}`, { method: 'DELETE' })).status,
          204,
        );
        const gone = await call(`/api/ledger/rules/${rule.id}`, { method: 'DELETE' });
        assert.deepEqual([gone.status, gone.data], [404, { error: '규칙을 찾을 수 없습니다' }]);
      });
    },
  );

  await t.test('the DB refuses an untrimmed merchant and a rule of the wrong kind', async () => {
    await reset();
    const ids = await categoryIds();
    await assert.rejects(
      pool.query(
        "INSERT INTO ledger_entries (entry_date, kind, amount, merchant) VALUES ('2026-11-05', 'expense', 1, ' a')",
      ),
      { code: '23514' },
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO ledger_category_rules (keyword, kind, category_id) VALUES ('a', 'income', $1)",
        [ids['expense/식비']],
      ),
      { code: '23503' },
    );
  });
});
