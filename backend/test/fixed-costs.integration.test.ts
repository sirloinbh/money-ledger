import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

type Item = {
  id: number;
  name: string;
  amount: number;
  variable: boolean;
  dayOfMonth: number;
  startMonth: string;
  active: boolean;
  entry: { id: number; date: string; amount: number; estimated: boolean } | null;
};

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('fixed costs against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  let ids: Record<string, number> = {};
  const reset = async () => {
    await pool.query('TRUNCATE ledger_categories RESTART IDENTITY CASCADE');
    await runMigration(pool, '002_ledger_categories.sql');
    await runMigration(pool, '020_ledger_fixed_costs.sql');
    const { rows } = await pool.query<{ id: string; kind: string; name: string }>(
      'SELECT id, kind, name FROM ledger_categories',
    );
    ids = Object.fromEntries(rows.map((row) => [`${row.kind}/${row.name}`, Number(row.id)]));
  };
  const call = async (
    path: string,
    init: { method?: string; body?: unknown } = {},
    today = '2026-11-15',
  ) => {
    let result: { status: number; data: Record<string, unknown> } | undefined;
    await withApi(
      pool,
      async (api) => {
        result = await api(path, init);
      },
      { today: () => today },
    );
    return result!;
  };
  const create = async (body: Record<string, unknown>) => {
    const response = await call('/api/ledger/fixed-costs', {
      method: 'POST',
      body: { categoryId: ids['expense/주거'], variable: false, ...body },
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return (response.data.fixedCost as { id: number }).id;
  };
  const generate = async (today: string) => {
    const response = await call('/api/ledger/fixed-costs/generate', { method: 'POST' }, today);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data.added as number;
  };
  const list = async (month: string) => {
    const response = await call(`/api/ledger/fixed-costs?month=${month}`);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data as { fixedCosts: Item[]; totals: { fixed: number; other: number } };
  };
  const entries = async () =>
    (
      await pool.query<{ entry_date: string; amount: string; memo: string }>(
        'SELECT entry_date, amount::text, memo FROM ledger_entries ORDER BY entry_date, id',
      )
    ).rows.map((row) => `${row.entry_date} ${row.memo} ${row.amount}`);

  await t.test(
    'due months are added once, skipped months included, not before the day',
    async () => {
      await reset();
      await create({ name: 'Rent', amount: 500_000, dayOfMonth: 25, startMonth: '2026-09' });
      // Nov 15: September and October are due, November 25 is not yet.
      assert.equal(await generate('2026-11-15'), 2);
      assert.equal(await generate('2026-11-15'), 0);
      assert.deepEqual(await entries(), ['2026-09-25 Rent 500000', '2026-10-25 Rent 500000']);
      // On the day itself the month is due.
      assert.equal(await generate('2026-11-25'), 1);
      assert.equal(await generate('2026-11-30'), 0);
      assert.equal((await entries()).length, 3);
    },
  );

  await t.test('two opens at the same time still add a month once', async () => {
    await reset();
    await create({ name: 'Phone', amount: 60_000, dayOfMonth: 1, startMonth: '2026-11' });
    const added = await Promise.all([generate('2026-11-15'), generate('2026-11-15')]);
    assert.deepEqual(added.sort(), [0, 1]);
    assert.deepEqual(await entries(), ['2026-11-01 Phone 60000']);
  });

  await t.test('a day past the month end uses the last day, leap years included', async () => {
    await reset();
    await create({ name: 'Savings', amount: 100_000, dayOfMonth: 31, startMonth: '2028-01' });
    await generate('2028-05-31');
    assert.deepEqual(await entries(), [
      '2028-01-31 Savings 100000',
      '2028-02-29 Savings 100000',
      '2028-03-31 Savings 100000',
      '2028-04-30 Savings 100000',
      '2028-05-31 Savings 100000',
    ]);
    // A 31st item is not due on April 29.
    await reset();
    await create({ name: 'Savings', amount: 100_000, dayOfMonth: 31, startMonth: '2026-04' });
    assert.equal(await generate('2026-04-29'), 0);
    assert.equal(await generate('2026-04-30'), 1);
  });

  await t.test('a variable item is an estimate from the last confirmed amount', async () => {
    await reset();
    const power = await create({
      name: 'Electricity',
      amount: 40_000,
      variable: true,
      dayOfMonth: 10,
      startMonth: '2026-09',
    });
    await generate('2026-09-10');
    let september = (await list('2026-09')).fixedCosts[0];
    assert.deepEqual(september.entry && [september.entry.amount, september.entry.estimated], [
      40_000,
      true,
    ]);

    const confirm = await call(`/api/ledger/fixed-costs/${power}/months/2026-09`, {
      method: 'PUT',
      body: { amount: 52_340 },
    });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.data));
    september = (await list('2026-09')).fixedCosts[0];
    assert.deepEqual([september.entry!.amount, september.entry!.estimated], [52_340, false]);

    // October and November (both skipped) start from September's confirmed amount.
    await generate('2026-11-15');
    for (const month of ['2026-10', '2026-11']) {
      const item = (await list(month)).fixedCosts[0];
      assert.deepEqual([item.entry!.amount, item.entry!.estimated], [52_340, true], month);
    }
    // A month with no entry cannot be confirmed.
    const none = await call(`/api/ledger/fixed-costs/${power}/months/2026-12`, {
      method: 'PUT',
      body: { amount: 1 },
    });
    assert.equal(none.status, 404);
  });

  await t.test('a deleted entry does not come back', async () => {
    await reset();
    await create({ name: 'Gas', amount: 30_000, dayOfMonth: 5, startMonth: '2026-11' });
    await generate('2026-11-15');
    const id = (await list('2026-11')).fixedCosts[0].entry!.id;
    assert.equal((await call(`/api/ledger/entries/${id}`, { method: 'DELETE' })).status, 204);
    assert.equal(await generate('2026-11-16'), 0);
    assert.equal((await list('2026-11')).fixedCosts[0].entry, null);
  });

  await t.test('stopping skips months, and starting again does not fill them in', async () => {
    await reset();
    const rent = await create({
      name: 'Rent',
      amount: 500_000,
      dayOfMonth: 1,
      startMonth: '2026-08',
    });
    await generate('2026-08-02');
    const stop = await call(`/api/ledger/fixed-costs/${rent}`, {
      method: 'PATCH',
      body: { active: false },
    });
    assert.equal(stop.status, 200, JSON.stringify(stop.data));
    assert.equal(await generate('2026-10-15'), 0);
    // Started again in November: only November is added, not September and October.
    const start = await call(
      `/api/ledger/fixed-costs/${rent}`,
      { method: 'PATCH', body: { active: true, amount: 520_000 } },
      '2026-11-15',
    );
    assert.equal((start.data.fixedCost as Item).startMonth, '2026-11');
    assert.equal(await generate('2026-11-15'), 1);
    assert.deepEqual(await entries(), ['2026-08-01 Rent 500000', '2026-11-01 Rent 520000']);
  });

  await t.test('the month total splits fixed costs from other spending', async () => {
    await reset();
    await create({ name: 'Rent', amount: 500_000, dayOfMonth: 1, startMonth: '2026-11' });
    await generate('2026-11-15');
    await pool.query(
      `INSERT INTO ledger_entries (entry_date, kind, amount, category_id) VALUES
         ('2026-11-03', 'expense', 12000, $1), ('2026-11-04', 'expense', 3000, NULL),
         ('2026-11-05', 'income', 3000000, $2), ('2026-12-01', 'expense', 9999, $1)`,
      [ids['expense/식비'], ids['income/급여']],
    );
    const { totals, fixedCosts } = await list('2026-11');
    assert.deepEqual(totals, { fixed: 500_000, other: 15_000 });
    assert.equal(fixedCosts[0].entry!.date, '2026-11-01');
    assert.deepEqual((await list('2026-10')).totals, { fixed: 0, other: 0 });
  });

  await t.test('input is checked: category kind, day, name, and an empty change', async () => {
    await reset();
    const base = {
      name: 'Rent',
      categoryId: ids['expense/주거'],
      amount: 1,
      variable: false,
      dayOfMonth: 1,
      startMonth: '2026-11',
    };
    const post = (body: Record<string, unknown>) =>
      call('/api/ledger/fixed-costs', { method: 'POST', body: { ...base, ...body } });
    const income = await post({ categoryId: ids['income/급여'] });
    assert.deepEqual([income.status, income.data.error], [422, 'Choose an expense category']);
    assert.equal((await post({ dayOfMonth: 32 })).status, 400);
    assert.equal((await post({ name: '   ' })).status, 400);
    assert.equal((await post({ amount: 1.5 })).status, 400);
    assert.equal((await post({ startMonth: '2026-13' })).status, 400);
    const id = await create({ name: 'Rent', amount: 1, dayOfMonth: 1, startMonth: '2026-11' });
    const empty = await call(`/api/ledger/fixed-costs/${id}`, { method: 'PATCH', body: {} });
    assert.equal(empty.status, 400);
    const missing = await call('/api/ledger/fixed-costs/999', {
      method: 'PATCH',
      body: { amount: 2 },
    });
    assert.equal(missing.status, 404);
  });
});
