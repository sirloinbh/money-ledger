import { expect, test } from 'vitest';

import {
  formatDateTime,
  formatDecimal,
  formatUsd,
  formatWon,
  realDate,
  sharesOf,
  signedPercent,
  withoutThousands,
  wonFromDigits,
} from './format';

test('commas are dropped only when they separate thousands', () => {
  expect(withoutThousands(' 10,000,000 ')).toBe('10000000');
  expect(withoutThousands('1,234.5')).toBe('1234.5');
  expect(withoutThousands('1,2,3')).toBe('1,2,3');
  expect(withoutThousands('12,34')).toBe('12,34');
});

test('API times are shown in Asia/Seoul', () => {
  // 15:30 UTC is already the next day in Seoul.
  const text = formatDateTime('2026-11-04T15:30:00.000Z');
  expect(text).toContain('Nov 5, 2026');
  expect(text).toContain('12:30');
});

test('won amounts get a currency symbol and thousands separators', () => {
  expect(formatWon(0)).toBe('₩0');
  expect(formatWon(12500)).toBe('₩12,500');
  expect(formatWon(3000000)).toBe('₩3,000,000');
});

test('decimal strings lose trailing zeros and keep every digit', () => {
  expect(formatDecimal('1.50000000')).toBe('1.5');
  expect(formatDecimal('10.00000000')).toBe('10');
  expect(formatDecimal('1234567.0001')).toBe('1,234,567.0001');
  expect(formatDecimal('0.12345678')).toBe('0.12345678');
  expect(formatUsd('1234.5000')).toBe('$1,234.5');
});

test('signedPercent shows the sign of a percentage from the API without trailing zeros', () => {
  expect(signedPercent('13.31')).toBe('+13.31%');
  expect(signedPercent('100.00')).toBe('+100%');
  expect(signedPercent('-0.05')).toBe('-0.05%');
  expect(signedPercent('-1.50')).toBe('-1.5%');
  expect(signedPercent('0.00')).toBe('0%');
  expect(signedPercent('-0.00')).toBe('0%');
});

test('shares take the singular for exactly one (#203)', () => {
  expect(sharesOf('1.00000000')).toBe('1 share');
  expect(sharesOf('1')).toBe('1 share');
  expect(sharesOf('1.50000000')).toBe('1.5 shares');
  expect(sharesOf('0.10000000')).toBe('0.1 shares');
  expect(sharesOf('1200.00000000')).toBe('1,200 shares');
});

test('whole won is 0 to ₩1 trillion, the cap the server checks (#186)', () => {
  expect(wonFromDigits('0')).toBe(0);
  expect(wonFromDigits('1000000000000')).toBe(1_000_000_000_000);
  expect(wonFromDigits('1000000000001')).toBeUndefined();
  expect(wonFromDigits('99999999999999999')).toBeUndefined();
  expect(wonFromDigits('1.5')).toBeUndefined();
  expect(wonFromDigits('-1')).toBeUndefined();
  expect(wonFromDigits('')).toBeUndefined();
});

test('a real date uses the same rule as the server (#186)', () => {
  expect(realDate('2024-02-29')).toBe(true);
  expect(realDate('2026-02-30')).toBe(false);
  expect(realDate('1899-12-31')).toBe(false);
  expect(realDate('2101-01-01')).toBe(false);
  expect(realDate('2026-1-5')).toBe(false);
});
