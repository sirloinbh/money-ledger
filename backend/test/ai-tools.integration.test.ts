import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { createApp } from '../src/app.js';
import { listen, runMigration } from './helpers.js';
import { testDatabase } from './test-database.js';

// #184 This file's own copy of the test DB (undefined without TEST_DATABASE_URL: the DB tests are skipped).
const url = await testDatabase();

// project-standards#711: shared-ai calls the first AI tool with a signed token; each call is checked for its scope
// and leaves one audit_log row.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
// One owner per run, so the audit rows of an earlier run on the same DB do not count.
const owner = `owner-${randomUUID()}`;
// A token names its tool ('@list' for the list) and has its own jti; the app requires both (#670, #822).
function token(scope: string, tool: string, key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'EdDSA', typ: 'JWT' })}.${b64({ iss: 'shared-ai', aud: 'money-ledger', sub: owner, client: 'stdio', scope, tool, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${body}.${sign(null, Buffer.from(body), key).toString('base64url')}`;
}

test('AI tools: list entries with scopes, signatures and audit rows', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url });
  await runMigration(pool, '022_audit_log.sql');
  const toolsPublicKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const { server, port } = await listen(createApp(pool, { toolsPublicKey }));
  const base = `http://127.0.0.1:${port}/internal/tools`;
  const call = (name: string, auth: string | null, body: unknown = {}) =>
    fetch(`${base}/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const merchant = `AI-${randomUUID()}`;
  const read = (scope = 'money-ledger:read') => token(scope, 'list_entries');
  try {
    await pool.query(
      "INSERT INTO ledger_entries (entry_date, kind, amount, category_id, merchant, memo) VALUES ('2040-04-01', 'expense', 12345, NULL, $1, '')",
      [merchant],
    );
    const listed = await fetch(base, {
      headers: { authorization: `Bearer ${token('money-ledger:read', '@list')}` },
    });
    assert.equal(listed.status, 200);
    const { tools } = (await listed.json()) as {
      tools: { name: string; annotations: { readOnlyHint: boolean } }[];
    };
    assert.deepEqual(
      tools.map((t) => [t.name, t.annotations.readOnlyHint]),
      [['list_entries', true]],
    );

    const range = { from: '2040-04-01', to: '2040-04-01' };
    assert.equal((await call('list_entries', null, range)).status, 401);
    assert.equal(
      (
        await call(
          'list_entries',
          token('money-ledger:read', 'list_entries', generateKeyPairSync('ed25519').privateKey),
          range,
        )
      ).status,
      401,
    );
    assert.equal((await call('list_entries', read('money-ledger:other'), range)).status, 403);

    const ok = await call('list_entries', read(), range);
    assert.equal(ok.status, 200);
    const { result } = (await ok.json()) as {
      result: { entries: { id: number; merchant: string; amount: number }[]; total: number };
    };
    const found = result.entries.find((e) => e.merchant === merchant);
    assert.equal(found?.amount, 12345);
    assert.ok(result.total >= 1);
    const income = await call('list_entries', read(), { ...range, kind: 'income' });
    assert.equal(
      (
        (await income.json()) as { result: { entries: { merchant: string }[] } }
      ).result.entries.some((e) => e.merchant === merchant),
      false,
    );
    assert.equal(
      (await call('list_entries', read(), { from: '2039-01-01', to: '2040-04-01' })).status,
      400,
      'more than 366 days is refused',
    );

    const rows = (
      await pool.query(
        "SELECT action,result,entity,tool,client,actor_type FROM audit_log WHERE actor_type='ai-tool' AND actor_id=$1 ORDER BY id",
        [owner],
      )
    ).rows;
    assert.deepEqual(
      rows.map((r) => [r.tool, r.action, r.result]),
      [
        ['list_entries', 'read', 'denied'],
        ['list_entries', 'read', 'ok'],
        ['list_entries', 'read', 'ok'],
        ['list_entries', 'read', 'error'],
      ],
    );
    assert.equal(rows[1].client, 'stdio');
    assert.equal(rows[1].entity, 'ledger_entry');
  } finally {
    await pool.query('DELETE FROM ledger_entries WHERE merchant = $1', [merchant]);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await pool.end();
  }
});

test('AI tools are off without the shared-ai public key', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url });
  const { server, port } = await listen(createApp(pool));
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/internal/tools`)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await pool.end();
  }
});
