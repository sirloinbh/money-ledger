import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

type Account = {
  id: number;
  initialCashKrw: number;
  cashKrw: number;
  createdAt: string;
  closedAt: string | null;
};
type State = { account: Account | null; closedAccounts: Account[] };

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('mock trading accounts against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async () => {
    await pool.query('DROP TABLE IF EXISTS mock_accounts');
    await runMigration(pool, '005_mock_accounts.sql');
    await runMigration(pool, '005_mock_accounts.sql'); // re-running is safe
  };

  await t.test('an account starts with 1,000만 원 unless another amount is given', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const empty = await call('/api/mock/accounts');
      assert.deepEqual(empty.data, { account: null, closedAccounts: [] });

      const created = await call('/api/mock/accounts', { method: 'POST', body: {} });
      assert.equal(created.status, 201);
      const account = created.data.account as Account;
      assert.deepEqual(
        {
          initialCashKrw: account.initialCashKrw,
          cashKrw: account.cashKrw,
          closedAt: account.closedAt,
        },
        { initialCashKrw: 10_000_000, cashKrw: 10_000_000, closedAt: null },
      );
      assert.ok(!Number.isNaN(Date.parse(account.createdAt)));

      const second = await call('/api/mock/accounts', {
        method: 'POST',
        body: { initialCashKrw: 50_000_000 },
      });
      assert.equal(second.status, 409);
      assert.deepEqual(second.data, { error: '이미 모의투자 계좌가 있습니다' });

      const state = (await call('/api/mock/accounts')).data as State;
      assert.equal(state.account?.id, account.id);
    });

    await reset();
    await withApi(pool, async (call) => {
      const created = await call('/api/mock/accounts', {
        method: 'POST',
        body: { initialCashKrw: 10_000_000_000 },
      });
      assert.equal((created.data.account as Account).cashKrw, 10_000_000_000);
    });
  });

  await t.test('reset keeps the old account as closed and opens a new one', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const first = (await call('/api/mock/accounts', { method: 'POST', body: {} })).data
        .account as Account;
      // Pretend some virtual money was spent, so the kept record differs from a fresh account.
      await pool.query('UPDATE mock_accounts SET cash_krw = 4000000 WHERE id = $1', [first.id]);

      const reset = await call(`/api/mock/accounts/${first.id}/reset`, {
        method: 'POST',
        body: { initialCashKrw: 30_000_000 },
      });
      assert.equal(reset.status, 200);
      const second = reset.data.account as Account;
      assert.notEqual(second.id, first.id);
      assert.deepEqual(
        {
          initialCashKrw: second.initialCashKrw,
          cashKrw: second.cashKrw,
          closedAt: second.closedAt,
        },
        { initialCashKrw: 30_000_000, cashKrw: 30_000_000, closedAt: null },
      );

      const state = (await call('/api/mock/accounts')).data as State;
      assert.equal(state.account?.id, second.id);
      assert.equal(state.closedAccounts.length, 1);
      const kept = state.closedAccounts[0];
      assert.deepEqual(
        { id: kept.id, initialCashKrw: kept.initialCashKrw, cashKrw: kept.cashKrw },
        { id: first.id, initialCashKrw: 10_000_000, cashKrw: 4_000_000 },
      );
      assert.ok(kept.closedAt !== null && Date.parse(kept.closedAt) >= Date.parse(kept.createdAt));

      // Resetting the already closed account again (a second click, a stale tab) changes nothing.
      const again = await call(`/api/mock/accounts/${first.id}/reset`, {
        method: 'POST',
        body: {},
      });
      assert.equal(again.status, 409);
      assert.deepEqual(again.data, {
        error: '이미 초기화된 계좌입니다. 화면을 새로 고친 뒤 다시 시도하세요',
      });
      const missing = await call('/api/mock/accounts/999999/reset', { method: 'POST', body: {} });
      assert.equal(missing.status, 404);
      assert.deepEqual(missing.data, { error: '모의투자 계좌를 찾을 수 없습니다' });

      const after = (await call('/api/mock/accounts')).data as State;
      assert.equal(after.account?.id, second.id);
      assert.equal(after.closedAccounts.length, 1);
    });
  });

  await t.test('two resets of the same account at once open only one new account', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const first = (await call('/api/mock/accounts', { method: 'POST', body: {} })).data
        .account as Account;
      const results = await Promise.all(
        [1, 2].map(() =>
          call(`/api/mock/accounts/${first.id}/reset`, { method: 'POST', body: {} }),
        ),
      );
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
      const { rows } = await pool.query<{ open: number; total: number }>(
        'SELECT count(*) FILTER (WHERE closed_at IS NULL)::int AS open, count(*)::int AS total FROM mock_accounts',
      );
      assert.deepEqual(rows[0], { open: 1, total: 2 });
    });
  });

  await t.test('a failed reset rolls back and leaves the open account as it was', async () => {
    await reset();
    const first = (
      await pool.query<{ id: string }>(
        'INSERT INTO mock_accounts (initial_cash_krw, cash_krw) VALUES (10000000, 10000000) RETURNING id',
      )
    ).rows[0].id;
    // Make the INSERT of the new account fail after the UPDATE has closed the old one.
    await pool.query(
      'ALTER TABLE mock_accounts ADD CONSTRAINT test_block_new CHECK (initial_cash_krw <> 20000000)',
    );
    await withApi(pool, async (call) => {
      const failed = await call(`/api/mock/accounts/${first}/reset`, {
        method: 'POST',
        body: { initialCashKrw: 20_000_000 },
      });
      assert.equal(failed.status, 500);
      const state = (await call('/api/mock/accounts')).data as State;
      assert.equal(state.account?.id, Number(first));
      assert.deepEqual(state.closedAccounts, []);
    });
  });

  await t.test('the DB itself allows one open account and the agreed amounts only', async () => {
    await reset();
    const insert = (initial: number, cash = initial) =>
      pool.query('INSERT INTO mock_accounts (initial_cash_krw, cash_krw) VALUES ($1, $2)', [
        initial,
        cash,
      ]);
    await insert(10_000_000);
    await assert.rejects(insert(10_000_000), { code: '23505' });
    await pool.query('UPDATE mock_accounts SET closed_at = now()');
    await assert.rejects(insert(9_999), { code: '23514' });
    await assert.rejects(insert(10_000_000, -1), { code: '23514' });
    await insert(10_000);
  });

  await t.test('the list shows the open account and the 20 most recently closed', async () => {
    await reset();
    await pool.query(
      `INSERT INTO mock_accounts (initial_cash_krw, cash_krw, created_at, closed_at)
       SELECT 10000 * n, 10000 * n, now() - interval '1 day' * (30 - n), now() - interval '1 day' * (29 - n)
       FROM generate_series(1, 25) AS n`,
    );
    await pool.query(
      'INSERT INTO mock_accounts (initial_cash_krw, cash_krw) VALUES (10000000, 10000000)',
    );
    await withApi(pool, async (call) => {
      const state = (await call('/api/mock/accounts')).data as State;
      assert.equal(state.account?.initialCashKrw, 10_000_000);
      assert.deepEqual(
        state.closedAccounts.map((account) => account.initialCashKrw / 10_000),
        Array.from({ length: 20 }, (_, i) => 25 - i),
      );
    });
  });

  await t.test('mock money is not counted in the portfolio totals', async () => {
    await reset();
    await pool.query(
      'DROP TABLE IF EXISTS portfolio_trades, portfolio_prepaid_usages, portfolio_assets',
    );
    await runMigration(pool, '004_portfolio_assets.sql');
    await runMigration(pool, '007_depreciable_assets.sql');
    await runMigration(pool, '010_prepaid_assets.sql');
    await runMigration(pool, '013_asset_trades.sql');
    await withApi(pool, async (call) => {
      await call('/api/portfolio/assets', {
        method: 'POST',
        body: { name: '통장', type: 'cash', currency: 'KRW', valueKrw: 1000 },
      });
      await call('/api/mock/accounts', { method: 'POST', body: { initialCashKrw: 50_000_000 } });
      const { data } = await call('/api/portfolio/assets');
      assert.deepEqual(data.totals, { assetsKrw: 1000, debtsKrw: 0, netKrw: 1000, uncounted: 0 });
    });
  });
});
