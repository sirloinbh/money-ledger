import { describe, expect, test, vi } from 'vitest';

import {
  type Asset,
  depreciationBody,
  type Draft,
  draftFromAsset,
  emptyDraft,
  handPrice,
  prepaidBody,
  toBody,
  valuationLines,
} from './asset-model';

// #190 The asset screen's pure helpers, checked without rendering.

const draft = (patch: Partial<Draft>): Draft => ({ ...emptyDraft(), name: 'Asset', ...patch });

const asset = (patch: Partial<Asset>): Asset => ({
  id: 1,
  name: 'Asset',
  type: 'cash',
  currency: 'KRW',
  quantity: null,
  valueKrw: null,
  valueForeign: null,
  memo: '',
  depreciation: null,
  prepaid: null,
  hasTrades: false,
  security: null,
  manualPrice: null,
  price: null,
  fx: null,
  currentValueKrw: null,
  currentValueForeign: null,
  valueIssue: null,
  costKrw: null,
  profitKrw: null,
  returnPercent: null,
  ...patch,
});

describe('toBody', () => {
  test('a cash asset sends its won valuation without separators', () => {
    expect(toBody(draft({ value: '5,000,000', memo: 'note' }))).toEqual({
      body: {
        name: 'Asset',
        type: 'cash',
        currency: 'KRW',
        quantity: null,
        valueKrw: 5000000,
        valueForeign: null,
        memo: 'note',
        securityId: null,
        manualPrice: null,
      },
    });
  });

  test('names the wrong field: no name, no valuation, a won valuation with decimals or above ₩1 quadrillion', () => {
    expect(toBody(draft({ name: ' ' }))).toEqual({ field: 'name', message: 'Enter an asset name' });
    expect(toBody(draft({}))).toMatchObject({ field: 'value' });
    expect(toBody(draft({ value: '1.5' }))).toMatchObject({ field: 'value' });
    expect(toBody(draft({ value: '1000000000000001' }))).toMatchObject({
      field: 'value',
      message: 'Enter a valuation of ₩1 quadrillion or less',
    });
  });

  test('a dollar valuation stays a decimal string', () => {
    expect(toBody(draft({ currency: 'USD', value: '1,234.5678' }))).toMatchObject({
      body: { currency: 'USD', valueKrw: null, valueForeign: '1234.5678' },
    });
    expect(toBody(draft({ currency: 'USD', value: '1.23456' }))).toMatchObject({ field: 'value' });
  });

  test('a linked stock needs a quantity and sends no value; with trades it may hold none', () => {
    const security: Draft['security'] = {
      id: 9,
      market: 'KRX',
      symbol: '005930',
      name: 'Samsung Electronics',
      currency: 'KRW',
      active: true,
    };
    expect(toBody(draft({ type: 'stock', security, value: '100' }))).toMatchObject({
      field: 'quantity',
      message: 'Enter a quantity to link a security',
    });
    expect(toBody(draft({ type: 'stock', security, quantity: '10', value: '100' }))).toMatchObject({
      body: { quantity: '10', valueKrw: null, securityId: 9, currency: 'KRW', manualPrice: null },
    });
    expect(toBody(draft({ type: 'stock', security }), true)).toMatchObject({
      body: { quantity: null, securityId: 9 },
    });
  });

  test('a quantity must be above 0 with up to 8 decimal places, and a debt has none', () => {
    expect(toBody(draft({ quantity: '0', value: '1' }))).toMatchObject({ field: 'quantity' });
    expect(toBody(draft({ quantity: '0.123456789', value: '1' }))).toMatchObject({
      field: 'quantity',
    });
    expect(toBody(draft({ type: 'debt', quantity: '3', value: '1' }))).toMatchObject({
      body: { type: 'debt', quantity: null, valueKrw: 1 },
    });
  });

  test('a prepaid or depreciable asset sends its own part and no value', () => {
    expect(toBody(draft({ type: 'prepaid', prepaidAmount: '300,000' }))).toEqual({
      body: {
        name: 'Asset',
        type: 'prepaid',
        currency: 'KRW',
        quantity: null,
        valueKrw: null,
        valueForeign: null,
        memo: '',
        prepaid: { kind: 'amount', amountKrw: 300000, startsOn: null, expiresOn: null },
      },
    });
    expect(
      toBody(
        draft({
          type: 'depreciable',
          purchasePrice: '1200000',
          purchasedOn: '2026-01-15',
          lifeMonths: '60',
        }),
      ),
    ).toMatchObject({
      body: {
        type: 'depreciable',
        depreciation: {
          purchasePriceKrw: 1200000,
          purchasedOn: '2026-01-15',
          usefulLifeMonths: 60,
          salvageValueKrw: 0,
        },
      },
    });
  });
});

describe('prepaidBody', () => {
  test('a pass needs real start and expiry dates in order', () => {
    const pass = {
      type: 'prepaid' as const,
      prepaidKind: 'period' as const,
      prepaidAmount: '90000',
    };
    expect(prepaidBody(draft({ ...pass, startsOn: '', expiresOn: '2026-03-31' }))).toMatchObject({
      field: 'startsOn',
    });
    expect(
      prepaidBody(draft({ ...pass, startsOn: '2026-04-01', expiresOn: '2026-03-31' })),
    ).toEqual({
      field: 'expiresOn',
      message: 'The expiry date must be on or after the start date',
    });
    expect(
      prepaidBody(draft({ ...pass, startsOn: '2026-01-01', expiresOn: '2026-03-31' })),
    ).toEqual({
      prepaid: {
        kind: 'period',
        amountKrw: 90000,
        startsOn: '2026-01-01',
        expiresOn: '2026-03-31',
      },
    });
  });

  test('a voucher needs a whole-won amount; its expiry is optional but must be real', () => {
    expect(prepaidBody(draft({ prepaidAmount: '12.5' }))).toMatchObject({ field: 'prepaidAmount' });
    expect(prepaidBody(draft({ prepaidAmount: '1000', expiresOn: '2026-02-30' }))).toMatchObject({
      field: 'expiresOn',
    });
  });
});

