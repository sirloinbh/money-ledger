import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
const assets = '/api/portfolio/assets';
const today = '2026-11-10';

type Share = { amountKrw: number | null; share: string };
type Allocation = {
  excluded: number;
  byType: (Share & { type: string; count: number })[];
  byAsset: (Share & { id: number; name: string; type: string })[];
  chart: (Share & { key: string; name: string | null; count: number })[];
};

/** "33.4" → 334, exactly (no floating point). */
const tenths = (share: string) => Number(share.replace('.', ''));
const sumOf = (rows: Share[]) => rows.reduce((sum, row) => sum + tenths(row.share), 0);

// #48 Asset allocation against the real database. Skipped (not passed) without the dedicated test DB.
test('asset allocation against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async () => {
    await pool.query(
      `DROP TABLE IF EXISTS portfolio_trades, portfolio_prepaid_usages, portfolio_assets, mock_orders,
         mock_holdings, mock_accounts, security_prices, fx_rates, price_fetch_state, price_api_calls,
         krx_market_days, securities`,
    );
    for (const file of [
      '004_portfolio_assets.sql',
      '005_mock_accounts.sql',
      '007_depreciable_assets.sql',
      '010_prepaid_assets.sql',
      '013_asset_trades.sql',
      '009_prices.sql',
      '012_krx_listing.sql',
      '015_mock_orders.sql',
      '016_asset_valuation.sql',
    ]) {
      await runMigration(pool, file);
    }
  };

  type Call = Parameters<Parameters<typeof withApi>[1]>[0];
  const api = (run: (call: Call) => Promise<void>) => withApi(pool, run, { today: () => today });
  const add = async (call: Call, body: object) => {
    const response = await call(assets, { method: 'POST', body });
    assert.equal(response.status, 201, JSON.stringify(response.data));
  };
  const read = async (call: Call) => {
    const { data } = await call(assets);
    return {
      allocation: data.allocation as Allocation,
      totals: data.totals as { assetsKrw: number },
    };
  };
  const cash = (name: string, valueKrw: number) => ({
    name,
    type: 'cash',
    currency: 'KRW',
    valueKrw,
  });

  await t.test('shares add up to 100.0% by largest remainder and debts stay out', async () => {
    await reset();
    await api(async (call) => {
      await add(call, cash('통장 A', 100));
      await add(call, cash('통장 B', 100));
      await add(call, { name: '집', type: 'real_estate', currency: 'KRW', valueKrw: 100 });
      await add(call, { name: '대출', type: 'debt', currency: 'KRW', valueKrw: 1_000_000 });
      const { allocation, totals } = await read(call);

      // 300 won: 33.33…% each. The one tenth still missing goes to the earliest of the equal remainders.
      assert.deepEqual(
        allocation.byAsset.map((row) => [row.name, row.amountKrw, row.share]),
        [
          ['통장 A', 100, '33.4'],
          ['통장 B', 100, '33.3'],
          ['집', 100, '33.3'],
        ],
      );
      assert.deepEqual(
        allocation.byType.map((row) => [row.type, row.amountKrw, row.share, row.count]),
        [
          ['cash', 200, '66.7', 2],
          ['real_estate', 100, '33.3', 1],
        ],
      );
      assert.equal(sumOf(allocation.byAsset), 1000);
      assert.equal(sumOf(allocation.byType), 1000);
      // The amounts are the asset total: debts are not in it.
      assert.equal(
        allocation.byAsset.reduce((sum, row) => sum + row.amountKrw!, 0),
        totals.assetsKrw,
      );
      assert.equal(allocation.excluded, 0);
    });
  });

  await t.test('the largest remainders win, not the largest amounts', async () => {
    await reset();
    await api(async (call) => {
      // 1/7 = 14.285…, 2/7 = 28.571…, 4/7 = 57.142…: floors 14.2 + 28.5 + 57.1 = 99.8.
      await add(call, cash('하나', 1));
      await add(call, cash('둘', 2));
      await add(call, cash('넷', 4));
      const { allocation } = await read(call);
      assert.deepEqual(
        allocation.byAsset.map((row) => [row.name, row.share]),
        [
          ['넷', '57.1'],
          ['둘', '28.6'],
          ['하나', '14.3'],
        ],
      );
      assert.equal(sumOf(allocation.byAsset), 1000);
    });
  });

  await t.test(
    'an asset without a won value is left out and counted; a 0 won one stays at 0.0%',
    async () => {
      await reset();
      await api(async (call) => {
        await add(call, cash('통장', 5000));
        await add(call, cash('빈 통장', 0));
        await add(call, { name: '달러', type: 'cash', currency: 'USD', valueForeign: '10' });
        await add(call, { name: '수량만', type: 'stock', currency: 'KRW', quantity: '3' });
        const { allocation } = await read(call);
        assert.equal(allocation.excluded, 2);
        assert.deepEqual(
          allocation.byAsset.map((row) => [row.name, row.share]),
          [
            ['통장', '100.0'],
            ['빈 통장', '0.0'],
          ],
        );
        assert.deepEqual(allocation.byType, [
          { type: 'cash', amountKrw: 5000, share: '100.0', count: 2 },
        ]);
      });
    },
  );

  await t.test('the chart shows the 8 largest and the rest as one line', async () => {
    await reset();
    await api(async (call) => {
      for (let i = 1; i <= 11; i++) await add(call, cash(`통장 ${i}`, i * 1000));
      const { allocation } = await read(call);
      assert.equal(allocation.byAsset.length, 11);
      assert.equal(allocation.chart.length, 9);
      assert.deepEqual(
        allocation.chart.slice(0, 2).map((row) => row.name),
        ['통장 11', '통장 10'],
      );
      const rest = allocation.chart[8];
      // 1,000 + 2,000 + 3,000 of 66,000.
      assert.deepEqual(
        { key: rest.key, name: rest.name, amountKrw: rest.amountKrw, count: rest.count },
        { key: 'rest', name: null, amountKrw: 6000, count: 3 },
      );
      assert.equal(sumOf(allocation.chart), 1000);
      // The rest line is the sum of the table's own shares.
      assert.equal(tenths(rest.share), sumOf(allocation.byAsset.slice(8)));
    });
  });

  await t.test('a linked asset is named after its security', async () => {
    await reset();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO securities (market, symbol, name, kind, currency) VALUES
         ('KOSPI', '005930', '삼성전자', 'stock', 'KRW'), ('NASDAQ', 'AAPL', NULL, 'stock', 'USD')
       RETURNING id`,
    );
    const [samsung, apple] = rows.map((row) => Number(row.id));
    await pool.query(
      `INSERT INTO security_prices (security_id, trade_date, close, currency, source) VALUES
         ($1, '2026-11-09', 70000, 'KRW', 'TEST'), ($2, '2026-11-09', 200, 'USD', 'TEST')`,
      [samsung, apple],
    );
    await pool.query(
      `INSERT INTO fx_rates (currency, rate_date, fx_rate, source) VALUES ('USD', '2026-11-09', 1400, 'TEST')`,
    );
    await api(async (call) => {
      await add(call, {
        name: '내 삼성',
        type: 'stock',
        currency: 'KRW',
        quantity: '1',
        securityId: samsung,
      });
      await add(call, {
        name: '내 애플',
        type: 'stock',
        currency: 'USD',
        quantity: '1',
        securityId: apple,
      });
      const { allocation } = await read(call);
      // Without a saved name a US security shows its ticker.
      assert.deepEqual(
        allocation.byAsset.map((row) => [row.name, row.amountKrw, row.share]),
        [
          ['AAPL', 280_000, '80.0'],
          ['삼성전자', 70_000, '20.0'],
        ],
      );
    });
  });

  await t.test('no assets, or only 0 won ones, give an empty or all-zero allocation', async () => {
    await reset();
    await api(async (call) => {
      assert.deepEqual((await read(call)).allocation, {
        excluded: 0,
        byType: [],
        byAsset: [],
        chart: [],
      });
      await add(call, cash('빈 통장', 0));
      const { allocation } = await read(call);
      assert.deepEqual(
        allocation.byAsset.map((row) => row.share),
        ['0.0'],
      );
    });
  });
});
