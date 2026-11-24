import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runDayTradeCheck } from '../src/mock/day-trade.js';
import { buyAllIn, chooseStrategy } from '../src/mock/positions.js';
import { KisError, type KisSource } from '../src/prices/kis.js';
import { runMigration } from './helpers.js';
import { testDatabase } from './test-database.js';

// #309 Day trade auto sell, with a fake clock and scripted prices. Tuesday 2026-11-24 is a trading day.
const url = await testDatabase();

const today = () => '2026-11-24';
// KST is UTC+9: 09:00 KST is 00:00Z.
const at = (hhmm: string) => new Date(`2026-11-24T${hhmm}:00+09:00`);

// The buy fills at the best ask 70,100, so +5% is 73,605 and -3% is 67,997 (exact in won).
function scriptedKis() {
  const state = {
    price: '70000',
    ask: '70100',
    bid: '70000',
    fail: undefined as Error | undefined,
    // An empty order book (market closed): the price is still readable, a quote is not.
    closedBook: false,
    calls: 0,
  };
  const source: KisSource = {
    name: 'TEST',
    lastPrice(symbol) {
      state.calls += 1;
      if (state.fail) return Promise.reject(state.fail);
      return Promise.resolve({ symbol, price: state.price, readAt: new Date().toISOString() });
    },
    quote(symbol) {
      state.calls += 1;
      if (state.fail) return Promise.reject(state.fail);
      if (state.closedBook) {
        return Promise.reject(
          new KisError('market_closed', 'The market is closed, so there is no order book'),
        );
      }
      return Promise.resolve({
        symbol,
        price: state.price,
        asks: [{ price: state.ask, quantity: '1000' }],
        bids: [{ price: state.bid, quantity: '1000' }],
        readAt: new Date().toISOString(),
      });
    },
  };
  return { state, source };
}

