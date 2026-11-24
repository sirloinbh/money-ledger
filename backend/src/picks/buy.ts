import { createHash } from 'node:crypto';

import type { Pool } from 'pg';

import { buyAllIn } from '../mock/positions.js';
import { liveQuote } from '../mock/quotes.js';
import type { KisSource } from '../prices/kis.js';
import type { PickDeps } from './run.js';

// #308 The buy step of the daily pick, on the all-in buy of #307: the open mock account spends all its cash on the
// picked stock at the best ask, and the order is linked to the pick.

/**
 * A fixed UUID for one pick's buy, used as the order's request key: calling the buy twice for one pick returns the
 * first position instead of buying twice (#307 keeps the key unique).
 */
export function buyKeyOf(pickId: number) {
  const bytes = createHash('sha256').update(`daily-pick-buy:${pickId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80; // version 8, custom
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The open mock account (there is one at most). */
async function openAccountId(pool: Pool) {
  const { rows } = await pool.query<{ id: number }>(
    'SELECT id FROM mock_accounts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1',
  );
  return rows.at(0)?.id;
}

/** `hasOpenPosition` and `buy` of the pick run, against the real tables of #307. */
export function pickBuyDeps(
  pool: Pool,
  kis: KisSource | undefined,
  today: () => string,
): Pick<PickDeps, 'hasOpenPosition' | 'buy'> {
  return {
    async hasOpenPosition() {
      const { rowCount } = await pool.query(
        `SELECT 1 FROM mock_positions p JOIN mock_accounts a ON a.id = p.account_id
         WHERE a.closed_at IS NULL AND p.closed_at IS NULL LIMIT 1`,
      );
      return (rowCount ?? 0) > 0;
    },
    async buy({ pickId, securityId }) {
      const accountId = await openAccountId(pool);
      if (accountId === undefined) throw new Error('There is no open mock trading account');
      const { rows } = await pool.query<{ symbol: string }>(
        'SELECT symbol FROM securities WHERE id = $1',
        [securityId],
      );
      const symbol = rows.at(0)?.symbol;
      if (!symbol) throw new Error('The picked security no longer exists');
      const quote = await liveQuote(kis, symbol);
      const ask = quote.asks[0]?.price;
      if (!ask) throw new Error('There is no ask in the order book right now');
      const { position } = await buyAllIn(pool, kis, today, accountId, {
        securityId,
        requestKey: buyKeyOf(pickId),
        expectedAsk: ask,
      });
      const order = await pool.query<{ buy_order_id: number }>(
        'SELECT buy_order_id FROM mock_positions WHERE id = $1',
        [position.id],
      );
      return order.rows[0].buy_order_id;
    },
  };
}
