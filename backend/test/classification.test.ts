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
    error: '키워드를 입력하세요',
  },
  {
    path: '/api/ledger/rules',
    label: 'a keyword over 50 characters',
    body: { keyword: 'a'.repeat(51), categoryId: 1 },
    error: '키워드는 50자 이하로 입력하세요',
  },
  {
    path: '/api/ledger/rules',
    label: 'no category',
    body: { keyword: '스타벅스' },
    error: '카테고리를 고르세요',
  },
  {
    path: '/api/ledger/entries/classify',
    label: 'no entries',
    body: { entryIds: [], categoryId: 1 },
    error: '분류할 내역을 고르세요',
  },
  {
    path: '/api/ledger/entries/classify',
    label: 'more than 200 entries',
    body: { entryIds: Array.from({ length: 201 }, (_, i) => i + 1), categoryId: 1 },
    error: '한 번에 200건까지 분류할 수 있습니다',
  },
  {
    path: '/api/ledger/entries/classify',
    label: 'an entry id that is not a positive integer',
    body: { entryIds: [0], categoryId: 1 },
    error: '내역 ID가 올바르지 않습니다',
  },
  {
    path: '/api/ledger/entries/classify',
    label: 'remember that is not a boolean',
    body: { entryIds: [1], categoryId: 1, remember: 'yes' },
    error: '규칙 저장 여부가 올바르지 않습니다',
  },
];

for (const { path, label, body, error } of invalid) {
  test(`${path} with ${label} is a Korean 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call(path, { method: 'POST', body });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

test('an unknown list filter is a Korean 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/ledger/entries?uncategorized=yes');
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'uncategorized는 true만 쓸 수 있습니다' });
  });
});

test('a malformed rule id is a Korean 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/ledger/rules/x', { method: 'DELETE' });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: '규칙 ID가 올바르지 않습니다' });
  });
});
