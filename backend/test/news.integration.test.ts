import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { newsQueue } from '../src/news/jobs.js';
import { fakeNewsSource, newsQueries, type NewsSource } from '../src/news/source.js';
import { fetchNews } from '../src/news/store.js';
import { resetDatabase, withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

const url = await testDatabase();

type Item = { title: string; link: string; query: string; fetchedDate: string };

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('news headlines against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  const reset = async () => {
    await resetDatabase(pool);
  };
  const now = new Date('2026-11-24T00:00:00Z'); // 09:00 on 2026-11-24 in Seoul
  const quiet = () => undefined;

  await t.test('stores each query once and skips links it already has', async () => {
    await reset();
    const first = await fetchNews(
      pool,
      fakeNewsSource(() => now),
      now,
      quiet,
    );
    assert.equal(first.failedQueries.length, 0);
    assert.equal(first.inserted, newsQueries.length * 2);
    const again = await fetchNews(
      pool,
      fakeNewsSource(() => now),
      now,
      quiet,
    );
    assert.equal(again.fetched, newsQueries.length * 2);
    assert.equal(again.inserted, 0);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM news_items');
    assert.equal(rows[0].n, newsQueries.length * 2);
  });

  await t.test('deduplicates an article that two queries both return', async () => {
    await reset();
    const same: NewsSource = {
      name: 'SAME',
      search: () =>
        Promise.resolve([
          {
            title: 't',
            summary: '',
            link: 'https://news.example.test/1',
            originalLink: null,
            publisher: null,
            publishedAt: now,
          },
        ]),
    };
    const result = await fetchNews(pool, same, now, quiet);
    assert.equal(result.inserted, 1);
    const { rows } = await pool.query('SELECT query FROM news_items');
    assert.deepEqual(rows, [{ query: newsQueries[0] }]); // keeps the first query that found it
  });

  await t.test('a failing query is logged and the others still store', async () => {
    await reset();
    const base = fakeNewsSource(() => now);
    const flaky: NewsSource = {
      name: 'FLAKY',
      search: (query) =>
        query === '금리' ? Promise.reject(new Error('boom')) : base.search(query),
    };
    const lines: Record<string, unknown>[] = [];
    const result = await fetchNews(pool, flaky, now, (line) => lines.push(line));
    assert.deepEqual(result.failedQueries, ['금리']);
    assert.equal(result.inserted, (newsQueries.length - 1) * 2);
    assert.ok(lines.some((line) => line.event === 'news_fetch_failed' && line.query === '금리'));
    // The job throws so pg-boss retries it.
    const queue = newsQueue(pool, flaky, quiet, () => now);
    await assert.rejects(
      queue.handler({}, { id: '1', queue: 'daily-news', attempt: 1, requestId: null }),
      /금리/,
    );
  });

  await t.test('GET /api/news lists a date; POST /api/news/fetch runs by hand', async () => {
    await reset();
    await withApi(
      pool,
      async (call) => {
        const empty = await call('/api/news?date=2026-11-24');
        assert.equal(empty.status, 200);
        assert.deepEqual(empty.data.items, []);
        const run = await call('/api/news/fetch', { method: 'POST' });
        assert.equal(run.status, 200);
        assert.equal(run.data.inserted, newsQueries.length * 2);
        const listed = await call('/api/news?date=2026-11-24');
        const items = listed.data.items as Item[];
        assert.equal(items.length, newsQueries.length * 2);
        assert.ok(items.every((item) => item.fetchedDate === '2026-11-24'));
        const other = await call('/api/news?date=2026-11-23');
        assert.deepEqual(other.data.items, []);
        const bad = await call('/api/news?date=yesterday');
        assert.equal(bad.status, 400);
      },
      { news: fakeNewsSource(() => now), now: () => now, today: () => '2026-11-24' },
    );
  });

  await t.test('the manual fetch answers 503 without a source', async () => {
    await reset();
    await withApi(pool, async (call) => {
      assert.equal((await call('/api/news/fetch', { method: 'POST' })).status, 503);
    });
  });
});
