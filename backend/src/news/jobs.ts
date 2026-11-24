import type { Pool } from 'pg';

import type { JobQueue } from '../standard/jobs.js';
import type { NewsSource } from './source.js';
import { fetchNews, type NewsLog } from './store.js';

export const NEWS_QUEUE = 'daily-news';

/** 07:30 Asia/Seoul on weekdays (#306). A weekday holiday just stores few or no new items: a link is stored once. */
export const NEWS_SCHEDULE = '30 7 * * 1-5';

/**
 * The daily news fetch as a pg-boss queue (ADR-0018). Storing is idempotent (unique link), so a repeated job is
 * harmless. A run where any query failed throws, so pg-boss retries it.
 */
export function newsQueue(
  pool: Pool,
  source: NewsSource | undefined,
  log: NewsLog,
  now: () => Date = () => new Date(),
): JobQueue {
  return {
    name: NEWS_QUEUE,
    policy: 'singleton',
    schedule: NEWS_SCHEDULE,
    handler: async () => {
      if (!source) {
        log({ event: 'news_fetch_skipped', message: 'No news source is configured' });
        return;
      }
      const result = await fetchNews(pool, source, now(), log);
      if (result.failedQueries.length > 0) {
        throw new Error(`News fetch failed for: ${result.failedQueries.join(', ')}`);
      }
    },
  };
}
