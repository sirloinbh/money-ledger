import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { type CalendarDay, KisError, type KisSource } from '../src/prices/kis.js';
import { isBusinessDay, syncHolidays } from '../src/prices/krx-calendar.js';
import { runMigration } from './helpers.js';
import { testDatabase } from './test-database.js';

// #321 The holiday sync and the shared business-day function against the real database.
const url = await testDatabase();

/** A KIS stand-in that answers from a map of closed weekdays, 30 days a page, and counts its calls. */
function stub(closed: string[]) {
  const calls: string[] = [];
  const source: KisSource = {
    name: 'STUB',
    quote: () => Promise.reject(new Error('not used')),
    calendar(from) {
      calls.push(from);
      const days: CalendarDay[] = [];
      const day = new Date(`${from}T00:00:00Z`);
      for (let i = 0; i < 30; i += 1) {
        const date = day.toISOString().slice(0, 10);
        days.push({ date, open: ![0, 6].includes(day.getUTCDay()) && !closed.includes(date) });
        day.setUTCDate(day.getUTCDate() + 1);
      }
      return Promise.resolve(days);
    },
  };
  return { source, calls };
}

const now = new Date('2026-11-24T00:00:00.000Z'); // 09:00 KST

test('the KRX holiday calendar against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  const reset = async () => {
    await pool.query('DROP TABLE IF EXISTS krx_holiday_sync, krx_holidays');
    await pool.query(
      'CREATE TABLE IF NOT EXISTS krx_holidays (holiday_date date PRIMARY KEY, name text NOT NULL)',
    );
    await runMigration(pool, '043_krx_holiday_sync.sql');
    await runMigration(pool, '043_krx_holiday_sync.sql'); // re-running is safe
  };
  const holidays = async () =>
    (
      await pool.query<{ d: string; source: string }>(
        'SELECT holiday_date::text AS d, source FROM krx_holidays ORDER BY holiday_date',
      )
    ).rows;

  await t.test(
    'fills the closed weekdays from KIS and the KRX-only rules, keeping manual rows',
    async () => {
      await reset();
      await pool.query(
        "INSERT INTO krx_holidays (holiday_date, name) VALUES ('2026-12-02', 'Hand-added')",
      );
      const { source, calls } = stub(['2026-12-25', '2027-02-08', '2027-02-09']);
      const result = await syncHolidays(pool, source, now);
      assert.equal(result.skipped, false);
      assert.ok(calls.length > 10 && calls.length < 40, `pages: ${calls.length}`);
      const rows = await holidays();
      assert.deepEqual(
        rows.filter((row) => row.d > '2026-11-01' && row.d < '2027-03-01'),
        [
          { d: '2026-12-02', source: 'manual' },
          { d: '2026-12-25', source: 'kis' },
          { d: '2026-12-31', source: 'rule' },
          { d: '2027-02-08', source: 'kis' },
          { d: '2027-02-09', source: 'kis' },
        ],
      );
      // The rule closures (Labour Day 2026 already passed but is still computed; 2027-12-31) are stored too.
      assert.ok(rows.some((row) => row.d === '2027-12-31' && row.source === 'rule'));
      assert.ok(rows.some((row) => row.d === '2026-05-01' && row.source === 'rule'));
      // The shared function: weekday holiday, weekend, a normal weekday.
      assert.equal(await isBusinessDay(pool, '2026-12-25'), false);
      assert.equal(await isBusinessDay(pool, '2026-12-02'), false, 'a manual row counts');
      assert.equal(await isBusinessDay(pool, '2026-12-26'), false, 'Saturday');
      assert.equal(await isBusinessDay(pool, '2026-12-28'), true);
    },
  );

  await t.test(
    'skips KIS while the last read is fresh, then replaces only the kis rows',
    async () => {
      await reset();
      await pool.query(
        "INSERT INTO krx_holidays (holiday_date, name) VALUES ('2026-12-02', 'Hand-added')",
      );
      await syncHolidays(pool, stub(['2026-12-25', '2027-01-20']).source, now);
      const again = stub([]);
      const skipped = await syncHolidays(pool, again.source, new Date('2026-12-01T00:00:00.000Z'));
      assert.equal(skipped.skipped, true);
      assert.equal(again.calls.length, 0);
      // 30 days later the read is due; 2027-01-20 is now open, so its kis row goes away. A day before the range read
      // (12-25), manual rows and rule rows stay.
      const later = await syncHolidays(pool, again.source, new Date('2026-12-26T00:00:00.000Z'));
      assert.equal(later.skipped, false);
      const rows = await holidays();
      assert.ok(!rows.some((row) => row.d === '2027-01-20'));
      assert.ok(rows.some((row) => row.d === '2026-12-25' && row.source === 'kis'));
      assert.ok(rows.some((row) => row.d === '2026-12-02' && row.source === 'manual'));
      assert.ok(rows.some((row) => row.d === '2026-12-31' && row.source === 'rule'));
    },
  );

  await t.test(
    'a failed or empty KIS read changes nothing but the rules, and is tried again',
    async () => {
      await reset();
      const failing: KisSource = {
        name: 'DOWN',
        quote: () => Promise.reject(new Error('not used')),
        calendar: () =>
          Promise.reject(new KisError('unavailable', 'KIS request failed (HTTP 500)')),
      };
      await assert.rejects(syncHolidays(pool, failing, now), /KIS request failed/);
      assert.deepEqual(
        (await holidays()).map((row) => row.source),
        ['rule', 'rule', 'rule'],
      );
      const empty: KisSource = { ...failing, calendar: () => Promise.resolve([]) };
      await assert.rejects(syncHolidays(pool, empty, now), /no calendar days/);
      const state = await pool.query('SELECT 1 FROM krx_holiday_sync');
      assert.equal(state.rowCount, 0, 'not marked as read, so the next run tries again');
      // Without a source (no KIS key) only the rules are added, once.
      const none = await syncHolidays(pool, undefined, now);
      assert.equal(none.rules, 0);
      assert.equal(await isBusinessDay(pool, '2026-12-31'), false, 'the year-end closing day');
    },
  );
});
