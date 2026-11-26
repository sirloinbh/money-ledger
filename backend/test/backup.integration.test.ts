import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { backupFormat, excludedTables, exportBackup, unclassifiedTables } from '../src/backup.js';
import { resetDatabase, withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

// #298 Backup and restore against the real database. Skipped (not passed) without TEST_DATABASE_URL.
const url = await testDatabase();

const secret = 'SENTINEL-ENCRYPTED-TOKEN-must-not-be-in-the-file';

test('backup and restore against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  // Rows in most tables, with values that lose digits or change shape when handled carelessly: a numeric with
  // eight decimals, a won amount above 2^31, Korean text, jsonb, an array and timestamps with a time zone.
  const seed = async () => {
    const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);
    const { rows: cats } = await q(
      'SELECT DISTINCT ON (kind) id, kind FROM ledger_categories ORDER BY kind, id',
    );
    const income = Number(cats.find((row) => row.kind === 'income').id);
    const expense = Number(cats.find((row) => row.kind === 'expense').id);
    await q(
      `INSERT INTO ledger_entries (entry_date, kind, amount, category_id, memo, merchant) VALUES
       ('2026-11-01', 'income', 3000000, $1, '월급 "11월"', ''), ('2026-11-02', 'expense', 4500000000, $2, 'big, with comma', '스타벅스')`,
      [income, expense],
    );
    await q(
      "INSERT INTO ledger_category_rules (keyword, kind, category_id) VALUES ('스타벅스', 'expense', $1)",
      [expense],
    );
    await q(
      "INSERT INTO ledger_budgets (category_id, kind, month, amount) VALUES ($1, 'expense', '2026-11-01', 500000)",
      [expense],
    );
    await q(
      "INSERT INTO ledger_fixed_costs (name, category_id, amount, day_of_month, start_month) VALUES ('Rent', $1, 500000, 25, '2026-09-01')",
      [expense],
    );
    await q(
      "INSERT INTO ledger_fixed_cost_runs (fixed_cost_id, month, entry_id, confirmed) VALUES (1, '2026-11-01', 2, true)",
    );
    await q("INSERT INTO ledger_recurring_dismissals (merchant_key) VALUES ('netflix')");
    await q(
      "INSERT INTO securities (market, symbol, name, kind, currency) VALUES ('KOSPI', '005930', '삼성전자', 'stock', 'KRW')",
    );
    await q(
      "INSERT INTO security_prices (security_id, trade_date, close, currency, source, fetched_at) VALUES (1, '2026-11-24', 70100, 'KRW', 'test', now())",
    );
    await q(
      "INSERT INTO fx_rates (currency, rate_date, fx_rate, source, fetched_at) VALUES ('USD', '2026-11-24', 1385.2500, 'test', now())",
    );
    await q(
      "INSERT INTO base_rates (effective_date, rate_pct, source, fetched_at) VALUES ('2026-11-01', 2.5, 'test', now())",
    );
    await q(
      `INSERT INTO portfolio_assets (name, asset_type, currency, quantity, value_foreign, memo) VALUES
       ('Dollar stock', 'other', 'USD', 1.12345678, 1234.5678, '메모')`,
    );
    await q(
      "INSERT INTO portfolio_assets (name, asset_type, value_krw) VALUES ('Savings', 'cash', 2500000), ('Loan', 'debt', 8000000)",
    );
    await q(
      "INSERT INTO savings_goals (name, target_amount, source, asset_id, start_month) VALUES ('Fund', 5000000, 'asset', 2, '2026-11-01')",
    );
    await q(
      "INSERT INTO net_worth_snapshots (snapshot_date, assets_krw, debts_krw, net_krw, uncounted) VALUES ('2026-11-25', 2500000, 8000000, -5500000, 0)",
    );
    await q('INSERT INTO mock_accounts (initial_cash_krw, cash_krw) VALUES (10000000, 8590000)');
    await q(
      "INSERT INTO mock_cash_flows (account_id, flow_date, amount_krw) VALUES (1, '2026-11-01', 10000000)",
    );
    await q(
      `INSERT INTO mock_orders (account_id, security_id, request_key, side, quantity, price, currency, price_date,
         amount_krw, fee_krw, cash_after_krw, fill_source)
       VALUES (1, 1, gen_random_uuid(), 'buy', 20, 70500, 'KRW', '2026-11-06', 1410000, 0, 8590000, 'book')`,
    );
    await q(
      'INSERT INTO mock_holdings (account_id, security_id, quantity, cost_krw) VALUES (1, 1, 20, 1410000)',
    );
    await q(
      `INSERT INTO mock_positions (account_id, security_id, buy_order_id, quantity, strategy, strategy_chosen_at,
         strategy_source, opened_at) VALUES (1, 1, 1, 20, 'long_hold', now(), 'web', '2026-11-06T10:00:00+09:00')`,
    );
    await q(
      "INSERT INTO mock_snapshots (account_id, snapshot_date, cash_krw, value_krw, total_krw, profit_krw, return_pct) VALUES (1, '2026-11-25', 8590000, 1420000, 10010000, 10000, 0.1)",
    );
    await q(
      "INSERT INTO news_items (id, link, original_link, title, summary, publisher, published_at, query, fetched_date) VALUES (1, 'https://example.com/a', 'https://example.com/a', '제목', '요약', 'pub', '2026-11-25T09:00:00+09:00', 'q', '2026-11-25')",
    );
    await q("INSERT INTO kakao_commands (command, result) VALUES ('status', 'ok')");
    await q(
      `INSERT INTO kakao_connection (id, status, access_token_enc, access_expires_at, refresh_token_enc, refresh_expires_at, connected_at)
       VALUES (1, 'connected', $1, now(), $1, now(), now())`,
      [secret],
    );
  };

  // resetDatabase applies the migration files but not the runner's history table; the backup reads the newest name.
  const migrationsDir = fileURLToPath(new URL('../../database/migrations/', import.meta.url));
  const reset = async () => {
    await resetDatabase(pool);
    const names = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
    await pool.query(
      'CREATE TABLE schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    await pool.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, 'test')", [
      names[names.length - 1],
    ]);
  };

  const withoutTime = (backup: Awaited<ReturnType<typeof exportBackup>>) => ({
    ...backup,
    createdAt: '',
  });
  const rowCount = async (table: string) =>
    Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);

  await t.test(
    'every table in the schema is classified, so a new table cannot be missed',
    async () => {
      await reset();
      assert.deepEqual(await unclassifiedTables(pool), []);
      // The rules never name a table the schema does not have.
      const { rows } = await pool.query<{ name: string }>(
        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
      );
      const backup = await exportBackup(pool);
      const present = new Set(rows.map((row) => row.name));
      for (const name of Object.keys(backup.tables)) assert.ok(present.has(name), name);
      for (const name of excludedTables) assert.ok(present.has(name), name);
      // Every table is either in the file or excluded.
      assert.deepEqual(
        [...present].filter(
          (name) => !(name in backup.tables) && !excludedTables.includes(name as never),
        ),
        [],
      );
    },
  );

  await t.test('export then restore into an empty database gives the same data back', async () => {
    await reset();
    await seed();
    const first = await exportBackup(pool);
    assert.equal(first.format, backupFormat);
    assert.ok(first.schemaMigration?.endsWith('.sql'));
    // The tables that matter have rows (the round trip below is not trivially equal).
    for (const name of [
      'ledger_entries',
      'portfolio_assets',
      'mock_accounts',
      'mock_orders',
      'mock_positions',
      'savings_goals',
      'securities',
      'news_items',
    ]) {
      assert.ok(first.tables[name].length > 0, name);
    }
    // Digits survive: the numeric with eight decimals and the won amount above 2^31 travel as text.
    assert.equal(first.tables.portfolio_assets[0].quantity, '1.12345678');
    assert.equal(first.tables.ledger_entries[1].amount, '4500000000');

    // Secrets never go into the file.
    const text = JSON.stringify(first);
    assert.equal(text.includes(secret), false);
    assert.equal('kakao_connection' in first.tables, false);
    assert.equal('kakao_login_states' in first.tables, false);
    assert.equal('schema_migrations' in first.tables, false);

    // A new, empty (freshly migrated) database.
    await reset();
    // The app saved today's net worth when it opened: that does not make the database non-empty, and the
    // saved day is replaced by the file's rows.
    await pool.query(
      "INSERT INTO net_worth_snapshots (snapshot_date, assets_krw, debts_krw, net_krw, uncounted) VALUES ('2026-11-26', 1, 0, 1, 0)",
    );
    await withApi(pool, async (api) => {
      const response = await api('/api/backup/restore', { method: 'POST', body: JSON.parse(text) });
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assert.equal((response.data.restored as Record<string, number>).ledger_entries, 2);
    });
    const second = await exportBackup(pool);
    assert.deepEqual(withoutTime(second), withoutTime(first));

    // The restored rows were not logged again by the report-change trigger, and counters continue after the ids.
    assert.equal(
      await rowCount('spending_report_changes'),
      first.tables.spending_report_changes.length,
    );
    const next = await pool.query<{ id: string }>(
      "INSERT INTO ledger_entries (entry_date, kind, amount, category_id) VALUES ('2026-11-03', 'expense', 1, (SELECT category_id FROM ledger_entries WHERE kind = 'expense' LIMIT 1)) RETURNING id",
    );
    assert.equal(Number(next.rows[0].id), 3);
    // The secret table was not touched by the restore: it stays empty in the new database.
    assert.equal(await rowCount('kakao_connection'), 0);
  });

  await t.test('the download is one JSON file with a name and a version', async () => {
    await reset();
    await seed();
    await withApi(
      pool,
      async (api) => {
        const response = await api('/api/backup');
        assert.equal(response.status, 200);
        assert.equal(response.data.app, 'money-ledger');
        assert.equal(response.data.format, 1);
      },
      { today: () => '2026-11-26' },
    );
    const { server, port } = await import('./helpers.js').then(async (helpers) => {
      const { createApp } = await import('../src/app.js');
      return helpers.listen(createApp(pool, { today: () => '2026-11-26' }));
    });
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/backup`);
      assert.match(
        response.headers.get('content-disposition') ?? '',
        /money-ledger-backup-2026-11-26\.json/,
      );
      assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  await t.test('a database that has data refuses a restore and keeps everything', async () => {
    await reset();
    await seed();
    const file = JSON.parse(JSON.stringify(await exportBackup(pool)));
    // Not empty: a restore changes nothing.
    const before = await exportBackup(pool);
    await withApi(pool, async (api) => {
      const response = await api('/api/backup/restore', { method: 'POST', body: file });
      assert.equal(response.status, 409);
      assert.match(String(response.data.error), /only into an empty database/);
    });
    assert.deepEqual(withoutTime(await exportBackup(pool)), withoutTime(before));
  });

  await t.test(
    'a file of an unknown version, app, table or column is refused and nothing changes',
    async () => {
      await reset();
      const good = {
        app: 'money-ledger',
        format: 1,
        createdAt: '2026-11-26T00:00:00.000Z',
        schemaMigration: null,
        tables: {} as Record<string, Record<string, unknown>[]>,
      };
      const before = await exportBackup(pool);
      const send = (body: unknown) => withApiResult('/api/backup/restore', body);
      const withApiResult = async (path: string, body: unknown) => {
        let result: { status: number; data: Record<string, unknown> } | undefined;
        await withApi(pool, async (api) => {
          result = await api(path, { method: 'POST', body });
        });
        return result!;
      };
      assert.equal((await send({ ...good, format: 2 })).status, 422);
      assert.equal((await send({ ...good, app: 'other' })).status, 400);
      assert.equal((await send({ ...good, tables: { nope: [] } })).status, 422);
      // A hand-made file cannot carry the secret tables in.
      assert.equal(
        (await send({ ...good, tables: { kakao_connection: [{ id: 1 }] } })).status,
        422,
      );
      assert.equal(
        (await send({ ...good, tables: { ledger_entries: [{ id: 1, bogus: 1 }] } })).status,
        422,
      );
      // A file from a newer schema than this database.
      assert.equal((await send({ ...good, schemaMigration: '999_future.sql' })).status, 409);
      // Rows the database rejects (a negative amount) roll everything back, including the tables before it.
      const { rows } = await pool.query('SELECT id FROM ledger_categories ORDER BY id LIMIT 1');
      const bad = await send({
        ...good,
        tables: {
          ledger_categories: [{ id: '9001', kind: 'expense', name: 'Temp', hidden: false }],
          ledger_entries: [
            {
              id: '1',
              entry_date: '2026-11-01',
              kind: 'expense',
              amount: '-5',
              category_id: String(rows[0].id),
              memo: '',
              merchant: '',
            },
          ],
        },
      });
      assert.equal(bad.status, 422);
      assert.deepEqual(withoutTime(await exportBackup(pool)), withoutTime(before));
    },
  );
});
