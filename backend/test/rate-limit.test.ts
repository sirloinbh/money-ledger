import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { withApi } from './helpers.js';

const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;

test('requests over the per-minute limit get a Korean 429 and a retry hint', async () => {
  await withApi(
    pool,
    async (call) => {
      assert.equal((await call('/api/health')).status, 200);
      assert.equal((await call('/api/health')).status, 200);
      const limited = await call('/api/health');
      assert.equal(limited.status, 429);
      assert.deepEqual(limited.data, { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요' });
    },
    { requestsPerMinute: 2 },
  );
});

test('the default limit leaves room for ordinary use', async () => {
  await withApi(pool, async (call) => {
    for (let i = 0; i < 50; i += 1) assert.equal((await call('/api/health')).status, 200);
  });
});
