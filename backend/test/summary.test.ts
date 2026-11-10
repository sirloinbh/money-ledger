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
  { query: '', error: '월을 YYYY-MM 형식으로 입력하세요' },
  { query: 'month=2026-13', error: '월을 YYYY-MM 형식으로 입력하세요' },
  { query: 'month=2026-1', error: '월을 YYYY-MM 형식으로 입력하세요' },
  { query: 'month=2026-11-01', error: '월을 YYYY-MM 형식으로 입력하세요' },
  { query: 'month=2026-11&month=2026-12', error: '월을 YYYY-MM 형식으로 입력하세요' },
  { query: 'month=1899-12', error: '월은 1900년부터 2100년 사이로 입력하세요' },
];

for (const { query, error } of invalid) {
  test(`a summary for "${query}" is a Korean 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call(`/api/ledger/summary?${query}`);
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}