describe('depreciationBody', () => {
  const base = { purchasePrice: '1000000', purchasedOn: '2026-01-15', lifeMonths: '60' };

  test('refuses a missing or impossible date, a life outside 1-1200 months, and salvage above the price', () => {
    expect(depreciationBody(draft({ ...base, purchasedOn: '' }))).toEqual({
      field: 'purchasedOn',
      message: 'Enter the purchase date',
    });
    expect(depreciationBody(draft({ ...base, purchasedOn: '2026-02-30' }))).toMatchObject({
      field: 'purchasedOn',
    });
    expect(depreciationBody(draft({ ...base, lifeMonths: '0' }))).toMatchObject({
      field: 'lifeMonths',
    });
    expect(depreciationBody(draft({ ...base, lifeMonths: '1201' }))).toMatchObject({
      field: 'lifeMonths',
    });
    expect(depreciationBody(draft({ ...base, salvage: '1000001' }))).toEqual({
      field: 'salvage',
      message: 'The salvage value cannot be more than the purchase price',
    });
  });

  test('an empty salvage value is 0', () => {
    expect(depreciationBody(draft({ ...base, salvage: '' }))).toMatchObject({
      depreciation: { salvageValueKrw: 0 },
    });
  });
});

describe('handPrice', () => {
  test('only for an unlinked stock or other asset, and empty is none', () => {
    expect(handPrice(draft({ type: 'cash', manualPrice: '100' }), false)).toBeNull();
    expect(handPrice(draft({ type: 'stock', manualPrice: '100' }), true)).toBeNull();
    expect(handPrice(draft({ type: 'other' }), false)).toBeNull();
  });

  test('a price without a date is from today; a won price has no decimals', () => {
    vi.useFakeTimers({ now: new Date('2026-11-22T03:00:00Z'), toFake: ['Date'] });
    try {
      expect(handPrice(draft({ type: 'other', manualPrice: '95,000,000' }), false)).toEqual({
        price: '95000000',
        pricedOn: '2026-11-22',
      });
    } finally {
      vi.useRealTimers();
    }
    expect(handPrice(draft({ type: 'other', manualPrice: '1.5' }), false)).toMatchObject({
      field: 'manualPrice',
    });
    expect(
      handPrice(draft({ type: 'other', currency: 'USD', manualPrice: '12.3456' }), false),
    ).toMatchObject({ price: '12.3456' });
    expect(handPrice(draft({ type: 'other', manualPricedOn: '2026-01-01' }), false)).toEqual({
      field: 'manualPrice',
      message: 'Enter the current price',
    });
  });
});

describe('valuationLines', () => {
  test('a delayed close, the rate, and the gain of an asset with trades', () => {
    const lines = valuationLines(
      asset({
        type: 'stock',
        currency: 'USD',
        quantity: '2.00000000',
        hasTrades: true,
        price: {
          price: '150.2500',
          currency: 'USD',
          source: 'close',
          date: '2026-11-06',
          stale: true,
        },
        fx: { fxRate: '1385.2500', rateDate: '2026-11-20', stale: false },
        currentValueKrw: 416265,
        currentValueForeign: '300.5500',
        profitKrw: -1200,
        returnPercent: '-0.29',
      }),
    );
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('$300.55');
    expect(lines[1]).toContain('Delayed · Nov 6 close');
    expect(lines[2]).toBe('Exchange rate ₩1,385.25 · as of Nov 20');
    expect(lines[3]).toBe('Valuation gain/loss -₩1,200 (-0.29%)');
  });

  test('says why a value is left out, and asks for a trade when there is no cost basis', () => {
    expect(valuationLines(asset({ valueIssue: 'no_fx' }))).toEqual([
      'No exchange rate · left out of the totals',
    ]);
    expect(valuationLines(asset({ valueIssue: 'too_large' }))).toEqual([
      'Value too large, so it is left out of the totals',
    ]);
    const handPriced = valuationLines(
      asset({
        type: 'other',
        price: {
          price: '1000.0000',
          currency: 'KRW',
          source: 'manual',
          date: '2026-11-02',
          stale: false,
        },
      }),
    );
    expect(handPriced[0]).toContain('Entered by hand · Nov 2');
    expect(handPriced[1]).toBe('No cost basis · record a trade to see gain/loss');
  });
});

describe('draftFromAsset', () => {
  test('a stored asset fills the form as the inputs show it', () => {
    expect(
      draftFromAsset(
        asset({
          type: 'other',
          currency: 'USD',
          quantity: '1200.50000000',
          valueForeign: '1234.5000',
          manualPrice: { price: '12.3400', pricedOn: '2026-11-01' },
        }),
      ),
    ).toMatchObject({
      quantity: '1,200.5',
      value: '1234.5',
      manualPrice: '12.34',
      manualPricedOn: '2026-11-01',
      salvage: '0',
      prepaidKind: 'amount',
    });
  });

  test('an older depreciable row with only a value offers it as the purchase price', () => {
    expect(draftFromAsset(asset({ type: 'depreciable', valueKrw: 800000 }))).toMatchObject({
      purchasePrice: '800000',
      purchasedOn: '',
    });
  });
});
