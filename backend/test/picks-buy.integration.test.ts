import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';
import { z } from 'zod/v4';

import { buyKeyOf, pickBuyDeps } from '../src/picks/buy.js';
import { fakeClaude } from '../src/picks/claude.js';
import { type PickDeps, runDailyPick } from '../src/picks/run.js';
import { fakeKis } from '../src/prices/kis-fake.js';
import { resetDatabase } from './helpers.js';
import { testDatabase } from './test-database.js';

// #308 The pick's buy step on the all-in buy of #307, against the real tables.
const url = await testDatabase();

const day = '2026-11-24';
const now = new Date('2026-11-23T23:00:00Z'); // 08:00 on 2026-11-24 in Seoul
// The fake book of 005930: best ask 70,100, best bid 70,000.
const kis = fakeKis(() => new Date('2026-11-24T01:00:00.000Z'));

test('the buy key of a pick is a fixed, valid UUID', () => {
  assert.equal(buyKeyOf(7), buyKeyOf(7));
  assert.notEqual(buyKeyOf(7), buyKeyOf(8));
  assert.ok(z.uuid().safeParse(buyKeyOf(7)).success);
});

test('the daily pick buys all-in and links the order', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async (withAccount = true) => {
    await resetDatabase(pool);
    await pool.query(
      `INSERT INTO securities (market, symbol, name, kind, currency, active)
       VALUES ('KOSPI', '005930', '삼성전자', 'stock', 'KRW', true)`,
    );
    if (withAccount) {
      await pool.query(
        'INSERT INTO mock_accounts (initial_cash_krw, cash_krw, fee_rate) VALUES (10000000, 10000000, 0.00015)',
      );
    }
    await pool.query(
      `INSERT INTO news_items (link, title, summary, published_at, query, fetched_date)
       VALUES ('https://n.test/1', '반도체 수출 급증', '', now(), '반도체', $1)`,
      [day],
    );
  };
  const deps = (): PickDeps => {
    return {
      claude: fakeClaude('005930', [1]),
      ...pickBuyDeps(pool, kis, () => day),
      log: () => undefined,
    };
  };

  await t.test(
    'buys the picked stock all-in at the best ask and links the order to the pick',
    async () => {
      await reset();
      const result = await runDailyPick(pool, deps(), now);
      assert.equal(result.status, 'picked');
      assert.ok(result.status === 'picked' && result.buyError === null && result.orderId !== null);
      const { rows } = await pool.query(
        `SELECT p.order_id, o.side, o.price, o.quantity, o.fill_source, o.request_key
       FROM daily_picks p JOIN mock_orders o ON o.id = p.order_id`,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].side, 'buy');
      assert.equal(rows[0].fill_source, 'book');
      assert.equal(Number(rows[0].price), 70100);
      const pickId = (await pool.query('SELECT id FROM daily_picks')).rows[0].id;
      assert.equal(rows[0].request_key, buyKeyOf(Number(pickId)));
      const account = (await pool.query('SELECT cash_krw FROM mock_accounts')).rows[0];
      assert.ok(Number(account.cash_krw) < 70100); // all-in: less than one more share of cash is left
      assert.equal(
        (await pool.query('SELECT 1 FROM mock_positions WHERE closed_at IS NULL')).rowCount,
        1,
      );
    },
  );

  await t.test(
    'a second run, and a run on the next day with the position open, buy nothing more',
    async () => {
      await reset();
      assert.equal((await runDailyPick(pool, deps(), now)).status, 'picked');
      assert.equal((await runDailyPick(pool, deps(), now)).status, 'already_picked');
      assert.equal((await pool.query('SELECT 1 FROM mock_orders')).rowCount, 1);
      // Next day, new headlines: the open position makes the run skip, before Claude is asked.
      await pool.query(
        `INSERT INTO news_items (link, title, summary, published_at, query, fetched_date)
       VALUES ('https://n.test/2', '다음 날 뉴스', '', now(), '경제', '2026-11-25')`,
      );
      const next = new Date('2026-11-24T23:00:00Z'); // 08:00 on 2026-11-25 in Seoul
      assert.equal((await runDailyPick(pool, deps(), next)).status, 'skipped_open_position');
      assert.equal((await pool.query('SELECT 1 FROM daily_picks')).rowCount, 1);
    },
  );

  await t.test(
    'without an open account the pick is kept and the buy error is reported',
    async () => {
      await reset(false);
      const result = await runDailyPick(pool, deps(), now);
      assert.ok(result.status === 'picked' && result.orderId === null);
      assert.match(
        result.status === 'picked' ? (result.buyError ?? '') : '',
        /no open mock trading account/,
      );
      assert.equal((await pool.query('SELECT order_id FROM daily_picks')).rows[0].order_id, null);
    },
  );
});
