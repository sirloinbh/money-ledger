import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import type { ClaudeClient } from '../src/picks/claude.js';
import { pickQueue } from '../src/picks/jobs.js';
import { type PickDeps, runDailyPick } from '../src/picks/run.js';
import { runMigration, withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

const url = await testDatabase();

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('the daily pick against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  const now = new Date('2026-11-23T23:00:00Z'); // 08:00 on 2026-11-24 in Seoul
  const day = '2026-11-24';

  const reset = async () => {
    await pool.query('DROP TABLE IF EXISTS daily_picks, news_items');
    await runMigration(pool, '028_news_items.sql');
    await runMigration(pool, '042_daily_picks.sql');
    await runMigration(pool, '042_daily_picks.sql'); // re-running is safe
    await pool.query('TRUNCATE securities RESTART IDENTITY CASCADE');
    await pool.query(
      `INSERT INTO securities (market, symbol, name, kind, currency, active) VALUES
       ('KOSPI', '005930', '삼성전자', 'stock', 'KRW', true),
       ('KOSPI', '000660', 'SK하이닉스', 'stock', 'KRW', false),
       ('NASDAQ', 'AAPL', 'Apple Inc', 'stock', 'USD', true)`,
    );
    await pool.query(
      `INSERT INTO news_items (link, title, summary, published_at, query, fetched_date) VALUES
       ('https://n.test/1', '반도체 수출 급증', '', now(), '반도체', $1),
       ('https://n.test/2', '금리 동결', '', now(), '금리', $1),
       ('https://n.test/old', '어제 뉴스', '', now(), '경제', '2026-11-23')`,
      [day],
    );
  };
  const newsIds = async () =>
    (
      await pool.query<{ id: number }>(
        'SELECT id FROM news_items WHERE fetched_date = $1 ORDER BY id',
        [day],
      )
    ).rows.map((row) => row.id);

  const answerFor = (ids: number[], stockCode: string) =>
    JSON.stringify({
      newsIds: ids,
      storyTitle: '이야기',
      storySummary: '요약',
      economicEffect: '영향',
      reasoning: '근거',
      stockCode,
    });
  /** A Claude client that answers with the given texts in order and records every prompt it was sent. */
  const scripted = (texts: string[]) => {
    const prompts: string[] = [];
    const client: ClaudeClient = {
      complete: ({ user }) => {
        prompts.push(user);
        const text = texts[Math.min(prompts.length, texts.length) - 1];
        return Promise.resolve({
          text,
          model: 'claude-opus-5-5',
          raw: { content: [{ type: 'text', text }] },
        });
      },
    };
    return { client, prompts };
  };
  const deps = (client: ClaudeClient, extra: Partial<PickDeps> = {}) => {
    const buys: { pickId: number; securityId: number; day: string }[] = [];
    const value: PickDeps = {
      claude: client,
      hasOpenPosition: () => Promise.resolve(false),
      buy: (pick) => {
        buys.push(pick);
        return Promise.resolve(500 + buys.length);
      },
      log: () => undefined,
      ...extra,
    };
    return { value, buys };
  };

  await t.test(
    'stores the pick with its news and security, buys, and links the order',
    async () => {
      await reset();
      const ids = await newsIds();
      const { client, prompts } = scripted([answerFor(ids, '005930')]);
      const { value, buys } = deps(client);
      const result = await runDailyPick(pool, value, now);
      assert.equal(result.status, 'picked');
      assert.equal(prompts.length, 1);
      assert.ok(!prompts[0].includes('어제 뉴스')); // only the day's headlines
      assert.equal(buys.length, 1);
      const { rows } = await pool.query(
        'SELECT p.*, s.symbol FROM daily_picks p JOIN securities s ON s.id = p.security_id',
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].symbol, '005930');
      assert.deepEqual(rows[0].news_item_ids.map(Number), ids);
      assert.equal(rows[0].pick_date, day);
      assert.equal(rows[0].model, 'claude-opus-5-5');
      assert.equal(Number(rows[0].order_id), 501);
      assert.equal(buys[0].pickId, Number(rows[0].id));
    },
  );

  await t.test(
    'an unknown or inactive code is rejected once with the reason, then the retry is used',
    async () => {
      await reset();
      const ids = await newsIds();
      const { client, prompts } = scripted([answerFor(ids, '999999'), answerFor(ids, '005930')]);
      const { value } = deps(client);
      assert.equal((await runDailyPick(pool, value, now)).status, 'picked');
      assert.equal(prompts.length, 2);
      assert.match(prompts[1], /999999 is not an active Korean stock code/);
    },
  );

  await t.test(
    'an inactive security, a US ticker, and unknown news ids are all rejected; two failures store nothing',
    async () => {
      await reset();
      const ids = await newsIds();
      const { client, prompts } = scripted([answerFor(ids, '000660'), answerFor([9999], '005930')]);
      const { value, buys } = deps(client);
      const result = await runDailyPick(pool, value, now);
      assert.equal(result.status, 'no_valid_pick');
      assert.equal(prompts.length, 2); // retries once, not more
      assert.match(prompts[1], /000660 is not an active Korean stock code/);
      assert.equal(buys.length, 0);
      assert.equal((await pool.query('SELECT 1 FROM daily_picks')).rowCount, 0);
      const us = scripted([answerFor(ids, 'AAPL')]);
      assert.equal((await runDailyPick(pool, deps(us.client).value, now)).status, 'no_valid_pick');
    },
  );

  await t.test('an answer that is not JSON is retried too', async () => {
    await reset();
    const ids = await newsIds();
    const { client, prompts } = scripted(['sorry', answerFor(ids, '005930')]);
    assert.equal((await runDailyPick(pool, deps(client).value, now)).status, 'picked');
    assert.match(prompts[1], /not valid JSON/);
  });

  await t.test('skips while a v2 position is open, and with no news says so', async () => {
    await reset();
    const ids = await newsIds();
    const { client, prompts } = scripted([answerFor(ids, '005930')]);
    const open = deps(client, { hasOpenPosition: () => Promise.resolve(true) });
    assert.equal((await runDailyPick(pool, open.value, now)).status, 'skipped_open_position');
    assert.equal(prompts.length, 0); // Claude is not even called
    await pool.query('DELETE FROM news_items');
    assert.equal((await runDailyPick(pool, deps(client).value, now)).status, 'no_news');
    assert.equal(prompts.length, 0);
  });

  await t.test('a second run the same day makes no second pick or buy', async () => {
    await reset();
    const ids = await newsIds();
    const { client, prompts } = scripted([answerFor(ids, '005930')]);
    const { value, buys } = deps(client);
    await runDailyPick(pool, value, now);
    const again = await runDailyPick(pool, value, now);
    assert.equal(again.status, 'already_picked');
    assert.equal(prompts.length, 1);
    assert.equal(buys.length, 1);
  });

  await t.test(
    'a failed buy keeps the pick; the next run buys it without asking Claude again',
    async () => {
      await reset();
      const ids = await newsIds();
      const { client, prompts } = scripted([answerFor(ids, '005930')]);
      let fail = true;
      const { value, buys } = deps(client, {
        buy: (pick) => {
          buys.push(pick);
          return fail ? Promise.reject(new Error('not enough cash')) : Promise.resolve(77);
        },
      });
      const first = await runDailyPick(pool, value, now);
      assert.deepEqual(first.status === 'picked' && first.buyError, 'not enough cash');
      assert.equal((await pool.query('SELECT order_id FROM daily_picks')).rows[0].order_id, null);
      // The job fails so pg-boss retries it.
      const queue = pickQueue(pool, value, () => now);
      fail = true;
      await assert.rejects(
        queue.handler({}, { id: '1', queue: 'daily-pick', attempt: 1, requestId: null }),
        /buy failed/,
      );
      fail = false;
      const again = await runDailyPick(pool, value, now);
      assert.equal(again.status === 'already_picked' && again.orderId, 77);
      assert.equal(prompts.length, 1);
      assert.equal(
        Number((await pool.query('SELECT order_id FROM daily_picks')).rows[0].order_id),
        77,
      );
    },
  );

  await t.test(
    'GET /api/picks shows the pick with its news; POST /api/picks/run runs by hand',
    async () => {
      await reset();
      const ids = await newsIds();
      const { client } = scripted([answerFor([ids[0]], '005930')]);
      const { value } = deps(client);
      await withApi(
        pool,
        async (call) => {
          const none = await call(`/api/picks?date=${day}`);
          assert.equal(none.status, 200);
          assert.equal(none.data.pick, null);
          const run = await call('/api/picks/run', { method: 'POST' });
          assert.equal(run.status, 200);
          assert.equal(run.data.status, 'picked');
          const got = await call(`/api/picks?date=${day}`);
          const pick = got.data.pick as {
            storyTitle: string;
            orderId: number;
            security: { symbol: string };
            news: { title: string }[];
          };
          assert.equal(pick.storyTitle, '이야기');
          assert.equal(pick.orderId, 501);
          assert.equal(pick.security.symbol, '005930');
          assert.deepEqual(
            pick.news.map((item) => item.title),
            ['반도체 수출 급증'],
          );
          assert.equal((await call('/api/picks?date=today')).status, 400);
        },
        { pick: value, now: () => now, today: () => day },
      );
    },
  );

  await t.test('the manual run answers 503 without a Claude client', async () => {
    await reset();
    await withApi(pool, async (call) => {
      assert.equal((await call('/api/picks/run', { method: 'POST' })).status, 503);
    });
  });
});
