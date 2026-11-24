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
      const notifier = createNotifier(messenger, {
        link: 'https://app',
        log: quiet().log,
        retryDelayMs: 0,
      });
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
      const notifier = createNotifier(messenger, {
        link: 'https://app',
        log: quiet().log,
        retryDelayMs: 0,
      });
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
      createNotifier(messenger, { link: 'https://app', log, retryDelayMs: 0 }),
      { status: async () => ({ configured: true, state: 'connected', connectedAt: null }) },
      () => '2026-11-24',
    );
    assert.equal(queue.name, KAKAO_DAILY_SUMMARY_QUEUE);
    assert.equal(queue.schedule, '10 19 * * 1-5');
    await assert.doesNotReject(queue.handler({}, {} as never));
    assert.equal(lines.filter((line) => line.event === 'kakao_notify_failed').length, 1);
    assert.equal(messenger.sent.length, 0);
  });

  await t.test('a holding without a close for the day skips the summary', async () => {
    await reset();
    await pool.query('DELETE FROM security_prices');
    await pool.query('DELETE FROM securities');
    const { rows } = await pool.query(
      "INSERT INTO securities (market, symbol, name, kind, currency) VALUES ('KOSPI', '005930', 'Samsung', 'stock', 'KRW') RETURNING id",
    );
    await pool.query(
      'INSERT INTO mock_accounts (initial_cash_krw, cash_krw) VALUES (10000000, 9000000)',
    );
    await pool.query(
      'INSERT INTO mock_holdings (account_id, security_id, quantity, cost_krw) VALUES (1, $1, 10, 1000000)',
      [rows[0].id],
    );
    const messenger = fakeMessenger();
    const notifier = createNotifier(messenger, {
      link: 'https://app',
      log: quiet().log,
      retryDelayMs: 0,
    });
    const { lines, log } = quiet();
    const options = { connected: async () => true, log };
    // No close at all: the total is unknown.
    await sendDailySummary(pool, notifier, '2026-11-24', options);
    // A close from an earlier day: the value would look current but is not.
    await pool.query(
      "INSERT INTO security_prices (security_id, trade_date, close, currency, source) VALUES ($1, '2026-11-20', 80000, 'KRW', 'test')",
      [rows[0].id],
    );
    await sendDailySummary(pool, notifier, '2026-11-24', options);
    assert.deepEqual(
      lines.map((line) => line.reason),
      ['no-valuation', 'stale-prices'],
    );
    // Today's close: sent.
    await pool.query(
      "INSERT INTO security_prices (security_id, trade_date, close, currency, source) VALUES ($1, '2026-11-24', 81000, 'KRW', 'test')",
      [rows[0].id],
    );
    await sendDailySummary(pool, notifier, '2026-11-24', options);
    assert.match(String(messenger.sent[0].text), /Total value: ₩9,810,000/);
  });
});
