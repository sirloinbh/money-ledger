import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { withApi } from './helpers.js';

// Validation runs before the DB: a pool that fails the test if any query or connection reaches it.
const reached = async () => {
  throw new Error('the request should have been rejected before the DB');
};
const noDb = { query: reached, connect: reached } as unknown as Pool;

const invalid = [
  {
    label: 'an amount sent as text',
    body: { initialCashKrw: '10000000' },
    error: 'Enter the starting amount as a number',
  },
  {
    label: 'a fractional amount',
    body: { initialCashKrw: 10000.5 },
    error: 'Enter the starting amount as a whole number of won',
  },
  {
    label: 'an amount under ₩10,000',
    body: { initialCashKrw: 9999 },
    error: 'The starting amount must be at least ₩10,000',
  },
  {
    label: 'an amount over ₩10 billion',
    body: { initialCashKrw: 10_000_000_001 },
    error: 'Enter a starting amount of ₩10 billion or less',
  },
  {
    label: 'a body that is not an object',
    body: [1],
    error: 'The request body must be a JSON object',
  },
];

for (const { label, body, error } of invalid) {
  for (const path of ['/api/mock/accounts', '/api/mock/accounts/1/reset']) {
    test(`${path} with ${label} is a 400 before the DB`, async () => {
      await withApi(noDb, async (call) => {
        const response = await call(path, { method: 'POST', body });
        assert.equal(response.status, 400);
        assert.deepEqual(response.data, { error });
      });
    });
  }
}

test('a malformed account id on reset is a 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/mock/accounts/abc/reset', { method: 'POST', body: {} });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'Invalid mock account ID' });
  });
});
