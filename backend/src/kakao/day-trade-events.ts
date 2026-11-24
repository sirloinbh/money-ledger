import type { Pool } from 'pg';

import type { DayTradeRun } from '../mock/day-trade.js';
import { valueForSummary } from './daily-summary.js';
import type { Notifier } from './notifier.js';

// #313 Tells KakaoTalk about the day trade sales of one run (mock/day-trade.ts `onSold`). The sales are already saved
// when this runs, and nothing here throws: a message that cannot be built or sent is logged by the notifier, and the
// trade stays.

/**
 * One `day-trade-sold` message per sale: take profit or stop loss, the price, the net gain after fees and tax, and the
 * account's value once the run's sales are saved (cash plus holdings at their latest stored close, or at cost when a
 * holding has none, the same valuation as the daily summary). Two sales in one run both show the value after both.
 */
export async function notifyDayTradeSales(
  pool: Pool,
  notifier: Notifier,
  sold: DayTradeRun['sold'],
  today: string,
  log: (line: Record<string, unknown>) => void,
) {
  const capital = new Map<number, number | undefined>();
  for (const { reason, position } of sold) {
    try {
      if (!position.sell || position.netGainKrw === null || position.netGainPct === null) {
        log({ level: 'error', event: 'kakao_day_trade_notify_skipped', positionId: position.id });
        continue;
      }
      if (!capital.has(position.accountId)) {
        const valued = await valueForSummary(pool, position.accountId, today, undefined, log);
        capital.set(position.accountId, valued?.summary.totalValueKrw);
      }
      const capitalKrw = capital.get(position.accountId);
      if (capitalKrw === undefined) {
        log({ level: 'error', event: 'kakao_day_trade_notify_skipped', positionId: position.id });
        continue;
      }
      await notifier.notify({
        type: 'day-trade-sold',
        reason: reason === 'take_profit' ? 'take-profit' : 'stop-loss',
        stockName: position.security.name ?? position.security.symbol,
        symbol: position.security.symbol,
        quantity: position.quantity,
        priceKrw: Number(position.sell.price),
        netGainKrw: position.netGainKrw,
        netGainPct: position.netGainPct,
        capitalKrw,
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
