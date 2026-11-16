import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { withApi } from './helpers.js';

// Validation runs before the DB: a pool that fails the test if any query reaches it.
const noDb = {
  query: async () => {
    throw new Error('the request should have been rejected before the DB');
  },
} as unknown as Pool;

test('a malformed report id is a 400, to read or to mark seen', async () => {
  await withApi(noDb, async (call) => {
    for (const response of [
      await call('/api/reports/abc'),
      await call('/api/reports/0/seen', { method: 'PUT' }),
    ]) {
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error: 'Invalid report ID' });
    }
  });
});
