import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

// #291 Recurring payment suggestions against the real database. #184: this file's own copy of the test DB.
const url = await testDatabase();

type Suggestion = {
  merchantKey: string;
  merchant: string;
  amount: number;
  register: Record<string, unknown>;
};

test('recurring payment suggestions against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  let categoryId = 0;
  const reset = async () => {
    await pool.query(
      'TRUNCATE ledger_fixed_cost_runs, ledger_fixed_costs, ledger_entries, ledger_recurring_dismissals, ledger_categories RESTART IDENTITY CASCADE',
    );
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO ledger_categories (kind, name) VALUES ('expense', 'Subscriptions') RETURNING id",
    );
    categoryId = Number(rows[0].id);
  };
  const add = (date: string, amount: number, merchant: string) =>
    pool.query(
      "INSERT INTO ledger_entries (entry_date, kind, amount, category_id, merchant) VALUES ($1, 'expense', $2, $3, $4)",
      [date, amount, categoryId, merchant],
    );
  const monthly = async (merchant: string, amount = 10_900) => {
    for (const month of ['2026-08', '2026-09', '2026-10'])
      await add(`${month}-05`, amount, merchant);
  };
  const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    let result: { status: number; data: Record<string, unknown> } | undefined;
    await withApi(
      pool,
      async (api) => {
        result = await api(path, init);
      },
      { today: () => '2026-11-24' },
    );
    return result!;
  };
  const suggestions = async () =>
    (await call('/api/ledger/recurring')).data.suggestions as Suggestion[];

  await t.test(
    'suggests a regular merchant with a body that registers as a fixed cost',
    async () => {
      await reset();
      await monthly('Netflix');
      await add('2026-10-20', 4_500, 'Cafe'); // one charge only: not recurring
      const response = await call('/api/ledger/recurring');
      assert.deepEqual(response.data.rule, { months: 3, minMonths: 3, tolerancePct: 10 });
      const found = response.data.suggestions as Suggestion[];
      assert.deepEqual(
        found.map((item) => [item.merchant, item.amount]),
        [['Netflix', 10_900]],
      );
      // One step: the ready body is accepted by the existing create route.
      const created = await call('/api/ledger/fixed-costs', {
        method: 'POST',
        body: found[0].register,
      });
      assert.equal(created.status, 201);
      assert.deepEqual(await suggestions(), []); // now a fixed cost, so it is not suggested again
    },
  );

  await t.test('entries a fixed cost added itself are not counted as a pattern', async () => {
    await reset();
    await monthly('Rent house');
    await pool.query(
      `INSERT INTO ledger_fixed_costs (name, category_id, amount, day_of_month, start_month)
       VALUES ('Other', $1, 1, 5, '2026-08-01')`,
      [categoryId],
    );
    const { rows } = await pool.query<{ id: number }>('SELECT id FROM ledger_entries');
    for (const [index, row] of rows.entries()) {
      await pool.query(
        'INSERT INTO ledger_fixed_cost_runs (fixed_cost_id, month, entry_id, confirmed) VALUES (1, $1, $2, true)',
        [`2026-${String(8 + index).padStart(2, '0')}-01`, row.id],
      );
    }
    assert.deepEqual(await suggestions(), []);
  });

  await t.test('dismissing hides the merchant for good, under any branch name', async () => {
    await reset();
    await monthly('스타벅스 강남점', 8_000);
    const [found] = await suggestions();
    const dismissed = await call('/api/ledger/recurring/dismiss', {
      method: 'POST',
      body: { merchantKey: found.merchantKey },
    });
    assert.equal(dismissed.status, 204);
    assert.deepEqual(await suggestions(), []);
    // Dismissing again is harmless, and a later month of the same merchant stays hidden.
    assert.equal(
      (
        await call('/api/ledger/recurring/dismiss', {
          method: 'POST',
          body: { merchantKey: found.merchantKey },
        })
      ).status,
      204,
    );
    await add('2026-10-06', 8_000, '스타벅스 역삼점');
    assert.deepEqual(await suggestions(), []);
  });

  await t.test('a bad dismiss body is a 400', async () => {
    await reset();
    assert.equal(
      (await call('/api/ledger/recurring/dismiss', { method: 'POST', body: {} })).status,
      400,
    );
    assert.equal(
      (await call('/api/ledger/recurring/dismiss', { method: 'POST', body: { merchantKey: '' } }))
        .status,
      400,
    );
  });

  await t.test('without any entries the list is empty', async () => {
    await reset();
    assert.deepEqual(await suggestions(), []);
  });
});
