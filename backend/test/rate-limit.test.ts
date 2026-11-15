import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { withApi } from './helpers.js';

const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;

test('requests over the per-minute limit get a 429', async () => {
  await withApi(
    pool,
    async (call) => {
      assert.equal((await call('/api/health')).status, 200);
      assert.equal((await call('/api/health')).status, 200);
      const limited = await call('/api/health');
      assert.equal(limited.status, 429);
      assert.deepEqual(limited.data, { error: 'Too many requests. Try again in a moment' });
    },
    { requestsPerMinute: 2 },
  );
});

test('the default limit leaves room for ordinary use', async () => {
  await withApi(pool, async (call) => {
    for (let i = 0; i < 50; i += 1) assert.equal((await call('/api/health')).status, 200);
  });
});
