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
  { label: 'no side', body: { ...buy, side: 'hold' }, error: '매수 또는 매도를 고르세요' },
  {
    label: 'no date',
    body: { ...buy, tradedOn: undefined },
    error: '날짜를 YYYY-MM-DD 형식으로 입력하세요',
  },
  { label: 'a zero quantity', body: { ...buy, quantity: '0' }, error: '수량은 0보다 커야 합니다' },
  {
    label: 'a quantity with 9 decimals',
    body: { ...buy, quantity: '0.123456789' },
    error: '수량은 정수 12자리, 소수 8자리까지 입력하세요',
  },
  {
    label: 'a number quantity',
    body: { ...buy, quantity: 10 },
    error: '수량은 소수 문자열로 보내세요',
  },
  { label: 'a zero price', body: { ...buy, price: '0.0' }, error: '단가는 0보다 커야 합니다' },
  {
    label: 'a price with 5 decimals',
    body: { ...buy, price: '1.12345' },
    error: '단가는 정수 16자리, 소수 4자리까지 입력하세요',
  },
  { label: 'a zero rate', body: { ...buy, fxRate: '0' }, error: '환율은 0보다 커야 합니다' },
  {
    label: 'a negative fee',
    body: { ...buy, feeKrw: -1 },
    error: '수수료는 0원 이상이어야 합니다',
  },
  {
    label: 'a fractional tax',
    body: { ...buy, taxKrw: 1.5 },
    error: '세금은 원 단위 정수로 입력하세요',
  },
  {
    label: 'a memo over 100 characters',
    body: { ...buy, memo: 'a'.repeat(101) },
    error: '메모는 100자 이하로 입력하세요',
  },
];

for (const { label, body, error } of invalid) {
  test(`a trade with ${label} is a Korean 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call('/api/portfolio/assets/1/trades', { method: 'POST', body });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

test('a trade dated after today is a Korean 400 before the DB', async () => {
  await withApi(
    noDb,
    async (call) => {
      const response = await call('/api/portfolio/assets/1/trades', {
        method: 'POST',
        body: { ...buy, tradedOn: '2026-01-03' },
      });
      assert.deepEqual(response.data, { error: '오늘 이후 날짜의 거래는 기록할 수 없습니다' });
    },
    { today: () => '2026-01-02' },
  );
});

test('malformed asset and trade ids are Korean 400s', async () => {
  await withApi(noDb, async (call) => {
    const asset = await call('/api/portfolio/assets/x/trades');
    assert.deepEqual(asset.data, { error: '자산 ID가 올바르지 않습니다' });
    const trade = await call('/api/portfolio/assets/1/trades/x', { method: 'DELETE' });
    assert.deepEqual(trade.data, { error: '거래 ID가 올바르지 않습니다' });
  });
});
