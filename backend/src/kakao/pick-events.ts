import type { Pool } from 'pg';

import { won } from '../money.js';
import type { Notifier } from './notifier.js';

// #313 Tells KakaoTalk about the day's pick once its all-in buy is saved (picks/run.ts `onBought`): the story, its
// effect on the economy, the reasoning, the stock, the quantity, the price and the question "day trade or long
// hold?". The buy is already saved when this runs, and nothing here throws.

type Row = {
  story_title: string;
  economic_effect: string;
  reasoning: string;
  symbol: string;
  name: string | null;
  quantity: string;
  price: string;
  cost_krw: string;
};

export async function notifyPickBought(
  pool: Pool,
  notifier: Notifier,
  pickId: number,
  log: (line: Record<string, unknown>) => void,
) {
  try {
    // The cost is the order amount plus its fee, both whole won, added in SQL.
    const { rows } = await pool.query<Row>(
      `SELECT p.story_title, p.economic_effect, p.reasoning, s.symbol, s.name,
              o.quantity, o.price, o.amount_krw + o.fee_krw AS cost_krw
       FROM daily_picks p
       JOIN securities s ON s.id = p.security_id
       JOIN mock_orders o ON o.id = p.order_id
       WHERE p.id = $1`,
      [pickId],
    );
    const pick = rows[0];
    if (!pick) {
      log({ level: 'error', event: 'kakao_pick_notify_skipped', pickId });
      return;
    }
    const stockName = pick.name ?? pick.symbol;
    await notifier.notify({
      type: 'pick-bought',
      news: {
        headline: pick.story_title,
        effect: pick.economic_effect,
        stockName,
        symbol: pick.symbol,
        reason: pick.reasoning,
      },
      stockName,
      symbol: pick.symbol,
      quantity: pick.quantity,
      // A Korean price is whole won, so this is only the number to print.
      priceKrw: Number(pick.price),
      amountKrw: won(pick.cost_krw),
    });
  } catch (error) {
    log({
      level: 'error',
      event: 'kakao_pick_notify_failed',
      pickId,
      message: error instanceof Error ? error.message : 'unknown error',
    });
  }
}
