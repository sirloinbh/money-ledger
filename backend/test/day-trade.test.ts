import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { dayTradeQueue, runDayTradeCheck } from '../src/mock/day-trade.js';

// #309 The window and trading-day guards answer before the database or KIS is touched: a pool and a source that
// fail the test if anything reaches them.
const reached = () => {
  throw new Error('the check should have stopped before the DB');
};
const noDb = { query: reached, connect: reached } as unknown as Pool;
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+09:00`);

test('only 09:00 to 15:20 KST counts, both ends included', async () => {
  for (const time of ['00:00', '08:59', '15:21', '15:59', '23:59']) {
    const run = await runDayTradeCheck(noDb, undefined, at('2026-11-24', time), () => '2026-11-24');
    assert.equal(run.skipped, 'outside_hours', time);
  }
  // 09:00 and 15:20 get past the window, so they reach the database.
  for (const time of ['09:00', '15:20']) {
    await assert.rejects(
      runDayTradeCheck(noDb, undefined, at('2026-11-24', time), () => '2026-11-24'),
      /should have stopped/,
      time,
    );
  }
});

test('weekends and calendar holidays are skipped', async () => {
  for (const date of ['2026-11-28', '2026-11-29']) {
    const run = await runDayTradeCheck(noDb, undefined, at(date, '10:00'), () => date);
    assert.equal(run.skipped, 'not_trading_day', date);
  }
  const holiday = await runDayTradeCheck(
    noDb,
    undefined,
    at('2026-12-25', '10:00'),
    () => '2026-12-25',
    {
      isTradingDay: (date) => date !== '2026-12-25',
    },
  );
  assert.equal(holiday.skipped, 'not_trading_day');
});

test('the queue runs every minute in market hours on weekdays, one run at a time', () => {
  const queue = dayTradeQueue(noDb, undefined, () => '2026-11-24');
  assert.equal(queue.schedule, '* 9-15 * * 1-5');
  assert.equal(queue.policy, 'singleton');
  assert.equal(queue.retryLimit, 0);
});
