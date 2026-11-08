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

const cash = { name: '비상금 통장', type: 'cash', currency: 'KRW', valueKrw: 5000000 };
const schedule = { purchasePriceKrw: 1_000_000, purchasedOn: '2026-01-01', usefulLifeMonths: 120 };
const bed = { name: '침대', type: 'depreciable', currency: 'KRW', depreciation: schedule };

const invalid = [
  { label: 'no name', body: { ...cash, name: ' ' }, error: '자산 이름을 입력하세요' },
  { label: 'an unknown type', body: { ...cash, type: 'gold' }, error: '자산 종류를 고르세요' },
  {
    label: 'an unknown currency',
    body: { ...cash, currency: 'JPY' },
    error: '통화는 KRW 또는 USD 중에서 고르세요',
  },
  {
    label: 'a fractional won value',
    body: { ...cash, valueKrw: 10.5 },
    error: '원화 평가금액은 원 단위 정수로 입력하세요',
  },
  {
    label: 'a negative value',
    body: { ...cash, valueKrw: -1 },
    error: '평가금액은 0 이상이어야 합니다',
  },
  {
    label: 'a value over 1,000조 won',
    body: { ...cash, valueKrw: 1_000_000_000_000_001 },
    error: '평가금액은 1,000조 원 이하로 입력하세요',
  },
  {
    label: 'a USD value on a won asset',
    body: { ...cash, valueKrw: null, valueForeign: '10.00' },
    error: '원화 자산의 평가금액은 원 단위로 입력하세요',
  },
  {
    label: 'a won value on a USD asset',
    body: { ...cash, currency: 'USD' },
    error: '달러 자산의 평가금액은 달러로 입력하세요',
  },
  {
    label: 'neither quantity nor value',
    body: { name: '삼성전자', type: 'stock', currency: 'KRW' },
    error: '수량이 없는 자산은 평가금액을 입력하세요',
  },
  {
    label: 'a quantity of zero',
    body: { name: '삼성전자', type: 'stock', currency: 'KRW', quantity: '0.000' },
    error: '수량은 0보다 커야 합니다',
  },
  {
    label: 'a quantity with 9 decimals',
    body: { name: '비트코인', type: 'other', currency: 'KRW', quantity: '0.123456789' },
    error: '수량은 정수 12자리, 소수 8자리까지 입력하세요',
  },
  {
    label: 'a quantity sent as a number',
    body: { name: '삼성전자', type: 'stock', currency: 'KRW', quantity: 10 },
    error: '수량은 소수 문자열로 보내세요',
  },
  {
    label: 'a USD value with 5 decimals',
    body: { name: '달러 예금', type: 'cash', currency: 'USD', valueForeign: '1.12345' },
    error: '외화 평가금액은 정수 16자리, 소수 4자리까지 입력하세요',
  },
  {
    label: 'a quantity on a debt',
    body: { name: '전세 대출', type: 'debt', currency: 'KRW', quantity: '1', valueKrw: 1 },
    error: '부채에는 수량을 넣을 수 없습니다',
  },
  // #63 Depreciating assets.
  {
    label: 'a depreciable type without a schedule',
    body: { name: '침대', type: 'depreciable', currency: 'KRW', valueKrw: 1000 },
    error: '감가상각 자산은 구입가, 구입일, 사용 기간을 입력하세요',
  },
  {
    label: 'a schedule on another type',
    body: { ...cash, depreciation: schedule },
    error: '감가상각 정보는 감가상각 자산에만 넣을 수 있습니다',
  },
  {
    label: 'a USD depreciating asset',
    body: { ...bed, currency: 'USD' },
    error: '감가상각 자산은 원화로 입력하세요',
  },
  {
    label: 'a value next to a schedule',
    body: { ...bed, valueKrw: 1000 },
    error: '감가상각 자산은 평가금액 대신 구입가로 현재 가치를 계산합니다',
  },
  {
    label: 'a salvage value above the purchase price',
    body: { ...bed, depreciation: { ...schedule, salvageValueKrw: 1_000_001 } },
    error: '잔존 가치는 구입가보다 클 수 없습니다',
  },
  {
    label: 'a negative purchase price',
    body: { ...bed, depreciation: { ...schedule, purchasePriceKrw: -1 } },
    error: '구입가는 0 이상이어야 합니다',
  },
  {
    label: 'a purchase price over 1,000조 won',
    body: { ...bed, depreciation: { ...schedule, purchasePriceKrw: 1_000_000_000_000_001 } },
    error: '구입가는 1,000조 원 이하로 입력하세요',
  },
  {
    label: 'a missing purchase date',
    body: { ...bed, depreciation: { ...schedule, purchasedOn: undefined } },
    error: '날짜를 YYYY-MM-DD 형식으로 입력하세요',
  },
  {
    label: 'a purchase date that does not exist',
    body: { ...bed, depreciation: { ...schedule, purchasedOn: '2026-02-30' } },
    error: '없는 날짜입니다',
  },
  {
    label: 'a useful life of 0 months',
    body: { ...bed, depreciation: { ...schedule, usefulLifeMonths: 0 } },
    error: '사용 기간은 1개월 이상이어야 합니다',
  },
  {
    label: 'a fractional useful life',
    body: { ...bed, depreciation: { ...schedule, usefulLifeMonths: 1.5 } },
    error: '사용 기간은 개월 단위 정수로 입력하세요',
  },
  {
    label: 'a useful life over 100 years',
    body: { ...bed, depreciation: { ...schedule, usefulLifeMonths: 1201 } },
    error: '사용 기간은 1200개월(100년) 이하로 입력하세요',
  },
];

for (const { label, body, error } of invalid) {
  test(`an asset with ${label} is a Korean 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call('/api/portfolio/assets', { method: 'POST', body });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

test('a malformed asset id is a Korean 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/portfolio/assets/x', { method: 'DELETE' });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: '자산 ID가 올바르지 않습니다' });
  });
});

test('a list date that does not exist is a Korean 400 before the DB', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/portfolio/assets?asOf=2026-13-01');
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: '없는 날짜입니다' });
  });
});
