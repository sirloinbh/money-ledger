import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

const url = await testDatabase();

type Estimate = {
  year: number;
  totalSalary: number | null;
  spending: { creditCard: number; debitCard: number; cash: number; unknown: number };
  estimate: { threshold: number; deduction: number; toThreshold: number } | null;
};

test('payment method on entries and the card deduction estimate', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  await pool.query('TRUNCATE ledger_entries, ledger_tax_salaries RESTART IDENTITY CASCADE');

  await withApi(pool, async (api) => {
    const add = (date: string, amount: number, paymentMethod?: string | null, kind = 'expense') =>
      api('/api/ledger/entries', { method: 'POST', body: { date, kind, amount, paymentMethod } });

    // Left out: no payment method. Chosen: kept. A bad value is refused.
    const plain = await add('2026-03-01', 1000);
    assert.equal(plain.status, 201);
    assert.equal((plain.data as { entry: { paymentMethod: unknown } }).entry.paymentMethod, null);
    assert.equal((await add('2026-03-01', 1000, 'bitcoin')).status, 400);
    await add('2026-03-02', 6_000_000, 'credit_card');
    await add('2026-03-03', 3_000_000, 'debit_card');
    await add('2026-03-04', 2_000_000, 'cash');
    await add('2026-03-05', 500, null);
    await add('2025-12-31', 9_999, 'cash'); // another year
    await add('2026-03-06', 7_000_000, 'cash', 'income'); // income never counts

    // An edit that leaves the field out keeps it; null clears it.
    const created = await add('2026-04-01', 5000, 'cash');
    const id = (created.data as { entry: { id: number } }).entry.id;
    const keep = await api(`/api/ledger/entries/${id}`, {
      method: 'PUT',
      body: { date: '2026-04-01', kind: 'expense', amount: 6000 },
    });
    assert.equal((keep.data as { entry: { paymentMethod: string } }).entry.paymentMethod, 'cash');
    const clear = await api(`/api/ledger/entries/${id}`, {
      method: 'PUT',
      body: { date: '2026-04-01', kind: 'expense', amount: 6000, paymentMethod: null },
    });
    assert.equal((clear.data as { entry: { paymentMethod: unknown } }).entry.paymentMethod, null);
    await api(`/api/ledger/entries/${id}`, { method: 'DELETE' });

    // No salary yet: the totals show, the estimate waits.
    const before = (await api('/api/ledger/tax/card-deduction?year=2026')).data as Estimate;
    assert.deepEqual(before.spending, {
      creditCard: 6_000_000,
      debitCard: 3_000_000,
      cash: 2_000_000,
      unknown: 1500,
    });
    assert.equal(before.estimate, null);

    // Salary 20,000,000 -> threshold 5,000,000: (6,000,000 - 5,000,000) * 15% + 5,000,000 * 30%.
    const saved = await api('/api/ledger/tax/salary', {
      method: 'PUT',
      body: { year: 2026, totalSalary: 20_000_000 },
    });
    assert.equal(saved.status, 200);
    const after = (await api('/api/ledger/tax/card-deduction?year=2026')).data as Estimate;
    assert.equal(after.totalSalary, 20_000_000);
    assert.equal(after.estimate?.threshold, 5_000_000);
    assert.equal(after.estimate?.deduction, 150_000 + 1_500_000);

    // Entering the salary again replaces it; bad input is refused; another year is separate.
    await api('/api/ledger/tax/salary', {
      method: 'PUT',
      body: { year: 2026, totalSalary: 30_000_000 },
    });
    assert.equal(
      ((await api('/api/ledger/tax/card-deduction?year=2026')).data as Estimate).totalSalary,
      30_000_000,
    );
    assert.equal(
      (
        await api('/api/ledger/tax/salary', {
          method: 'PUT',
          body: { year: 2026, totalSalary: -1 },
        })
      ).status,
      400,
    );
    assert.equal((await api('/api/ledger/tax/card-deduction?year=abc')).status, 400);
    const other = (await api('/api/ledger/tax/card-deduction?year=2025')).data as Estimate;
    assert.equal(other.totalSalary, null);
    assert.equal(other.spending.cash, 9_999);
  });
});
