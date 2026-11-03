import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

type Asset = {
  id: number;
  name: string;
  type: string;
  currency: string;
  quantity: string | null;
  valueKrw: number | null;
  valueForeign: string | null;
  memo: string;
};
type Totals = { assetsKrw: number; debtsKrw: number; netKrw: number; uncounted: number };

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('portfolio assets against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async () => {
    await pool.query('DROP TABLE IF EXISTS portfolio_assets');
    await runMigration(pool, '004_portfolio_assets.sql');
    await runMigration(pool, '004_portfolio_assets.sql'); // re-running is safe
  };

  await t.test('quantities and USD values are stored in the agreed formats', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const stock = await call('/api/portfolio/assets', {
        method: 'POST',
        body: { name: '  애플 ', type: 'stock', currency: 'USD', quantity: '1.5', memo: '해외' },
      });
      assert.equal(stock.status, 201);
      assert.deepEqual(
        { ...(stock.data.asset as Asset), id: 0 },
        {
          id: 0,
          name: '애플',
          type: 'stock',
          currency: 'USD',
          quantity: '1.50000000',
          valueKrw: null,
          valueForeign: null,
          memo: '해외',
        },
      );

      const dollars = await call('/api/portfolio/assets', {
        method: 'POST',
        body: { name: '달러 예금', type: 'cash', currency: 'USD', valueForeign: '1234.5' },
      });
      assert.equal((dollars.data.asset as Asset).valueForeign, '1234.5000');

      const big = await call('/api/portfolio/assets', {
        method: 'POST',
        body: {
          name: '아파트',
          type: 'real_estate',
          currency: 'KRW',
          valueKrw: Number.MAX_SAFE_INTEGER,
        },
      });
      assert.equal((big.data.asset as Asset).valueKrw, Number.MAX_SAFE_INTEGER);
    });
  });

  await t.test('debts are totalled apart and subtracted only in the net worth', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const add = (body: object) => call('/api/portfolio/assets', { method: 'POST', body });
      await add({ name: '통장', type: 'cash', currency: 'KRW', valueKrw: 5000000 });
      await add({ name: '전세 보증금', type: 'real_estate', currency: 'KRW', valueKrw: 200000000 });
      await add({ name: '전세 대출', type: 'debt', currency: 'KRW', valueKrw: 120000000 });
      await add({ name: '달러 예금', type: 'cash', currency: 'USD', valueForeign: '100' });
      await add({ name: '삼성전자', type: 'stock', currency: 'KRW', quantity: '10' });

      const { data } = await call('/api/portfolio/assets');
      assert.deepEqual(data.totals as Totals, {
        assetsKrw: 205000000,
        debtsKrw: 120000000,
        netKrw: 85000000,
        uncounted: 2,
      });
      assert.equal((data.assets as Asset[]).length, 5);
    });
  });

  await t.test('an asset can be changed, switched to USD, and deleted', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const { data } = await call('/api/portfolio/assets', {
        method: 'POST',
        body: { name: '예금', type: 'cash', currency: 'KRW', valueKrw: 1000 },
      });
      const id = (data.asset as Asset).id;
      const changed = await call(`/api/portfolio/assets/${id}`, {
        method: 'PUT',
        body: { name: '달러 예금', type: 'cash', currency: 'USD', valueForeign: '7.25' },
      });
      assert.equal(changed.status, 200);
      assert.deepEqual(
        {
          currency: (changed.data.asset as Asset).currency,
          valueKrw: (changed.data.asset as Asset).valueKrw,
          valueForeign: (changed.data.asset as Asset).valueForeign,
        },
        { currency: 'USD', valueKrw: null, valueForeign: '7.2500' },
      );

      assert.equal((await call(`/api/portfolio/assets/${id}`, { method: 'DELETE' })).status, 204);
      const again = await call(`/api/portfolio/assets/${id}`, { method: 'DELETE' });
      assert.equal(again.status, 404);
      assert.deepEqual(again.data, { error: '자산을 찾을 수 없습니다' });
      const missing = await call(`/api/portfolio/assets/${id}`, {
        method: 'PUT',
        body: { name: '예금', type: 'cash', currency: 'KRW', valueKrw: 1 },
      });
      assert.equal(missing.status, 404);
    });
  });

  await t.test(
    'the DB itself refuses a won value on a USD asset and an asset with nothing to value',
    async () => {
      await reset();
      await assert.rejects(
        pool.query(
          "INSERT INTO portfolio_assets (name, asset_type, currency, value_krw) VALUES ('a', 'cash', 'USD', 1)",
        ),
        { code: '23514' },
      );
      await assert.rejects(
        pool.query("INSERT INTO portfolio_assets (name, asset_type) VALUES ('a', 'cash')"),
        { code: '23514' },
      );
    },
  );
});
