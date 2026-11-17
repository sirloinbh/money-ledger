import type { Pool } from 'pg';

import { serviceDate } from '../standard/http.js';
import { seoulHour } from './dates.js';
import { type PriceLog, runDailyFetch } from './fetch.js';
import type { PriceSources } from './sources.js';
import { getState, markAttempt, markChecked, stateSources } from './store.js';

// The daily fetch is due from 12:00 Asia/Seoul, every day including weekends (docs/price-source.md). The pg-boss
// queue in ./jobs.ts calls runIfDue hourly from 12:00 to 18:00 and once at start. When a source fails, the next hourly
// call tries again. A server that was off at 12:00 fetches once when it starts (ADR-0018, #556).

const firstHour = 12;
const lastRetryHour = 18;

/** Called after each run of the daily fetch, with the run's time (#54: the mock account's daily value). */
export type AfterFetch = (now: Date) => Promise<void>;

/**
 * Runs the daily fetch if it is due at `now`. Returns whether it ran. Safe to call twice: the state table says
 * "done today" and "tried this hour". Two servers never run it together because the queue is a `singleton` (jobs.ts).
 */
export async function runIfDue(
  pool: Pool,
  sources: PriceSources,
  now: Date,
  log: PriceLog,
  afterFetch?: AfterFetch,
) {
  const today = serviceDate(now);
  const hour = seoulHour(now);
  if (hour < firstHour) return false;
  const state = await getState(pool, stateSources.job, 'all');
  if (state.checkedThrough === today) return false;
  const last = state.lastAttemptAt;
  if (last && serviceDate(last) === today) {
    if (hour > lastRetryHour) return false; // retries end at 18:00; the next try is tomorrow at 12:00
    if (seoulHour(last) === hour) return false; // once an hour
  }
  await markAttempt(pool, stateSources.job, 'all', now);
  const { complete } = await runDailyFetch(pool, sources, now, log);
  if (complete) await markChecked(pool, stateSources.job, 'all', today, now);
  log({ event: 'price_fetch_run', today, complete });
  // A failure here is logged on its own and does not count as a failed fetch.
  await afterFetch?.(now).catch((error: unknown) =>
    log({
      event: 'price_after_fetch_error',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  return true;
}
