import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import {
  KAKAO_DAILY_SUMMARY_QUEUE,
  kakaoDailySummaryQueue,
  sendDailySummary,
} from '../src/kakao/daily-summary.js';
import { fakeMessenger } from '../src/kakao/fake.js';
import { createNotifier } from '../src/kakao/notifier.js';
import { runMigration } from './helpers.js';
import { testDatabase } from './test-database.js';

const url = await testDatabase();

test('the daily KakaoTalk summary against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  const reset = async () => {
    await pool.query(
      'DROP TABLE IF EXISTS mock_snapshots, mock_orders, mock_holdings, mock_accounts',
    );
    await runMigration(pool, '005_mock_accounts.sql');
    await runMigration(pool, '009_prices.sql');
    await runMigration(pool, '015_mock_orders.sql');
  };
  const quiet = () => {
    const lines: Record<string, unknown>[] = [];
    return { lines, log: (line: Record<string, unknown>) => void lines.push(line) };
  };

  await t.test(
    'an open account with no holdings is summarized, with the comparison when given',
    async () => {
      await reset();
      await pool.query(
        'INSERT INTO mock_accounts (initial_cash_krw, cash_krw) VALUES (10000000, 10000000)',
      );
      const messenger = fakeMessenger();
      const notifier = createNotifier(messenger, { log: quiet().log, retryDelayMs: 0 });
      await sendDailySummary(pool, notifier, '2026-11-24', {
        connected: async () => true,
        log: quiet().log,
      });
      assert.equal(
        messenger.sent[0].text,
        'Daily summary\nTotal value: ₩10,000,000\nReturn: 0.00% (₩0)\nCash: ₩10,000,000',
      );

      await sendDailySummary(pool, notifier, '2026-11-24', {
        connected: async () => true,
        comparison: async () => ({
          depositPct: '0.10',
          buffettPct: '0.40',
          renaissancePct: '1.00',
        }),
        log: quiet().log,
      });
      assert.match(
        String(messenger.sent[1].text),
        /Deposit \+0\.10% · Buffett \+0\.40% · Renaissance \+1\.00%/,
      );
    },
  );

  await t.test(
    'without a connection or an open account nothing is sent and no error is raised',
    async () => {
      await reset();
      const messenger = fakeMessenger();
      const notifier = createNotifier(messenger, { log: quiet().log, retryDelayMs: 0 });
      const { lines, log } = quiet();
      await sendDailySummary(pool, notifier, '2026-11-24', { connected: async () => false, log });
      await sendDailySummary(pool, notifier, '2026-11-24', { connected: async () => true, log });
      assert.deepEqual(
        lines.map((line) => line.reason),
        ['not-connected', 'no-account'],
      );
      assert.equal(messenger.sent.length, 0);
    },
  );

  await t.test('a send that fails does not fail the job', async () => {
    await reset();
    await pool.query(
      'INSERT INTO mock_accounts (initial_cash_krw, cash_krw) VALUES (10000000, 10000000)',
    );
    const messenger = fakeMessenger();
    messenger.failures.push(new Error('a'), new Error('b'));
    const { lines, log } = quiet();
    const queue = kakaoDailySummaryQueue(
      pool,
      createNotifier(messenger, { log, retryDelayMs: 0 }),
      { status: async () => ({ configured: true, state: 'connected', connectedAt: null }) },
      () => '2026-11-24',
    );
    assert.equal(queue.name, KAKAO_DAILY_SUMMARY_QUEUE);
    assert.equal(queue.schedule, '10 19 * * 1-5');
    await queue.handler({}, {} as never);
    assert.equal(lines.filter((line) => line.event === 'kakao_notify_failed').length, 1);
  });
});
