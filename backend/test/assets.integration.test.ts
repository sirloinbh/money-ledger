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
  depreciation: {
    purchasePriceKrw: number;
    purchasedOn: string;
    usefulLifeMonths: number;
    salvageValueKrw: number;
  } | null;
  currentValueKrw: number | null;
};
type Totals = {
  assetsKrw: number | null;
  debtsKrw: number | null;
  netKrw: number | null;
  uncounted: number;
};

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('portfolio assets against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async () => {
    await pool.query(
      'DROP TABLE IF EXISTS portfolio_trades, portfolio_prepaid_usages, portfolio_assets',
    );
    await runMigration(pool, '004_portfolio_assets.sql');
    await runMigration(pool, '004_portfolio_assets.sql'); // re-running is safe
    await runMigration(pool, '007_depreciable_assets.sql');
    await runMigration(pool, '010_prepaid_assets.sql');
    await runMigration(pool, '013_asset_trades.sql');
    await runMigration(pool, '007_depreciable_assets.sql');
    await runMigration(pool, '010_prepaid_assets.sql');
    await runMigration(pool, '013_asset_trades.sql');
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
          depreciation: null,
          prepaid: null,
          hasTrades: false,
          currentValueKrw: null,
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
          valueKrw: 1_000_000_000_000_000,
        },
      });
      assert.equal((big.data.asset as Asset).valueKrw, 1_000_000_000_000_000);
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

  await t.test(
    'totals too large for a JSON number come back as null and the list still loads',
    async () => {
      await reset();
      // 10,000 rows of 1,000조 won: each is allowed, their sum is not a safe integer.
      await pool.query(
        `INSERT INTO portfolio_assets (name, asset_type, value_krw)
       SELECT 'a' || n, 'real_estate', 1000000000000000 FROM generate_series(1, 10000) AS n`,
      );
      await pool.query(
        "INSERT INTO portfolio_assets (name, asset_type, value_krw) VALUES ('b', 'debt', 1)",
      );
      await withApi(pool, async (call) => {
        const response = await call('/api/portfolio/assets');
        assert.equal(response.status, 200);
        assert.deepEqual(response.data.totals as Totals, {
          assetsKrw: null,
          debtsKrw: 1,
          netKrw: null,
          uncounted: 0,
        });
        assert.equal((response.data.assets as Asset[]).length, 10001);
      });
      await assert.rejects(
        pool.query(
          "INSERT INTO portfolio_assets (name, asset_type, value_krw) VALUES ('c', 'cash', 1000000000000001)",
        ),
        { code: '23514' },
      );
    },
  );

  // #63 Straight-line by month. 1,200,000 won over 60 months loses 20,000 won a month.
  const computer = {
    name: '노트북',
    type: 'depreciable',
    currency: 'KRW',
    depreciation: { purchasePriceKrw: 1_200_000, purchasedOn: '2026-01-15', usefulLifeMonths: 60 },
  };

  await t.test(
    'a depreciating asset loses the same amount each full month and stops at the end',
    async () => {
      await reset();
      await withApi(pool, async (call) => {
        const created = await call('/api/portfolio/assets', { method: 'POST', body: computer });
        assert.equal(created.status, 201);
        assert.deepEqual((created.data.asset as Asset).depreciation, {
          purchasePriceKrw: 1_200_000,
          purchasedOn: '2026-01-15',
          usefulLifeMonths: 60,
          salvageValueKrw: 0, // decision: 0 won unless entered
        });
        assert.equal((created.data.asset as Asset).valueKrw, null);

        const valueOn = async (asOf: string) => {
          const { status, data } = await call(`/api/portfolio/assets?asOf=${asOf}`);
          assert.equal(status, 200);
          assert.equal(data.asOf, asOf);
          return (data.assets as Asset[])[0].currentValueKrw;
        };
        assert.equal(await valueOn('2025-12-01'), 1_200_000); // before the purchase
        assert.equal(await valueOn('2026-01-15'), 1_200_000); // the purchase date
        assert.equal(await valueOn('2026-02-14'), 1_200_000); // not yet a full month
        assert.equal(await valueOn('2026-02-15'), 1_180_000);
        assert.equal(await valueOn('2028-07-15'), 600_000); // halfway, 30 months
        assert.equal(await valueOn('2031-01-15'), 0); // end of the useful life
        assert.equal(await valueOn('2040-01-01'), 0); // never below the salvage value
      });
    },
  );

  await t.test(
    'the value never goes below the salvage value and rounds half away from zero',
    async () => {
      await reset();
      await withApi(pool, async (call) => {
        const add = (name: string, depreciation: object) =>
          call('/api/portfolio/assets', {
            method: 'POST',
            body: { name, type: 'depreciable', currency: 'KRW', depreciation },
          });
        await add('침대', {
          purchasePriceKrw: 1_000_000,
          purchasedOn: '2026-01-01',
          usefulLifeMonths: 7,
          salvageValueKrw: 100_000,
        });
        // 5 won over 2 months: 2.5 won a month, rounded to 3 (half-even would give 2).
        await add('컵', { purchasePriceKrw: 5, purchasedOn: '2026-01-01', usefulLifeMonths: 2 });

        const values = async (asOf: string) =>
          ((await call(`/api/portfolio/assets?asOf=${asOf}`)).data.assets as Asset[]).map(
            (asset) => asset.currentValueKrw,
          );
        // 900,000 × 3 / 7 = 385,714.28… taken off.
        assert.deepEqual(await values('2026-04-01'), [614_286, 0]);
        assert.deepEqual(await values('2026-02-01'), [871_429, 2]);
        assert.deepEqual(await values('2030-01-01'), [100_000, 0]);
      });
    },
  );

  await t.test(
    'a month from a day the next month lacks is full on the 1st of the month after',
    async () => {
      await reset();
      await withApi(pool, async (call) => {
        await call('/api/portfolio/assets', {
          method: 'POST',
          body: {
            ...computer,
            depreciation: { ...computer.depreciation, purchasedOn: '2026-01-31' },
          },
        });
        const valueOn = async (asOf: string) =>
          ((await call(`/api/portfolio/assets?asOf=${asOf}`)).data.assets as Asset[])[0]
            .currentValueKrw;
        assert.equal(await valueOn('2026-02-28'), 1_200_000);
        assert.equal(await valueOn('2026-03-01'), 1_180_000);
        assert.equal(await valueOn('2026-03-30'), 1_180_000);
        assert.equal(await valueOn('2026-03-31'), 1_160_000);
      });
    },
  );

  await t.test('the month count does not depend on the session time zone', async () => {
    await reset();
    // In São Paulo 2018-11-04 starts a DST change: with timestamptz the month came out 1 hour short.
    const client = await pool.connect();
    try {
      await client.query("SET TimeZone = 'America/Sao_Paulo'");
      const { rows } = await client.query<{ value: string }>(
        "SELECT portfolio_depreciated_value(1200000, 0, '2018-11-04', 60, '2018-12-04') AS value",
      );
      assert.equal(rows[0].value, '1180000');
    } finally {
      await client.query('RESET TimeZone');
      client.release();
    }
  });

  await t.test(
    'a #45 depreciable row with only a value still counts after migration 007',
    async () => {
      await pool.query(
        'DROP TABLE IF EXISTS portfolio_trades, portfolio_prepaid_usages, portfolio_assets',
      );
      await runMigration(pool, '004_portfolio_assets.sql');
      await pool.query(
        "INSERT INTO portfolio_assets (name, asset_type, value_krw) VALUES ('old', 'depreciable', 700000)",
      );
      await runMigration(pool, '007_depreciable_assets.sql');
      await runMigration(pool, '010_prepaid_assets.sql');
      await runMigration(pool, '013_asset_trades.sql');
      await withApi(pool, async (call) => {
        const { data } = await call('/api/portfolio/assets');
        const [old] = data.assets as Asset[];
        assert.deepEqual(
          { depreciation: old.depreciation, currentValueKrw: old.currentValueKrw },
          { depreciation: null, currentValueKrw: 700_000 },
        );
        assert.equal((data.totals as Totals).assetsKrw, 700_000);
      });
    },
  );

  await t.test('the current value counts in the totals, as of today by default', async () => {
    await reset();
    await withApi(
      pool,
      async (call) => {
        await call('/api/portfolio/assets', { method: 'POST', body: computer });
        await call('/api/portfolio/assets', {
          method: 'POST',
          body: { name: '통장', type: 'cash', currency: 'KRW', valueKrw: 1000 },
        });
        const { data } = await call('/api/portfolio/assets');
        assert.equal(data.asOf, '2026-11-15');
        assert.deepEqual(
          (data.assets as Asset[]).map((asset) => asset.currentValueKrw),
          [1000, 1_000_000], // cash sorts before depreciable; 10 months have passed
        );
        assert.deepEqual(data.totals as Totals, {
          assetsKrw: 1_001_000,
          debtsKrw: 0,
          netKrw: 1_001_000,
          uncounted: 0,
        });
      },
      { today: () => '2026-11-15' },
    );
  });

  await t.test(
    'a depreciating asset can become a plain asset again, and the DB refuses half a schedule',
    async () => {
      await reset();
      await withApi(pool, async (call) => {
        const { data } = await call('/api/portfolio/assets', { method: 'POST', body: computer });
        const id = (data.asset as Asset).id;
        const changed = await call(`/api/portfolio/assets/${id}`, {
          method: 'PUT',
          body: { name: '노트북', type: 'other', currency: 'KRW', valueKrw: 300_000 },
        });
        assert.equal(changed.status, 200);
        assert.equal((changed.data.asset as Asset).depreciation, null);
        assert.equal((changed.data.asset as Asset).currentValueKrw, 300_000);

        const back = await call(`/api/portfolio/assets/${id}`, { method: 'PUT', body: computer });
        assert.equal(back.status, 200);
        assert.equal((back.data.asset as Asset).valueKrw, null);
        assert.equal((back.data.asset as Asset).depreciation?.purchasePriceKrw, 1_200_000);

        const bad = await call('/api/portfolio/assets?asOf=2026-02-30');
        assert.equal(bad.status, 400);
        assert.deepEqual(bad.data, { error: '없는 날짜입니다' });
      });
      await assert.rejects(
        pool.query(
          `INSERT INTO portfolio_assets (name, asset_type, purchase_price_krw, purchased_on)
           VALUES ('a', 'depreciable', 1000, '2026-01-01')`,
        ),
        { code: '23514' },
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO portfolio_assets
             (name, asset_type, purchase_price_krw, purchased_on, useful_life_months, salvage_value_krw)
           VALUES ('a', 'cash', 1000, '2026-01-01', 12, 0)`,
        ),
        { code: '23514' },
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO portfolio_assets
             (name, asset_type, purchase_price_krw, purchased_on, useful_life_months, salvage_value_krw)
           VALUES ('a', 'depreciable', 1000, '2026-01-01', 12, 1001)`,
        ),
        { code: '23514' },
      );
    },
  );
});
