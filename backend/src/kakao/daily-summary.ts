import type { Pool } from 'pg';

import { accountValue } from '../mock/holdings.js';
import { serviceDate } from '../standard/http.js';
import { type JobLog, type JobQueue, logJob } from '../standard/jobs.js';
import type { Comparison } from './messages.js';
import type { Notifier } from './notifier.js';
import type { KakaoService } from './service.js';

// #313 Once a day after the close: the open mock account's summary to KakaoTalk. The comparison with the deposit,
// Buffett and Renaissance comes from #294; until it lands `comparison` is not given and the message leaves it out.

export const KAKAO_DAILY_SUMMARY_QUEUE = 'kakao-daily-summary';

export async function sendDailySummary(
  pool: Pool,
  notifier: Notifier,
  day: string,
  options: {
    connected: () => Promise<boolean>;
    comparison?: (accountId: number, day: string) => Promise<Comparison | undefined>;
    log?: JobLog;
  },
) {
  const log = options.log ?? logJob;
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
  const value = await accountValue(pool, account.id, day);
  const summary = value?.summary;
  // A holding without a stored close makes the total unknown; no summary is better than a wrong one.
  if (!summary || summary.totalKrw === null || summary.returnPct === null) {
    log({ level: 'info', event: 'kakao_daily_summary_skipped', reason: 'no-valuation', day });
    return;
  }
  await notifier.notify({
    type: 'daily-summary',
    summary: {
      capitalKrw: summary.initialCashKrw,
      cashKrw: summary.cashKrw,
      totalValueKrw: summary.totalKrw,
      profitKrw: summary.profitKrw ?? 0,
      returnPct: summary.returnPct,
    },
    comparison: await options.comparison?.(account.id, day),
  });
}

/**
 * The summary as a pg-boss queue. Cron in Asia/Seoul: 19:10 on weekdays, after the daily price fetch (12:00-18:00) and
 * the net worth save (19:05). `singleton`: one run at a time. A failed send is the notifier's to log; the job itself
 * only fails when the database does, and then pg-boss runs it again.
 */
export function kakaoDailySummaryQueue(
  pool: Pool,
  notifier: Notifier,
  kakao: Pick<KakaoService, 'status'>,
  today: () => string = () => serviceDate(),
  options: {
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
        comparison: options.comparison,
      }),
  };
}
