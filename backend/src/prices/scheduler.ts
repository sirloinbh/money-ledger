import type { Pool } from 'pg';

import { serviceDate } from '../standard/http.js';
import { seoulHour } from './dates.js';
import { type PriceLog, runDailyFetch } from './fetch.js';
import type { PriceSources } from './sources.js';
import { getState, markAttempt, markChecked, stateSources } from './store.js';

// Runs the daily fetch at 12:00 Asia/Seoul, every day including weekends (docs/price-source.md). When a source
// fails it tries again once an hour until 18:00. A server that was off at 12:00 fetches once when it starts.

const firstHour = 12;
const lastRetryHour = 18;

/** Runs the daily fetch if it is due at `now`. Returns whether it ran. */
export async function runIfDue(pool: Pool, sources: PriceSources, now: Date, log: PriceLog) {
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
  return true;
}

/** Checks every minute whether the fetch is due. Returns a function that stops the timer. */
export function startPriceJobs(pool: Pool, sources: PriceSources, log: PriceLog) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runIfDue(pool, sources, new Date(), log);
    } catch (error) {
      log({
        event: 'price_job_error',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
