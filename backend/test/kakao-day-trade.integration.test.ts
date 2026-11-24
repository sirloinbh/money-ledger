import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { notifyDayTradeSales } from '../src/kakao/day-trade-events.js';
import { fakeMessenger } from '../src/kakao/fake.js';
import { createNotifier } from '../src/kakao/notifier.js';
import { dayTradeQueue } from '../src/mock/day-trade.js';
import { buyAllIn, chooseStrategy } from '../src/mock/positions.js';
import type { KisSource } from '../src/prices/kis.js';
import { runMigration } from './helpers.js';
import { testDatabase } from './test-database.js';

// #313 The day trade sale message, through the real day trade queue with a scripted price. Tuesday 2026-11-24.
const url = await testDatabase();
const today = () => '2026-11-24';

function scriptedKis() {
  const state = { price: '70000', bid: '70000' };
  const source: KisSource = {
    name: 'TEST',
    lastPrice: (symbol) =>
      Promise.resolve({ symbol, price: state.price, readAt: new Date().toISOString() }),
    quote: (symbol) =>
      Promise.resolve({
        symbol,
        price: state.price,
        asks: [{ price: '70100', quantity: '1000' }],
        bids: [{ price: state.bid, quantity: '1000' }],
        readAt: new Date().toISOString(),
      }),
  };
  return { state, source };
}

test('the day trade sale message against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  let accountId = 0;
  let securityId = 0;
  const reset = async () => {
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
      '041_mock_positions.sql',
      '042_mock_position_exit.sql',
    ]) {
      await runMigration(pool, file);
    }
    const security = await pool.query<{ id: string }>(
      `INSERT INTO securities (market, symbol, name, kind, currency, active)
       VALUES ('KOSPI', '005930', 'Samsung Electronics', 'stock', 'KRW', true) RETURNING id`,
    );
    securityId = Number(security.rows[0].id);
    const account = await pool.query<{ id: string }>(
      `INSERT INTO mock_accounts (initial_cash_krw, cash_krw, fee_rate)
       VALUES (10000000, 10000000, '0.00015') RETURNING id`,
    );
    accountId = Number(account.rows[0].id);
  };
  const open = async (kis: KisSource) => {
    const bought = await buyAllIn(pool, kis, today, accountId, {
      securityId,
      requestKey: randomUUID(),
      expectedAsk: '70100',
    });
    await chooseStrategy(pool, bought.position.id, 'day_trade', 'web');
    return bought.position.id;
  };
  const wire = (kis: KisSource, messenger: ReturnType<typeof fakeMessenger>) => {
    const notifier = createNotifier(messenger, {
      link: 'https://app',
      log: () => undefined,
      retryDelayMs: 0,
    });
    // 10:00 KST on the trading day.
    return dayTradeQueue(
      pool,
      kis,
      today,
      { onSold: (sold) => notifyDayTradeSales(pool, notifier, sold, today(), () => undefined) },
      () => new Date('2026-11-24T10:00:00+09:00'),
    );
  };

  await t.test('a take profit sale sends price, net gain and the new capital', async () => {
    await reset();
    const { state, source } = scriptedKis();
    await open(source);
    const messenger = fakeMessenger();
    const queue = wire(source, messenger);

    await queue.handler({}, {} as never);
    assert.equal(messenger.sent.length, 0, 'nothing sold, nothing sent');

    state.price = '73605';
    state.bid = '73605';
    await queue.handler({}, {} as never);
    // 142 shares sold at 73,605: net gain 473,745 (4.76%), and with no other holding the capital is the cash.
    assert.equal(
      messenger.sent[0].text,
      'Take profit: sold Samsung Electronics (005930)\n142 sh at ₩73,605\nNet gain: ₩473,745 (+4.76%)\nCapital: ₩10,473,745',
    );
    assert.equal(messenger.sent.length, 1);
  });

  await t.test('a stop loss sale says so, and a failing send leaves the trade sold', async () => {
    await reset();
    const { state, source } = scriptedKis();
    const id = await open(source);
    const messenger = fakeMessenger();
    messenger.failures.push(new Error('a'), new Error('b'));
    const queue = wire(source, messenger);

    state.price = '67997';
    state.bid = '67997';
    await assert.doesNotReject(queue.handler({}, {} as never));
    assert.equal(messenger.sent.length, 0);
    const { rows } = await pool.query<{ closed_at: Date | null; exit_reason: string }>(
      'SELECT closed_at, exit_reason FROM mock_positions WHERE id = $1',
      [id],
    );
    assert.notEqual(rows[0].closed_at, null);
    assert.equal(rows[0].exit_reason, 'stop_loss');
  });

  await t.test('a stop loss sale is sent with the loss and a capital below the start', async () => {
    await reset();
    const { state, source } = scriptedKis();
    await open(source);
    const messenger = fakeMessenger();
    const queue = wire(source, messenger);
    state.price = '67997';
    state.bid = '67997';
    await queue.handler({}, {} as never);
    assert.equal(messenger.sent.length, 1);
    assert.match(
      String(messenger.sent[0].text),
      /^Stop loss: sold Samsung Electronics \(005930\)\n142 sh at ₩67,997\nNet gain: -₩/,
    );
    assert.match(String(messenger.sent[0].text), /\nCapital: ₩9,\d{3},\d{3}$/);
  });

  await t.test(
    'a sale whose capital is unknown is logged, not sent with a made-up figure',
    async () => {
      await reset();
      const { source } = scriptedKis();
      const id = await open(source);
      const messenger = fakeMessenger();
      const lines: Record<string, unknown>[] = [];
      const notifier = createNotifier(messenger, {
        link: 'https://app',
        log: () => undefined,
        retryDelayMs: 0,
      });
      await notifyDayTradeSales(
        pool,
        notifier,
        [
          {
            positionId: id,
            reason: 'take_profit',
            position: {
              id,
              accountId: 999_999,
              security: { id: 1, symbol: '005930', name: null },
              quantity: '1',
              netGainKrw: 1,
              netGainPct: '1.00',
              sell: { price: '1', amountKrw: 1, feeKrw: 0, taxKrw: 0 },
            } as never,
          },
        ],
        today(),
        (line) => void lines.push(line),
      );
      assert.equal(messenger.sent.length, 0);
      assert.equal(lines[0].event, 'kakao_day_trade_notify_skipped');
    },
  );
});
