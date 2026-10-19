import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { serviceDate } from '../src/app.js';
import { withApi } from './helpers.js';

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

test('a DB failure becomes a Korean 500 without leaking the error', async () => {
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
        assert.deepEqual(data, { error: '서버 오류가 발생했습니다' });
      },
    );
  } finally {
    console.error = original;
  }
});

test('unknown API paths return a Korean 404 JSON body', async () => {
  await withApi(
    pool(async () => ({ rows: [] })),
    async (call) => {
      const { status, data } = await call('/api/does-not-exist');
      assert.equal(status, 404);
      assert.equal(data.error, '요청한 API를 찾을 수 없습니다');
    },
  );
});

test('service date follows Asia/Seoul across the UTC day boundary', () => {
  assert.equal(serviceDate(new Date('2026-10-18T14:59:59Z')), '2026-10-18');
  assert.equal(serviceDate(new Date('2026-10-18T15:00:00Z')), '2026-10-19');
});
