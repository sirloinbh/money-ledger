import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { fakeMessenger } from '../src/kakao/fake.js';
import { createNotifier } from '../src/kakao/notifier.js';
import {
  BUDGET_ALERT_QUEUE,
  budgetAlertQueue,
  sendBudgetAlerts,
} from '../src/ledger/budget-alert.js';
import { resetDatabase } from './helpers.js';
import { testDatabase } from './test-database.js';

const url = await testDatabase();

// #299 Needs the test DB; skipped (not passed) without it.
test('budget overrun alerts against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  const log = () => undefined;
  const setup = async () => {
    await resetDatabase(pool);
    const { rows } = await pool.query<{ id: number; name: string }>(
      "SELECT id, name FROM ledger_categories WHERE kind = 'expense' ORDER BY id LIMIT 2",
    );
    const messenger = fakeMessenger();
    const notifier = createNotifier(messenger, { link: 'https://app', log, retryDelayMs: 0 });
    return { food: rows[0], other: rows[1], messenger, notifier };
  };
  const budget = (id: number, month: string, amount: number) =>
    pool.query('INSERT INTO ledger_budgets (category_id, month, amount) VALUES ($1, $2, $3)', [
      id,
      month,
      amount,
    ]);
  const spend = (id: number, date: string, amount: number) =>
    pool.query(
      "INSERT INTO ledger_entries (entry_date, kind, amount, category_id) VALUES ($1, 'expense', $2, $3)",
      [date, amount, id],
    );
  const run = (notifier: ReturnType<typeof createNotifier>, day: string, connected = true) =>
    sendBudgetAlerts(pool, notifier, day, { connected: async () => connected, log });

  await t.test('spending below the budget sends nothing', async () => {
    const { food, messenger, notifier } = await setup();
    await budget(food.id, '2026-11-01', 100000);
    await spend(food.id, '2026-11-03', 99999);
    assert.equal(await run(notifier, '2026-11-20'), 0);
    assert.equal(messenger.sent.length, 0);
  });

  await t.test(
    'reaching the budget alerts once, and crossing it later does not alert again',
    async () => {
      const { food, messenger, notifier } = await setup();
      await budget(food.id, '2026-11-01', 100000);
      await spend(food.id, '2026-11-03', 100000);
      assert.equal(await run(notifier, '2026-11-20'), 1);
      assert.match(String(messenger.sent[0].text), /^Budget reached: /);
      assert.match(String(messenger.sent[0].text), /spent ₩100,000 of ₩100,000 \(100\.0%\)/);

      await spend(food.id, '2026-11-21', 20000);
      assert.equal(await run(notifier, '2026-11-22'), 0);
      assert.equal(await run(notifier, '2026-11-22'), 0);
      assert.equal(messenger.sent.length, 1);
    },
  );

  await t.test('going over the budget says by how much, per category', async () => {
    const { food, other, messenger, notifier } = await setup();
    await budget(food.id, '2026-11-01', 100000);
    await budget(other.id, '2026-11-01', 50000);
    await spend(food.id, '2026-11-03', 112500);
    await spend(other.id, '2026-11-04', 1000);
    assert.equal(await run(notifier, '2026-11-20'), 1);
    const text = String(messenger.sent[0].text);
    assert.ok(text.startsWith(`Budget exceeded: ${food.name}`));
    assert.match(text, /\(112\.5%\)\nOver by ₩12,500$/);
  });

  await t.test('the next month alerts again, and a month without a budget does not', async () => {
    const { food, messenger, notifier } = await setup();
    await budget(food.id, '2026-11-01', 100000);
    await spend(food.id, '2026-11-03', 100000);
    await spend(food.id, '2026-12-03', 100000);
    await run(notifier, '2026-11-20');
    assert.equal(await run(notifier, '2026-12-05'), 1);
    assert.equal(messenger.sent.length, 2);
    await budget(food.id, '2027-01-01', 0);
    await spend(food.id, '2027-01-03', 999999);
    assert.equal(await run(notifier, '2027-01-10'), 0);
  });

  await t.test(
    'without a connection nothing is claimed, so the alert goes out once connected',
    async () => {
      const { food, messenger, notifier } = await setup();
      await budget(food.id, '2026-11-01', 100000);
      await spend(food.id, '2026-11-03', 150000);
      assert.equal(await run(notifier, '2026-11-20', false), 0);
      assert.equal(messenger.sent.length, 0);
      assert.equal(await run(notifier, '2026-11-20'), 1);
    },
  );

  await t.test('two runs at the same time send one alert', async () => {
    const { food, messenger, notifier } = await setup();
    await budget(food.id, '2026-11-01', 100000);
    await spend(food.id, '2026-11-03', 150000);
    await Promise.all([run(notifier, '2026-11-20'), run(notifier, '2026-11-20')]);
    assert.equal(messenger.sent.length, 1);
  });

  await t.test('the queue runs the check when connected and skips it when not', async () => {
    const { food, messenger, notifier } = await setup();
    await budget(food.id, '2026-11-01', 100000);
    await spend(food.id, '2026-11-03', 150000);
    const state = { value: 'disconnected' as 'disconnected' | 'connected' };
    const queue = budgetAlertQueue(
      pool,
      notifier,
      { status: async () => ({ configured: true, state: state.value, connectedAt: null }) },
      () => '2026-11-20',
    );
    assert.equal(queue.name, BUDGET_ALERT_QUEUE);
    const job = { id: 'j', queue: queue.name, attempt: 1, requestId: null };
    await queue.handler({}, job);
    assert.equal(messenger.sent.length, 0);
    state.value = 'connected';
    await queue.handler({}, job);
    assert.equal(messenger.sent.length, 1);
  });
});
