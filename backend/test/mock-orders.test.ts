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
  expectedPrice: '70600.0000',
  expectedPriceDate: '2026-11-06',
  expectedFxRate: null,
};

const invalid = [
  {
    label: 'a fractional quantity',
    body: { ...valid, quantity: '1.5' },
    error: 'Enter the quantity as a whole number of shares',
  },
  {
    label: 'a zero quantity',
    body: { ...valid, quantity: '0' },
    error: 'Enter the quantity as a whole number of shares',
  },
  {
    label: 'a quantity sent as a number',
    body: { ...valid, quantity: 10 },
    error: 'Enter the quantity',
  },
  {
    label: 'more than 1,000,000 shares',
    body: { ...valid, quantity: '1000001' },
    error: 'Enter 1,000,000 shares or fewer',
  },
  {
    label: 'an unknown side',
    body: { ...valid, side: 'short' },
    error: 'Choose buy or sell',
  },
  { label: 'no security', body: { ...valid, securityId: undefined }, error: 'Choose a security' },
  {
    label: 'a malformed request key',
    body: { ...valid, requestKey: 'abc' },
    error: 'The order key is not valid',
  },
  {
    label: 'no confirmed price',
    body: { ...valid, expectedPrice: undefined },
    error: 'No confirmed quote. Review the order again',
  },
  {
    label: 'a body that is not an object',
    body: [1],
    error: 'The request body must be a JSON object',
  },
];

for (const { label, body, error } of invalid) {
  test(`an order with ${label} is a 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call('/api/mock/accounts/1/orders', { method: 'POST', body });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

test('a malformed account id is a 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/mock/accounts/abc/orders', { method: 'POST', body: valid });
    assert.deepEqual([response.status, response.data], [400, { error: 'Invalid mock account ID' }]);
  });
});

test('a preview with a bad quantity or side is a 400 before the DB', async () => {
  await withApi(noDb, async (call) => {
    const quantity = await call(
      '/api/mock/accounts/1/orders/preview?securityId=1&side=buy&quantity=-1',
    );
    assert.deepEqual(quantity.data, { error: 'Enter the quantity as a whole number of shares' });
    const side = await call('/api/mock/accounts/1/orders/preview?securityId=1&side=x&quantity=1');
    assert.deepEqual(side.data, { error: 'Choose buy or sell' });
    const security = await call(
      '/api/mock/accounts/1/orders/preview?securityId=0&side=buy&quantity=1',
    );
    assert.deepEqual(security.data, { error: 'The security ID is not valid' });
  });
});
