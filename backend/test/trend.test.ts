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
    error: '시작 월을 YYYY-MM 형식으로 입력하세요, 끝 월을 YYYY-MM 형식으로 입력하세요',
  },
  { query: 'from=2026-01', error: '끝 월을 YYYY-MM 형식으로 입력하세요' },
  { query: 'from=2026-1&to=2026-12', error: '시작 월을 YYYY-MM 형식으로 입력하세요' },
  { query: 'from=2026-01&to=2026-13', error: '끝 월을 YYYY-MM 형식으로 입력하세요' },
  { query: 'from=2026-01&to=2026-12&to=2026-11', error: '끝 월을 YYYY-MM 형식으로 입력하세요' },
  { query: 'from=1899-12&to=1900-05', error: '시작 월은 1900년부터 2100년 사이로 입력하세요' },
  { query: 'from=2100-06&to=2101-01', error: '끝 월은 1900년부터 2100년 사이로 입력하세요' },
  { query: 'from=2026-12&to=2026-11', error: '시작 월이 끝 월보다 늦습니다' },
  { query: 'from=2024-11&to=2026-11', error: '기간은 24개월까지 볼 수 있습니다' },
];

for (const { query, error } of invalid) {
  test(`a trend for "${query}" is a Korean 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call(`/api/ledger/trend?${query}`);
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}
