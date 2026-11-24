import type { Pool } from 'pg';

import { type BaseRateSource, fakeBaseRateSource } from './prices/benchmark-sources.js';
import { addDays } from './prices/dates.js';
import { ecosBaseRateSource } from './prices/ecos.js';
import { SourceError } from './prices/sources.js';
import { getState, markChecked, markFailed } from './prices/store.js';
import { serviceDate } from './standard/http.js';
import type { JobQueue } from './standard/jobs.js';

// #294 The daily fetch of the Bank of Korea base rate for the deposit comparison. It is a separate job from the
// price fetch so the shared price code stays as it is. It asks from the day after the last checked date to today and
// stores every row it gets; an answer with no rows (the rate did not change) still counts as checked. Running it twice
// in a row does nothing the second time.

const BENCHMARK_QUEUE = 'benchmarks';
export type BenchmarkLog = (event: Record<string, unknown>) => void;

const baseRateState = { source: 'ECOS', scope: 'BASE_RATE' } as const;
/** The first run asks from here, so the rate in effect at any account start is known. */
const firstDate = '2020-01-01';

const key = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);

/** The base rate source from the environment: the fake with PRICE_SOURCE=fake (not in production), ECOS_API_KEY otherwise. */
export function baseRateSourceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BaseRateSource | undefined {
  if (env.PRICE_SOURCE?.trim() === 'fake' && env.NODE_ENV !== 'production') {
    return fakeBaseRateSource();
  }
  const ecos = key(env.ECOS_API_KEY);
  return ecos ? ecosBaseRateSource(ecos) : undefined;
}

/** Fetches the base rate once. `complete` is false when it failed and should be retried in an hour. */
export async function runBaseRateFetch(
  pool: Pool,
  source: BaseRateSource | undefined,
  now: Date,
  log: BenchmarkLog,
) {
  if (!source) {
    log({ event: 'benchmark_source_missing', source: baseRateState.source });
    return { complete: true };
  }
  const today = serviceDate(now);
  try {
    const state = await getState(pool, baseRateState.source, baseRateState.scope);
    const start = state.checkedThrough === null ? firstDate : addDays(state.checkedThrough, 1);
    if (start > today) return { complete: true };
    const rows = await source.rates(start, today);
    for (const row of rows) {
      await pool.query(
        `INSERT INTO base_rates (effective_date, rate_pct, source, fetched_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (effective_date) DO UPDATE SET
           rate_pct = EXCLUDED.rate_pct, source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at`,
        [row.date, row.ratePct, source.name, now],
      );
    }
    await markChecked(pool, baseRateState.source, baseRateState.scope, today, now);
    log({ event: 'benchmark_fetch_run', today, rows: rows.length });
    return { complete: true };
  } catch (error) {
    const message =
      error instanceof SourceError ? error.message : 'Could not get or save the base rate';
    log({ event: 'benchmark_fetch_failed', source: baseRateState.source, message });
    await markFailed(pool, baseRateState.source, baseRateState.scope, message, now).catch(
      () => undefined,
    );
    return { complete: false };
  }
}

/** pg-boss queue: hourly from 12:30 to 18:30 Asia/Seoul (half an hour after the price fetch); the next hour is the retry. */
export function benchmarkQueue(
  pool: Pool,
  source: BaseRateSource | undefined,
  log: BenchmarkLog,
  now: () => Date = () => new Date(),
): JobQueue {
  return {
    name: BENCHMARK_QUEUE,
    policy: 'singleton',
    retryLimit: 0,
    schedule: '30 12-18 * * *',
    handler: async () => {
      await runBaseRateFetch(pool, source, now(), log);
    },
  };
}
