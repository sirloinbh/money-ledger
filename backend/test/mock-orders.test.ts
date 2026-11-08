import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { withApi } from './helpers.js';

// Validation runs before the DB: a pool that fails the test if any query or connection reaches it.
const reached = async () => {
  throw new Error('the request should have been rejected before the DB');
};
const noDb = { query: reached, connect: reached } as unknown as Pool;

const valid = {
  securityId: 1,
  side: 'buy',
  quantity: '10',
  requestKey: '0b8f6c7e-5d2a-4c1e-9f3b-2a7d6e8c1f40',
};

const invalid = [
  {
    label: 'a fractional quantity',
    body: { ...valid, quantity: '1.5' },
    error: '수량은 1주 단위의 정수로 입력하세요',
  },
  {
    label: 'a zero quantity',
    body: { ...valid, quantity: '0' },
    error: '수량은 1주 단위의 정수로 입력하세요',
  },
  {
    label: 'a quantity sent as a number',
    body: { ...valid, quantity: 10 },
    error: '수량을 입력하세요',
  },
  {
    label: 'more than 1,000,000 shares',
    body: { ...valid, quantity: '1000001' },
    error: '수량은 1,000,000주 이하로 입력하세요',
  },
  {
    label: 'an unknown side',
    body: { ...valid, side: 'short' },
    error: '매수 또는 매도를 고르세요',
  },
  { label: 'no security', body: { ...valid, securityId: undefined }, error: '종목을 고르세요' },
  {
    label: 'a malformed request key',
    body: { ...valid, requestKey: 'abc' },
    error: '주문 키가 올바르지 않습니다',
  },
  { label: 'a body that is not an object', body: [1], error: '요청 본문은 JSON 객체여야 합니다' },
];

for (const { label, body, error } of invalid) {
  test(`an order with ${label} is a Korean 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call('/api/mock/accounts/1/orders', { method: 'POST', body });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

test('a malformed account id is a Korean 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/mock/accounts/abc/orders', { method: 'POST', body: valid });
    assert.deepEqual(
      [response.status, response.data],
      [400, { error: '모의투자 계좌 ID가 올바르지 않습니다' }],
    );
  });
});

test('a preview with a bad quantity or side is a Korean 400 before the DB', async () => {
  await withApi(noDb, async (call) => {
    const quantity = await call(
      '/api/mock/accounts/1/orders/preview?securityId=1&side=buy&quantity=-1',
    );
    assert.deepEqual(quantity.data, { error: '수량은 1주 단위의 정수로 입력하세요' });
    const side = await call('/api/mock/accounts/1/orders/preview?securityId=1&side=x&quantity=1');
    assert.deepEqual(side.data, { error: '매수 또는 매도를 고르세요' });
    const security = await call(
      '/api/mock/accounts/1/orders/preview?securityId=0&side=buy&quantity=1',
    );
    assert.deepEqual(security.data, { error: '종목 ID가 올바르지 않습니다' });
  });
});
