import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RequestHandler } from 'express';
import { Pool } from 'pg';

import { createApp } from '../src/app.js';
import { backgroundJobs, shutdownOnce } from '../src/runtime.js';
import { createPool } from '../src/standard/db.js';
import type { JobBoss, Jobs } from '../src/standard/jobs.js';
import { listen } from './helpers.js';

// #178: the API keeps running when the database or the job runner fails. Fakes stand in for pg and pg-boss.
const okPool = { query: async () => ({ rows: [] }) } as unknown as Pool;
const rejectAll: RequestHandler = (_req, res) => {
  res.status(401).json({ error: 'unauthorized' });
};

async function serve(
  options: Parameters<typeof createApp>[1],
  run: (base: string) => Promise<void>,
) {
  const { server, port } = await listen(createApp(okPool, options));
  try {
    await run(`http://127.0.0.1:${port}/api`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const idleBoss = { stop: () => assert.fail('a started boss is not stopped by start()') };

function fakeJobs(overrides: Partial<Jobs> = {}): Jobs {
  const boss = {
    getQueues: async () => [],
    getSchedules: async () => [],
  } as unknown as JobBoss;
  return { boss, send: async () => 'job-1', stop: async () => {}, ...overrides };
}

test('/api/health answers 200 even when the sign-in rejects every request', async () => {
  await serve({ auth: rejectAll, today: () => '2026-11-22' }, async (base) => {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      service: 'money-ledger',
      today: '2026-11-22',
    });
    assert.equal((await fetch(`${base}/me`)).status, 401);
    assert.equal((await fetch(`${base}/ledger/categories`)).status, 401);
  });
});

test('when the job runner fails to start, the failure is logged and the API still serves', async () => {
  const logged: Record<string, unknown>[] = [];
  const jobs = backgroundJobs('all', (line) => logged.push(line));
  await serve({ jobsStatus: jobs.status }, async (base) => {
    // The API is already listening here, before the jobs start (server.ts order).
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const before = await fetch(`${base}/jobs/status`);
    assert.equal(before.status, 503);
    assert.deepEqual(await before.json(), { error: 'Background jobs are still starting' });

    let sent = false;
    const stops: unknown[] = [];
    const boss = {
      stop: async (options?: unknown) => {
        stops.push(options);
      },
    };
    await jobs.start(
      boss,
      () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432')),
      async () => {
        sent = true;
      },
    );
    assert.equal(jobs.state(), 'failed');
    assert.equal(sent, false, 'nothing is sent when the start failed');
    // A boss that started before the failure (e.g. a queue policy mismatch) is stopped, not left running.
    assert.deepEqual(stops, [{ graceful: false }]);
    assert.deepEqual(logged, [
      {
        level: 'error',
        event: 'jobs_start_failed',
        message: 'connect ECONNREFUSED 127.0.0.1:5432',
      },
    ]);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const status = await fetch(`${base}/jobs/status`);
    assert.equal(status.status, 503);
    assert.deepEqual(await status.json(), {
      error: 'Background jobs failed to start; see the server log',
    });
  });
});

test('with jobs off the status route says so instead of answering 500', async () => {
  const jobs = backgroundJobs('off', () => assert.fail('nothing to log'));
  let opened = false;
  await jobs.start(idleBoss, async () => {
    opened = true;
    return fakeJobs();
  });
  assert.equal(opened, false);
  await serve({ jobsStatus: jobs.status }, async (base) => {
    const status = await fetch(`${base}/jobs/status`);
    assert.equal(status.status, 503);
    assert.deepEqual(await status.json(), { error: 'Background jobs are off on this server' });
  });
});

test('running jobs answer the shared status view; a failed first send is only logged', async () => {
  const logged: Record<string, unknown>[] = [];
  const jobs = backgroundJobs('all', (line) => logged.push(line));
  await jobs.start(
    idleBoss,
    async () => fakeJobs(),
    () => Promise.reject(new Error('queue is busy')),
  );
  assert.equal(jobs.state(), 'running');
  assert.deepEqual(logged, [
    { level: 'error', event: 'jobs_after_start_failed', message: 'queue is busy' },
  ]);
  await serve({ jobsStatus: jobs.status }, async (base) => {
    const status = await fetch(`${base}/jobs/status`);
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), {
      queues: [],
      recent: {},
      failed: [],
      deadLetter: [],
      schedules: [],
    });
  });
});

test('shutdown waits for a pending start, survives a failing jobs.stop, and runs once', async () => {
  const steps: string[] = [];
  const logged: Record<string, unknown>[] = [];
  const log = (line: Record<string, unknown>) => logged.push(line);
  const jobs = backgroundJobs('all', log);
  let finishStart: (value: Jobs) => void = () => {};
  void jobs.start(
    idleBoss,
    () =>
      new Promise<Jobs>((resolve) => {
        finishStart = resolve;
      }),
  );
  const server = {
    close(callback: () => void) {
      steps.push('server.close');
      callback();
    },
  };
  const pool = {
    end: async () => {
      steps.push('pool.end');
    },
  };
  const shutdown = shutdownOnce(server, jobs, pool, log);
  const first = shutdown();
  const second = shutdown();
  assert.equal(first, second, 'a second SIGINT/SIGTERM reuses the first shutdown');
  // The start finishes after the signal: its jobs are still stopped before the pool ends.
  finishStart(
    fakeJobs({
      stop: async () => {
        steps.push('jobs.stop');
        throw new Error('stop timed out');
      },
    }),
  );
  await first;
  assert.deepEqual(steps, ['server.close', 'jobs.stop', 'pool.end']);
  assert.deepEqual(logged, [
    { level: 'error', event: 'jobs_stop_failed', message: 'stop timed out' },
  ]);
});

test('the server pool (createPool) survives an idle-client error instead of crashing the process', () => {
  const pool = createPool(new Pool({ connectionString: 'postgres://unused@127.0.0.1:1/none' }));
  // Without a listener, emitting 'error' throws (and in the server, ends the process).
  assert.doesNotThrow(() =>
    pool.emit('error', new Error('terminating connection due to administrator command')),
  );
});
