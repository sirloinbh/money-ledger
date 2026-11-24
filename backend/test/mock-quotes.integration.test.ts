import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { fakeKis } from '../src/prices/kis-fake.js';
import { withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

// #305 The quote route reads the symbol and the status of the security from the real securities table.
const url = await testDatabase();

test('GET /api/mock/quotes/:securityId against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  const ids = await pool.query<{ symbol: string; id: number }>(
    `INSERT INTO securities (market, symbol, name, kind, currency, active) VALUES
       ('KOSPI', '005930', 'Samsung Electronics', 'stock', 'KRW', true),
       ('KOSPI', '000660', 'SK hynix', 'stock', 'KRW', false),
       ('NASDAQ', 'AAPL', 'Apple Inc', 'stock', 'USD', true)
     ON CONFLICT DO NOTHING RETURNING symbol, id`,
  );
  const idOf = (symbol: string) => ids.rows.find((row) => row.symbol === symbol)!.id;
  await withApi(
    pool,
    async (call) => {
      const ok = await call(`/api/mock/quotes/${idOf('005930')}`);
      assert.equal(ok.status, 200);
      assert.equal(ok.data.symbol, '005930');
      assert.equal(ok.data.price, '70000');
      assert.equal((ok.data.asks as unknown[]).length, 10);
      assert.equal((await call(`/api/mock/quotes/${idOf('000660')}`)).status, 409);
      assert.equal((await call(`/api/mock/quotes/${idOf('AAPL')}`)).status, 409);
      assert.equal((await call('/api/mock/quotes/99999999')).status, 404);
    },
    { kis: fakeKis() },
  );
});