test('day trade auto sell against the real database', { skip: !url }, async (t) => {
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
      '040_mock_positions.sql',
      '041_mock_position_exit.sql',
    ]) {
      await runMigration(pool, file);
    }
    await runMigration(pool, '041_mock_position_exit.sql'); // re-running is safe
    const security = await pool.query<{ id: string }>(
      `INSERT INTO securities (market, symbol, name, kind, currency, active)
       VALUES ('KOSPI', '005930', '삼성전자', 'stock', 'KRW', true) RETURNING id`,
    );
    securityId = Number(security.rows[0].id);
    const account = await pool.query<{ id: string }>(
      `INSERT INTO mock_accounts (initial_cash_krw, cash_krw, fee_rate)
       VALUES (10000000, 10000000, '0.00015') RETURNING id`,
    );
    accountId = Number(account.rows[0].id);
  };

  /** Buys all-in at 70,100 and chooses the strategy. */
  const open = async (
    kis: KisSource,
    strategy: 'day_trade' | 'long_hold' | 'undecided' = 'day_trade',
  ) => {
    const bought = await buyAllIn(pool, kis, today, accountId, {
      securityId,
      requestKey: randomUUID(),
      expectedAsk: '70100',
    });
    const id = bought.position.id;
    if (strategy !== 'undecided') await chooseStrategy(pool, id, strategy, 'web');
    return id;
  };
  const row = async (id: number) =>
    (
      await pool.query<{
        closed_at: Date | null;
        strategy: string;
        strategy_source: string | null;
        exit_reason: string | null;
        net_gain_krw: string | null;
        net_gain_pct: string | null;
        carried_over_at: Date | null;
      }>(
        `SELECT closed_at, strategy, strategy_source, exit_reason, net_gain_krw, net_gain_pct, carried_over_at
         FROM mock_positions WHERE id = $1`,
        [id],
      )
    ).rows[0];
  const sells = async () =>
    Number(
      (await pool.query<{ n: string }>("SELECT count(*) AS n FROM mock_orders WHERE side = 'sell'"))
        .rows[0].n,
    );
  const check = (kis: KisSource, time: string, options = {}) =>
    runDayTradeCheck(pool, kis, at(time), today, options);

  await t.test('sells at +5% exactly: the boundary counts, one tick below does not', async () => {
    await reset();
    const { state, source } = scriptedKis();
    const id = await open(source);
    state.price = '73604';
    state.bid = '73604';
    const below = await check(source, '10:00');
    assert.deepEqual(below.sold, []);
    assert.equal((await row(id)).closed_at, null);

    state.price = '73605';
    state.bid = '73605';
    const hit = await check(source, '10:01');
    assert.deepEqual(
      hit.sold.map(({ positionId, reason }) => ({ positionId, reason })),
      [{ positionId: id, reason: 'take_profit' }],
    );
    assert.equal(hit.sold[0].position.netGainKrw, 473_745);
    assert.equal(hit.sold[0].position.security.symbol, '005930');
    const closed = await row(id);
    assert.notEqual(closed.closed_at, null);
    assert.equal(closed.exit_reason, 'take_profit');
    // 142 shares: buy 9,954,200 + fee 1,493; sale 10,451,910 - fee 1,568 - tax 20,904 -> +473,745 (4.76%).
    assert.equal(Number(closed.net_gain_krw), 473_745);
    assert.equal(closed.net_gain_pct, '4.76');
    const cash = await pool.query<{ cash_krw: string }>(
      'SELECT cash_krw FROM mock_accounts WHERE id = $1',
      [accountId],
    );
    assert.equal(Number(cash.rows[0].cash_krw), 10_000_000 + 473_745);
  });

  await t.test(
    'sells at -3% exactly and records a loss; one tick above does not sell',
    async () => {
      await reset();
      const { state, source } = scriptedKis();
      const id = await open(source);
      state.price = '67998';
      state.bid = '67998';
      assert.deepEqual((await check(source, '10:00')).sold, []);

      state.price = '67997';
      state.bid = '67997';
      const hit = await check(source, '10:01');
      assert.deepEqual(
        hit.sold.map(({ positionId, reason }) => ({ positionId, reason })),
        [{ positionId: id, reason: 'stop_loss' }],
      );
      const closed = await row(id);
      assert.equal(closed.exit_reason, 'stop_loss');
      assert.ok(Number(closed.net_gain_krw) < 0);
      assert.match(closed.net_gain_pct!, /^-\d+\.\d{2}$/);
    },
  );

  await t.test('sells at the best bid, not at the trigger price', async () => {
    await reset();
    const { state, source } = scriptedKis();
    await open(source);
    state.price = '73605';
    state.bid = '73500';
    await check(source, '10:00');
    const order = await pool.query<{ price: string }>(
      "SELECT price FROM mock_orders WHERE side = 'sell'",
    );
    assert.equal(Number(order.rows[0].price), 73500);
  });

  await t.test('only runs from 09:00 to 15:20 KST on a trading day', async () => {
    await reset();
    const { state, source } = scriptedKis();
    const id = await open(source);
    state.price = '80000';
    state.bid = '80000';
    state.calls = 0;
    for (const time of ['08:59', '15:21', '23:00']) {
      assert.equal((await check(source, time)).skipped, 'outside_hours', time);
    }
    const saturday = await runDayTradeCheck(pool, source, at('10:00'), () => '2026-11-28');
    assert.equal(saturday.skipped, 'not_trading_day');
    const holiday = await check(source, '10:00', { isTradingDay: () => false });
    assert.equal(holiday.skipped, 'not_trading_day');
    assert.equal(state.calls, 0, 'no price is read outside the window');
    assert.equal((await row(id)).closed_at, null);

    // 09:00 and 15:20 are inside the window.
    assert.equal((await check(source, '09:00')).sold.length, 1);
    await reset();
    const next = scriptedKis();
    await open(next.source);
    next.state.price = '80000';
    next.state.bid = '80000';
    assert.equal((await check(next.source, '15:20')).sold.length, 1);
  });

  await t.test('two overlapping runs sell once', async () => {
    await reset();
    const { state, source } = scriptedKis();
    await open(source);
    state.price = '75000';
    state.bid = '75000';
    const runs = await Promise.all([check(source, '10:00'), check(source, '10:00')]);
    assert.equal(runs.flatMap((run) => run.sold).length, 1);
    assert.equal(await sells(), 1);
    // A later run finds nothing open.
    assert.deepEqual((await check(source, '10:01')).sold, []);
    assert.equal(await sells(), 1);
  });

  await t.test('long hold and undecided positions are left alone', async () => {
    await reset();
    const { state, source } = scriptedKis();
    const held = await open(source, 'long_hold');
    state.price = '80000';
    state.bid = '80000';
    const run = await check(source, '10:00');
    assert.deepEqual(run.sold, []);
    assert.equal((await row(held)).closed_at, null);
    await reset();
    const second = scriptedKis();
    const undecided = await open(second.source, 'undecided');
    second.state.price = '80000';
    second.state.bid = '80000';
    assert.deepEqual((await check(second.source, '10:00')).sold, []);
    assert.equal((await row(undecided)).closed_at, null);
  });

  await t.test('at 15:20 a day trade between the levels becomes a long hold', async () => {
    await reset();
    const { state, source } = scriptedKis();
    const id = await open(source);
    state.price = '71000';
    assert.deepEqual((await check(source, '15:19')).carriedOver, []);
    assert.equal((await row(id)).strategy, 'day_trade');

    const run = await check(source, '15:20');
    assert.deepEqual(run.carriedOver, [id]);
    const carried = await row(id);
    assert.equal(carried.closed_at, null);
    assert.equal(carried.strategy, 'long_hold');
    assert.equal(carried.strategy_source, 'auto');
    assert.notEqual(carried.carried_over_at, null);
    // It is not looked at as a day trade any more.
    state.price = '80000';
    assert.deepEqual((await check(source, '15:20')).sold, []);
  });

  await t.test('at 15:20 a day trade that reached a level is sold, not carried over', async () => {
    await reset();
    const { state, source } = scriptedKis();
    const id = await open(source);
    state.price = '67000';
    state.bid = '67000';
    const run = await check(source, '15:20');
    assert.equal(run.sold.length, 1);
    assert.deepEqual(run.carriedOver, []);
    assert.equal((await row(id)).exit_reason, 'stop_loss');
  });

  await t.test('a day trade left from an earlier day is carried over, not sold', async () => {
    await reset();
    const { state, source } = scriptedKis();
    const id = await open(source);
    await pool.query("UPDATE mock_positions SET opened_at = '2026-11-23T06:00:00Z' WHERE id = $1", [
      id,
    ]);
    state.price = '80000';
    state.bid = '80000';
    const run = await check(source, '09:00');
    assert.deepEqual(run.carriedOver, [id]);
    assert.deepEqual(run.sold, []);
    assert.equal((await row(id)).strategy, 'long_hold');
  });

  await t.test(
    'a closed market ends the run quietly: the sale needs a book and nothing changes',
    async () => {
      await reset();
      const { state, source } = scriptedKis();
      const id = await open(source);
      state.closedBook = true;
      // The price alone is still readable and is at a level, but the sale cannot get a bid.
      state.price = '80000';
      const run = await check(source, '15:20');
      assert.equal(run.skipped, 'market_closed');
      assert.deepEqual(run.sold, []);
      assert.deepEqual(run.carriedOver, []);
      assert.equal((await row(id)).strategy, 'day_trade');
      assert.equal((await row(id)).closed_at, null);
      assert.equal(await sells(), 0);
    },
  );

  await t.test('a KIS failure leaves the position open for the next minute', async () => {
    await reset();
    const { state, source } = scriptedKis();
    const id = await open(source);
    state.fail = new KisError('rate_limit', 'KIS says too many requests, try again in a moment');
    const run = await check(source, '10:00');
    assert.equal(run.failed.length, 1);
    assert.equal(run.failed[0].positionId, id);
    assert.equal((await row(id)).closed_at, null);
    state.fail = undefined;
    state.price = '80000';
    state.bid = '80000';
    assert.equal((await check(source, '10:01')).sold.length, 1);
  });
});
