import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { serviceDate } from '../src/app.js';
import { resetDatabase, withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

// #184 This file's own copy of the test DB (undefined without TEST_DATABASE_URL: the DB tests are skipped).
const url = await testDatabase();

type Created = { id: number; period: string; startDate: string; endDate: string };
type ListItem = Created & {
  madeOn: string;
  updatedOn: string | null;
  seen: boolean;
  total: number;
};
type Report = ListItem & {
  previousTotal: number;
  change: number;
  topCategories: {
    categoryId: number | null;
    name: string;
    hidden: boolean;
    amount: number;
    share: string;
  }[];
  overspending:
    | {
        categoryId: number;
        name: string;
        hidden: boolean;
        spent: number;
        budget: number;
        over: number;
        percent: string;
        status: string;
      }[]
    | null;
};

// Requires a dedicated test DB with database/migrations applied. Skipped (not passed) without it.
test('spending reports against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  let ids: Record<string, number> = {};
  /** `history`: an income entry long before every period, so each period counts as after the first entry. */
  const reset = async ({ history = true } = {}) => {
    await pool.query('TRUNCATE ledger_categories RESTART IDENTITY CASCADE');
    await resetDatabase(pool);
    const { rows } = await pool.query<{ id: string; kind: string; name: string }>(
      'SELECT id, kind, name FROM ledger_categories',
    );
    ids = Object.fromEntries(rows.map((row) => [`${row.kind}/${row.name}`, Number(row.id)]));
    if (history) {
      await pool.query(
        "INSERT INTO ledger_entries (entry_date, kind, amount) VALUES ('2026-01-05', 'income', 1)",
      );
    }
  };
  const spend = (date: string, category: string | null, amount: number, kind = 'expense') =>
    pool.query(
      'INSERT INTO ledger_entries (entry_date, kind, amount, category_id) VALUES ($1, $2, $3, $4)',
      [date, kind, amount, category === null ? null : ids[category]],
    );
  const call = async (today: string, path: string, method = 'GET') => {
    let result: { status: number; data: unknown } | undefined;
    await withApi(
      pool,
      async (api) => {
        result = await api(path, { method });
      },
      { today: () => today },
    );
    return result!;
  };
  const generate = async (today: string) => {
    const response = await call(today, '/api/reports/generate', 'POST');
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return (response.data as { created: Created[] }).created;
  };
  const list = async () =>
    ((await call('2026-11-16', '/api/reports')).data as { reports: ListItem[] }).reports;
  const report = async (id: number) =>
    ((await call('2026-11-16', `/api/reports/${id}`)).data as { report: Report }).report;

  await t.test(
    'the latest finished week (Sunday to Saturday) and month, with totals, change, top 3 and overspending',
    async () => {
      await reset();
      // The week of Sun 11-08 to Sat 11-14.
      await spend('2026-11-07', 'expense/식비', 10000); // the Saturday before: the previous week
      await spend('2026-11-08', 'expense/식비', 30000); // Sunday: first day
      await spend('2026-11-14', 'expense/교통', 20000); // Saturday: last day
      await spend('2026-11-15', 'expense/식비', 99999); // the next Sunday: not in it
      await spend('2026-11-10', null, 5000); // uncategorized is a row of its own
      await spend('2026-11-09', 'expense/주거', 1000);
      await spend('2026-11-11', 'expense/통신', 500); // 4th: not in the top 3
      await spend('2026-11-12', 'income/급여', 3000000, 'income'); // income: not spending
      // October, with budgets: food exactly at its budget, transport over, housing within.
      await pool.query(
        `INSERT INTO ledger_budgets (category_id, month, amount)
         VALUES ($1, '2026-10-01', 40000), ($2, '2026-10-01', 50000), ($3, '2026-10-01', 100000)`,
        [ids['expense/식비'], ids['expense/교통'], ids['expense/주거']],
      );
      await spend('2026-10-31', 'expense/식비', 40000);
      await spend('2026-10-01', 'expense/교통', 70000);

      // Monday 11-16 in Seoul.
      const created = await generate('2026-11-16');
      assert.deepEqual(
        created.map((item) => [item.period, item.startDate, item.endDate]),
        [
          ['week', '2026-11-08', '2026-11-14'],
          ['month', '2026-10-01', '2026-10-31'],
        ],
      );

      const week = await report(created[0].id);
      assert.deepEqual(
        [week.total, week.previousTotal, week.change, week.seen, week.overspending],
        [56500, 10000, 46500, false, null],
      );
      assert.deepEqual(
        week.topCategories.map((item) => [item.name, item.amount, item.share]),
        [
          ['식비', 30000, '53.1'],
          ['교통', 20000, '35.4'],
          ['Uncategorized', 5000, '8.8'],
        ],
      );
      assert.equal(week.topCategories[2].categoryId, null);

      const month = await report(created[1].id);
      assert.deepEqual([month.total, month.previousTotal, month.change], [110000, 0, 110000]);
      assert.deepEqual(
        month.overspending?.map((item) => [
          item.name,
          item.spent,
          item.budget,
          item.over,
          item.percent,
          item.status,
        ]),
        [
          ['식비', 40000, 40000, 0, '100.0', 'reached'],
          ['교통', 70000, 50000, 20000, '140.0', 'over'],
        ],
      );
    },
  );

  await t.test('the week ends at midnight on Saturday in Seoul, not in UTC', async () => {
    await reset();
    // 14:59:59 UTC is 23:59:59 on Saturday 11-14 in Seoul: that week is not finished, so the latest is 11-01.
    const saturday = serviceDate(new Date('2026-11-14T14:59:59Z'));
    assert.equal(saturday, '2026-11-14');
    assert.deepEqual(
      (await generate(saturday))
        .filter((item) => item.period === 'week')
        .map((item) => item.startDate),
      ['2026-11-01'],
    );
    // One second later it is Sunday 11-15 in Seoul (still Saturday in UTC): the week of 11-08 has finished.
    const sunday = serviceDate(new Date('2026-11-14T15:00:00Z'));
    assert.equal(sunday, '2026-11-15');
    assert.deepEqual(
      (await generate(sunday)).map((item) => [item.period, item.startDate]),
      [['week', '2026-11-08']],
    );
    // The 1st of a month: the month before has just finished.
    assert.deepEqual(
      (await generate('2026-12-01'))
        .filter((item) => item.period === 'month')
        .map((item) => item.startDate),
      ['2026-11-01'],
    );
  });

  await t.test('a period is made once, even when two opens run at the same time', async () => {
    await reset();
    await spend('2026-11-09', 'expense/식비', 30000);
    const [first, second] = await Promise.all([generate('2026-11-16'), generate('2026-11-16')]);
    assert.equal(first.length + second.length, 2);
    assert.deepEqual(await generate('2026-11-16'), []);
    const rows = await pool.query('SELECT period, start_date FROM spending_reports');
    assert.equal(rows.rowCount, 2);
  });

  await t.test(
    'a report is rebuilt when an expense entry in its period changes (#205)',
    async () => {
      await reset();
      await spend('2026-11-09', 'expense/식비', 30000);
      const created = await generate('2026-11-16');
      const weekId = created.find((item) => item.period === 'week')!.id;
      const octoberId = created.find((item) => item.period === 'month')!.id;
      // The logged entry changes not yet rebuilt into a report.
      const pending = async () =>
        Number(
          (await pool.query<{ n: string }>('SELECT count(*) AS n FROM spending_report_changes'))
            .rows[0].n,
        );

      // Added: the week's report and the list follow, and say when they were updated.
      const added = await pool.query<{ id: string }>(
        `INSERT INTO ledger_entries (entry_date, kind, amount, category_id)
       VALUES ('2026-11-10', 'expense', 1000, $1) RETURNING id`,
        [ids['expense/교통']],
      );
      assert.equal(await pending(), 1);
      let week = await report(weekId);
      assert.equal(week.total, 31000);
      assert.deepEqual(
        week.topCategories.map((category) => [category.name, category.amount]),
        [
          ['식비', 30000],
          ['교통', 1000],
        ],
      );
      assert.match(week.updatedOn!, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal((await report(octoberId)).updatedOn, null);
      assert.equal(await pending(), 0);

      // Changed, then deleted.
      const entryId = added.rows[0].id;
      await pool.query('UPDATE ledger_entries SET amount = 5000 WHERE id = $1', [entryId]);
      assert.equal((await list()).find((item) => item.id === weekId)!.total, 35000);
      await pool.query('DELETE FROM ledger_entries WHERE id = $1', [entryId]);
      assert.equal((await report(weekId)).total, 30000);

      // The week before is the report's "previous" total, so it changes the report too.
      await spend('2026-11-07', 'expense/식비', 2000);
      week = await report(weekId);
      assert.deepEqual([week.previousTotal, week.change], [2000, 28000]);

      // Neither income, a memo, nor an entry outside every report's periods is logged.
      await spend('2026-11-11', 'income/급여', 3000000, 'income');
      await pool.query("UPDATE ledger_entries SET memo = 'lunch' WHERE entry_date = '2026-11-09'");
      await spend('2026-11-20', 'expense/식비', 7000);
      assert.equal(await pending(), 0);

      // An entry moved from income to expense counts.
      await pool.query(
        "UPDATE ledger_entries SET kind = 'expense', category_id = $1 WHERE kind = 'income' AND entry_date = '2026-11-11'",
        [ids['expense/식비']],
      );
      assert.equal(await pending(), 1);

      // Opening the app rebuilds it too, and the report keeps whether it was seen.
      await call('2026-11-16', `/api/reports/${weekId}/seen`, 'PUT');
      await generate('2026-11-16');
      assert.equal(await pending(), 0);
      const listed = (await list()).find((item) => item.id === weekId)!;
      assert.deepEqual([listed.total, listed.seen], [3030000, true]);
    },
  );

  await t.test(
    'two transactions changing entries of the same reports never wait on each other',
    async () => {
      await reset();
      await spend('2026-11-09', 'expense/식비', 1000);
      await generate('2026-11-16'); // the week of 11-08 and October
      const [first, second] = [await pool.connect(), await pool.connect()];
      const insert = (client: typeof first, date: string) =>
        client.query(
          "INSERT INTO ledger_entries (entry_date, kind, amount) VALUES ($1, 'expense', 100)",
          [date],
        );
      try {
        await first.query('BEGIN');
        await second.query('BEGIN');
        // Opposite orders: marking report rows here would lock them crosswise and deadlock one of the two.
        await insert(first, '2026-11-10');
        await insert(second, '2026-10-10');
        await Promise.all([insert(first, '2026-10-11'), insert(second, '2026-11-11')]);
        await Promise.all([first.query('COMMIT'), second.query('COMMIT')]);
      } finally {
        first.release();
        second.release();
      }
      const totals = (await list()).map((item) => [item.period, item.total]);
      assert.deepEqual(totals, [
        ['week', 1200],
        ['month', 200],
      ]);
    },
  );

  await t.test('an entry saved while reports are made is never lost', async () => {
    await reset();
    // An entry change in an open transaction holds the reports' lock in shared mode.
    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(
        `INSERT INTO ledger_entries (entry_date, kind, amount, category_id)
         VALUES ('2026-11-09', 'expense', 4000, $1)`,
        [ids['expense/식비']],
      );
      let done = false;
      const making = generate('2026-11-16').then((created) => {
        done = true;
        return created;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(done, false, 'making reports waits for the entry to commit');
      await writer.query('COMMIT');
      const created = await making;
      const week = created.find((item) => item.period === 'week')!;
      assert.equal((await report(week.id)).total, 4000);
    } finally {
      writer.release();
    }
  });

  await t.test(
    'a first open makes only the latest periods; later ones catch up to 8 weeks and 12 months',
    async () => {
      await reset();
      assert.equal((await generate('2026-11-16')).length, 2);
      // Monday 2027-03-01, after 15 weeks without opening the app.
      const created = await generate('2027-03-01');
      const weeks = created.filter((item) => item.period === 'week').map((item) => item.startDate);
      assert.equal(weeks.length, 8);
      assert.deepEqual([weeks[0], weeks.at(-1)], ['2027-01-03', '2027-02-21']);
      assert.deepEqual(
        created.filter((item) => item.period === 'month').map((item) => item.startDate),
        ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01'],
      );
    },
  );

  await t.test('periods that ended before the first entry get no report', async () => {
    await reset({ history: false });
    assert.deepEqual(await generate('2026-11-16'), []);
    // The first entry, on Tuesday 11-10: the week of 11-08 gets a report, October does not.
    await spend('2026-11-10', 'expense/식비', 3000);
    assert.deepEqual(
      (await generate('2026-11-16')).map((item) => [item.period, item.startDate]),
      [['week', '2026-11-08']],
    );
    // A month later, November is made, and the weeks since, from where the reports left off.
    const later = await generate('2026-12-01');
    assert.deepEqual(
      later.map((item) => [item.period, item.startDate]),
      [
        ['week', '2026-11-15'],
        ['week', '2026-11-22'],
        ['month', '2026-11-01'],
      ],
    );
  });

  await t.test('opening a report marks it seen; reading it does not', async () => {
    await reset();
    const [week] = await generate('2026-11-16');
    await report(week.id);
    assert.deepEqual(
      (await list()).map((item) => [item.period, item.seen]),
      [
        ['week', false],
        ['month', false],
      ],
    );
    const seen = await call('2026-11-16', `/api/reports/${week.id}/seen`, 'PUT');
    assert.deepEqual(seen.data, { report: { id: week.id, seen: true } });
    assert.deepEqual(
      (await list()).map((item) => item.seen),
      [true, false],
    );
    const missing = await call('2026-11-16', '/api/reports/999999');
    assert.deepEqual([missing.status, missing.data], [404, { error: 'Report not found' }]);
    const missingSeen = await call('2026-11-16', '/api/reports/999999/seen', 'PUT');
    assert.equal(missingSeen.status, 404);
  });

  await t.test('the DB keeps weeks on Sunday and months on the 1st', async () => {
    await reset();
    await assert.rejects(
      pool.query(
        "INSERT INTO spending_reports (period, start_date, end_date, content) VALUES ('week', '2026-11-09', '2026-11-15', '{}')",
      ),
      /spending_reports_week_check/,
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO spending_reports (period, start_date, end_date, content) VALUES ('month', '2026-11-02', '2026-11-30', '{}')",
      ),
      /spending_reports_month_check/,
    );
  });
});
