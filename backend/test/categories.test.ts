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
    error: '카테고리 이름을 입력하세요',
  },
  {
    label: 'a name over 30 characters',
    body: { kind: 'expense', name: '가'.repeat(31) },
    error: '카테고리 이름은 30자 이하로 입력하세요',
  },
  {
    label: 'an unknown kind',
    body: { kind: 'transfer', name: '이체' },
    error: '종류는 수입 또는 지출 중에서 고르세요',
  },
  { label: 'a missing body', body: undefined, error: '요청 본문은 JSON 객체여야 합니다' },
];

for (const { label, body, error } of invalid) {
  test(`adding a category with ${label} is a Korean 400`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call('/api/ledger/categories', { method: 'POST', body });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

test('a change with nothing to change is a Korean 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/ledger/categories/1', { method: 'PATCH', body: {} });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: '바꿀 이름이나 숨김 여부를 보내세요' });
  });
});

test('a malformed category id is a Korean 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/ledger/categories/abc', {
      method: 'PATCH',
      body: { hidden: true },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: '카테고리 ID가 올바르지 않습니다' });
  });
});

test('an unknown list filter is a Korean 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/ledger/categories?kind=transfer');
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: '종류는 수입 또는 지출 중에서 고르세요' });
  });
});

test('a duplicate name reported by the DB becomes a Korean 409', async () => {
  const duplicate = pool(async () => {
    throw Object.assign(new Error('duplicate key'), { code: '23505' });
  });
  await withApi(duplicate, async (call) => {
    const response = await call('/api/ledger/categories', {
      method: 'POST',
      body: { kind: 'expense', name: '식비' },
    });
    assert.equal(response.status, 409);
    assert.deepEqual(response.data, { error: '같은 종류에 이미 있는 카테고리 이름입니다' });
  });
});

test('changing a category that does not exist is a Korean 404', async () => {
  await withApi(
    pool(async () => ({ rows: [] })),
    async (call) => {
      const response = await call('/api/ledger/categories/99', {
        method: 'PATCH',
        body: { hidden: true },
      });
      assert.equal(response.status, 404);
      assert.deepEqual(response.data, { error: '카테고리를 찾을 수 없습니다' });
    },
  );
});
