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

const cash = { name: 'Emergency fund account', type: 'cash', currency: 'KRW', valueKrw: 5000000 };
const schedule = { purchasePriceKrw: 1_000_000, purchasedOn: '2026-01-01', usefulLifeMonths: 120 };
const bed = { name: 'Bed', type: 'depreciable', currency: 'KRW', depreciation: schedule };
const pass = { kind: 'period', amountKrw: 270000, startsOn: '2026-01-01', expiresOn: '2026-03-31' };
const gym = { name: 'Gym', type: 'prepaid', currency: 'KRW', prepaid: pass };

const invalid = [
  { label: 'no name', body: { ...cash, name: ' ' }, error: 'Enter an asset name' },
  { label: 'an unknown type', body: { ...cash, type: 'gold' }, error: 'Choose an asset type' },
  {
    label: 'an unknown currency',
    body: { ...cash, currency: 'JPY' },
    error: 'Choose KRW or USD as the currency',
  },
  {
    label: 'a fractional won value',
    body: { ...cash, valueKrw: 10.5 },
    error: 'Enter the valuation in won as a whole number',
  },
  {
    label: 'a negative value',
    body: { ...cash, valueKrw: -1 },
    error: 'The valuation must be 0 or more',
  },
  {
    label: 'a value over ₩1 quadrillion',
    body: { ...cash, valueKrw: 1_000_000_000_000_001 },
    error: 'Enter a valuation of ₩1 quadrillion or less',
  },
  {
    label: 'a USD value on a won asset',
    body: { ...cash, valueKrw: null, valueForeign: '10.00' },
    error: 'Enter the valuation of a won asset in won',
  },
  {
    label: 'a won value on a USD asset',
    body: { ...cash, currency: 'USD' },
    error: 'Enter the valuation of a dollar asset in dollars',
  },
  {
    label: 'neither quantity nor value',
    body: { name: 'Samsung Electronics', type: 'stock', currency: 'KRW' },
    error: 'Enter a valuation for an asset without a quantity',
  },
  {
    label: 'a quantity of zero',
    body: { name: 'Samsung Electronics', type: 'stock', currency: 'KRW', quantity: '0.000' },
    error: 'The quantity must be above 0',
  },
  {
    label: 'a quantity with 9 decimals',
    body: { name: 'Bitcoin', type: 'other', currency: 'KRW', quantity: '0.123456789' },
    error: 'Enter the quantity with up to 12 integer and 8 decimal digits',
  },
  {
    label: 'a quantity sent as a number',
    body: { name: 'Samsung Electronics', type: 'stock', currency: 'KRW', quantity: 10 },
    error: 'Send the quantity as a decimal string',
  },
  {
    label: 'a USD value with 5 decimals',
    body: { name: 'Dollar deposit', type: 'cash', currency: 'USD', valueForeign: '1.12345' },
    error: 'Enter the foreign-currency valuation with up to 16 integer and 4 decimal digits',
  },
  {
    label: 'a quantity on a debt',
    body: { name: 'Lease deposit loan', type: 'debt', currency: 'KRW', quantity: '1', valueKrw: 1 },
    error: 'A liability cannot have a quantity',
  },
  // #63 Depreciating assets.
  {
    label: 'a depreciable type without a schedule',
    body: { name: 'Bed', type: 'depreciable', currency: 'KRW', valueKrw: 1000 },
    error: 'A depreciable asset needs a purchase price, purchase date, and useful life',
  },
  {
    label: 'a schedule on another type',
    body: { ...cash, depreciation: schedule },
    error: 'Depreciation info can only go on a depreciable asset',
  },
  {
    label: 'a USD depreciating asset',
    body: { ...bed, currency: 'USD' },
    error: 'A depreciable asset must be in won',
  },
  {
    label: 'a value next to a schedule',
    body: { ...bed, valueKrw: 1000 },
    error: 'A depreciable asset is valued from the purchase price, not from a valuation',
  },
  {
    label: 'a salvage value above the purchase price',
    body: { ...bed, depreciation: { ...schedule, salvageValueKrw: 1_000_001 } },
    error: 'The salvage value cannot be more than the purchase price',
  },
  {
    label: 'a negative purchase price',
    body: { ...bed, depreciation: { ...schedule, purchasePriceKrw: -1 } },
    error: 'The purchase price must be ₩0 or more',
  },
  {
    label: 'a purchase price over ₩1 quadrillion',
    body: { ...bed, depreciation: { ...schedule, purchasePriceKrw: 1_000_000_000_000_001 } },
    error: 'Enter a purchase price of ₩1 quadrillion or less',
  },
  {
    label: 'a missing purchase date',
    body: { ...bed, depreciation: { ...schedule, purchasedOn: undefined } },
    error: 'Enter the date as YYYY-MM-DD',
  },
  {
    label: 'a purchase date that does not exist',
    body: { ...bed, depreciation: { ...schedule, purchasedOn: '2026-02-30' } },
    error: 'That date does not exist',
  },
  {
    label: 'a useful life of 0 months',
    body: { ...bed, depreciation: { ...schedule, usefulLifeMonths: 0 } },
    error: 'The useful life must be at least 1 month',
  },
  {
    label: 'a fractional useful life',
    body: { ...bed, depreciation: { ...schedule, usefulLifeMonths: 1.5 } },
    error: 'Enter the useful life as a whole number of months',
  },
  {
    label: 'a useful life over 100 years',
    body: { ...bed, depreciation: { ...schedule, usefulLifeMonths: 1201 } },
    error: 'Enter a useful life of 1200 months (100 years) or less',
  },
  // #64 Prepaid assets.
  {
    label: 'a prepaid type without its details',
    body: { name: 'Gym', type: 'prepaid', currency: 'KRW', valueKrw: 1000 },
    error: 'A prepaid asset needs a voucher or pass kind and the amount paid',
  },
  {
    label: 'prepaid details on another type',
    body: { ...cash, prepaid: pass },
    error: 'Prepaid info can only go on a prepaid asset',
  },
  {
    label: 'an unknown prepaid kind',
    body: { ...gym, prepaid: { ...pass, kind: 'count' } },
    error: 'Choose a prepaid kind: voucher or pass',
  },
  {
    label: 'a USD prepaid asset',
    body: { ...gym, currency: 'USD' },
    error: 'A prepaid asset must be in won',
  },
  {
    label: 'a value next to prepaid details',
    body: { ...gym, valueKrw: 1 },
    error: 'A prepaid asset is valued from the amount paid, not from a valuation',
  },
  {
    label: 'a negative prepaid amount',
    body: { ...gym, prepaid: { ...pass, amountKrw: -1 } },
    error: 'The amount paid must be ₩0 or more',
  },
  {
    label: 'a pass without an expiry',
    body: { ...gym, prepaid: { ...pass, expiresOn: null } },
    error: 'A pass needs a start date and an expiry date',
  },
  {
    label: 'a pass that ends before it starts',
    body: { ...gym, prepaid: { ...pass, expiresOn: '2025-12-31' } },
    error: 'The expiry date must be on or after the start date',
  },
  {
    label: 'a stored value with a start date',
    body: { ...gym, prepaid: { kind: 'amount', amountKrw: 1, startsOn: '2026-01-01' } },
    error: 'A voucher has no start date',
  },
  {
    label: 'an expiry that does not exist',
    body: { ...gym, prepaid: { ...pass, expiresOn: '2026-02-30' } },
    error: 'That date does not exist',
  },
];

