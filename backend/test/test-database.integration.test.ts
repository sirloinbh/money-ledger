import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { Client } from 'pg';

import { dropCopy } from './test-database.js';

// #379 The drop of a test database copy waits for connections that are still closing, and falls back to FORCE.
const source = process.env.TEST_DATABASE_URL;

async function scratch(t: { after: (fn: () => Promise<void>) => void }) {
  const admin = new URL(source!);
  admin.pathname = '/postgres';
  const name = `money_drop_t${process.pid}_${randomBytes(3).toString('hex')}`;
  const maintenance = new Client({ connectionString: admin.toString() });
  await maintenance.connect();
  await maintenance.query(`CREATE DATABASE "${name}"`);
  const url = new URL(source!);
  url.pathname = `/${name}`;
  t.after(async () => {
    await maintenance.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await maintenance.end();
  });
  const exists = async () =>
    (await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount ===
    1;
  return { adminUrl: admin.toString(), name, url: url.toString(), exists };
}

test(
  'a copy with a connection that closes soon is dropped without FORCE',
  { skip: !source },
  async (t) => {
    const copy = await scratch(t);
    const client = new Client({ connectionString: copy.url });
    await client.connect();
    setTimeout(() => void client.end(), 300);
    assert.equal(await dropCopy(copy.adminUrl, copy.name), 'clean');
    assert.equal(await copy.exists(), false);
  },
);

test(
  'a copy whose connection stays open is dropped with FORCE after the wait',
  { skip: !source },
  async (t) => {
    const copy = await scratch(t);
    const client = new Client({ connectionString: copy.url });
    // The forced drop ends this connection; its error is expected and must not fail the test.
    client.on('error', () => undefined);
    await client.connect();
    const lines: string[] = [];
    const log = console.error;
    console.error = (line: string) => void lines.push(line);
    try {
      assert.equal(await dropCopy(copy.adminUrl, copy.name), 'forced');
    } finally {
      console.error = log;
    }
    assert.equal(await copy.exists(), false);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /dropping it with FORCE/);
  },
);

test('a copy that does not exist is not an error', { skip: !source }, async (t) => {
  const copy = await scratch(t);
  assert.equal(await dropCopy(copy.adminUrl, copy.name), 'clean');
  assert.equal(await dropCopy(copy.adminUrl, copy.name), 'clean');
});
