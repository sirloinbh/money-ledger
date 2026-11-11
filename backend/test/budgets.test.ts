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
  { query: '', error: '월을 YYYY-MM 형식으로 입력하세요' },
  { query: 'month=2026-13', error: '월을 YYYY-MM 형식으로 입력하세요' },
  { query: 'month=2101-01', error: '월은 1900년부터 2100년 사이로 입력하세요' },
];

for (const { query, error } of invalidLists) {
  test(`budgets for "${query}" are a Korean 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call(`/api/ledger/budgets?${query}`);
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

const invalidSaves = [
  { path: '1', body: [], error: '요청 본문은 JSON 객체여야 합니다' },
  { path: '1', body: { amount: 1000 }, error: '월을 YYYY-MM 형식으로 입력하세요' },
  { path: '1', body: { month: '2026-11' }, error: '예산을 숫자로 입력하세요' },
  { path: '1', body: { month: '2026-11', amount: '1000' }, error: '예산을 숫자로 입력하세요' },
  {
    path: '1',
    body: { month: '2026-11', amount: 10.5 },
    error: '예산은 원 단위 정수로 입력하세요',
  },
  { path: '1', body: { month: '2026-11', amount: -1 }, error: '예산은 0원 이상이어야 합니다' },
  {
    path: '1',
    body: { month: '2026-11', amount: Number.MAX_SAFE_INTEGER + 2 },
    error: '예산이 너무 큽니다',
  },
  {
    path: 'abc',
    body: { month: '2026-11', amount: 1000 },
    error: 'Invalid 카테고리 ID',
  },
];

for (const { path, body, error } of invalidSaves) {
  test(`saving a budget ${JSON.stringify(body)} at ${path} is a Korean 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call(`/api/ledger/budgets/${path}`, { method: 'PUT', body });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}
