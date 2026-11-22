import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RequestHandler } from 'express';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';

import { createApp } from '../src/app.js';
import { fakeSources } from '../src/prices/fake.js';
import { PRICE_QUEUE, priceQueue } from '../src/prices/jobs.js';
import { jobBossOptions, jobsStatus, startJobs } from '../src/standard/jobs.js';
import { listen } from './helpers.js';
import { testDatabase } from './test-database.js';

// #184 This file's own copy of the test DB (undefined without TEST_DATABASE_URL: the DB tests are skipped).
const url = await testDatabase();

// Real pg-boss on the test DB (schema pgboss): the queue starts, a sent job is worked, and the status route
// answers only behind the sign-in.
test(
  'pg-boss runs the price queue and the status route needs the sign-in (#556)',
  { skip: url ? false : 'TEST_DATABASE_URL is not set' },
  async () => {
    const pool = new Pool({ connectionString: url });
    const logged: Record<string, unknown>[] = [];
    const ran: Date[] = [];
    const queue = priceQueue(
      pool,
      fakeSources(),
      () => undefined,
      (now) => {
        ran.push(now);
        return Promise.resolve();
      },
      () => new Date('2026-11-09T03:00:00Z'), // 12:00 in Seoul: due
    );
    const jobs = await startJobs(new PgBoss(jobBossOptions(url!)), [queue], {
      log: (line) => logged.push(line),
    });
    try {
      await pool.query('DELETE FROM price_fetch_state');
      const id = await jobs.send(PRICE_QUEUE, {}, { key: 'test' });
      assert.ok(id);
      for (let i = 0; i < 100 && ran.length === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(ran.length, 1);
      const requireSignIn: RequestHandler = (req, res, next) => {
        if (req.header('x-test-user')) next();
        else res.status(401).json({ error: 'Sign in required' });
      };
      const app = createApp(pool, { auth: requireSignIn, jobsStatus: jobsStatus(jobs.boss) });
      const { server, port } = await listen(app);
      try {
        const base = `http://127.0.0.1:${port}/api/jobs/status`;
        assert.equal((await fetch(base)).status, 401);
        const signedIn = await fetch(base, { headers: { 'x-test-user': '1' } });
        assert.equal(signedIn.status, 200);
        const body = (await signedIn.json()) as {
          queues: { name: string; policy: string }[];
          schedules: { name: string; cron: string; timezone: string }[];
        };
        const price = body.queues.find((q) => q.name === PRICE_QUEUE);
        assert.equal(price?.policy, 'singleton');
        assert.deepEqual(
          body.schedules.map(({ name, cron, timezone }) => ({ name, cron, timezone })),
          [{ name: PRICE_QUEUE, cron: '0 12-18 * * *', timezone: 'Asia/Seoul' }],
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      await jobs.stop();
      await pool.end();
    }
  },
);
