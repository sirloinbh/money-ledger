import type { Pool } from 'pg';

import type { LivePrice } from './daily-summary.js';
import type { Notifier } from './notifier.js';

// #313 Tells KakaoTalk about the keep-or-sell questions a morning tick just opened (mock/long-hold.ts `onOpened`).
// The questions are already saved when this runs, and nothing here throws: a message that cannot be built or sent is
// logged, and the question stays open for the web screen and the chatbot.

type Row = {
  symbol: string;
  name: string | null;
  quantity: string;
  buy_price: string;
  close: string | null;
};

/**
 * One `long-hold-question` message per position. The price is the live price when it answers, else the last stored
 * close, else the buy price; the return is that price against the money spent on the buy, in SQL numeric.
 */
export async function notifyLongHoldQuestions(
  pool: Pool,
  notifier: Notifier,
  positionIds: number[],
  livePrice: LivePrice | undefined,
  log: (line: Record<string, unknown>) => void,
) {
  for (const positionId of positionIds) {
    try {
      const { rows } = await pool.query<Row>(
        `SELECT s.symbol, s.name, p.quantity::text AS quantity, b.price::text AS buy_price,
                (SELECT c.close::text FROM security_prices c WHERE c.security_id = p.security_id
                 ORDER BY c.trade_date DESC LIMIT 1) AS close
         FROM mock_positions p
         JOIN securities s ON s.id = p.security_id
         JOIN mock_orders b ON b.id = p.buy_order_id
         WHERE p.id = $1`,
        [positionId],
      );
      const position = rows[0];
      if (!position) {
        log({ level: 'error', event: 'kakao_long_hold_notify_skipped', positionId });
        continue;
      }
      let price = position.close ?? position.buy_price;
      if (livePrice) {
        try {
          const live = await livePrice(position.symbol);
          if (/^\d{1,12}$/.test(live)) price = live;
        } catch (error) {
          log({
            level: 'warn',
            event: 'kakao_long_hold_quote_failed',
            symbol: position.symbol,
            code: (error as { code?: unknown }).code ?? 'unknown',
          });
        }
      }
      const { rows: pct } = await pool.query<{ pct: string }>(
        `SELECT round((p.quantity * $2::numeric - b.amount_krw) / b.amount_krw * 100, 2)::text AS pct
         FROM mock_positions p JOIN mock_orders b ON b.id = p.buy_order_id WHERE p.id = $1`,
        [positionId, price],
      );
      await notifier.notify({
        type: 'long-hold-question',
        stockName: position.name ?? position.symbol,
        symbol: position.symbol,
        quantity: position.quantity,
        // A Korean price is whole won, so this is only the number to print.
        priceKrw: Number(price.split('.')[0]),
        returnPct: pct[0].pct,
      });
    } catch (error) {
      log({
        level: 'error',
        event: 'kakao_long_hold_notify_failed',
        positionId,
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }
}
