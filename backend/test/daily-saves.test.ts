import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { DAILY_SAVES_QUEUE, dailySavesQueue, runDailySaves } from '../src/daily-saves.js';

// #185 The daily job's order and its failures, with fake steps.

const info = { id: 'job-1', queue: DAILY_SAVES_QUEUE, attempt: 1, requestId: null };

function fakeWork(failing: string[] = []) {
  const ran: string[] = [];
  const step = (name: string) => (day: string) => {
    ran.push(`${name} ${day}`);
    return failing.includes(name) ? Promise.reject(new Error(`${name} broke`)) : Promise.resolve();
  };
  return {
    ran,
    work: { fixedCosts: step('fixedCosts'), reports: step('reports'), netWorth: step('netWorth') },
  };
}

test('the queue runs at 00:05 and 19:05 in Seoul, one run at a time, for the service date', async () => {
  const { ran, work } = fakeWork();
  const queue = dailySavesQueue(
    {} as Pool,
    () => '2026-11-22',
    work,
    () => undefined,
  );
  assert.equal(queue.name, 'daily-saves');
  assert.equal(queue.schedule, '5 0,19 * * *');
  assert.equal(queue.policy, 'singleton');
  assert.ok((queue.retryLimit ?? 0) > 0);
  await queue.handler({}, info);
  // Fixed costs first, so the reports count the entries due today.
  assert.deepEqual(ran, ['fixedCosts 2026-11-22', 'reports 2026-11-22', 'netWorth 2026-11-22']);
});

test('a failed fixed-cost step skips the reports, still saves the net worth, and fails the job for a retry', async () => {
  const { ran, work } = fakeWork(['fixedCosts']);
  const logged: Record<string, unknown>[] = [];
  await assert.rejects(
    runDailySaves('2026-11-22', work, (line) => logged.push(line)),
    /Daily saves failed: fixedCosts/,
  );
  assert.deepEqual(ran, ['fixedCosts 2026-11-22', 'netWorth 2026-11-22']);
  assert.deepEqual(
    logged.map(({ level, event, step }) => [level, event, step]),
    [
      ['error', 'daily_save_failed', 'fixedCosts'],
      ['info', 'daily_save_skipped', 'reports'],
    ],
  );
  assert.equal(logged[0].message, 'fixedCosts broke');
});

test('a failed report or net worth step does not stop the other', async () => {
  const reports = fakeWork(['reports']);
  await assert.rejects(
    runDailySaves('2026-11-22', reports.work, () => undefined),
    /Daily saves failed: reports$/,
  );
  assert.equal(reports.ran.length, 3);

  const both = fakeWork(['reports', 'netWorth']);
  await assert.rejects(
    runDailySaves('2026-11-22', both.work, () => undefined),
    /Daily saves failed: reports, netWorth$/,
  );
  assert.equal(both.ran.length, 3);
});
