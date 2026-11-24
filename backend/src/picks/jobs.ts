import type { Pool } from 'pg';

import type { JobQueue } from '../standard/jobs.js';
import { type PickDeps, runDailyPick } from './run.js';

export const PICK_QUEUE = 'daily-pick';

/** 08:00 Asia/Seoul on weekdays, 30 minutes after the news fetch (#306, #308). */
export const PICK_SCHEDULE = '0 8 * * 1-5';

/**
 * The daily pick as a pg-boss queue (ADR-0018). Re-running is safe: a day has one pick, and a pick whose buy
 * failed is only bought again. A buy that failed throws so pg-boss retries it; "no news yet" and "no valid pick"
 * also throw, since the news fetch may still be retrying.
 */
export function pickQueue(
  pool: Pool,
  deps: PickDeps | undefined,
  now: () => Date = () => new Date(),
): JobQueue {
  return {
    name: PICK_QUEUE,
    policy: 'singleton',
    schedule: PICK_SCHEDULE,
    handler: async () => {
      if (!deps) return;
      const result = await runDailyPick(pool, deps, now());
      deps.log({ event: 'pick_run', ...result });
      if (result.status === 'no_news') throw new Error('No news stored yet for the pick');
      if (result.status === 'no_valid_pick') throw new Error(`No valid pick: ${result.problem}`);
      if ((result.status === 'picked' || result.status === 'already_picked') && result.buyError) {
        throw new Error(`The pick is stored but the buy failed: ${result.buyError}`);
      }
    },
  };
}
