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
    error: '시작 금액을 숫자로 입력하세요',
  },
  {
    label: 'a fractional amount',
    body: { initialCashKrw: 10000.5 },
    error: '시작 금액은 원 단위 정수로 입력하세요',
  },
  {
    label: 'an amount under 1만 원',
    body: { initialCashKrw: 9999 },
    error: '시작 금액은 1만 원 이상이어야 합니다',
  },
  {
    label: 'an amount over 100억 원',
    body: { initialCashKrw: 10_000_000_001 },
    error: '시작 금액은 100억 원 이하로 입력하세요',
  },
  { label: 'a body that is not an object', body: [1], error: '요청 본문은 JSON 객체여야 합니다' },
];

for (const { label, body, error } of invalid) {
  for (const path of ['/api/mock/accounts', '/api/mock/accounts/1/reset']) {
    test(`${path} with ${label} is a Korean 400 before the DB`, async () => {
      await withApi(noDb, async (call) => {
        const response = await call(path, { method: 'POST', body });
        assert.equal(response.status, 400);
        assert.deepEqual(response.data, { error });
      });
    });
  }
}

test('a malformed account id on reset is a Korean 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/mock/accounts/abc/reset', { method: 'POST', body: {} });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: '모의투자 계좌 ID가 올바르지 않습니다' });
  });
});
