import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { resetDatabase, withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

// #293 The trade journal: a note at order time, editing notes later, and the journal list with its result.
const url = await testDatabase();
const today = () => '2026-11-09';

type Entry = {
  id: number;
  side: string;
  note: string | null;
  reviewNote: string | null;
  result: { kind: 'realized' | 'current'; gainKrw: number } | null;
};

test('mock trade journal against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  let accountId = 0;
  let securityId = 0;
  const reset = async () => {
    await resetDatabase(pool);
    const security = await pool.query<{ id: string }>(
      `INSERT INTO securities (market, symbol, name, kind, currency, active)
       VALUES ('KOSPI', '005930', '삼성전자', 'stock', 'KRW', true) RETURNING id`,
    );
    securityId = Number(security.rows[0].id);
    await pool.query(
      `INSERT INTO security_prices (security_id, trade_date, close, currency, source)
       VALUES ($1, '2026-11-06', 70000, 'KRW', 'T')`,
      [securityId],
    );
    const account = await pool.query<{ id: string }>(
      'INSERT INTO mock_accounts (initial_cash_krw, cash_krw) VALUES (10000000, 10000000) RETURNING id',
    );
    accountId = Number(account.rows[0].id);
  };
  const orders = () => `/api/mock/accounts/${accountId}/orders`;
  const order = (side: 'buy' | 'sell', quantity: string, note?: string) => ({
    securityId,
    side,
    quantity,
    requestKey: randomUUID(),
    expectedPrice: '70000',
    expectedPriceDate: '2026-11-06',
    expectedFxRate: null,
    ...(note === undefined ? {} : { note }),
  });

  await t.test('an order keeps its note, and the note can be edited later', async () => {
    await reset();
    await withApi(
      pool,
      async (call) => {
        const placed = await call(orders(), {
          method: 'POST',
          body: order('buy', '10', '  Earnings look strong  '),
        });
        assert.equal(placed.status, 201);
        const id = (placed.data as { order: { id: number; note: string } }).order.id;
        assert.equal(
          (placed.data as { order: { note: string } }).order.note,
          'Earnings look strong',
        );

        const none = await call(orders(), { method: 'POST', body: order('buy', '1') });
        assert.equal((none.data as { order: { note: unknown } }).order.note, null);

        // Only the sent field changes.
        const review = await call(`${orders()}/${id}/notes`, {
          method: 'PATCH',
          body: { reviewNote: 'Too early to judge' },
        });
        assert.equal(review.status, 200);
        assert.deepEqual(
          [
            (review.data as { order: Entry }).order.note,
            (review.data as { order: Entry }).order.reviewNote,
          ],
          ['Earnings look strong', 'Too early to judge'],
        );

        // Blank text clears a note.
        const cleared = await call(`${orders()}/${id}/notes`, {
          method: 'PATCH',
          body: { note: '   ' },
        });
        assert.equal((cleared.data as { order: Entry }).order.note, null);
        assert.equal((cleared.data as { order: Entry }).order.reviewNote, 'Too early to judge');
      },
      { today },
    );
  });

  await t.test('bad notes and unknown orders are refused', async () => {
    await reset();
    await withApi(
      pool,
      async (call) => {
        const placed = await call(orders(), { method: 'POST', body: order('buy', '1') });
        const id = (placed.data as { order: { id: number } }).order.id;
        const patch = (path: string, body: unknown) => call(path, { method: 'PATCH', body });
        assert.equal((await patch(`${orders()}/${id}/notes`, {})).status, 400);
        assert.equal(
          (await patch(`${orders()}/${id}/notes`, { note: 'x'.repeat(1001) })).status,
          400,
        );
        assert.equal((await patch(`${orders()}/${id}/notes`, { note: 5 })).status, 400);
        assert.equal((await patch(`${orders()}/999999/notes`, { note: 'a' })).status, 404);
        assert.equal((await patch(`${orders()}/abc/notes`, { note: 'a' })).status, 400);
        // Another account's order id is not found through this account.
        const other = await pool.query<{ id: string }>(
          'INSERT INTO mock_accounts (initial_cash_krw, cash_krw, closed_at) VALUES (1000000, 1000000, now()) RETURNING id',
        );
        const through = await patch(`/api/mock/accounts/${other.rows[0].id}/orders/${id}/notes`, {
          note: 'a',
        });
        assert.equal(through.status, 404);
        assert.equal((await call(`/api/mock/accounts/999999/orders/journal`)).status, 404);
      },
      { today },
    );
  });

  await t.test('the journal shows the result so far for a buy and its notes', async () => {
    await reset();
    await withApi(
      pool,
      async (call) => {
        await call(orders(), { method: 'POST', body: order('buy', '10', 'Dip buy') });
        // The close rises after the order: the gain at the latest close is 10 × 2,000 = 20,000.
        await pool.query(
          `INSERT INTO security_prices (security_id, trade_date, close, currency, source)
           VALUES ($1, '2026-11-09', 72000, 'KRW', 'T')`,
          [securityId],
        );
        const journal = await call(`${orders()}/journal`);
        assert.equal(journal.status, 200);
        const { entries, hasMore } = journal.data as { entries: Entry[]; hasMore: boolean };
        assert.equal(hasMore, false);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].note, 'Dip buy');
        assert.deepEqual(entries[0].result, { kind: 'current', gainKrw: 20_000 });
      },
      { today },
    );
  });

  await t.test('a closed position shows its realized gain on both orders', async () => {
    await reset();
    await withApi(
      pool,
      async (call) => {
        const buy = (await call(orders(), { method: 'POST', body: order('buy', '10') })).data as {
          order: { id: number };
        };
        const sell = (await call(orders(), { method: 'POST', body: order('sell', '10') })).data as {
          order: { id: number };
        };
        // A position links a buy to its sale (#307); its net gain is recorded when it is sold.
        await pool.query(
          `INSERT INTO mock_positions (account_id, security_id, buy_order_id, sell_order_id, quantity,
             closed_at, net_gain_krw, net_gain_pct, exit_reason, strategy, strategy_chosen_at, strategy_source)
           VALUES ($1, $2, $3, $4, 10, now(), -1234, -0.18, 'manual', 'day_trade', now(), 'web')`,
          [accountId, securityId, buy.order.id, sell.order.id],
        );
        const { entries } = (await call(`${orders()}/journal`)).data as { entries: Entry[] };
        assert.deepEqual(
          entries.map((entry) => [entry.side, entry.result]),
          [
            ['sell', { kind: 'realized', gainKrw: -1234 }],
            ['buy', { kind: 'realized', gainKrw: -1234 }],
          ],
        );
      },
      { today },
    );
  });

  await t.test('a close-price sale has no result of its own yet', async () => {
    await reset();
    await withApi(
      pool,
      async (call) => {
        await call(orders(), { method: 'POST', body: order('buy', '10') });
        await call(orders(), { method: 'POST', body: order('sell', '4') });
        const { entries } = (await call(`${orders()}/journal`)).data as { entries: Entry[] };
        assert.equal(entries[0].side, 'sell');
        assert.equal(entries[0].result, null);
      },
      { today },
    );
  });
});
