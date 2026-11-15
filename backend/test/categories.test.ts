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

const pool = (query: () => Promise<unknown>) => ({ query }) as unknown as Pool;

const invalid = [
  {
    label: 'an empty name',
    body: { kind: 'expense', name: '   ' },
    error: 'Enter a category name',
  },
  {
    label: 'a name over 30 characters',
    body: { kind: 'expense', name: '가'.repeat(31) },
    error: 'Enter a category name of 30 characters or fewer',
  },
  {
    label: 'an unknown kind',
    body: { kind: 'transfer', name: 'Transfer' },
    error: 'Choose income or expense as the kind',
  },
  { label: 'a missing body', body: undefined, error: 'The request body must be a JSON object' },
];

for (const { label, body, error } of invalid) {
  test(`adding a category with ${label} is a 400`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call('/api/ledger/categories', { method: 'POST', body });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

test('a change with nothing to change is a 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/ledger/categories/1', { method: 'PATCH', body: {} });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'Send a new name or a hidden flag' });
  });
});

test('a malformed category id is a 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/ledger/categories/abc', {
      method: 'PATCH',
      body: { hidden: true },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'Invalid category ID' });
  });
});

test('an unknown list filter is a 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/ledger/categories?kind=transfer');
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'Choose income or expense as the kind' });
  });
});

test('a duplicate name reported by the DB becomes a 409', async () => {
  const duplicate = pool(async () => {
    throw Object.assign(new Error('duplicate key'), { code: '23505' });
  });
  await withApi(duplicate, async (call) => {
    const response = await call('/api/ledger/categories', {
      method: 'POST',
      body: { kind: 'expense', name: 'Food' },
    });
    assert.equal(response.status, 409);
    assert.deepEqual(response.data, {
      error: 'A category with this name already exists for this kind',
    });
  });
});

test('changing a category that does not exist is a 404', async () => {
  await withApi(
    pool(async () => ({ rows: [] })),
    async (call) => {
      const response = await call('/api/ledger/categories/99', {
        method: 'PATCH',
        body: { hidden: true },
      });
      assert.equal(response.status, 404);
      assert.deepEqual(response.data, { error: 'Category not found' });
    },
  );
});

test('a decomposed Hangul name is stored composed, so it meets the duplicate check', async () => {
  const params: unknown[][] = [];
  const capture = {
    query: async (_sql: string, values: unknown[]) => {
      params.push(values);
      return { rows: [{ id: '1', kind: 'expense', name: values[1], hidden: false }] };
    },
  } as unknown as Pool;
  await withApi(capture, async (call) => {
    const decomposed = '식비'.normalize('NFD');
    assert.notEqual(decomposed, '식비');
    const response = await call('/api/ledger/categories', {
      method: 'POST',
      body: { kind: 'expense', name: decomposed },
    });
    assert.equal(response.status, 201);
    assert.equal(params[0][1], '식비');
  });
});
