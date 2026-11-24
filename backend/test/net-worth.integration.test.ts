import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

// #184 This file's own copy of the test DB (undefined without TEST_DATABASE_URL: the DB tests are skipped).
const url = await testDatabase();
const assets = '/api/portfolio/assets';
const netWorth = '/api/portfolio/net-worth';

type Snapshot = {
  date: string;
  assetsKrw: number;
  debtsKrw: number;
  netKrw: number;
  uncounted: number;
};

// #49 Net worth by day against the real database. Skipped (not passed) without the dedicated test DB.
test('net worth snapshots against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async () => {
    await pool.query(
      `DROP TABLE IF EXISTS net_worth_snapshots, portfolio_trades, portfolio_prepaid_usages, portfolio_assets,
         mock_snapshots, mock_position_questions, mock_positions, mock_orders, mock_holdings, mock_accounts, security_prices, fx_rates, price_fetch_state, price_api_calls,
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
      '024_price_fetch_not_found.sql',
      '015_mock_orders.sql',
      '016_asset_valuation.sql',
      '018_mock_snapshots.sql',
      '019_net_worth_snapshots.sql',
    ]) {
      await runMigration(pool, file);
    }
  };

  type Call = Parameters<Parameters<typeof withApi>[1]>[0];
  // `day` stands in for "today in Seoul", so a test can save on several days.
  let day = '2026-11-10';
  const api = (run: (call: Call) => Promise<void>) => withApi(pool, run, { today: () => day });
  const add = async (call: Call, body: object) => {
    const response = await call(assets, { method: 'POST', body });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return (response.data as { asset: { id: number } }).asset.id;
  };
  const save = async (call: Call) => {
    const response = await call(netWorth, { method: 'POST' });
    return {
      status: response.status,
      data: response.data as { snapshot?: Snapshot; error?: string },
    };
  };
  const list = async (call: Call, query = '') => {
    const response = await call(`${netWorth}${query}`);
    return response.data as { today: string; snapshots: Snapshot[] };
  };
  const cash = (name: string, valueKrw: number) => ({
    name,
    type: 'cash',
    currency: 'KRW',
    valueKrw,
  });

  await t.test('saving takes the asset screen totals, current values included', async () => {
    await reset();
    await api(async (call) => {
      await add(call, cash('Bank account', 5_000_000));
      await add(call, { name: 'Loan', type: 'debt', currency: 'KRW', valueKrw: 2_000_000 });
      await add(call, {
        name: 'Laptop',
        type: 'depreciable',
        currency: 'KRW',
        depreciation: {
          purchasePriceKrw: 1_200_000,
          purchasedOn: '2026-01-15',
          usefulLifeMonths: 60,
        },
      });
      await add(call, {
        name: 'Gym',
        type: 'prepaid',
        currency: 'KRW',
        prepaid: {
          kind: 'period',
          amountKrw: 300_000,
          startsOn: '2026-11-01',
          expiresOn: '2027-01-29',
        },
      });
      // No USD rate stored: left out and counted.
      await add(call, { name: 'Dollars', type: 'cash', currency: 'USD', valueForeign: '10' });
      const { data: screen } = await call(assets);
      const totals = (screen as { totals: Record<string, number> }).totals;

      const { status, data } = await save(call);
      assert.equal(status, 200);
      assert.deepEqual(data.snapshot, {
        date: '2026-11-10',
        assetsKrw: totals.assetsKrw,
        debtsKrw: 2_000_000,
        netKrw: totals.assetsKrw - 2_000_000,
        uncounted: 1,
      });
      // The depreciating and prepaid assets count at their current value, below what was paid.
      assert.ok(totals.assetsKrw > 5_000_000 && totals.assetsKrw < 5_000_000 + 1_200_000 + 300_000);
    });
  });

  await t.test('a day keeps one row: saving again replaces it with the latest totals', async () => {
    await reset();
    await api(async (call) => {
      const id = await add(call, cash('Bank account', 1_000));
      await save(call);
      await call(`${assets}/${id}`, { method: 'PUT', body: cash('Bank account', 3_000) });
      const { data } = await save(call);
      assert.equal(data.snapshot?.netKrw, 3_000);
      const { snapshots } = await list(call);
      assert.deepEqual(
        snapshots.map((row) => [row.date, row.netKrw]),
        [['2026-11-10', 3_000]],
      );
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM net_worth_snapshots');
      assert.equal(rows[0].n, 1);
    });
  });

  await t.test('two saves of the same day at once both succeed (#195)', async () => {
    await reset();
    await api(async (call) => {
      await add(call, cash('Bank account', 2_000));
      // Another save of the day is in flight: its row is written but not committed yet.
      const other = await pool.connect();
      try {
        await other.query('BEGIN');
        await other.query(
          `INSERT INTO net_worth_snapshots (snapshot_date, assets_krw, debts_krw, net_krw, uncounted)
           VALUES ($1, 1, 0, 1, 0)`,
          [day],
        );
        // This save reads its totals, then waits on that row; the commit makes its upsert a serialization
        // failure (40001), which used to answer 500.
        const pending = save(call);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await other.query('COMMIT');
        const { status, data } = await pending;
        assert.equal(status, 200, JSON.stringify(data));
        assert.equal(data.snapshot?.netKrw, 2_000);
      } finally {
        other.release();
      }
      const results = await Promise.all([save(call), save(call), save(call)]);
      assert.deepEqual(
        results.map((result) => result.status),
        [200, 200, 200],
      );
      assert.deepEqual(
        (await list(call)).snapshots.map((row) => [row.date, row.netKrw]),
        [['2026-11-10', 2_000]],
      );
    });
  });

  await t.test('`latest=true` gives only the latest saved day', async () => {
    await reset();
    await api(async (call) => {
      assert.deepEqual((await list(call, '?latest=true')).snapshots, []);
      await add(call, cash('Bank account', 1_000));
      day = '2026-10-01';
      await save(call);
      day = '2026-11-10';
      await add(call, cash('Wallet', 500));
      await save(call);
      const latest = await list(call, '?latest=true');
      assert.equal(latest.today, '2026-11-10');
      assert.deepEqual(
        latest.snapshots.map((row) => [row.date, row.netKrw]),
        [['2026-11-10', 1_500]],
      );
      const wrong = await call(`${netWorth}?latest=yes`);
      assert.equal(wrong.status, 400);
    });
  });

  await t.test(
    'days without a save stay out, oldest first, and `from` limits the list',
    async () => {
      await reset();
      await api(async (call) => {
        await add(call, cash('Bank account', 1_000));
        day = '2026-08-01';
        await save(call);
        day = '2026-10-15';
        await save(call);
        day = '2026-11-10';
        await add(call, { name: 'Loan', type: 'debt', currency: 'KRW', valueKrw: 5_000 });
        await save(call);

        const all = await list(call);
        assert.equal(all.today, '2026-11-10');
        // No rows for the days between: nothing is filled with 0.
        assert.deepEqual(
          all.snapshots.map((row) => [row.date, row.netKrw]),
          [
            ['2026-08-01', 1_000],
            ['2026-10-15', 1_000],
            ['2026-11-10', -4_000],
          ],
        );
        const recent = await list(call, '?from=2026-10-15');
        assert.deepEqual(
          recent.snapshots.map((row) => row.date),
          ['2026-10-15', '2026-11-10'],
        );
        assert.deepEqual((await list(call, '?from=2026-11-11')).snapshots, []);
      });
    },
  );

  await t.test(
    'totals too large to be exact are refused in Korean and nothing is saved',
    async () => {
      await reset();
      await api(async (call) => {
        // 10,000 of ₩1 trillion (the cap, #186): 10^16 is past 2^53. Many rows, so straight into the table.
        await pool.query(
          `INSERT INTO portfolio_assets (name, asset_type, currency, value_krw)
           SELECT 'Big account ' || n, 'cash', 'KRW', 1000000000000 FROM generate_series(1, 10000) n`,
        );
        const { status, data } = await save(call);
        assert.equal(status, 422);
        assert.equal(data.error, 'The totals are too large to save the net worth');
        assert.deepEqual((await list(call)).snapshots, []);
      });
    },
  );

  await t.test('a wrong `from` is a 400 that names the date', async () => {
    await api(async (call) => {
      const response = await call(`${netWorth}?from=2026-13-01`);
      assert.equal(response.status, 400);
      assert.match((response.data as { error: string }).error, /date/);
    });
  });

  await t.test('the database keeps net = assets − debts', async () => {
    await reset();
    await assert.rejects(
      pool.query(
        `INSERT INTO net_worth_snapshots (snapshot_date, assets_krw, debts_krw, net_krw) VALUES ('2026-11-10', 10, 3, 6)`,
      ),
      /net_worth_snapshots_values_check/,
    );
  });
});
