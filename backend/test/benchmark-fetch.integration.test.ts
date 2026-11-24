// Importing the app sets the pg type parsers (dates as text, bigint as number) the server runs with.
import '../src/app.js';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { benchmarkQueue, runBaseRateFetch } from '../src/benchmark-fetch.js';
import type { BaseRateSource } from '../src/prices/benchmark-sources.js';
import { SourceError } from '../src/prices/sources.js';
import { testDatabase } from './test-database.js';

// #294 The daily base rate fetch. #184: this file's own copy of the test DB (skipped without one).
const url = await testDatabase();
// 2026-11-24 12:30 in Seoul.
const now = new Date('2026-11-24T03:30:00Z');
const quiet = () => undefined;

function counted(rows: { date: string; ratePct: string }[]) {
  const calls: string[] = [];
  const source: BaseRateSource = {
    name: 'TEST',
    rates: (start, end) => {
      calls.push(`${start} ${end}`);
      return Promise.resolve(rows);
    },
  };
  return { source, calls };
}

test('base rate fetch against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  const reset = () =>
    pool.query("TRUNCATE base_rates; DELETE FROM price_fetch_state WHERE source = 'ECOS'");

  await t.test(
    'the first run asks from 2020 and stores the rows; the second run asks nothing',
    async () => {
      await reset();
      const { source, calls } = counted([
        { date: '2025-05-29', ratePct: '2.5' },
        { date: '2025-11-27', ratePct: '2.25' },
      ]);
      assert.deepEqual(await runBaseRateFetch(pool, source, now, quiet), { complete: true });
      assert.deepEqual(calls, ['2020-01-01 2026-11-24']);
      const { rows } = await pool.query(
        'SELECT effective_date::text AS d, rate_pct::text AS r FROM base_rates ORDER BY 1',
      );
      assert.deepEqual(rows, [
        { d: '2025-05-29', r: '2.5000' },
        { d: '2025-11-27', r: '2.2500' },
      ]);
      await runBaseRateFetch(pool, source, now, quiet);
      assert.equal(calls.length, 1);
      // The next day asks only from the day after the last checked day.
      await runBaseRateFetch(pool, source, new Date('2026-11-25T03:30:00Z'), quiet);
      assert.deepEqual(calls[1], '2026-11-25 2026-11-25');
    },
  );

  await t.test(
    'an answer with no rows still counts as checked; a re-sent day is replaced',
    async () => {
      await reset();
      await runBaseRateFetch(
        pool,
        counted([{ date: '2026-11-01', ratePct: '3' }]).source,
        now,
        quiet,
      );
      const next = new Date('2026-11-25T03:30:00Z');
      const empty = counted([]);
      await runBaseRateFetch(pool, empty.source, next, quiet);
      await runBaseRateFetch(pool, empty.source, next, quiet);
      assert.equal(empty.calls.length, 1);
      await pool.query("DELETE FROM price_fetch_state WHERE source = 'ECOS'");
      await runBaseRateFetch(
        pool,
        counted([{ date: '2026-11-01', ratePct: '3.25' }]).source,
        now,
        quiet,
      );
      const { rows } = await pool.query('SELECT rate_pct::text AS r FROM base_rates');
      assert.deepEqual(rows, [{ r: '3.2500' }]);
    },
  );

  await t.test(
    'a failure is logged and recorded, the dates stay unchecked, and nothing is stored',
    async () => {
      await reset();
      const events: Record<string, unknown>[] = [];
      const failing: BaseRateSource = {
        name: 'TEST',
        rates: () => Promise.reject(new SourceError('ECOS base rate response error (HTTP 500)')),
      };
      assert.deepEqual(await runBaseRateFetch(pool, failing, now, (event) => events.push(event)), {
        complete: false,
      });
      assert.equal(events[0].event, 'benchmark_fetch_failed');
      const state = await pool.query(
        "SELECT checked_through, last_error FROM price_fetch_state WHERE source = 'ECOS'",
      );
      assert.equal(state.rows[0].checked_through, null);
      assert.equal(state.rows[0].last_error, 'ECOS base rate response error (HTTP 500)');
      assert.equal((await pool.query('SELECT 1 FROM base_rates')).rowCount, 0);
    },
  );

  await t.test('without a source nothing is asked and the job is not a failure', async () => {
    await reset();
    const events: Record<string, unknown>[] = [];
    assert.deepEqual(await runBaseRateFetch(pool, undefined, now, (event) => events.push(event)), {
      complete: true,
    });
    assert.equal(events[0].event, 'benchmark_source_missing');
  });

  await t.test('the queue is a singleton with the hourly schedule after the price fetch', () => {
    const queue = benchmarkQueue(pool, undefined, quiet);
    assert.deepEqual(
      [queue.name, queue.policy, queue.schedule],
      ['benchmarks', 'singleton', '30 12-18 * * *'],
    );
  });
});
