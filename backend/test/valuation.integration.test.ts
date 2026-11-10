import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { fakeSources } from '../src/prices/fake.js';
import { trackedUsSecurities } from '../src/prices/store.js';
import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
const assets = '/api/portfolio/assets';
const today = '2026-11-10';

type Asset = {
  id: number;
  currency: string;
  quantity: string | null;
  security: { id: number; symbol: string; name: string | null; active: boolean } | null;
  manualPrice: { price: string; pricedOn: string } | null;
  price: {
    price: string;
    currency: string;
    source: 'close' | 'manual';
    date: string;
    stale: boolean;
  } | null;
  fx: { fxRate: string; rateDate: string; stale: boolean } | null;
  currentValueKrw: number | null;
  currentValueForeign: string | null;
  valueIssue: string | null;
  costKrw: number | null;
  profitKrw: number | null;
  returnPercent: string | null;
};
type Totals = { assetsKrw: number | null; uncounted: number };

// #47 Current prices of held assets. Requires the dedicated test DB; skipped (not passed) without it.
test('asset valuation against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const ids: Record<string, number> = {};
  const reset = async () => {
    await pool.query(
      `DROP TABLE IF EXISTS portfolio_trades, portfolio_prepaid_usages, portfolio_assets, mock_orders,
         mock_holdings, security_prices, fx_rates, price_fetch_state, price_api_calls, krx_market_days, securities`,
    );
    for (const file of [
      '004_portfolio_assets.sql',
      '007_depreciable_assets.sql',
      '010_prepaid_assets.sql',
      '013_asset_trades.sql',
      '009_prices.sql',
      '012_krx_listing.sql',
      '016_asset_valuation.sql',
      '016_asset_valuation.sql', // re-running is safe
    ]) {
      await runMigration(pool, file);
    }
    const { rows } = await pool.query<{ id: string; symbol: string }>(
      `INSERT INTO securities (market, symbol, name, kind, currency, active) VALUES
         ('KOSPI', '005930', '삼성전자', 'stock', 'KRW', true),
         ('KOSPI', '000001', '정지종목', 'stock', 'KRW', false),
         ('NASDAQ', 'AAPL', NULL, 'stock', 'USD', true),
         ('NASDAQ', 'MSFT', 'Microsoft Corp', 'stock', 'USD', true)
       RETURNING id, symbol`,
    );
    for (const row of rows) ids[row.symbol] = Number(row.id);
  };
  const close = (symbol: string, date: string, price: string, currency = 'KRW') =>
    pool.query(
      `INSERT INTO security_prices (security_id, trade_date, close, currency, source) VALUES ($1, $2, $3, $4, 'TEST')`,
      [ids[symbol], date, price, currency],
    );
  const rate = (date: string, value: string) =>
    pool.query(
      `INSERT INTO fx_rates (currency, rate_date, fx_rate, source) VALUES ('USD', $1, $2, 'TEST')`,
      [date, value],
    );

  type Call = Parameters<Parameters<typeof withApi>[1]>[0];
  const create = async (call: Call, body: object) => {
    const response = await call(assets, { method: 'POST', body });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.asset as Asset & { id: number };
  };
  const list = async (call: Call, asOf?: string) => {
    const { data } = await call(asOf ? `${assets}?asOf=${asOf}` : assets);
    return { assets: data.assets as Asset[], totals: data.totals as Totals };
  };
  const api = (run: (call: Call) => Promise<void>, sources = {}) =>
    withApi(pool, run, {
      today: () => today,
      now: () => new Date(`${today}T03:00:00Z`),
      prices: sources,
    });

  await t.test('a linked stock is valued at its newest close, delayed after 5 days', async () => {
    await reset();
    await close('005930', '2026-11-03', '70000');
    await close('005930', '2026-11-05', '71500');
    await api(async (call) => {
      const asset = await create(call, {
        name: '삼성전자',
        type: 'stock',
        currency: 'KRW',
        quantity: '10',
        securityId: ids['005930'],
      });
      assert.deepEqual(asset.security, {
        id: ids['005930'],
        market: 'KOSPI',
        symbol: '005930',
        name: '삼성전자',
        active: true,
      });
      assert.deepEqual(asset.price, {
        price: '71500.0000',
        currency: 'KRW',
        source: 'close',
        date: '2026-11-05',
        stale: false,
      });
      assert.equal(asset.currentValueKrw, 715_000);
      assert.equal(asset.valueIssue, null);
      // No trades: no cost, so no gain.
      assert.deepEqual([asset.costKrw, asset.profitKrw, asset.returnPercent], [null, null, null]);

      // An earlier reference date uses the close of that time; 6 days old is delayed.
      const before = (await list(call, '2026-11-04')).assets[0];
      assert.equal(before.currentValueKrw, 700_000);
      assert.equal(before.price?.date, '2026-11-03');
      assert.equal(before.price?.stale, false);
      const late = (await list(call, '2026-11-11')).assets[0];
      assert.equal(late.price?.stale, true);
      assert.equal(late.currentValueKrw, 715_000);
      assert.equal((await list(call)).totals.assetsKrw, 715_000);
    });
  });

  await t.test(
    'a USD holding with trades is converted at the newest rate and shows its gain',
    async () => {
      await reset();
      await close('AAPL', '2026-11-06', '110.25', 'USD');
      await rate('2026-11-02', '1300');
      await rate('2026-11-09', '1400.5');
      await api(async (call) => {
        const asset = await create(call, {
          name: '애플',
          type: 'stock',
          currency: 'USD',
          quantity: null,
          valueForeign: '1',
          securityId: ids.AAPL,
        });
        const bought = await call(`${assets}/${asset.id}/trades`, {
          method: 'POST',
          body: {
            side: 'buy',
            tradedOn: '2026-11-02',
            quantity: '2',
            price: '100',
            fxRate: '1300',
            feeKrw: 1000,
            taxKrw: 0,
          },
        });
        assert.equal(bought.status, 201, JSON.stringify(bought.data));
        const [held] = (await list(call)).assets;
        // 2 × 110.25 × 1400.5 = 308,810.25 → 308,810 (rounded once). Cost 2 × 100 × 1300 + 1,000 fee.
        assert.equal(held.currentValueForeign, '220.5000');
        assert.equal(held.currentValueKrw, 308_810);
        assert.deepEqual(held.fx, { fxRate: '1400.5000', rateDate: '2026-11-09', stale: false });
        assert.equal(held.costKrw, 261_000);
        assert.equal(held.profitKrw, 47_810);
        assert.equal(held.returnPercent, '18.32');

        // Everything sold: holds nothing, worth 0, and the gain is realized (#46), not shown here.
        await call(`${assets}/${asset.id}/trades`, {
          method: 'POST',
          body: {
            side: 'sell',
            tradedOn: '2026-11-09',
            quantity: '2',
            price: '110',
            fxRate: '1400',
          },
        });
        const [sold] = (await list(call)).assets;
        assert.deepEqual(
          [sold.quantity, sold.currentValueKrw, sold.costKrw, sold.profitKrw, sold.returnPercent],
          [null, 0, 0, 0, null],
        );
      });
    },
  );

  await t.test(
    'without a rate a USD asset is left out of the totals but keeps its dollars',
    async () => {
      await reset();
      await api(async (call) => {
        await create(call, {
          name: '달러 예금',
          type: 'cash',
          currency: 'USD',
          valueForeign: '100.5',
        });
        await create(call, { name: '통장', type: 'cash', currency: 'KRW', valueKrw: 1000 });
        let { assets: found, totals } = await list(call);
        const dollars = found.find((asset) => asset.currency === 'USD')!;
        assert.deepEqual(
          [dollars.currentValueKrw, dollars.currentValueForeign, dollars.valueIssue, dollars.fx],
          [null, '100.5000', 'no_fx', null],
        );
        assert.deepEqual(totals, { ...totals, assetsKrw: 1000, uncounted: 1 });

        // A rate more than 5 days old is still used, and marked delayed.
        await rate('2026-11-03', '1385.25');
        ({ assets: found, totals } = await list(call));
        const converted = found.find((asset) => asset.currency === 'USD')!;
        assert.equal(converted.currentValueKrw, 139_218); // 100.5 × 1385.25 = 139,217.625
        assert.deepEqual(converted.fx, {
          fxRate: '1385.2500',
          rateDate: '2026-11-03',
          stale: true,
        });
        assert.deepEqual(totals, { ...totals, assetsKrw: 140_218, uncounted: 0 });
      });
    },
  );

  await t.test('an unlinked asset uses the price entered by hand', async () => {
    await reset();
    await api(async (call) => {
      const coin = await create(call, {
        name: '비트코인',
        type: 'other',
        currency: 'KRW',
        quantity: '0.05',
        manualPrice: { price: '95000000', pricedOn: '2026-11-09' },
      });
      assert.deepEqual(coin.manualPrice, { price: '95000000.0000', pricedOn: '2026-11-09' });
      assert.deepEqual(coin.price, {
        price: '95000000.0000',
        currency: 'KRW',
        source: 'manual',
        date: '2026-11-09',
        stale: false,
      });
      assert.equal(coin.currentValueKrw, 4_750_000);

      const usd = await create(call, {
        name: '비상장 미국 주식',
        type: 'stock',
        currency: 'USD',
        quantity: '3',
        manualPrice: { price: '12.3456', pricedOn: '2026-11-01' },
      });
      assert.equal(usd.currentValueForeign, '37.0368');
      assert.equal(usd.valueIssue, 'no_fx');
    });
  });

  await t.test(
    'a linked security without a close has no price, and no hand price is mixed in',
    async () => {
      await reset();
      await api(async (call) => {
        const asset = await create(call, {
          name: '애플',
          type: 'stock',
          currency: 'USD',
          quantity: '1',
          securityId: ids.MSFT,
        });
        assert.deepEqual([asset.price, asset.valueIssue], [null, 'no_price']);
        const { totals } = await list(call);
        assert.equal(totals.uncounted, 1);
      });
    },
  );

  await t.test('a stopped security is valued at its last close', async () => {
    await reset();
    await close('000001', '2026-10-01', '5000');
    await api(async (call) => {
      const asset = await create(call, {
        name: '정지종목',
        type: 'stock',
        currency: 'KRW',
        quantity: '3',
        securityId: ids['000001'],
      });
      assert.equal(asset.security?.active, false);
      assert.equal(asset.price?.stale, true);
      assert.equal(asset.currentValueKrw, 15_000);
    });
  });

  await t.test(
    'linking a US security without closes fetches it once and tracks the holding',
    async () => {
      await reset();
      await api(async (call) => {
        const asset = await create(call, {
          name: '애플',
          type: 'stock',
          currency: 'USD',
          quantity: '2',
          securityId: ids.AAPL,
        });
        assert.equal(asset.price?.source, 'close');
        assert.equal(asset.price?.currency, 'USD');
        const calls = await pool.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM price_api_calls',
        );
        assert.equal(calls.rows[0].n, 1);

        // Saving again with closes stored does not fetch again.
        const again = await call(`${assets}/${asset.id}`, {
          method: 'PUT',
          body: {
            name: '애플 주식',
            type: 'stock',
            currency: 'USD',
            quantity: '2',
            securityId: ids.AAPL,
          },
        });
        assert.equal(again.status, 200, JSON.stringify(again.data));
        const after = await pool.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM price_api_calls',
        );
        assert.equal(after.rows[0].n, 1);
      }, fakeSources());

      // Held and linked: on the daily fetch. Without a quantity it is not a holding.
      const tracked = await trackedUsSecurities(pool, new Date(`${today}T03:00:00Z`));
      assert.deepEqual(
        tracked.map((security) => security.symbol),
        ['AAPL'],
      );
      await pool.query('UPDATE portfolio_assets SET quantity = NULL, value_foreign = 1');
      assert.deepEqual(await trackedUsSecurities(pool, new Date(`${today}T03:00:00Z`)), []);
    },
  );

  await t.test('a fetch that fails still saves the asset without a price', async () => {
    await reset();
    const sources = fakeSources();
    sources.tiingo.closes = () => Promise.reject(new Error('down'));
    const logged: object[] = [];
    await withApi(
      pool,
      async (call) => {
        const asset = await create(call, {
          name: '애플',
          type: 'stock',
          currency: 'USD',
          quantity: '2',
          securityId: ids.AAPL,
        });
        assert.equal(asset.valueIssue, 'no_price');
      },
      { today: () => today, prices: sources, priceLog: (event) => logged.push(event) },
    );
    assert.deepEqual(logged, [
      { event: 'price_fetch_now', symbol: 'AAPL', result: 'fetch_failed' },
    ]);
  });

  await t.test('linking and hand prices are checked with Korean messages', async () => {
    await reset();
    await api(async (call) => {
      const post = (body: object) => call(assets, { method: 'POST', body });
      const base = { name: '종목', type: 'stock', currency: 'KRW', quantity: '1' };
      const cases: [object, string][] = [
        [
          { ...base, type: 'other', securityId: ids['005930'] },
          '종목은 주식 자산에만 연결할 수 있습니다',
        ],
        [{ ...base, securityId: 999_999 }, '연결할 종목을 찾을 수 없습니다'],
        [{ ...base, securityId: ids.AAPL }, '종목의 통화(USD)와 자산의 통화가 같아야 합니다'],
        [
          { ...base, securityId: ids['005930'], manualPrice: { price: '1', pricedOn: today } },
          '종목에 연결한 자산은 받은 종가로 평가하므로 현재가를 입력하지 않습니다',
        ],
        [
          { ...base, manualPrice: { price: '1000.5', pricedOn: today } },
          '원화 현재가는 원 단위 정수로 입력하세요',
        ],
        [{ ...base, manualPrice: { price: '0', pricedOn: today } }, '현재가는 0보다 커야 합니다'],
        [
          {
            ...base,
            type: 'real_estate',
            valueKrw: 1,
            manualPrice: { price: '1', pricedOn: today },
          },
          '현재가는 주식이나 기타(코인 등) 자산에만 입력할 수 있습니다',
        ],
        [
          { ...base, quantity: null, valueKrw: 1, manualPrice: { price: '1', pricedOn: today } },
          '현재가를 넣으려면 수량을 입력하세요',
        ],
        [{ ...base, manualPrice: { price: '1' } }, '날짜'],
      ];
      for (const [body, message] of cases) {
        const response = await post(body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.match(String(response.data.error), new RegExp(message.replace(/[()]/g, '\\$&')));
      }
      // A whole won price written with zero decimals is fine.
      const ok = await post({ ...base, manualPrice: { price: '1000.00', pricedOn: today } });
      assert.equal(ok.status, 201);
    });
  });

  await t.test('values too large to add up are left out instead of failing the list', async () => {
    await reset();
    await api(async (call) => {
      await create(call, {
        name: '큰 값',
        type: 'other',
        currency: 'KRW',
        quantity: '999999999999',
        manualPrice: { price: '9999999999999999', pricedOn: today },
      });
      const { assets: found, totals } = await list(call);
      assert.deepEqual([found[0].currentValueKrw, found[0].valueIssue], [null, 'too_large']);
      assert.deepEqual(totals, { ...totals, assetsKrw: 0, uncounted: 1 });
    });
  });

  await t.test('the database keeps links and hand prices consistent', async () => {
    await reset();
    const insert = (values: string) =>
      pool.query(
        `INSERT INTO portfolio_assets (name, asset_type, currency, quantity, security_id, manual_price, manual_price_on)
         VALUES ${values}`,
      );
    await assert.rejects(
      insert(`('a', 'stock', 'KRW', 1, ${ids.AAPL}, NULL, NULL)`),
      /security_fkey/,
    );
    await assert.rejects(
      insert(`('a', 'other', 'KRW', 1, ${ids['005930']}, NULL, NULL)`),
      /valuation_check/,
    );
    await assert.rejects(
      insert(`('a', 'stock', 'KRW', 1, ${ids['005930']}, 100, '2026-11-01')`),
      /valuation_check/,
    );
    await assert.rejects(
      insert(`('a', 'stock', 'KRW', 1, NULL, 100.5, '2026-11-01')`),
      /valuation_check/,
    );
    await assert.rejects(insert(`('a', 'stock', 'KRW', 1, NULL, 100, NULL)`), /valuation_check/);
    await insert(`('a', 'stock', 'USD', 1, NULL, 100.5, '2026-11-01')`);
  });
});
