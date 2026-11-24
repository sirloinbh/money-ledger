import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { allInQuantity, sellPosition } from '../src/mock/positions.js';
import type { KisSource } from '../src/prices/kis.js';
import { fakeKis } from '../src/prices/kis-fake.js';
import { runMigration, withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

// #307 All-in buy at the best ask, fees and tax on a sale, and the day trade or long hold strategy.
const url = await testDatabase();

const today = () => '2026-11-24';
// The fake book of 005930: best ask 70,100 (price 70,000 + one 100 tick), best bid 70,000.
const kis: KisSource = fakeKis(() => new Date('2026-11-24T01:00:00.000Z'));

type Position = {
  id: number;
  quantity: string;
  strategy: string;
  strategyChosenAt: string | null;
  strategySource: string | null;
  closedAt: string | null;
  buy: { price: string; amountKrw: number; feeKrw: number };
  sell: { price: string; amountKrw: number; feeKrw: number; taxKrw: number } | null;
};

test('mock all-in positions against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const ids: Record<string, number> = {};
  let accountId = 0;
  const reset = async (cash: number, feeRate = '0.00015') => {
    await pool.query(
      `DROP TABLE IF EXISTS portfolio_trades, portfolio_prepaid_usages, portfolio_assets, mock_positions,
         mock_snapshots, mock_orders, mock_holdings, mock_accounts, security_prices, fx_rates,
         price_fetch_state, price_api_calls, krx_market_days, securities`,
    );
    for (const file of [
      '005_mock_accounts.sql',
      '009_prices.sql',
      '012_krx_listing.sql',
      '024_price_fetch_not_found.sql',
      '015_mock_orders.sql',
      '004_portfolio_assets.sql',
      '007_depreciable_assets.sql',
      '010_prepaid_assets.sql',
      '013_asset_trades.sql',
      '016_asset_valuation.sql',
      '018_mock_snapshots.sql',
      '040_mock_positions.sql',
    ]) {
      await runMigration(pool, file);
    }
    await runMigration(pool, '040_mock_positions.sql'); // re-running is safe
    const securities = await pool.query<{ id: string; symbol: string }>(
      `INSERT INTO securities (market, symbol, name, kind, currency, active) VALUES
         ('KOSPI', '005930', '삼성전자', 'stock', 'KRW', true),
         ('KOSPI', '999999', '휴장', 'stock', 'KRW', true),
         ('KOSPI', '000660', 'SK하이닉스', 'stock', 'KRW', false),
         ('NASDAQ', 'AAPL', 'Apple Inc', 'stock', 'USD', true)
       RETURNING id, symbol`,
    );
    for (const row of securities.rows) ids[row.symbol] = Number(row.id);
    const account = await pool.query<{ id: string }>(
      'INSERT INTO mock_accounts (initial_cash_krw, cash_krw, fee_rate) VALUES ($1, $1, $2) RETURNING id',
      [cash, feeRate],
    );
    accountId = Number(account.rows[0].id);
  };
  const cashOf = async () =>
    Number(
      (
        await pool.query<{ c: string }>('SELECT cash_krw AS c FROM mock_accounts WHERE id = $1', [
          accountId,
        ])
      ).rows[0].c,
    );
  const base = () => `/api/mock/accounts/${accountId}/positions`;
  const buy = (symbol = '005930', ask = '70100', requestKey = randomUUID()) => ({
    securityId: ids[symbol],
    requestKey,
    expectedAsk: ask,
  });

  await t.test('all-in quantity: the fee edge where one more share would not fit', async () => {
    await reset(1_000_000);
    // 14 shares cost 981,400 + fee round(147.21) = 147 = 981,547; a 15th share needs 1,051,500.
    assert.equal(await allInQuantity(pool, '981547', '70100', '0.00015'), '14');
    // One won less and 14 no longer fits, so it is 13.
    assert.equal(await allInQuantity(pool, '981546', '70100', '0.00015'), '13');
    // The fee rounds up here: 3 × 1,000 + round(3,000 × 0.0005 = 1.5) = 3,002 > 3,001.
    assert.equal(await allInQuantity(pool, '3001', '1000', '0.0005'), '2');
    assert.equal(await allInQuantity(pool, '3002', '1000', '0.0005'), '3');
    // Not even one share.
    assert.equal(await allInQuantity(pool, '70000', '70100', '0.00015'), null);
    assert.equal(await allInQuantity(pool, '1000', '1000', '0'), '1');
  });

  await t.test('buys all-in at the best ask and records a position', async () => {
    await reset(1_000_000);
    await withApi(
      pool,
      async (call) => {
        const preview = await call(`${base()}/preview?securityId=${ids['005930']}`);
        assert.equal(preview.status, 200);
        assert.deepEqual(
          [preview.data.ask, preview.data.quantity, preview.data.amountKrw, preview.data.feeKrw],
          ['70100', '14', 981_400, 147],
        );
        assert.equal(preview.data.cashAfterKrw, 18_453);
        assert.equal(await cashOf(), 1_000_000, 'a preview saves nothing');

        const key = randomUUID();
        const placed = await call(base(), { method: 'POST', body: buy('005930', '70100', key) });
        assert.equal(placed.status, 201);
        const position = placed.data.position as Position;
        assert.equal(position.quantity, '14.00000000');
        assert.equal(position.strategy, 'undecided');
        assert.equal(position.strategyChosenAt, null);
        assert.equal(position.buy.price, '70100.0000');
        assert.equal(position.buy.amountKrw, 981_400);
        assert.equal(position.buy.feeKrw, 147);
        assert.equal(await cashOf(), 18_453);
        const holding = await pool.query<{ quantity: string; cost_krw: number }>(
          'SELECT quantity, cost_krw FROM mock_holdings WHERE account_id = $1',
          [accountId],
        );
        assert.deepEqual(holding.rows[0], { quantity: '14.00000000', cost_krw: 981547 });
        const order = await pool.query<{ fill_source: string; tax_krw: number }>(
          'SELECT fill_source, tax_krw FROM mock_orders',
        );
        assert.deepEqual(order.rows, [{ fill_source: 'book', tax_krw: 0 }]);

        // The same key answers with the first position and fills nothing more.
        const again = await call(base(), { method: 'POST', body: buy('005930', '70100', key) });
        assert.equal(again.status, 200);
        assert.equal((again.data.position as Position).id, position.id);
        assert.equal(await cashOf(), 18_453);
        // The same key for another security is refused.
        const other = await call(base(), { method: 'POST', body: buy('999999', '70100', key) });
        assert.equal(other.status, 409);

        const list = await call(base());
        assert.equal((list.data.positions as Position[]).length, 1);
      },
      { today, kis },
    );
  });

  await t.test(
    'refuses a closed market, a changed ask, too little cash, and other securities',
    async () => {
      await reset(50_000);
      await withApi(
        pool,
        async (call) => {
          const closed = await call(base(), { method: 'POST', body: buy('999999') });
          assert.equal(closed.status, 409);
          assert.match(String(closed.data.error), /market is closed/);

          const poor = await call(base(), { method: 'POST', body: buy('005930') });
          assert.equal(poor.status, 409);
          assert.match(String(poor.data.error), /Not enough cash/);
          const poorPreview = await call(`${base()}/preview?securityId=${ids['005930']}`);
          assert.equal(poorPreview.data.quantity, null);
          assert.match(String(poorPreview.data.problem), /Not enough cash/);

          await pool.query('UPDATE mock_accounts SET cash_krw = 1000000 WHERE id = $1', [
            accountId,
          ]);
          const moved = await call(base(), { method: 'POST', body: buy('005930', '70000') });
          assert.equal(moved.status, 409);
          assert.match(String(moved.data.error), /ask changed/);
          const halted = await call(base(), { method: 'POST', body: buy('000660') });
          assert.equal(halted.status, 409);
          const usd = await call(base(), { method: 'POST', body: buy('AAPL') });
          assert.equal(usd.status, 409);
          const bad = await call(base(), {
            method: 'POST',
            body: { securityId: ids['005930'], requestKey: 'x', expectedAsk: '1' },
          });
          assert.equal(bad.status, 400);
          assert.equal(await cashOf(), 1_000_000);
          const count = await pool.query('SELECT 1 FROM mock_positions');
          assert.equal(count.rowCount, 0);
        },
        { today, kis },
      );
      // Without live prices set up the buy is a 503, and nothing is saved.
      await withApi(
        pool,
        async (call) => {
          assert.equal((await call(base(), { method: 'POST', body: buy() })).status, 503);
        },
        { today },
      );
    },
  );

  await t.test('chooses the strategy once and keeps when and how', async () => {
    await reset(1_000_000);
    await withApi(
      pool,
      async (call) => {
        const placed = await call(base(), { method: 'POST', body: buy() });
        const id = (placed.data.position as Position).id;
        const path = `/api/mock/positions/${id}/strategy`;

        const bad = await call(path, { method: 'POST', body: { strategy: 'undecided' } });
        assert.equal(bad.status, 400);
        assert.equal(
          (
            await call(`/api/mock/positions/999/strategy`, {
              method: 'POST',
              body: { strategy: 'day_trade' },
            })
          ).status,
          404,
        );

        const chosen = await call(path, { method: 'POST', body: { strategy: 'long_hold' } });
        assert.equal(chosen.status, 200);
        const position = chosen.data.position as Position;
        assert.equal(position.strategy, 'long_hold');
        assert.equal(position.strategySource, 'web');
        assert.ok(position.strategyChosenAt);

        // The same choice again changes nothing; another choice is refused.
        const same = await call(path, {
          method: 'POST',
          body: { strategy: 'long_hold', source: 'kakao' },
        });
        assert.equal(same.status, 200);
        assert.equal((same.data.position as Position).strategySource, 'web');
        assert.equal(
          (await call(path, { method: 'POST', body: { strategy: 'day_trade' } })).status,
          409,
        );

        // A sold position cannot get a strategy.
        await pool.query('UPDATE mock_accounts SET cash_krw = 1000000 WHERE id = $1', [accountId]);
        const second = await call(base(), { method: 'POST', body: buy('005930', '70100') });
        const secondId = (second.data.position as Position).id;
        await sellPosition(pool, kis, today, secondId);
        const afterSale = await call(`/api/mock/positions/${secondId}/strategy`, {
          method: 'POST',
          body: { strategy: 'day_trade' },
        });
        assert.equal(afterSale.status, 409);
      },
      { today, kis },
    );
  });

  await t.test('sells at the best bid with commission and transaction tax', async () => {
    await reset(1_000_000);
    await withApi(
      pool,
      async (call) => {
        const placed = await call(base(), { method: 'POST', body: buy() });
        const id = (placed.data.position as Position).id;
        const sold = await sellPosition(pool, kis, today, id);
        // 14 × 70,000 = 980,000; commission round(147) = 147; tax round(980,000 × 0.002) = 1,960.
        assert.deepEqual(sold.sell, {
          price: '70000.0000',
          amountKrw: 980_000,
          feeKrw: 147,
          taxKrw: 1_960,
        });
        assert.ok(sold.closedAt);
        assert.equal(await cashOf(), 18_453 + 980_000 - 147 - 1_960);
        const holding = await pool.query('SELECT 1 FROM mock_holdings WHERE account_id = $1', [
          accountId,
        ]);
        assert.equal(holding.rowCount, 0);

        // Selling again is refused, and the cash stays.
        await assert.rejects(sellPosition(pool, kis, today, id), /already sold/);
        assert.equal(await cashOf(), 18_453 + 980_000 - 147 - 1_960);

        // The order history shows the tax.
        const history = await call(`/api/mock/accounts/${accountId}/orders`);
        const orders = history.data.orders as { side: string; taxKrw: number }[];
        assert.deepEqual(
          orders.map((order) => [order.side, order.taxKrw]),
          [
            ['sell', 1_960],
            ['buy', 0],
          ],
        );
        // The closed position stays in the list.
        const list = await call(base());
        assert.equal((list.data.positions as Position[])[0].sell?.taxKrw, 1_960);
      },
      { today, kis },
    );
  });

  await t.test('a sale in a closed market is refused and changes nothing', async () => {
    await reset(1_000_000);
    await withApi(
      pool,
      async (call) => {
        const placed = await call(base(), { method: 'POST', body: buy() });
        const id = (placed.data.position as Position).id;
        const closedKis: KisSource = {
          name: 'CLOSED',
          quote: (symbol) => kis.quote(symbol === '005930' ? '999999' : symbol),
          lastPrice: (symbol) => kis.lastPrice(symbol),
        };
        await assert.rejects(sellPosition(pool, closedKis, today, id), /market is closed/);
        assert.equal(await cashOf(), 18_453);
        const open = await pool.query('SELECT 1 FROM mock_positions WHERE closed_at IS NULL');
        assert.equal(open.rowCount, 1);
      },
      { today, kis },
    );
  });

  await t.test('the close-price order path still works with a fee', async () => {
    await reset(1_000_000);
    await pool.query(
      "INSERT INTO security_prices (security_id, trade_date, close, currency, source) VALUES ($1, '2026-11-23', 70000, 'KRW', 'T')",
      [ids['005930']],
    );
    await withApi(
      pool,
      async (call) => {
        const placed = await call(`/api/mock/accounts/${accountId}/orders`, {
          method: 'POST',
          body: {
            securityId: ids['005930'],
            side: 'buy',
            quantity: '2',
            requestKey: randomUUID(),
            expectedPrice: '70000',
            expectedPriceDate: '2026-11-23',
            expectedFxRate: null,
          },
        });
        assert.equal(placed.status, 201);
        assert.equal(await cashOf(), 1_000_000 - 140_000 - 21);
        const source = await pool.query<{ fill_source: string }>(
          'SELECT fill_source FROM mock_orders',
        );
        assert.equal(source.rows[0].fill_source, 'close');
      },
      { today, kis },
    );
  });

  await t.test('a new account pays the 0.015% v2 commission', async () => {
    await reset(1_000_000);
    await pool.query('DELETE FROM mock_accounts');
    await withApi(
      pool,
      async (call) => {
        const created = await call('/api/mock/accounts', { method: 'POST', body: {} });
        assert.equal(created.status, 201);
        const rate = await pool.query<{ fee_rate: string }>('SELECT fee_rate FROM mock_accounts');
        assert.equal(rate.rows[0].fee_rate, '0.000150');
      },
      { today, kis },
    );
  });
});
