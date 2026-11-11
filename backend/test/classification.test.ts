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
    path: '/api/ledger/rules',
    label: 'a blank keyword',
    body: { keyword: '  ', categoryId: 1 },
    error: 'Enter a keyword',
  },
  {
    path: '/api/ledger/rules',
    label: 'a keyword over 50 characters',
    body: { keyword: 'a'.repeat(51), categoryId: 1 },
    error: 'The keyword must be 50 characters or fewer',
  },
  {
    path: '/api/ledger/rules',
    label: 'no category',
    body: { keyword: 'Starbucks' },
    error: 'Choose a category',
  },
  {
    path: '/api/ledger/entries/classify',
    label: 'no entries',
    body: { entryIds: [], categoryId: 1 },
    error: 'Select the entries to classify',
  },
  {
    path: '/api/ledger/entries/classify',
    label: 'more than 200 entries',
    body: { entryIds: Array.from({ length: 201 }, (_, i) => i + 1), categoryId: 1 },
    error: 'You can classify at most 200 entries at a time',
  },
  {
    path: '/api/ledger/entries/classify',
    label: 'an entry id that is not a positive integer',
    body: { entryIds: [0], categoryId: 1 },
    error: 'The entry ID is not valid',
  },
  {
    path: '/api/ledger/entries/classify',
    label: 'remember that is not a boolean',
    body: { entryIds: [1], categoryId: 1, remember: 'yes' },
    error: 'The save-as-rule flag is not valid',
  },
];

for (const { path, label, body, error } of invalid) {
  test(`${path} with ${label} is a 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call(path, { method: 'POST', body });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

test('an unknown list filter is a 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/ledger/entries?uncategorized=yes');
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'uncategorized can only be true' });
  });
});

test('a malformed rule id is a 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/ledger/rules/x', { method: 'DELETE' });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'Invalid rule ID' });
  });
});
