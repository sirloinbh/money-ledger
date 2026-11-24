import type { Pool } from 'pg';

import type { DayTradeRun } from '../mock/day-trade.js';
import { accountValue } from '../mock/holdings.js';
import type { Notifier } from './notifier.js';

// #313 Tells KakaoTalk about the day trade sales of one run (mock/day-trade.ts `onSold`). The sales are already saved
// when this runs, and nothing here throws: a message that cannot be built or sent is logged by the notifier, and the
// trade stays.

/**
 * One `day-trade-sold` message per sale: take profit or stop loss, the price, the net gain after fees and tax, and the
 * account's value after the sale (cash plus holdings at their latest prices).
 */
export async function notifyDayTradeSales(
  pool: Pool,
  notifier: Notifier,
  sold: DayTradeRun['sold'],
  today: string,
  log: (line: Record<string, unknown>) => void,
) {
  for (const { reason, position } of sold) {
    try {
      const value = await accountValue(pool, position.accountId, today);
      if (!position.sell || position.netGainKrw === null || position.netGainPct === null) continue;
      await notifier.notify({
        type: 'day-trade-sold',
        reason: reason === 'take_profit' ? 'take-profit' : 'stop-loss',
        stockName: position.security.name ?? position.security.symbol,
        symbol: position.security.symbol,
        quantity: position.quantity,
        priceKrw: Number(position.sell.price),
        netGainKrw: position.netGainKrw,
        netGainPct: position.netGainPct,
        // Unknown only when a holding has no stored close; the cash alone is then the safest figure to state.
        capitalKrw: value?.summary.totalKrw ?? value?.summary.cashKrw ?? 0,
      });
    } catch (error) {
      log({
        level: 'error',
        event: 'kakao_day_trade_notify_failed',
        positionId: position.id,
        message: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }
}