for (const { label, body, error } of invalid) {
  test(`an asset with ${label} is a 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call('/api/portfolio/assets', { method: 'POST', body });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

test('a malformed asset id is a 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/portfolio/assets/x', { method: 'DELETE' });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'Invalid asset ID' });
  });
});

test('a list date that does not exist is a 400 before the DB', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/portfolio/assets?asOf=2026-13-01');
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'That date does not exist' });
  });
});

// #64 Uses of a stored-value prepaid asset.
const usageInvalid = [
  { label: 'no date', body: { amountKrw: 1000 }, error: 'Enter the date as YYYY-MM-DD' },
  {
    label: 'a zero amount',
    body: { usedOn: '2026-01-01', amountKrw: 0 },
    error: 'The amount used must be at least ₩1',
  },
  {
    label: 'a fractional amount',
    body: { usedOn: '2026-01-01', amountKrw: 1.5 },
    error: 'Enter the amount used as a whole number of won',
  },
  {
    label: 'a memo over 100 characters',
    body: { usedOn: '2026-01-01', amountKrw: 1, memo: 'a'.repeat(101) },
    error: 'The note must be 100 characters or fewer',
  },
];

for (const { label, body, error } of usageInvalid) {
  test(`a use with ${label} is a 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call('/api/portfolio/assets/1/usages', { method: 'POST', body });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

test('a malformed use id is a 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/portfolio/assets/1/usages/x', { method: 'DELETE' });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'Invalid usage record ID' });
  });
});
