import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { createApp, serviceDate } from '../src/app.js';
import { listen, withApi } from './helpers.js';

const pool = (query: () => Promise<unknown>) => ({ query }) as unknown as Pool;

test('health reports the service and the injected service date when the DB answers', async () => {
  await withApi(
    pool(async () => ({ rows: [] })),
    async (call) => {
      const { status, data } = await call('/api/health');
      assert.equal(status, 200);
      assert.deepEqual(data, { ok: true, service: 'money-ledger', today: '2026-10-19' });
    },
    { today: () => '2026-10-19' },
  );
});

test('a DB failure becomes a 500 without leaking the error', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    await withApi(
      pool(async () => {
        throw new Error('password authentication failed for user secret');
      }),
      async (call) => {
        const { status, data } = await call('/api/health');
        assert.equal(status, 500);
        assert.deepEqual(data, { error: 'Server error' });
      },
    );
  } finally {
    console.error = original;
  }
});

test('a zod 4 validation error becomes a 400 with its own message', async () => {
  await withApi(
    pool(async () => z.string({ error: 'Enter text' }).parse(1)),
    async (call) => {
      const { status, data } = await call('/api/health');
      assert.equal(status, 400);
      assert.deepEqual(data, { error: 'Enter text' });
    },
  );
});

test('unknown API paths return an English 404 JSON body', async () => {
  await withApi(
    pool(async () => ({ rows: [] })),
    async (call) => {
      const { status, data } = await call('/api/does-not-exist');
      assert.equal(status, 404);
      assert.equal(data.error, 'API not found');
    },
  );
});

test('service date follows Asia/Seoul across the UTC day boundary', () => {
  assert.equal(serviceDate(new Date('2026-10-18T14:59:59Z')), '2026-10-18');
  assert.equal(serviceDate(new Date('2026-10-18T15:00:00Z')), '2026-10-19');
});

test('every response has an X-Request-Id, and a valid incoming one is kept (#175)', async (t) => {
  const logged = t.mock.method(console, 'log', () => {});
  const { server, port } = await listen(createApp(pool(async () => ({ rows: [] }))));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${port}/api/health`;

  const made = await fetch(url);
  assert.match(made.headers.get('x-request-id') ?? '', /^[\w.-]{1,128}$/);

  const kept = await fetch(url, { headers: { 'x-request-id': 'req-from-nginx-1' } });
  assert.equal(kept.headers.get('x-request-id'), 'req-from-nginx-1');

  // A 404 carries one too, and the request log line has the same ID.
  const missing = await fetch(`http://127.0.0.1:${port}/api/does-not-exist`);
  assert.equal(missing.status, 404);
  assert.ok(missing.headers.get('x-request-id'));
  assert.ok(
    logged.mock.calls.some((c) =>
      String(c.arguments[0]).includes('"requestId":"req-from-nginx-1"'),
    ),
  );
});
