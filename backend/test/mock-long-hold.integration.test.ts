import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runLongHoldTick, seoulClock } from '../src/mock/long-hold.js';
import type { KisSource } from '../src/prices/kis.js';
import { fakeKis } from '../src/prices/kis-fake.js';
import { runMigration, withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

// #310 The morning keep-or-sell question of each long hold, with a fake clock.
const url = await testDatabase();

const kis: KisSource = fakeKis(() => new Date('2026-11-25T00:00:00.000Z'));
/** A KST wall time as the Date the app sees: 2026-11-25 08:30 KST is 2026-11-24 23:30 UTC. */
const kst = (text: string) => new Date(`${text.replace(' ', 'T')}:00+09:00`);

type Question = { id: number; positionId: number; status: string; answerSource: string | null };

test('the morning keep-or-sell question against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  let accountId = 0;
  let securityId = 0;
  let clock = kst('2026-11-25 08:00');
  const now = () => clock;
  const today = () => seoulClock(clock).date;

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
    await runMigration(pool, '046_mock_position_questions.sql'); // re-running is safe
    const security = await pool.query<{ id: string }>(
      `INSERT INTO securities (market, symbol, name, kind, currency, active)
       VALUES ('KOSPI', '005930', '삼성전자', 'stock', 'KRW', true) RETURNING id`,
    );
    securityId = Number(security.rows[0].id);
    const account = await pool.query<{ id: string }>(
      'INSERT INTO mock_accounts (initial_cash_krw, cash_krw, fee_rate) VALUES (10000000, 10000000, 0.00015) RETURNING id',
    );
    accountId = Number(account.rows[0].id);
  };
  /** A position bought on `day` (KST) with the given strategy; each costs about 1.4M won (20 shares). */
  const position = async (day: string, strategy: 'undecided' | 'day_trade' | 'long_hold') => {
    const order = await pool.query<{ id: string }>(
      `INSERT INTO mock_orders (account_id, security_id, request_key, side, quantity, price, currency, price_date,
         amount_krw, fee_krw, cash_after_krw, fill_source)
       VALUES ($1, $2, $3, 'buy', 20, 70100, 'KRW', $4, 1402000, 210, 8000000, 'book') RETURNING id`,
      [accountId, securityId, randomUUID(), day],
    );
    await pool.query(
      `INSERT INTO mock_holdings (account_id, security_id, quantity, cost_krw) VALUES ($1, $2, 20, 1402210)
       ON CONFLICT (account_id, security_id) DO UPDATE SET quantity = mock_holdings.quantity + 20,
         cost_krw = mock_holdings.cost_krw + 1402210`,
      [accountId, securityId],
    );
    const made = await pool.query<{ id: string }>(
      `INSERT INTO mock_positions (account_id, security_id, buy_order_id, quantity, strategy, strategy_chosen_at,
         strategy_source, opened_at)
       VALUES ($1, $2, $3, 20, $4, CASE WHEN $4 = 'undecided' THEN NULL ELSE now() END,
         CASE WHEN $4 = 'undecided' THEN NULL ELSE 'web' END, ($5::date + time '10:00') AT TIME ZONE 'Asia/Seoul')
       RETURNING id`,
      [accountId, securityId, order.rows[0].id, strategy, day],
    );
    return Number(made.rows[0].id);
  };
  const questions = async () =>
    (
      await pool.query<{
        position_id: string;
        question_date: string;
        status: string;
        answer_source: string | null;
      }>(
        'SELECT position_id, question_date::text, status, answer_source FROM mock_position_questions ORDER BY id',
      )
    ).rows;
  const cashOf = async () =>
    Number(
      (
        await pool.query<{ c: string }>('SELECT cash_krw AS c FROM mock_accounts WHERE id = $1', [
          accountId,
        ])
      ).rows[0].c,
    );
  const tick = (at: string, source: KisSource | undefined = kis) => {
    clock = kst(at);
    return runLongHoldTick(pool, source, clock);
  };

  await t.test(
    'asks once at 08:30 for each long hold bought before today, and only those',
    async () => {
      await reset();
      const hold = await position('2026-11-24', 'long_hold');
      await position('2026-11-24', 'day_trade');
      await position('2026-11-24', 'undecided');
      await position('2026-11-25', 'long_hold'); // bought today: not asked yet
      assert.deepEqual(await tick('2026-11-25 08:29'), { opened: 0, sold: 0, closed: 0 });
      assert.equal((await questions()).length, 0);
      assert.equal((await tick('2026-11-25 08:30')).opened, 1);
      assert.equal((await tick('2026-11-25 08:31')).opened, 0, 'a second tick asks nothing again');
      const rows = await questions();
      assert.deepEqual(
        rows.map((row) => [Number(row.position_id), row.question_date, row.status]),
        [[hold, '2026-11-25', 'open']],
      );
      // The list the screen reads.
      await withApi(
        pool,
        async (call) => {
          const list = await call(`/api/mock/accounts/${accountId}/next-day-questions`);
          const found = list.data.questions as Question[];
          assert.deepEqual(
            found.map((q) => [q.positionId, q.status]),
            [[hold, 'open']],
          );
        },
        { today, now, kis },
      );
    },
  );

  await t.test('keep closes the question; answering twice is refused', async () => {
    await reset();
    const hold = await position('2026-11-24', 'long_hold');
    await tick('2026-11-25 08:30');
    clock = kst('2026-11-25 09:10');
    await withApi(
      pool,
      async (call) => {
        const path = `/api/mock/positions/${hold}/next-day`;
        assert.equal((await call(path, { method: 'POST', body: { answer: 'maybe' } })).status, 400);
        assert.equal(
          (
            await call('/api/mock/positions/999/next-day', {
              method: 'POST',
              body: { answer: 'keep' },
            })
          ).status,
          404,
        );
        const kept = await call(path, { method: 'POST', body: { answer: 'keep' } });
        assert.equal(kept.status, 200);
        assert.deepEqual(
          [(kept.data.question as Question).status, (kept.data.question as Question).answerSource],
          ['kept', 'web'],
        );
        const again = await call(path, { method: 'POST', body: { answer: 'sell' } });
        assert.equal(again.status, 409);
        assert.equal(await cashOf(), 10_000_000, 'nothing was sold');
        const open = await pool.query('SELECT 1 FROM mock_positions WHERE closed_at IS NULL');
        assert.equal(open.rowCount, 1);
      },
      { today, now, kis },
    );
    // Asked again the next business day.
    assert.equal((await tick('2026-11-26 08:30')).opened, 1);
  });

  await t.test('sell after 09:00 sells at the best bid with fee and tax, at once', async () => {
    await reset();
    const hold = await position('2026-11-24', 'long_hold');
    await tick('2026-11-25 08:30');
    clock = kst('2026-11-25 09:05');
    await withApi(
      pool,
      async (call) => {
        const sold = await call(`/api/mock/positions/${hold}/next-day`, {
          method: 'POST',
          body: { answer: 'sell', source: 'kakao' },
        });
        assert.equal(sold.status, 200);
        assert.deepEqual(
          [(sold.data.question as Question).status, (sold.data.question as Question).answerSource],
          ['sold', 'kakao'],
        );
        // 20 × 70,000 = 1,400,000; fee round(210) = 210; tax round(2,800) = 2,800.
        assert.equal(await cashOf(), 10_000_000 + 1_400_000 - 210 - 2_800);
        const closed = await pool.query('SELECT 1 FROM mock_positions WHERE closed_at IS NOT NULL');
        assert.equal(closed.rowCount, 1);
      },
      { today, now, kis },
    );
  });

  await t.test('sell before 09:00 waits and is sold by the 09:00 tick', async () => {
    await reset();
    const hold = await position('2026-11-24', 'long_hold');
    await tick('2026-11-25 08:30');
    clock = kst('2026-11-25 08:45');
    await withApi(
      pool,
      async (call) => {
        const queued = await call(`/api/mock/positions/${hold}/next-day`, {
          method: 'POST',
          body: { answer: 'sell' },
        });
        assert.equal((queued.data.question as Question).status, 'sell_queued');
        assert.equal(await cashOf(), 10_000_000);
      },
      { today, now, kis },
    );
    assert.equal((await tick('2026-11-25 08:59')).sold, 0);
    assert.equal(await cashOf(), 10_000_000);
    assert.equal((await tick('2026-11-25 09:00')).sold, 1);
    assert.equal(await cashOf(), 10_000_000 + 1_400_000 - 210 - 2_800);
    assert.equal((await questions())[0].status, 'sold');
    assert.equal((await tick('2026-11-25 09:01')).sold, 0, 'sold once');
  });

  await t.test('a queued sale that cannot fill waits, then expires at the close', async () => {
    await reset();
    const hold = await position('2026-11-24', 'long_hold');
    const closedKis: KisSource = {
      name: 'CLOSED',
      quote: (symbol) => kis.quote(symbol === '005930' ? '999999' : symbol),
      lastPrice: (symbol) => kis.lastPrice(symbol),
    };
    await tick('2026-11-25 08:30', closedKis);
    clock = kst('2026-11-25 09:30');
    await withApi(
      pool,
      async (call) => {
        const answer = await call(`/api/mock/positions/${hold}/next-day`, {
          method: 'POST',
          body: { answer: 'sell' },
        });
        assert.equal(
          (answer.data.question as Question).status,
          'sell_queued',
          'the market could not fill it yet',
        );
      },
      { today, now, kis: closedKis },
    );
    assert.equal((await tick('2026-11-25 10:00', closedKis)).sold, 0);
    assert.equal(await cashOf(), 10_000_000);
    assert.equal((await tick('2026-11-25 15:30', closedKis)).closed, 1);
    assert.equal((await questions())[0].status, 'expired');
    const open = await pool.query('SELECT 1 FROM mock_positions WHERE closed_at IS NULL');
    assert.equal(open.rowCount, 1, 'the position is kept');
  });

  await t.test('no answer by 15:00 keeps the position and closes the question', async () => {
    await reset();
    const hold = await position('2026-11-24', 'long_hold');
    await tick('2026-11-25 08:30');
    assert.equal((await tick('2026-11-25 14:59')).closed, 0);
    assert.equal((await tick('2026-11-25 15:00')).closed, 1);
    const [row] = await questions();
    assert.deepEqual([row.status, row.answer_source], ['kept', 'auto']);
    clock = kst('2026-11-25 15:01');
    await withApi(
      pool,
      async (call) => {
        const late = await call(`/api/mock/positions/${hold}/next-day`, {
          method: 'POST',
          body: { answer: 'sell' },
        });
        assert.equal(late.status, 409);
      },
      { today, now, kis },
    );
    assert.equal(await cashOf(), 10_000_000);
    // A question that was still open when the server missed 15:00 is closed by the next day's first tick.
    await pool.query(
      "UPDATE mock_position_questions SET status = 'open', answered_at = NULL, answer_source = NULL",
    );
    assert.equal((await tick('2026-11-26 08:00')).closed, 1);
    assert.equal((await questions())[0].status, 'kept');
  });

  await t.test('no question on a weekend or a listed holiday', async () => {
    await reset();
    await position('2026-11-24', 'long_hold');
    await pool.query(
      "INSERT INTO krx_holidays (holiday_date, name) VALUES ('2026-11-26', 'Test holiday')",
    );
    assert.equal((await tick('2026-11-26 08:30')).opened, 0, 'holiday');
    assert.equal((await tick('2026-11-28 08:30')).opened, 0, 'Saturday');
    assert.equal((await tick('2026-11-29 08:30')).opened, 0, 'Sunday');
    assert.equal((await tick('2026-11-27 08:30')).opened, 1, 'the next business day');
  });

  await t.test('a position with no question today answers 404', async () => {
    await reset();
    const hold = await position('2026-11-24', 'long_hold');
    clock = kst('2026-11-25 09:10');
    await withApi(
      pool,
      async (call) => {
        const none = await call(`/api/mock/positions/${hold}/next-day`, {
          method: 'POST',
          body: { answer: 'keep' },
        });
        assert.equal(none.status, 404);
      },
      { today, now, kis },
    );
  });
});
