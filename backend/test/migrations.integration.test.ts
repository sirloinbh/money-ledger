import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { checksum, migrate, readMigrations } from '../src/migrations.js';

const url = process.env.TEST_DATABASE_URL;
const dir = fileURLToPath(new URL('../../database/migrations/', import.meta.url));

// #71 Requires a dedicated test DB whose user may create databases. Skipped (not passed) without it. The runner
// works on a database of its own: the migrations' guards look constraints up by name across the database, so a
// schema next to the other tests' tables would not start empty.
test('migrations apply to an empty database and can run again', { skip: !url }, async (t) => {
  const admin = new Client({ connectionString: url });
  await admin.connect();
  const opened: { name: string; db: Client }[] = [];
  /** A new, empty database for this run, dropped at the end. */
  const emptyDatabase = async (suffix: string) => {
    const name = `money_migrate_test_${process.pid}_${suffix}`;
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
    const target = new URL(url!);
    target.pathname = `/${name}`;
    const db = new Client({ connectionString: target.toString() });
    await db.connect();
    opened.push({ name, db });
    return db;
  };
  t.after(async () => {
    for (const { name, db } of opened) {
      await db.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    }
    await admin.end();
  });
  const client = await emptyDatabase('empty');

  const files = await readMigrations(dir);
  const names = files.map((file) => file.name);
  const tables = async () =>
    (
      await client.query<{ name: string }>(
        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'",
      )
    ).rows.map((row) => row.name);

  await t.test('every file is applied in order and recorded', async () => {
    assert.ok(names.length >= 18);
    assert.deepEqual(await migrate(client, files), names);
    const found = await tables();
    for (const table of [
      'ledger_categories',
      'ledger_entries',
      'ledger_budgets',
      'ledger_fixed_costs',
      'portfolio_assets',
      'securities',
      'mock_accounts',
      'net_worth_snapshots',
      'spending_reports',
      'schema_migrations',
    ]) {
      assert.ok(found.includes(table), table);
    }
    const { rows } = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name',
    );
    assert.deepEqual(
      rows.map((row) => row.name),
      names,
    );
  });

  await t.test('running again applies nothing', async () => {
    assert.deepEqual(await migrate(client, files), []);
  });

  await t.test(
    'a database set up before the history, with only 001 and 002, gets the rest and keeps its data',
    async () => {
      // Like the existing DB in #71: the first files applied with psql, before the runner existed.
      const old = await emptyDatabase('old');
      const [initial, categories] = files;
      assert.deepEqual(
        [initial.name, categories.name],
        ['001_initial.sql', '002_ledger_categories.sql'],
      );
      await old.query(initial.sql);
      await old.query(categories.sql);
      const category = await old.query<{ id: string }>(
        "INSERT INTO ledger_categories (kind, name) VALUES ('expense', 'Pets') RETURNING id",
      );
      // 001 and 002 have no history, so they run once more (written to be rerun); the rest are new.
      assert.deepEqual(await migrate(old, files), names);
      const kept = await old.query('SELECT name FROM ledger_categories WHERE id = $1', [
        category.rows[0].id,
      ]);
      assert.deepEqual(kept.rows, [{ name: 'Pets' }], 'existing data stays');
      assert.ok((await old.query("SELECT to_regclass('spending_reports') AS t")).rows[0].t);
      // And again: nothing, without an error.
      assert.deepEqual(await migrate(old, files), []);
    },
  );

  await t.test('a changed file stops before anything runs', async () => {
    const changed = files.map((file, index) =>
      index === 0 ? { ...file, sql: 'SELECT 2', checksum: checksum('SELECT 2') } : file,
    );
    await assert.rejects(migrate(client, changed), /was changed: 001_initial\.sql/);
  });

  await t.test('a failing file rolls back alone, names itself and can be fixed', async () => {
    const good = {
      name: '900_good.sql',
      sql: 'CREATE TABLE migrate_good (id int)',
      checksum: checksum('good'),
    };
    const bad = {
      name: '901_bad.sql',
      sql: 'CREATE TABLE migrate_partial (id int); SELECT no_such_column FROM migrate_partial',
      checksum: checksum('bad'),
    };
    await assert.rejects(migrate(client, [...files, good, bad]), /Failed to apply 901_bad\.sql/);
    const found = await tables();
    assert.ok(found.includes('migrate_good'), 'the earlier file stays');
    assert.ok(!found.includes('migrate_partial'), 'the failed file left nothing');
    const fixed = { ...bad, sql: 'CREATE TABLE migrate_partial (id int)' };
    assert.deepEqual(await migrate(client, [...files, good, fixed]), ['901_bad.sql']);
  });
});
