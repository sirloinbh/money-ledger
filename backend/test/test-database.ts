import { randomBytes } from 'node:crypto';
import { after } from 'node:test';

import { Client } from 'pg';

// #184 Backend test files run in parallel (package.json: --test-concurrency=4). Each DB test file gets a database of
// its own, cloned from TEST_DATABASE_URL (money_test, migrated) with CREATE DATABASE ... TEMPLATE, and dropped when
// the file ends. So a file can TRUNCATE, RESTART IDENTITY, re-run migrations, commit and send requests at once
// without seeing another file's rows.
//
// health-log's inSnapshot (one connection in one rolled-back transaction per test) was not ported: most files here
// TRUNCATE ... RESTART IDENTITY, re-run migrations in their setup, send concurrent requests on several connections,
// or start pg-boss, and none of that fits in one transaction on one connection.
//
// The template must have no other session: PostgreSQL refuses to copy a database someone is connected to. No test
// connects to money_test itself; only the clones are used.

/** Clones look like money_test_c<pid>_<hex>, so leftovers of a killed run can be found and matched to their process. */
const clonePrefix = (template: string) => `${template}_c`;

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * The URL of a fresh copy of the test database for this file, or undefined when TEST_DATABASE_URL is not set (DB
 * tests are then skipped). Call it once at the top of a test file: `const url = await testDatabase();`. The copy is
 * dropped after the file's tests, also when they fail.
 */
export async function testDatabase(): Promise<string | undefined> {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) return undefined;
  const template = decodeURIComponent(new URL(source).pathname.slice(1));
  const name = `${clonePrefix(template)}${process.pid}_${randomBytes(4).toString('hex')}`;
  // The maintenance database: CREATE and DROP DATABASE cannot run while connected to the database they copy or drop.
  const adminUrl = new URL(source);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await dropLeftovers(admin, template);
    try {
      await admin.query(`CREATE DATABASE ${quoted(name)} TEMPLATE ${quoted(template)}`);
    } catch (error) {
      if ((error as { code?: string }).code === '55006') {
        throw new Error(
          `Cannot copy ${template}: another session is connected to it (a dev server, psql or e2e run?). ` +
            'Close it and run the tests again.',
          { cause: error },
        );
      }
      throw error;
    }
  } finally {
    await admin.end();
  }
  // Registered on the file's root, so it runs after every test and its own t.after hooks (which end the pools).
  after(async () => {
    const dropper = new Client({ connectionString: adminUrl.toString() });
    await dropper.connect();
    try {
      // FORCE: a pool a failed test left open must not keep the copy alive.
      await dropper.query(`DROP DATABASE IF EXISTS ${quoted(name)} WITH (FORCE)`);
    } finally {
      await dropper.end();
    }
  });
  const url = new URL(source);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Drops copies whose test process is gone (a run killed before its after hooks). */
async function dropLeftovers(admin: Client, template: string) {
  const prefix = clonePrefix(template);
  const { rows } = await admin.query<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE starts_with(datname, $1)`,
    [prefix],
  );
  for (const { datname } of rows) {
    const pid = Number(/^(\d+)_[0-9a-f]+$/.exec(datname.slice(prefix.length))?.[1]);
    if (!Number.isInteger(pid) || alive(pid)) continue;
    // Another file may be dropping the same leftover at the same moment; either way it is gone.
    await admin
      .query(`DROP DATABASE IF EXISTS ${quoted(datname)} WITH (FORCE)`)
      .catch(() => undefined);
  }
}
