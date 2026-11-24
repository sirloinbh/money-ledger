import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { fakeMessenger } from '../src/kakao/fake.js';
import { notifyLongHoldQuestions } from '../src/kakao/long-hold-events.js';
import { createNotifier } from '../src/kakao/notifier.js';
import { longHoldQueue } from '../src/mock/long-hold.js';
import { runMigration } from './helpers.js';
import { testDatabase } from './test-database.js';

// #313 The keep-or-sell question message, through the real morning queue with a fake clock. 2026-11-25 is a Wednesday.
const url = await testDatabase();
const kst = (text: string) => new Date(`${text.replace(' ', 'T')}:00+09:00`);

test('the long hold question message against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  let accountId = 0;
  let securityId = 0;
  const reset = async () => {
    await pool.query(
      `DROP TABLE IF EXISTS portfolio_trades, portfolio_prepaid_usages, portfolio_assets, mock_position_questions,
         krx_holidays, mock_positions, mock_snapshots, mock_orders, mock_holdings, mock_accounts, security_prices,
         fx_rates, price_fetch_state, price_api_calls, krx_market_days, securities`,
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
      '046_mock_position_questions.sql',
    ]) {
      await runMigration(pool, file);
    }
    const security = await pool.query<{ id: string }>(
      `INSERT INTO securities (market, symbol, name, kind, currency, active)
       VALUES ('KOSPI', '005930', 'Samsung Electronics', 'stock', 'KRW', true) RETURNING id`,
    );
    securityId = Number(security.rows[0].id);
    const account = await pool.query<{ id: string }>(
      'INSERT INTO mock_accounts (initial_cash_krw, cash_krw, fee_rate) VALUES (10000000, 10000000, 0.00015) RETURNING id',
    );
    accountId = Number(account.rows[0].id);
  };
  /** A long hold of 20 shares bought on 2026-11-24 at 70,100 (₩1,402,000). */
  const longHold = async () => {
    const order = await pool.query<{ id: string }>(
      `INSERT INTO mock_orders (account_id, security_id, request_key, side, quantity, price, currency, price_date,
         amount_krw, fee_krw, cash_after_krw, fill_source)
       VALUES ($1, $2, $3, 'buy', 20, 70100, 'KRW', '2026-11-24', 1402000, 210, 8000000, 'book') RETURNING id`,
      [accountId, securityId, randomUUID()],
    );
    const made = await pool.query<{ id: string }>(
      `INSERT INTO mock_positions (account_id, security_id, buy_order_id, quantity, strategy, strategy_chosen_at,
         strategy_source, opened_at)
       VALUES ($1, $2, $3, 20, 'long_hold', now(), 'web', '2026-11-24T10:00:00+09:00') RETURNING id`,
      [accountId, securityId, order.rows[0].id],
    );
    return Number(made.rows[0].id);
  };
  const wire = (
    messenger: ReturnType<typeof fakeMessenger>,
    at: string,
    livePrice?: (symbol: string) => Promise<string>,
    lines: Record<string, unknown>[] = [],
  ) => {
    const notifier = createNotifier(messenger, {
      link: 'https://app',
      log: () => undefined,
      retryDelayMs: 0,
    });
    return longHoldQueue(
      pool,
      undefined,
      () => kst(at),
      (ids) =>
        notifyLongHoldQuestions(pool, notifier, ids, livePrice, (line) => void lines.push(line)),
    );
  };

  await t.test('the 08:30 tick asks once, with the live price and the return', async () => {
    await reset();
    await longHold();
    const messenger = fakeMessenger();
    await wire(messenger, '2026-11-25 08:29').handler({}, {} as never);
    assert.equal(messenger.sent.length, 0, 'before 08:30 nothing is asked');
    // 20 shares at 77,110: 1,542,200 against 1,402,000 is +10.00%.
    const live = () => Promise.resolve('77110');
    await wire(messenger, '2026-11-25 08:30', live).handler({}, {} as never);
    assert.equal(messenger.sent.length, 1);
    assert.equal(
      messenger.sent[0].text,
      'Keep or sell Samsung Electronics (005930)?\n20 sh, last ₩77,110, +10.00%\nReply 유지 or 매도. No answer by 15:00 means keep.',
    );
    await wire(messenger, '2026-11-25 08:31', live).handler({}, {} as never);
    assert.equal(messenger.sent.length, 1, 'a later tick asks nothing again');
  });

  await t.test(
    'a quote that fails falls back to the stored close, then to the buy price',
    async () => {
      await reset();
      await longHold();
      await pool.query(
        "INSERT INTO security_prices (security_id, trade_date, close, currency, source) VALUES ($1, '2026-11-24', 68000, 'KRW', 'TEST')",
        [securityId],
      );
      const messenger = fakeMessenger();
      const lines: Record<string, unknown>[] = [];
      await wire(
        messenger,
        '2026-11-25 08:30',
        () => Promise.reject(new Error('down')),
        lines,
      ).handler({}, {} as never);
      // 20 × 68,000 = 1,360,000 against 1,402,000 is -3.00%.
      assert.match(String(messenger.sent[0].text), /20 sh, last ₩68,000, -3\.00%/);
      assert.equal(lines[0].event, 'kakao_long_hold_quote_failed');

      await reset();
      await longHold();
      const bare = fakeMessenger();
      await wire(bare, '2026-11-25 08:30').handler({}, {} as never);
      assert.match(String(bare.sent[0].text), /20 sh, last ₩70,100, 0\.00%/);
    },
  );

  await t.test('failing sends leave the question open', async () => {
    await reset();
    await longHold();
    const messenger = fakeMessenger();
    messenger.failures.push(new Error('a'), new Error('b'));
    await assert.doesNotReject(wire(messenger, '2026-11-25 08:30').handler({}, {} as never));
    assert.equal(messenger.sent.length, 0);
    const { rows } = await pool.query<{ status: string }>(
      'SELECT status FROM mock_position_questions',
    );
    assert.deepEqual(rows, [{ status: 'open' }]);
  });
});
