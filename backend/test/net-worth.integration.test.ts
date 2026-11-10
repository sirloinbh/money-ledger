import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigration, withApi } from './helpers.js';

const url = process.env.TEST_DATABASE_URL;
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
         mock_orders, mock_holdings, mock_accounts, security_prices, fx_rates, price_fetch_state, price_api_calls,
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
      await add(call, cash('통장', 5_000_000));
      await add(call, { name: '대출', type: 'debt', currency: 'KRW', valueKrw: 2_000_000 });
      await add(call, {
        name: '노트북',
        type: 'depreciable',
        currency: 'KRW',
        depreciation: {
          purchasePriceKrw: 1_200_000,
          purchasedOn: '2026-01-15',
          usefulLifeMonths: 60,
        },
      });
      await add(call, {
        name: '헬스장',
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
      await add(call, { name: '달러', type: 'cash', currency: 'USD', valueForeign: '10' });
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
      const id = await add(call, cash('통장', 1_000));
      await save(call);
      await call(`${assets}/${id}`, { method: 'PUT', body: cash('통장', 3_000) });
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

  await t.test(
    'days without a save stay out, oldest first, and `from` limits the list',
    async () => {
      await reset();
      await api(async (call) => {
        await add(call, cash('통장', 1_000));
        day = '2026-08-01';
        await save(call);
        day = '2026-10-15';
        await save(call);
        day = '2026-11-10';
        await add(call, { name: '대출', type: 'debt', currency: 'KRW', valueKrw: 5_000 });
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
        // Ten of 10^15 won: 10^16 is past 2^53.
        for (let i = 1; i <= 10; i++) await add(call, cash(`큰 통장 ${i}`, 1_000_000_000_000_000));
        const { status, data } = await save(call);
        assert.equal(status, 422);
        assert.equal(data.error, '합계가 너무 커서 순자산을 저장하지 못했습니다');
        assert.deepEqual((await list(call)).snapshots, []);
      });
    },
  );

  await t.test('a wrong `from` is a Korean 400', async () => {
    await api(async (call) => {
      const response = await call(`${netWorth}?from=2026-13-01`);
      assert.equal(response.status, 400);
      assert.match((response.data as { error: string }).error, /날짜/);
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
