import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;

type Trade = {
  id: number;
  side: 'buy' | 'sell';
  tradedOn: string;
  quantity: string;
  currency: string;
  price: string;
  fxRate: string | null;
  amountKrw: number;
  feeKrw: number;
  taxKrw: number;
  memo: string;
  quantityAfter: string;
  realizedKrw: number | null;
};
type Position = {
  quantity: string | null;
  averagePrice: string | null;
  costKrw: number;
  realizedKrw: number;
};
type Asset = { id: number; quantity: string | null; hasTrades: boolean };

const assets = '/api/portfolio/assets';
const samsung = { name: '삼성전자', type: 'stock', currency: 'KRW', quantity: '1' };
const apple = { name: '애플', type: 'stock', currency: 'USD', quantity: '1' };

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('asset trades against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async () => {
    await pool.query(
      'DROP TABLE IF EXISTS portfolio_trades, portfolio_prepaid_usages, portfolio_assets',
    );
    for (const file of [
      '004_portfolio_assets.sql',
      '007_depreciable_assets.sql',
      '010_prepaid_assets.sql',
      '013_asset_trades.sql',
      '013_asset_trades.sql', // re-running is safe
    ]) {
      await runMigration(pool, file);
    }
  };

  type Call = Parameters<Parameters<typeof withApi>[1]>[0];
  const create = async (call: Call, body: object) =>
    ((await call(assets, { method: 'POST', body })).data.asset as Asset).id;
  const trade = (call: Call, id: number, body: object) =>
    call(`${assets}/${id}/trades`, { method: 'POST', body });
  const ledger = async (call: Call, id: number) => {
    const { data } = await call(`${assets}/${id}/trades`);
    return { trades: data.trades as Trade[], position: data.position as Position };
  };
  const assetOf = async (call: Call, id: number) =>
    ((await call(assets)).data.assets as Asset[]).find((asset) => asset.id === id)!;

  await t.test('split buys and a partial sell use the moving average, fees and taxes', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const id = await create(call, samsung);
      const buy1 = await trade(call, id, {
        side: 'buy',
        tradedOn: '2026-01-02',
        quantity: '10',
        price: '1000',
        feeKrw: 100,
        memo: ' 첫 매수 ',
      });
      assert.equal(buy1.status, 201);
      assert.deepEqual(
        { ...(buy1.data.trade as Trade), id: 0 },
        {
          id: 0,
          side: 'buy',
          tradedOn: '2026-01-02',
          quantity: '10.00000000',
          currency: 'KRW',
          price: '1000.0000',
          fxRate: null,
          amountKrw: 10_000,
          feeKrw: 100,
          taxKrw: 0,
          memo: '첫 매수',
          quantityAfter: '10.00000000',
          realizedKrw: null,
        },
      );
      await trade(call, id, {
        side: 'buy',
        tradedOn: '2026-01-05',
        quantity: '10',
        price: '1300',
        feeKrw: 130,
      });
      // Cost 10,100 + 13,130 = 23,230 for 20: 1,161.5 a share, the buy fees included.
      assert.deepEqual((await ledger(call, id)).position, {
        quantity: '20.00000000',
        averagePrice: '1161.5000',
        costKrw: 23_230,
        realizedKrw: 0,
      });

      const sell = await trade(call, id, {
        side: 'sell',
        tradedOn: '2026-01-10',
        quantity: '5',
        price: '1500',
        feeKrw: 75,
        taxKrw: 15,
      });
      assert.equal(sell.status, 201);
      // Average cost of 5: round(23,230 × 5 ÷ 20) = round(5,807.5) = 5,808 (half away from zero).
      // Realized: 7,500 − 5,808 − 75 − 15 = 1,602.
      assert.equal((sell.data.trade as Trade).realizedKrw, 1602);
      assert.equal((sell.data.trade as Trade).quantityAfter, '15.00000000');
      const { trades, position } = await ledger(call, id);
      assert.deepEqual(position, {
        quantity: '15.00000000',
        averagePrice: '1161.4667', // 17,422 ÷ 15
        costKrw: 17_422,
        realizedKrw: 1602,
      });
      assert.deepEqual(
        trades.map((item) => item.tradedOn),
        ['2026-01-10', '2026-01-05', '2026-01-02'], // newest first
      );
      // The asset's quantity is the trades' total, saved in the same transaction.
      const asset = await assetOf(call, id);
      assert.deepEqual(
        { quantity: asset.quantity, hasTrades: asset.hasTrades },
        { quantity: '15.00000000', hasTrades: true },
      );
    });
  });

  await t.test(
    'a USD asset averages in dollars and realizes in won with the entered rates',
    async () => {
      await reset();
      await withApi(pool, async (call) => {
        const id = await create(call, apple);
        // 2 × 100.5 × 1,300 = 261,300 won, plus a 1,000 won fee.
        const first = await trade(call, id, {
          side: 'buy',
          tradedOn: '2026-02-02',
          quantity: '2',
          price: '100.5',
          fxRate: '1300',
          feeKrw: 1000,
        });
        assert.equal((first.data.trade as Trade).amountKrw, 261_300);
        assert.equal((first.data.trade as Trade).fxRate, '1300.0000');
        await trade(call, id, {
          side: 'buy',
          tradedOn: '2026-02-03',
          quantity: '1',
          price: '110',
          fxRate: '1400',
        });
        assert.deepEqual((await ledger(call, id)).position, {
          quantity: '3.00000000',
          averagePrice: '103.6667', // 311 dollars ÷ 3, the won fee left out
          costKrw: 416_300,
          realizedKrw: 0,
        });
        // 1.5 × 120 × 1,350 = 243,000 won; cost taken round(416,300 × 1.5 ÷ 3) = 208,150.
        const sell = await trade(call, id, {
          side: 'sell',
          tradedOn: '2026-02-10',
          quantity: '1.5',
          price: '120',
          fxRate: '1350',
        });
        assert.equal((sell.data.trade as Trade).realizedKrw, 34_850);
        assert.deepEqual((await ledger(call, id)).position, {
          quantity: '1.50000000',
          averagePrice: '103.6667',
          costKrw: 208_150,
          realizedKrw: 34_850,
        });
      });
    },
  );

  await t.test(
    'a sell above what is held at that date is refused and nothing is saved',
    async () => {
      await reset();
      await withApi(pool, async (call) => {
        const id = await create(call, samsung);
        const buy = await trade(call, id, {
          side: 'buy',
          tradedOn: '2026-03-02',
          quantity: '10',
          price: '1000',
        });
        const buyId = (buy.data.trade as Trade).id;
        const sell = await trade(call, id, {
          side: 'sell',
          tradedOn: '2026-03-05',
          quantity: '6',
          price: '1000',
        });
        const sellId = (sell.data.trade as Trade).id;

        const over = await trade(call, id, {
          side: 'sell',
          tradedOn: '2026-03-06',
          quantity: '4.5',
          price: '1000',
        });
        assert.equal(over.status, 400);
        assert.deepEqual(over.data, {
          error: '2026-03-06 매도 수량이 그때 보유 수량(4)보다 많습니다',
        });
        // A sell dated before the buy.
        const early = await trade(call, id, {
          side: 'sell',
          tradedOn: '2026-03-01',
          quantity: '1',
          price: '1000',
        });
        assert.deepEqual(early.data, {
          error: '2026-03-01 매도 수량이 그때 보유 수량(0)보다 많습니다',
        });
        // Deleting or shrinking the buy a later sell relies on.
        const del = await call(`${assets}/${id}/trades/${buyId}`, { method: 'DELETE' });
        assert.equal(del.status, 400);
        const shrink = await call(`${assets}/${id}/trades/${buyId}`, {
          method: 'PUT',
          body: { side: 'buy', tradedOn: '2026-03-02', quantity: '5', price: '1000' },
        });
        assert.deepEqual(shrink.data, {
          error: '2026-03-05 매도 수량이 그때 보유 수량(5)보다 많습니다',
        });
        // Moving the sell before the buy.
        const moved = await call(`${assets}/${id}/trades/${sellId}`, {
          method: 'PUT',
          body: { side: 'sell', tradedOn: '2026-03-01', quantity: '6', price: '1000' },
        });
        assert.equal(moved.status, 400);

        const { trades, position } = await ledger(call, id);
        assert.equal(trades.length, 2);
        assert.equal(position.quantity, '4.00000000');
        assert.equal((await assetOf(call, id)).quantity, '4.00000000');
      });
    },
  );

  await t.test('trades on the same date count in the order they were entered', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const id = await create(call, samsung);
      const day = { tradedOn: '2026-04-01', quantity: '3', price: '1000' };
      // A sell entered before the buy of the same day is a sell of nothing.
      const sellFirst = await trade(call, id, { ...day, side: 'sell' });
      assert.equal(sellFirst.status, 400);
      assert.equal((await trade(call, id, { ...day, side: 'buy' })).status, 201);
      assert.equal((await trade(call, id, { ...day, side: 'sell' })).status, 201);
    });
  });

  await t.test('selling everything, editing and deleting keep the asset consistent', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const id = await create(call, samsung);
      const buy = await trade(call, id, {
        side: 'buy',
        tradedOn: '2026-05-01',
        quantity: '2',
        price: '1000',
      });
      const sell = await trade(call, id, {
        side: 'sell',
        tradedOn: '2026-05-02',
        quantity: '2',
        price: '1100',
      });
      assert.deepEqual((await ledger(call, id)).position, {
        quantity: null,
        averagePrice: null,
        costKrw: 0,
        realizedKrw: 200,
      });
      const sold = await assetOf(call, id);
      assert.deepEqual(
        { quantity: sold.quantity, hasTrades: sold.hasTrades },
        { quantity: null, hasTrades: true },
      );
      // The asset can still be renamed with nothing held and no value.
      const renamed = await call(`${assets}/${id}`, {
        method: 'PUT',
        body: { ...samsung, name: '삼성전자 우', quantity: null },
      });
      assert.equal(renamed.status, 200);

      // An edited trade is saved and the position follows.
      const edited = await call(`${assets}/${id}/trades/${(buy.data.trade as Trade).id}`, {
        method: 'PUT',
        body: { side: 'buy', tradedOn: '2026-05-01', quantity: '3', price: '900', feeKrw: 10 },
      });
      assert.equal(edited.status, 200);
      assert.equal((edited.data.trade as Trade).amountKrw, 2700);
      assert.equal((await assetOf(call, id)).quantity, '1.00000000');

      for (const item of [sell, buy]) {
        const gone = await call(`${assets}/${id}/trades/${(item.data.trade as Trade).id}`, {
          method: 'DELETE',
        });
        assert.equal(gone.status, 204);
      }
      // No trades left: the quantity is entered by hand again (the asset still has nothing held until then).
      assert.equal((await assetOf(call, id)).hasTrades, false);
      const manual = await call(`${assets}/${id}`, {
        method: 'PUT',
        body: { ...samsung, quantity: '7' },
      });
      assert.equal(manual.status, 200);
      assert.deepEqual(
        {
          quantity: (manual.data.asset as Asset).quantity,
          hasTrades: (manual.data.asset as Asset).hasTrades,
        },
        { quantity: '7.00000000', hasTrades: false },
      );
    });
  });

  await t.test(
    'an asset with trades keeps its quantity, a tradeable type and its currency',
    async () => {
      await reset();
      await withApi(pool, async (call) => {
        const id = await create(call, samsung);
        await trade(call, id, {
          side: 'buy',
          tradedOn: '2026-06-01',
          quantity: '4',
          price: '1000',
        });
        const put = (body: object) => call(`${assets}/${id}`, { method: 'PUT', body });
        const quantity = await put({ ...samsung, quantity: '5' });
        assert.deepEqual(quantity.data, {
          error: '거래 기록이 있는 자산의 수량은 거래로만 바뀝니다',
        });
        const cash = await put({ ...samsung, type: 'cash', quantity: '4' });
        assert.equal(cash.status, 400);
        assert.deepEqual(cash.data, {
          error: '거래 기록이 있는 자산은 주식이나 기타(코인 등)로, 같은 통화로만 바꿀 수 있습니다',
        });
        const usd = await put({ ...samsung, currency: 'USD', quantity: '4' });
        assert.equal(usd.status, 400);
        // Same quantity written differently, and a move to 기타 are fine.
        const fine = await put({ ...samsung, type: 'other', quantity: '4.0' });
        assert.equal(fine.status, 200);
      });
    },
  );

  await t.test('trades follow the asset currency and type, and refuse future dates', async () => {
    await reset();
    await withApi(
      pool,
      async (call) => {
        const won = await create(call, samsung);
        const dollar = await create(call, apple);
        const savings = await create(call, {
          name: '통장',
          type: 'cash',
          currency: 'KRW',
          valueKrw: 1000,
        });
        const base = { side: 'buy', tradedOn: '2026-07-01', quantity: '1', price: '1000' };
        const cases: [number, object, string][] = [
          [won, { ...base, fxRate: '1300' }, '원화 자산의 거래에는 환율을 넣지 않습니다'],
          [won, { ...base, price: '1000.5' }, '원화 단가는 원 단위 정수로 입력하세요'],
          [dollar, base, '달러 거래는 그날 환율을 입력하세요'],
          [savings, base, '거래는 주식과 기타(코인 등) 자산에만 기록할 수 있습니다'],
          [won, { ...base, tradedOn: '2026-07-16' }, '오늘 이후 날짜의 거래는 기록할 수 없습니다'],
          [
            won,
            { ...base, quantity: '999999999999', price: '9999999999' },
            '거래 금액이 1,000조 원을 넘습니다',
          ],
        ];
        for (const [id, body, error] of cases) {
          const response = await trade(call, id, body);
          assert.equal(response.status, 400, error);
          assert.deepEqual(response.data, { error });
        }
        assert.equal((await trade(call, 999999, base)).status, 404);
        // A trade id of another asset is not found.
        const mine = await trade(call, won, base);
        const other = await call(`${assets}/${dollar}/trades/${(mine.data.trade as Trade).id}`, {
          method: 'DELETE',
        });
        assert.equal(other.status, 404);
        assert.deepEqual(other.data, { error: '거래를 찾을 수 없습니다' });
      },
      { today: () => '2026-07-15' },
    );
  });

  await t.test('two sells of everything at once: only one goes through', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const id = await create(call, samsung);
      await trade(call, id, { side: 'buy', tradedOn: '2026-08-01', quantity: '5', price: '1000' });
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          trade(call, id, { side: 'sell', tradedOn: '2026-08-02', quantity: '5', price: '1000' }),
        ),
      );
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 400, 400, 400]);
    });
  });

  await t.test('the DB refuses inconsistent trades and deletes them with their asset', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const id = await create(call, samsung);
      await trade(call, id, { side: 'buy', tradedOn: '2026-08-01', quantity: '1', price: '1000' });
      const insert = (values: string) =>
        pool.query(
          `INSERT INTO portfolio_trades (asset_id, side, traded_on, quantity, currency, price, fx_rate,
             amount_krw) VALUES (${id}, ${values})`,
        );
      // A won price with a fraction, a won trade with a rate, a dollar trade without one.
      await assert.rejects(insert("'buy', '2026-08-01', 1, 'KRW', 1.5, NULL, 2"), {
        code: '23514',
      });
      await assert.rejects(insert("'buy', '2026-08-01', 1, 'KRW', 1, 1300, 1"), { code: '23514' });
      await assert.rejects(insert("'buy', '2026-08-01', 1, 'USD', 1, NULL, 1"), { code: '23514' });
      assert.equal((await call(`${assets}/${id}`, { method: 'DELETE' })).status, 204);
      const left = await pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM portfolio_trades',
      );
      assert.equal(left.rows[0].n, 0);
    });
  });

  await t.test('the first trade replaces a quantity entered by hand (decision 4)', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const id = await create(call, { ...samsung, quantity: '10' });
      // Holding 10 by hand is not a trade: a first sell has nothing to sell.
      const sell = await trade(call, id, {
        side: 'sell',
        tradedOn: '2026-09-01',
        quantity: '1',
        price: '1000',
      });
      assert.deepEqual(sell.data, {
        error: '2026-09-01 매도 수량이 그때 보유 수량(0)보다 많습니다',
      });
      assert.equal((await assetOf(call, id)).quantity, '10.00000000');
      await trade(call, id, { side: 'buy', tradedOn: '2026-09-01', quantity: '5', price: '1000' });
      assert.equal((await assetOf(call, id)).quantity, '5.00000000');
    });
  });

  await t.test('a quantity too large anywhere in the history is a Korean 400', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const id = await create(call, samsung);
      const big = { quantity: '600000000000', price: '1' };
      await trade(call, id, { ...big, side: 'buy', tradedOn: '2026-09-01' });
      await trade(call, id, { ...big, side: 'sell', tradedOn: '2026-09-10' });
      // In between, the holding would reach 1.2조 shares although it ends at 0.6조.
      const between = await trade(call, id, { ...big, side: 'buy', tradedOn: '2026-09-05' });
      assert.equal(between.status, 400);
      assert.deepEqual(between.data, { error: '보유 수량이나 금액이 너무 큽니다' });
    });
  });

  await t.test('an asset edit and a trade at the same time leave a consistent asset', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const id = await create(call, samsung);
      await trade(call, id, { side: 'buy', tradedOn: '2026-09-01', quantity: '2', price: '1000' });
      // The edit sends the quantity it saw (2); the trade makes it 3. Either the edit goes first and the
      // trade follows, or the trade goes first and the edit is refused: never a quantity of 2 with 3 bought.
      const [edit, buy] = await Promise.all([
        call(`${assets}/${id}`, {
          method: 'PUT',
          body: { ...samsung, name: '삼성', quantity: '2' },
        }),
        trade(call, id, { side: 'buy', tradedOn: '2026-09-02', quantity: '1', price: '1000' }),
      ]);
      assert.equal(buy.status, 201);
      assert.ok([200, 400].includes(edit.status));
      assert.equal((await assetOf(call, id)).quantity, '3.00000000');
    });
  });

  await t.test(
    're-running older migrations after 013 keeps assets that only 013 allows',
    async () => {
      await reset();
      await withApi(pool, async (call) => {
        const id = await create(call, samsung);
        await trade(call, id, {
          side: 'buy',
          tradedOn: '2026-09-01',
          quantity: '1',
          price: '1000',
        });
        await trade(call, id, {
          side: 'sell',
          tradedOn: '2026-09-02',
          quantity: '1',
          price: '1000',
        });
      });
      // All sold: quantity NULL and no value, valid only through quantity_from_trades.
      for (const file of [
        '004_portfolio_assets.sql',
        '007_depreciable_assets.sql',
        '010_prepaid_assets.sql',
        '013_asset_trades.sql',
        '007_depreciable_assets.sql',
        '010_prepaid_assets.sql',
      ]) {
        await runMigration(pool, file);
      }
      const { rows } = await pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'portfolio_assets'::regclass
         AND conname = 'portfolio_assets_quantity_or_value_check'`,
      );
      assert.match(rows[0].def, /quantity_from_trades/);
    },
  );

  await t.test('one sell whose realized profit no JSON number holds is refused', async () => {
    await reset();
    await withApi(pool, async (call) => {
      const id = await create(call, samsung);
      const max = 1_000_000_000_000_000;
      // Two sells of about +1,000조 each keep the total of realized profit in range later on.
      await trade(call, id, { side: 'buy', tradedOn: '2026-10-01', quantity: '2', price: '1' });
      for (const day of ['2026-10-02', '2026-10-03']) {
        await trade(call, id, { side: 'sell', tradedOn: day, quantity: '1', price: String(max) });
      }
      // A won cost of 9,000조 (three buys of 1,000조 each with as much in fees and taxes).
      for (let n = 0; n < 3; n += 1) {
        await trade(call, id, {
          side: 'buy',
          tradedOn: '2026-10-04',
          quantity: '1',
          price: String(max),
          feeKrw: max,
          taxKrw: max,
        });
      }
      // Selling them for 1 won with a 1,000조 fee: about −1경 on this one sell, while the total stays
      // about −8,000조.
      const sell = await trade(call, id, {
        side: 'sell',
        tradedOn: '2026-10-05',
        quantity: '3',
        price: '1',
        feeKrw: max,
      });
      assert.equal(sell.status, 400);
      assert.deepEqual(sell.data, { error: '보유 수량이나 금액이 너무 큽니다' });
      assert.equal((await call(`${assets}/${id}/trades`)).status, 200);
    });
  });
});
