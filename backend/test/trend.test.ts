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
  {
    query: '',
    error: 'Enter the start month as YYYY-MM, Enter the end month as YYYY-MM',
  },
  { query: 'from=2026-01', error: 'Enter the end month as YYYY-MM' },
  { query: 'from=2026-1&to=2026-12', error: 'Enter the start month as YYYY-MM' },
  { query: 'from=2026-01&to=2026-13', error: 'Enter the end month as YYYY-MM' },
  { query: 'from=2026-01&to=2026-12&to=2026-11', error: 'Enter the end month as YYYY-MM' },
  { query: 'from=1899-12&to=1900-05', error: 'Enter the start month between 1900 and 2100' },
  { query: 'from=2100-06&to=2101-01', error: 'Enter the end month between 1900 and 2100' },
  { query: 'from=2026-12&to=2026-11', error: 'The start month is after the end month' },
  { query: 'from=2024-11&to=2026-11', error: 'The period can be at most 24 months' },
];

for (const { query, error } of invalid) {
  test(`a trend for "${query}" is a 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call(`/api/ledger/trend?${query}`);
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}
