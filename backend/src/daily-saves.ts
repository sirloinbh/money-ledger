import type { Pool } from 'pg';

import { addDueFixedCosts } from './ledger/fixed-costs.js';
import { generateReports } from './ledger/reports.js';
import { saveNetWorth } from './portfolio/net-worth.js';
import { serviceDate } from './standard/http.js';
import { type JobLog, type JobQueue, logJob } from './standard/jobs.js';

export const DAILY_SAVES_QUEUE = 'daily-saves';

/** What the daily job does, in this order. Each one is safe to run again (#185). */
type DailyWork = {
  /** Adds the fixed-cost entries due by `day` (a month already added is skipped). */
  fixedCosts: (day: string) => Promise<unknown>;
  /** Makes the reports of the weeks and months that ended before `day`, and rebuilds changed ones. */
  reports: (day: string) => Promise<unknown>;
  /** Saves (replaces) the net worth of `day`. */
  netWorth: (day: string) => Promise<unknown>;
};

const realWork = (pool: Pool): DailyWork => ({
  fixedCosts: (day) => addDueFixedCosts(pool, day),
  reports: (day) => generateReports(pool, day),
  netWorth: (day) => saveNetWorth(pool, day),
});

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the day's saves (#185, user decision 2026-11-22: a daily job and the app-open calls both). A failed step is
 * logged and the others still run, except that reports wait for the fixed costs, so a report never misses a due
 * entry (as in the app, #204). Throws at the end when a step failed, so pg-boss runs the job again.
 */
export async function runDailySaves(day: string, work: DailyWork, log: JobLog = logJob) {
  const failed: string[] = [];
  const step = async (name: keyof DailyWork) => {
    try {
      await work[name](day);
      return true;
    } catch (error) {
      failed.push(name);
      log({
        level: 'error',
        event: 'daily_save_failed',
        step: name,
        day,
        message: messageOf(error),
      });
      return false;
    }
  };
  if (await step('fixedCosts')) await step('reports');
  else log({ level: 'info', event: 'daily_save_skipped', step: 'reports', day });
  await step('netWorth');
  if (failed.length > 0) throw new Error(`Daily saves failed: ${failed.join(', ')}`);
}

/**
 * The daily saves as a pg-boss queue, in the style of the price queue (prices/jobs.ts). Cron in Asia/Seoul:
 * 00:05 adds the day's fixed costs and the reports of the period that just ended, and 19:05, after the daily price
 * fetch (12:00–18:00), saves the net worth again with that day's prices. Both runs do all three; each is safe to
 * repeat. `singleton`: one run at a time. The app still calls the same three on open (app.tsx), so a server that
 * was off at those times loses nothing.
 */
export function dailySavesQueue(
  pool: Pool,
  today: () => string = () => serviceDate(),
  work: DailyWork = realWork(pool),
  log: JobLog = logJob,
): JobQueue {
  return {
    name: DAILY_SAVES_QUEUE,
    policy: 'singleton',
    retryLimit: 2,
    retryDelay: 60,
    schedule: '5 0,19 * * *',
    handler: () => runDailySaves(today(), work, log),
  };
}
