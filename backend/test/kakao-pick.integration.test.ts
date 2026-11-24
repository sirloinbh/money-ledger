import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { fakeMessenger } from '../src/kakao/fake.js';
import { createNotifier } from '../src/kakao/notifier.js';
import { notifyPickBought } from '../src/kakao/pick-events.js';
import { pickBuyDeps } from '../src/picks/buy.js';
import { fakeClaude } from '../src/picks/claude.js';
import { type PickDeps, runDailyPick } from '../src/picks/run.js';
import { fakeKis } from '../src/prices/kis-fake.js';
import { runMigration } from './helpers.js';
import { testDatabase } from './test-database.js';

// #313 The pick message, through the real pick run and the all-in buy. 08:00 on 2026-11-24 in Seoul.
const url = await testDatabase();
const day = '2026-11-24';
const now = new Date('2026-11-23T23:00:00Z');
const kis = fakeKis(() => new Date('2026-11-24T01:00:00.000Z'));

test('the pick message against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async (withAccount = true) => {
    await pool.query(
      `DROP TABLE IF EXISTS daily_picks, news_items, portfolio_trades, portfolio_prepaid_usages, portfolio_assets,
         mock_positions, mock_snapshots, mock_orders, mock_holdings, mock_accounts, security_prices, fx_rates,
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
      '028_news_items.sql',
      '043_daily_picks.sql',
      '041_mock_positions.sql',
      '042_mock_position_exit.sql',
    ]) {
      await runMigration(pool, file);
    }
    await pool.query(
      `INSERT INTO securities (market, symbol, name, kind, currency, active)
       VALUES ('KOSPI', '005930', 'Samsung Electronics', 'stock', 'KRW', true)`,
    );
    if (withAccount) {
      await pool.query(
        'INSERT INTO mock_accounts (initial_cash_krw, cash_krw, fee_rate) VALUES (10000000, 10000000, 0.00015)',
      );
    }
    await pool.query(
      `INSERT INTO news_items (link, title, summary, published_at, query, fetched_date)
       VALUES ('https://n.test/1', 'Chip exports surge', '', now(), 'chips', $1)`,
      [day],
    );
  };
  const wire = (messenger: ReturnType<typeof fakeMessenger>, lines: Record<string, unknown>[]) => {
    const notifier = createNotifier(messenger, {
      link: 'https://app',
      log: () => undefined,
      retryDelayMs: 0,
    });
    const deps: PickDeps = {
      claude: fakeClaude('005930', [1]),
      ...pickBuyDeps(pool, kis, () => day),
      onBought: (pickId) =>
        notifyPickBought(pool, notifier, pickId, (line) => void lines.push(line)),
      log: () => undefined,
    };
    return deps;
  };

  await t.test('a bought pick sends the news, the reason and the question once', async () => {
    await reset();
    const messenger = fakeMessenger();
    const deps = wire(messenger, []);
    assert.equal((await runDailyPick(pool, deps, now)).status, 'picked');
    assert.equal(messenger.sent.length, 3);
    const last = String(messenger.sent[2].text);
    // 142 shares at the best ask 70,100: 9,954,200 + fee 1,493.
    assert.match(last, /^Day trade or long hold\?/);
    assert.match(
      last,
      /Bought Samsung Electronics \(005930\)\n142 sh at ₩70,100\nCost: ₩9,955,693/,
    );
    // A second run finds the pick already bought and sends nothing more.
    assert.equal((await runDailyPick(pool, deps, now)).status, 'already_picked');
    assert.equal(messenger.sent.length, 3);
  });

  await t.test('a pick whose buy failed is messaged when the retry buys it', async () => {
    await reset(false);
    const messenger = fakeMessenger();
    const deps = wire(messenger, []);
    const first = await runDailyPick(pool, deps, now);
    assert.ok(first.status === 'picked' && first.buyError !== null);
    assert.equal(messenger.sent.length, 0, 'nothing bought, nothing sent');
    await pool.query(
      'INSERT INTO mock_accounts (initial_cash_krw, cash_krw, fee_rate) VALUES (10000000, 10000000, 0.00015)',
    );
    assert.equal((await runDailyPick(pool, deps, now)).status, 'already_picked');
    assert.equal(messenger.sent.length, 3);
  });

  await t.test('failing sends keep the buy, and a throwing hook cannot fail the run', async () => {
    await reset();
    const messenger = fakeMessenger();
    messenger.failures.push(new Error('a'), new Error('b'));
    const deps = wire(messenger, []);
    const result = await runDailyPick(pool, deps, now);
    assert.ok(result.status === 'picked' && result.buyError === null && result.orderId !== null);

    await reset();
    const logged: Record<string, unknown>[] = [];
    const throwing: PickDeps = {
      ...wire(fakeMessenger(), []),
      onBought: () => Promise.reject(new Error('boom')),
      log: (line) => void logged.push(line),
    };
    const run = await runDailyPick(pool, throwing, now);
    assert.ok(run.status === 'picked' && run.buyError === null);
    assert.ok(logged.some((line) => line.event === 'pick_notify_failed'));
  });
});
