import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

type Order = {
  id: number;
  side: string;
  quantity: string;
  price: string;
  currency: string;
  priceDate: string;
  fxRate: string | null;
  fxDate: string | null;
  amountKrw: number;
  feeKrw: number;
  cashAfterKrw: number;
};
type Placed = { order: Order; cashKrw: number };
type Preview = {
  price: string | null;
  priceDate: string | null;
  priceStale: boolean;
  amountKrw: number | null;
  feeKrw: number | null;
  cashKrw: number;
  cashAfterKrw: number | null;
  heldQuantity: string;
  problem: string | null;
};

const today = () => '2026-11-09';

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('mock trading market orders against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const ids: Record<string, number> = {};
  let accountId = 0;
  const reset = async (cash = 10_000_000) => {
    await pool.query(
      `DROP TABLE IF EXISTS mock_orders, mock_holdings, mock_accounts, security_prices, fx_rates,
         price_fetch_state, price_api_calls, krx_market_days, securities`,
    );
    for (const file of [
      '005_mock_accounts.sql',
      '009_prices.sql',
      '012_krx_listing.sql',
      '015_mock_orders.sql',
    ]) {
      await runMigration(pool, file);
    }
    await runMigration(pool, '015_mock_orders.sql'); // re-running is safe
    const securities = await pool.query<{ id: string; symbol: string }>(
      `INSERT INTO securities (market, symbol, name, kind, currency, active) VALUES
         ('KOSPI', '005930', '삼성전자', 'stock', 'KRW', true),
         ('KOSPI', '000660', 'SK하이닉스', 'stock', 'KRW', false),
         ('KOSDAQ', '0009A0', '신규상장', 'stock', 'KRW', true),
         ('KOSPI', '100001', '십만일', 'stock', 'KRW', true),
         ('NASDAQ', 'AAPL', 'Apple Inc', 'stock', 'USD', true)
       RETURNING id, symbol`,
    );
    for (const row of securities.rows) ids[row.symbol] = Number(row.id);
    await pool.query(
      `INSERT INTO security_prices (security_id, trade_date, close, currency, source) VALUES
         ($1, '2026-11-05', 70000, 'KRW', 'T'), ($1, '2026-11-06', 70600, 'KRW', 'T'),
         ($2, '2026-11-06', 180000, 'KRW', 'T'),
         ($3, '2026-11-06', 100001, 'KRW', 'T'),
         ($4, '2026-11-06', 231.5, 'USD', 'T')`,
      [ids['005930'], ids['000660'], ids['100001'], ids.AAPL],
    );
    const account = await pool.query<{ id: string }>(
      'INSERT INTO mock_accounts (initial_cash_krw, cash_krw) VALUES ($1, $1) RETURNING id',
      [cash],
    );
    accountId = Number(account.rows[0].id);
  };
  const addRate = () =>
    pool.query(
      "INSERT INTO fx_rates (currency, rate_date, fx_rate, source) VALUES ('USD', '2026-11-06', 1384.5, 'T')",
    );
  const cashOf = async () =>
    Number(
      (
        await pool.query<{ cash_krw: string }>('SELECT cash_krw FROM mock_accounts WHERE id = $1', [
          accountId,
        ])
      ).rows[0].cash_krw,
    );
  const holding = async (symbol: string) =>
    (
      await pool.query<{ quantity: string; cost_krw: string }>(
        'SELECT quantity, cost_krw FROM mock_holdings WHERE account_id = $1 AND security_id = $2',
        [accountId, ids[symbol]],
      )
    ).rows[0];
  const orderCount = async () =>
    Number((await pool.query<{ n: string }>('SELECT count(*) AS n FROM mock_orders')).rows[0].n);
  // An order as the screen sends it: with the close (and rate) the confirmation showed, read here from the DB.
  const body = async (
    symbol: string,
    side: 'buy' | 'sell',
    quantity: string,
    requestKey = randomUUID(),
  ) => {
    const { rows } = await pool.query<{
      close: string | null;
      trade_date: string | null;
      fx: string | null;
    }>(
      `SELECT p.close, p.trade_date,
              (SELECT fx_rate FROM fx_rates WHERE s.currency = 'USD' ORDER BY rate_date DESC LIMIT 1) AS fx
       FROM securities s
       LEFT JOIN LATERAL (
         SELECT close, trade_date FROM security_prices WHERE security_id = s.id
         ORDER BY trade_date DESC LIMIT 1
       ) p ON true
       WHERE s.id = $1`,
      [ids[symbol] ?? 0],
    );
    return {
      securityId: ids[symbol],
      side,
      quantity,
      requestKey,
      expectedPrice: rows[0]?.close ?? null,
      expectedPriceDate: rows[0]?.trade_date ?? null,
      expectedFxRate: rows[0]?.fx ?? null,
    };
  };
  const path = () => `/api/mock/accounts/${accountId}/orders`;

  await t.test('a buy fills at the stored close, takes the cash and adds the holding', async () => {
    await reset();
    await withApi(
      pool,
      async (call) => {
        // A price sent by the client is ignored: the server's latest close is used.
        const placed = await call(path(), {
          method: 'POST',
          body: { ...(await body('005930', 'buy', '10')), price: '1' },
        });
        assert.equal(placed.status, 201);
        const { order, cashKrw } = placed.data as Placed;
        assert.deepEqual(
          [order.side, order.quantity, order.price, order.priceDate, order.fxRate, order.fxDate],
          ['buy', '10.00000000', '70600.0000', '2026-11-06', null, null],
        );
        assert.deepEqual(
          [order.amountKrw, order.feeKrw, order.cashAfterKrw, cashKrw],
          [706_000, 0, 9_294_000, 9_294_000],
        );
        assert.equal(await cashOf(), 9_294_000);
        assert.deepEqual(await holding('005930'), { quantity: '10.00000000', cost_krw: '706000' });

        // A later close does not change the recorded order.
        await pool.query(
          "INSERT INTO security_prices (security_id, trade_date, close, currency, source) VALUES ($1, '2026-11-09', 80000, 'KRW', 'T')",
          [ids['005930']],
        );
        const saved = await pool.query('SELECT price, amount_krw FROM mock_orders WHERE id = $1', [
          order.id,
        ]);
        assert.deepEqual(saved.rows[0], { price: '70600.0000', amount_krw: '706000' });
      },
      { today },
    );
  });

  await t.test(
    'the same request key fills once, also when sent twice at the same time',
    async () => {
      await reset();
      await withApi(
        pool,
        async (call) => {
          const order = await body('005930', 'buy', '1');
          const [first, second] = await Promise.all([
            call(path(), { method: 'POST', body: order }),
            call(path(), { method: 'POST', body: order }),
          ]);
          assert.deepEqual([first.status, second.status].sort(), [200, 201]);
          assert.equal((first.data as Placed).order.id, (second.data as Placed).order.id);
          assert.equal(await orderCount(), 1);
          assert.equal(await cashOf(), 10_000_000 - 70_600);

          const again = await call(path(), { method: 'POST', body: order });
          assert.equal(again.status, 200);
          assert.equal(await orderCount(), 1);

          const changed = await call(path(), { method: 'POST', body: { ...order, quantity: '2' } });
          assert.deepEqual(
            [changed.status, changed.data],
            [409, { error: '같은 주문 키로 다른 주문을 보냈습니다' }],
          );
        },
        { today },
      );
    },
  );

  await t.test('two orders at once never spend more than the cash', async () => {
    await reset(1_000_000);
    await withApi(
      pool,
      async (call) => {
        // Each takes 706,000 of 1,000,000: only one can fill.
        const results = await Promise.all([
          call(path(), { method: 'POST', body: await body('005930', 'buy', '10') }),
          call(path(), { method: 'POST', body: await body('005930', 'buy', '10') }),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        assert.deepEqual(results.find((r) => r.status === 409)?.data, {
          error: '현금이 부족합니다',
        });
        assert.equal(await cashOf(), 294_000);
        assert.equal(await orderCount(), 1);
      },
      { today },
    );
  });

  await t.test(
    'a US buy converts with the latest stored rate and charges the fee rate',
    async () => {
      await reset();
      await addRate();
      await pool.query('UPDATE mock_accounts SET fee_rate = 0.00015 WHERE id = $1', [accountId]);
      await withApi(
        pool,
        async (call) => {
          const placed = (
            await call(path(), { method: 'POST', body: await body('AAPL', 'buy', '3') })
          ).data as Placed;
          // round(3 × 231.5 × 1384.5) = round(961,535.25); fee round(961,535 × 0.00015) = round(144.23).
          assert.deepEqual(
            [
              placed.order.price,
              placed.order.fxRate,
              placed.order.fxDate,
              placed.order.amountKrw,
              placed.order.feeKrw,
            ],
            ['231.5000', '1384.5000', '2026-11-06', 961_535, 144],
          );
          assert.equal(placed.cashKrw, 10_000_000 - 961_535 - 144);
          assert.deepEqual(await holding('AAPL'), {
            quantity: '3.00000000',
            cost_krw: String(961_535 + 144),
          });

          // Half a won rounds away from zero: 100,001 × 0.00015 = 15.00015 → 15; 10 shares → 150.0015 → 150.
          // 1 share of 100,000 at 0.000015 would be 1.5 → 2, checked with SQL numeric round, not JS.
          await pool.query('UPDATE mock_accounts SET fee_rate = 0.000015 WHERE id = $1', [
            accountId,
          ]);
          await pool.query(
            "INSERT INTO security_prices (security_id, trade_date, close, currency, source) VALUES ($1, '2026-11-09', 100000, 'KRW', 'T')",
            [ids['100001']],
          );
          const half = (
            await call(path(), { method: 'POST', body: await body('100001', 'buy', '1') })
          ).data as Placed;
          assert.deepEqual([half.order.amountKrw, half.order.feeKrw], [100_000, 2]);
        },
        { today },
      );
    },
  );

  await t.test(
    'a sale returns cash, keeps the average cost and removes an emptied holding',
    async () => {
      await reset();
      await withApi(
        pool,
        async (call) => {
          await call(path(), { method: 'POST', body: await body('100001', 'buy', '3') });
          assert.deepEqual(await holding('100001'), { quantity: '3.00000000', cost_krw: '300003' });

          const sold = await call(path(), {
            method: 'POST',
            body: await body('100001', 'sell', '1'),
          });
          assert.equal(sold.status, 201);
          assert.equal((sold.data as Placed).cashKrw, 10_000_000 - 300_003 + 100_001);
          // round(300,003 × 2 / 3) = 200,002
          assert.deepEqual(await holding('100001'), { quantity: '2.00000000', cost_krw: '200002' });

          const tooMany = await call(path(), {
            method: 'POST',
            body: await body('100001', 'sell', '3'),
          });
          assert.deepEqual(
            [tooMany.status, tooMany.data],
            [409, { error: '보유 수량이 부족합니다' }],
          );
          const none = await call(path(), {
            method: 'POST',
            body: await body('005930', 'sell', '1'),
          });
          assert.deepEqual(none.data, { error: '보유 수량이 부족합니다' });

          await call(path(), { method: 'POST', body: await body('100001', 'sell', '2') });
          assert.equal(await holding('100001'), undefined);
          assert.equal(await cashOf(), 10_000_000 - 300_003 + 300_003);
        },
        { today },
      );
    },
  );

  await t.test('orders that cannot fill are refused and change nothing', async () => {
    await reset(100_000);
    await withApi(
      pool,
      async (call) => {
        const refuse = async (order: object, status: number, error: string) => {
          const response = await call(path(), { method: 'POST', body: order });
          assert.deepEqual([response.status, response.data], [status, { error }]);
        };
        await refuse(await body('005930', 'buy', '2'), 409, '현금이 부족합니다');
        // Inactive (#97): not buyable, but a held one can be sold.
        await refuse(await body('000660', 'buy', '1'), 409, '거래가 중단된 종목은 살 수 없습니다');
        await refuse(
          await body('0009A0', 'buy', '1'),
          409,
          '저장된 종가가 없어 주문할 수 없습니다',
        );
        await refuse(
          await body('AAPL', 'buy', '1'),
          409,
          '저장된 환율이 없어 미국 주식을 주문할 수 없습니다',
        );
        await refuse(
          { ...(await body('005930', 'buy', '1')), securityId: 999_999 },
          404,
          '종목을 찾을 수 없습니다',
        );
        assert.equal(await cashOf(), 100_000);
        assert.equal(await orderCount(), 0);

        await pool.query(
          'INSERT INTO mock_holdings (account_id, security_id, quantity, cost_krw) VALUES ($1, $2, 1, 150000)',
          [accountId, ids['000660']],
        );
        const sold = await call(path(), {
          method: 'POST',
          body: await body('000660', 'sell', '1'),
        });
        assert.equal(sold.status, 201);
        assert.equal(await cashOf(), 280_000);

        await pool.query('UPDATE mock_accounts SET closed_at = now() WHERE id = $1', [accountId]);
        await refuse(
          await body('005930', 'buy', '1'),
          409,
          '초기화된 계좌입니다. 화면을 새로 고친 뒤 다시 시도하세요',
        );
        const missing = await call('/api/mock/accounts/999999/orders', {
          method: 'POST',
          body: await body('005930', 'buy', '1'),
        });
        assert.deepEqual(missing.data, { error: '모의투자 계좌를 찾을 수 없습니다' });
      },
      { today },
    );
  });

  await t.test(
    'the preview shows the fill and the reason it cannot fill, and saves nothing',
    async () => {
      await reset(1_000_000);
      await withApi(
        pool,
        async (call) => {
          const ok = (
            await call(`${path()}/preview?securityId=${ids['005930']}&side=buy&quantity=10`)
          ).data as Preview;
          assert.deepEqual(
            [
              ok.price,
              ok.priceDate,
              ok.priceStale,
              ok.amountKrw,
              ok.feeKrw,
              ok.cashKrw,
              ok.cashAfterKrw,
              ok.problem,
            ],
            ['70600.0000', '2026-11-06', false, 706_000, 0, 1_000_000, 294_000, null],
          );
          const tooMuch = (
            await call(`${path()}/preview?securityId=${ids['005930']}&side=buy&quantity=20`)
          ).data as Preview;
          assert.deepEqual([tooMuch.problem, tooMuch.cashAfterKrw], ['현금이 부족합니다', null]);
          const sell = (
            await call(`${path()}/preview?securityId=${ids['005930']}&side=sell&quantity=1`)
          ).data as Preview;
          assert.deepEqual([sell.heldQuantity, sell.problem], ['0', '보유 수량이 부족합니다']);
          assert.equal(await orderCount(), 0);
        },
        { today },
      );
      // Delayed close: more than 5 days before today.
      await withApi(
        pool,
        async (call) => {
          const late = (
            await call(`${path()}/preview?securityId=${ids['005930']}&side=buy&quantity=1`)
          ).data as Preview;
          assert.deepEqual([late.priceStale, late.problem], [true, null]);
        },
        { today: () => '2026-11-12' },
      );
    },
  );

  await t.test('a close or rate that changed after the confirmation is refused', async () => {
    await reset();
    await addRate();
    await withApi(
      pool,
      async (call) => {
        const changed = '시세가 바뀌었습니다. 주문을 다시 확인하세요';
        // The same day's close fetched again with another value.
        const seen = await body('005930', 'buy', '1');
        await pool.query(
          "UPDATE security_prices SET close = 71000 WHERE security_id = $1 AND trade_date = '2026-11-06'",
          [ids['005930']],
        );
        const late = await call(path(), { method: 'POST', body: seen });
        assert.deepEqual([late.status, late.data], [409, { error: changed }]);
        // A new rate for a US order.
        const us = await body('AAPL', 'buy', '1');
        await pool.query(
          "INSERT INTO fx_rates (currency, rate_date, fx_rate, source) VALUES ('USD', '2026-11-09', 1390, 'T')",
        );
        const rate = await call(path(), { method: 'POST', body: us });
        assert.deepEqual([rate.status, rate.data], [409, { error: changed }]);
        assert.equal(await orderCount(), 0);
        assert.equal(await cashOf(), 10_000_000);

        // Confirmed again with what is stored now: it fills.
        const again = await call(path(), { method: 'POST', body: await body('AAPL', 'buy', '1') });
        assert.equal(again.status, 201);
        assert.equal((again.data as Placed).order.fxRate, '1390.0000');
      },
      { today },
    );
  });

  await t.test(
    'the same key sent for two accounts at once is a Korean 409, not a server error',
    async () => {
      await reset();
      // Another account's order with the same key, inserted but not committed yet: the API passes its own
      // key check, then waits on the unique key and fails with 23505 once this commits.
      const closed = await pool.query<{ id: string }>(
        'INSERT INTO mock_accounts (initial_cash_krw, cash_krw, closed_at) VALUES (10000000, 10000000, now()) RETURNING id',
      );
      const order = await body('005930', 'buy', '1');
      const other = await pool.connect();
      try {
        await other.query('BEGIN');
        await other.query(
          `INSERT INTO mock_orders (account_id, security_id, request_key, side, quantity, price, currency,
             price_date, amount_krw, fee_krw, cash_after_krw)
           VALUES ($1, $2, $3, 'buy', 1, 70600, 'KRW', '2026-11-06', 70600, 0, 0)`,
          [closed.rows[0].id, ids['005930'], order.requestKey],
        );
        await withApi(
          pool,
          async (call) => {
            const pending = call(path(), { method: 'POST', body: order });
            await new Promise((resolve) => setTimeout(resolve, 300));
            await other.query('COMMIT');
            const response = await pending;
            assert.deepEqual(
              [response.status, response.data],
              [409, { error: '같은 주문 키로 다른 주문을 보냈습니다' }],
            );
          },
          { today },
        );
      } finally {
        await other.query('ROLLBACK').catch(() => undefined);
        other.release();
      }
      // Rolled back: no cash taken, no holding.
      assert.equal(await cashOf(), 10_000_000);
      assert.equal(await holding('005930'), undefined);
    },
  );

  await t.test(
    'a buy that would take a holding cost over the 1,000조 ceiling is refused',
    async () => {
      await reset();
      await pool.query('UPDATE mock_accounts SET cash_krw = 1000000000000000 WHERE id = $1', [
        accountId,
      ]);
      await pool.query(
        'INSERT INTO mock_holdings (account_id, security_id, quantity, cost_krw) VALUES ($1, $2, 1, 999999999999000)',
        [accountId, ids['005930']],
      );
      await withApi(
        pool,
        async (call) => {
          const response = await call(path(), {
            method: 'POST',
            body: await body('005930', 'buy', '1'),
          });
          assert.deepEqual(
            [response.status, response.data],
            [409, { error: '주문 금액이 너무 큽니다' }],
          );
        },
        { today },
      );
    },
  );

  await t.test('the DB keeps orders whole-share and USD orders with a rate', async () => {
    await reset();
    const insert = (quantity: string, currency: string, rate: string | null) =>
      pool.query(
        `INSERT INTO mock_orders (account_id, security_id, request_key, side, quantity, price, currency, price_date,
           fx_rate, fx_date, amount_krw, fee_krw, cash_after_krw)
         VALUES ($1, $2, $3, 'buy', $4, 100, $5, '2026-11-06', $6, $7, 100, 0, 0)`,
        [
          accountId,
          currency === 'USD' ? ids.AAPL : ids['005930'],
          randomUUID(),
          quantity,
          currency,
          rate,
          rate ? '2026-11-06' : null,
        ],
      );
    await assert.rejects(insert('1.5', 'KRW', null), /mock_orders_quantity_check/);
    await assert.rejects(insert('1', 'USD', null), /mock_orders_fx_check/);
    await assert.rejects(insert('1', 'KRW', '1384.5'), /mock_orders_fx_check/);
    await assert.rejects(
      pool.query('UPDATE mock_accounts SET fee_rate = 0.01 WHERE id = $1', [accountId]),
      /mock_accounts_fee_rate_check/,
    );
  });
});
