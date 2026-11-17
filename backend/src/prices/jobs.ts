import type { Pool } from 'pg';

import type { JobQueue } from '../standard/jobs.js';
import type { PriceLog } from './fetch.js';
import { type AfterFetch, runIfDue } from './scheduler.js';
import type { PriceSources } from './sources.js';

export const PRICE_QUEUE = 'daily-prices';

/**
 * The daily price fetch as a pg-boss queue (ADR-0018, #556). `singleton`: one run at a time across servers.
 * The cron runs hourly from 12:00 to 18:00 Asia/Seoul; that hourly call is also the retry when a source failed.
 * The handler only runs the due check, which reads the state table, so a duplicate job does nothing.
 * `retryLimit: 0`: the next hour is the retry, and a retry inside the same hour would be skipped anyway.
 */
export function priceQueue(
  pool: Pool,
  sources: PriceSources,
  log: PriceLog,
  afterFetch?: AfterFetch,
  now: () => Date = () => new Date(),
): JobQueue {
  return {
    name: PRICE_QUEUE,
    policy: 'singleton',
    retryLimit: 0,
    schedule: '0 12-18 * * *',
    handler: async () => {
      await runIfDue(pool, sources, now(), log, afterFetch);
    },
  };
}
