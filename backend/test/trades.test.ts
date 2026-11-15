import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { withApi } from './helpers.js';

// Validation runs before the DB: a pool that fails the test if any query reaches it.
const noDb = {
  query: async () => {
    throw new Error('the request should have been rejected before the DB');
  },
  connect: async () => {
    throw new Error('the request should have been rejected before the DB');
  },
} as unknown as Pool;

const buy = { side: 'buy', tradedOn: '2026-01-02', quantity: '10', price: '1000' };

const invalid = [
  { label: 'no side', body: { ...buy, side: 'hold' }, error: 'Choose buy or sell' },
  {
    label: 'no date',
    body: { ...buy, tradedOn: undefined },
    error: 'Enter the date as YYYY-MM-DD',
  },
  {
    label: 'a zero quantity',
    body: { ...buy, quantity: '0' },
    error: 'The quantity must be above 0',
  },
  {
    label: 'a quantity with 9 decimals',
    body: { ...buy, quantity: '0.123456789' },
    error: 'Enter the quantity with up to 12 integer and 8 decimal digits',
  },
  {
    label: 'a number quantity',
    body: { ...buy, quantity: 10 },
    error: 'Send the quantity as a decimal string',
  },
  {
    label: 'a zero price',
    body: { ...buy, price: '0.0' },
    error: 'The unit price must be above 0',
  },
  {
    label: 'a price with 5 decimals',
    body: { ...buy, price: '1.12345' },
    error: 'Enter the unit price with up to 16 integer and 4 decimal digits',
  },
  {
    label: 'a zero rate',
    body: { ...buy, fxRate: '0' },
    error: 'The exchange rate must be above 0',
  },
  {
    label: 'a negative fee',
    body: { ...buy, feeKrw: -1 },
    error: 'The fee must be ₩0 or more',
  },
  {
    label: 'a fractional tax',
    body: { ...buy, taxKrw: 1.5 },
    error: 'Enter the tax as a whole number of won',
  },
  {
    label: 'a memo over 100 characters',
    body: { ...buy, memo: 'a'.repeat(101) },
    error: 'The note must be 100 characters or fewer',
  },
];

for (const { label, body, error } of invalid) {
  test(`a trade with ${label} is a 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call('/api/portfolio/assets/1/trades', { method: 'POST', body });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

test('a trade dated after today is a 400 before the DB', async () => {
  await withApi(
    noDb,
    async (call) => {
      const response = await call('/api/portfolio/assets/1/trades', {
        method: 'POST',
        body: { ...buy, tradedOn: '2026-01-03' },
      });
      assert.deepEqual(response.data, { error: 'Trades dated after today cannot be recorded' });
    },
    { today: () => '2026-01-02' },
  );
});

test('malformed asset and trade ids are 400s', async () => {
  await withApi(noDb, async (call) => {
    const asset = await call('/api/portfolio/assets/x/trades');
    assert.deepEqual(asset.data, { error: 'Invalid asset ID' });
    const trade = await call('/api/portfolio/assets/1/trades/x', { method: 'DELETE' });
    assert.deepEqual(trade.data, { error: 'Invalid trade ID' });
  });
});
