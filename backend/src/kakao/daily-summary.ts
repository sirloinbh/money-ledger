import type { Pool } from 'pg';

import { accountValue } from '../mock/holdings.js';
import { won } from '../money.js';
import { isBusinessDay } from '../prices/krx-calendar.js';
import { serviceDate } from '../standard/http.js';
import { type JobLog, type JobQueue, logJob } from '../standard/jobs.js';
import type { Comparison, DailySummary } from './messages.js';
import type { Notifier } from './notifier.js';
import type { KakaoService } from './service.js';

// #313 Once a day after the close: the open mock account's summary to KakaoTalk. The comparison with the deposit,
// Buffett and Renaissance comes from #294 (kakao/comparison.ts). It covers the account's own return period, which ends
// at the last stored daily snapshot, so it can end a day earlier than the live-valued headline return.
//
// KRX daily closes are stored around 8 AM the next day (docs/price-source.md), so at 19:10 no Korean holding has
// today's stored close. Each Korean holding is valued at the live price (after 15:30 it is the day's close) and, when
// that is not available, at the latest stored close. A holding with no price at all is valued at cost. One missing
// price never skips the summary; the message says how many holdings used each kind of price.

export const KAKAO_DAILY_SUMMARY_QUEUE = 'kakao-daily-summary';

/** The current price of a Korean stock as a decimal string; rejects when it cannot be read. */
export type LivePrice = (symbol: string) => Promise<string>;

/**
 * The account's total value and return, valuing each Korean holding at `livePrice` when it answers. The
 * multiplication, the rounding and the return use SQL numeric (AGENTS.project.md); only whole-won integers are added
 * here.
 */
export async function valueForSummary(
  pool: Pool,
  accountId: number,
  day: string,
  livePrice: LivePrice | undefined,
  log: JobLog = logJob,
): Promise<Pick<DailySummary, 'summary' | 'prices'> | undefined> {
  const value = await accountValue(pool, accountId, day);
  if (!value) return undefined;
  const prices = { live: 0, close: 0, stale: 0, cost: 0 };

  // One at a time: each quote is two KIS calls, and KIS limits calls per second. A quote that fails (rate limit, market
  // closed, bad answer) is logged by symbol and code, and that holding falls back to its stored close below.
  const known: { holding: (typeof value.holdings)[number]; live: string | undefined }[] = [];
  for (const holding of value.holdings) {
    let live: string | undefined;
    if (livePrice && holding.security.currency === 'KRW') {
      try {
        const price = await livePrice(holding.security.symbol);
        if (/^\d{1,12}$/.test(price)) live = price;
      } catch (error) {
        log({
          level: 'warn',
          event: 'kakao_daily_summary_quote_failed',
          symbol: holding.security.symbol,
          code: (error as { code?: unknown }).code ?? 'unknown',
          day,
        });
      }
    }
    known.push({ holding, live });
  }

  const liveRows = known.filter((entry) => entry.live !== undefined);
  const liveKrw = new Map<number, number>();
  if (liveRows.length > 0) {
    const { rows } = await pool.query<{ id: number; krw: string }>(
      `SELECT t.id, round(t.quantity::numeric * t.price::numeric) AS krw
       FROM unnest($1::bigint[], $2::text[], $3::text[]) AS t(id, quantity, price)`,
      [
        liveRows.map((entry) => entry.holding.security.id),
        liveRows.map((entry) => entry.holding.quantity),
        liveRows.map((entry) => entry.live),
      ],
    );
    for (const row of rows) liveKrw.set(row.id, won(row.krw));
  }

  let valueKrw = 0;
  for (const { holding } of known) {
    const live = liveKrw.get(holding.security.id as number);
    if (live !== undefined) {
      prices.live += 1;
      valueKrw += live;
    } else if (holding.valueKrw !== null) {
      // A close more than 5 days old is counted apart, so the note says the price is that old.
      if (holding.priceStale) prices.stale += 1;
      else prices.close += 1;
      valueKrw += holding.valueKrw;
    } else {
      prices.cost += 1;
      valueKrw += holding.costKrw;
    }
  }

  const { initialCashKrw, cashKrw } = value.summary;
  const totalKrw = cashKrw + valueKrw;
  const { rows } = await pool.query<{ pct: string }>(
    'SELECT round(($1::numeric - $2::numeric) * 100 / $2::numeric, 2) AS pct',
    [totalKrw, initialCashKrw],
  );
  return {
    summary: {
      capitalKrw: initialCashKrw,
      cashKrw,
      totalValueKrw: totalKrw,
      profitKrw: totalKrw - initialCashKrw,
      returnPct: rows[0].pct,
    },
    prices,
  };
}

export async function sendDailySummary(
  pool: Pool,
  notifier: Notifier,
  day: string,
  options: {
    connected: () => Promise<boolean>;
    livePrice?: LivePrice;
    comparison?: (accountId: number, day: string) => Promise<Comparison | undefined>;
    log?: JobLog;
  },
) {
  const log = options.log ?? logJob;
  // A market holiday has no new close to report (#321: the shared KRX calendar).
  if (!(await isBusinessDay(pool, day))) {
    log({ level: 'info', event: 'kakao_daily_summary_skipped', reason: 'not-business-day', day });
    return;
  }
  // Not connected (or revoked): nothing to send, and not an error the job should retry.
  if (!(await options.connected())) {
    log({ level: 'info', event: 'kakao_daily_summary_skipped', reason: 'not-connected', day });
    return;
  }
  const { rows } = await pool.query<{ id: number }>(
    'SELECT id FROM mock_accounts WHERE closed_at IS NULL LIMIT 1',
  );
  const account = rows[0];
  if (!account) {
    log({ level: 'info', event: 'kakao_daily_summary_skipped', reason: 'no-account', day });
    return;
  }
  const valued = await valueForSummary(pool, account.id, day, options.livePrice, log);
  // The account was open a moment ago; a reset in between leaves nothing to send.
  if (!valued) return;
  // The comparison is an extra line: if it cannot be read, the summary still goes out without it.
  let comparison: Comparison | undefined;
  try {
    comparison = await options.comparison?.(account.id, day);
  } catch (error) {
    log({
      level: 'warn',
      event: 'kakao_daily_summary_comparison_failed',
      message: error instanceof Error ? error.message : 'unknown error',
      day,
    });
  }
  await notifier.notify({ type: 'daily-summary', ...valued, comparison });
}

/**
 * The summary as a pg-boss queue. Cron in Asia/Seoul: 19:10 on weekdays, after the daily price fetch (12:00-18:00) and
 * the net worth save (19:05). The cron skips weekends; the handler also skips the KRX holidays (`isBusinessDay`, #321).
 * `singleton`: one run at a time. A failed send is the notifier's to log; the job itself only fails when the database
 * does, and then pg-boss runs it again.
 */
export function kakaoDailySummaryQueue(
  pool: Pool,
  notifier: Notifier,
  kakao: Pick<KakaoService, 'status'>,
  today: () => string = () => serviceDate(),
  options: {
    livePrice?: LivePrice;
    comparison?: (accountId: number, day: string) => Promise<Comparison | undefined>;
  } = {},
): JobQueue {
  return {
    name: KAKAO_DAILY_SUMMARY_QUEUE,
    policy: 'singleton',
    retryLimit: 2,
    retryDelay: 60,
    schedule: '10 19 * * 1-5',
    handler: () =>
      sendDailySummary(pool, notifier, today(), {
        connected: async () => (await kakao.status()).state === 'connected',
        livePrice: options.livePrice,
        comparison: options.comparison,
      }),
  };
}
