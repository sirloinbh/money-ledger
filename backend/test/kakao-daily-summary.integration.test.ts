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
import { resetDatabase } from './helpers.js';
import { testDatabase } from './test-database.js';

const url = await testDatabase();

test('the daily KakaoTalk summary against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  const reset = async () => {
    await resetDatabase(pool);
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

  await t.test(
    'holdings are valued at the live price, the last close, or cost, and never skip the summary',
    async () => {
      await reset();
      await pool.query('DELETE FROM security_prices');
      await pool.query('DELETE FROM securities');
      const added = await pool.query<{ id: number }>(
        `INSERT INTO securities (market, symbol, name, kind, currency) VALUES
         ('KOSPI', '005930', 'Samsung', 'stock', 'KRW'),
         ('KOSPI', '000660', 'SK hynix', 'stock', 'KRW'),
         ('KOSDAQ', '035720', 'No price', 'stock', 'KRW') RETURNING id`,
      );
      const [samsung, hynix, bare] = added.rows.map((row) => row.id);
      await pool.query(
        'INSERT INTO mock_accounts (initial_cash_krw, cash_krw) VALUES (10000000, 8000000)',
      );
      await pool.query(
        `INSERT INTO mock_holdings (account_id, security_id, quantity, cost_krw) VALUES
         (1, $1, 10, 700000), (1, $2, 5, 800000), (1, $3, 2, 200000)`,
        [samsung, hynix, bare],
      );
      // Only a close of an earlier day is stored: the day's own close comes the next morning.
      await pool.query(
        `INSERT INTO security_prices (security_id, trade_date, close, currency, source)
       VALUES ($1, '2026-11-23', 150000, 'KRW', 'test'), ($2, '2026-11-23', 70000, 'KRW', 'test')`,
        [hynix, samsung],
      );
      const messenger = fakeMessenger();
      const notifier = createNotifier(messenger, {
        link: 'https://app',
        log: quiet().log,
        retryDelayMs: 0,
      });
      const asked: string[] = [];
      // Samsung answers live; SK hynix cannot (market closed); the third has no close either.
      const livePrice = async (symbol: string) => {
        asked.push(symbol);
        if (symbol === '005930') return '71500';
        throw new Error('market closed');
      };
      await sendDailySummary(pool, notifier, '2026-11-24', {
        connected: async () => true,
        livePrice,
        log: quiet().log,
      });
      assert.deepEqual(asked.sort(), ['000660', '005930', '035720']);
      // 8,000,000 cash + Samsung 10 x 71,500 live + SK hynix 5 x 150,000 close + 200,000 cost
      assert.equal(
        messenger.sent[0].text,
        'Daily summary\nTotal value: ₩9,665,000\nReturn: -3.35% (-₩335,000)\nCash: ₩8,000,000\nPrices: 1 live, 1 last close, 1 at cost',
      );

      // Without a live source everything falls back to the stored close, or cost.
      await sendDailySummary(pool, notifier, '2026-11-24', {
        connected: async () => true,
        log: quiet().log,
      });
      assert.match(String(messenger.sent[1].text), /Total value: ₩9,650,000/);
      assert.match(String(messenger.sent[1].text), /Prices: 2 last close, 1 at cost/);
    },
  );
});
