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

const invalidLists = [
  { query: '', error: 'Enter the month as YYYY-MM' },
  { query: 'month=2026-13', error: 'Enter the month as YYYY-MM' },
  { query: 'month=2101-01', error: 'Enter the month between 1900 and 2100' },
];

for (const { query, error } of invalidLists) {
  test(`budgets for "${query}" are a 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call(`/api/ledger/budgets?${query}`);
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

const invalidSaves = [
  { path: '1', body: [], error: 'The request body must be a JSON object' },
  { path: '1', body: { amount: 1000 }, error: 'Enter the month as YYYY-MM' },
  { path: '1', body: { month: '2026-11' }, error: 'Enter the budget as a number' },
  { path: '1', body: { month: '2026-11', amount: '1000' }, error: 'Enter the budget as a number' },
  {
    path: '1',
    body: { month: '2026-11', amount: 10.5 },
    error: 'Enter the budget as a whole number of won',
  },
  { path: '1', body: { month: '2026-11', amount: -1 }, error: 'The budget must be ₩0 or more' },
  {
    path: '1',
    body: { month: '2026-11', amount: Number.MAX_SAFE_INTEGER + 2 },
    error: 'The budget is too large',
  },
  {
    path: 'abc',
    body: { month: '2026-11', amount: 1000 },
    error: 'Invalid category ID',
  },
];

for (const { path, body, error } of invalidSaves) {
  test(`saving a budget ${JSON.stringify(body)} at ${path} is a 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call(`/api/ledger/budgets/${path}`, { method: 'PUT', body });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}
