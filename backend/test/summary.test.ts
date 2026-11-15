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

const invalid = [
  { query: '', error: 'Enter the month as YYYY-MM' },
  { query: 'month=2026-13', error: 'Enter the month as YYYY-MM' },
  { query: 'month=2026-1', error: 'Enter the month as YYYY-MM' },
  { query: 'month=2026-11-01', error: 'Enter the month as YYYY-MM' },
  { query: 'month=2026-11&month=2026-12', error: 'Enter the month as YYYY-MM' },
  { query: 'month=1899-12', error: 'Enter the month between 1900 and 2100' },
  { query: 'month=2101-01', error: 'Enter the month between 1900 and 2100' },
];

for (const { query, error } of invalid) {
  test(`a summary for "${query}" is a 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call(`/api/ledger/summary?${query}`);
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}
