import { expect, test } from 'vitest';

import {
  formatDateTime,
  formatDecimal,
  formatUsd,
  formatWon,
  serviceToday,
  signedPercent,
  withoutThousands,
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
  expect(text).toContain('2026. 11. 5.');
  expect(text).toContain('12:30');
});

test('today follows Asia/Seoul across the UTC day boundary', () => {
  expect(serviceToday(new Date('2026-11-02T14:59:59Z'))).toBe('2026-11-02');
  expect(serviceToday(new Date('2026-11-02T15:00:00Z'))).toBe('2026-11-03');
});

test('won amounts get thousands separators and 원', () => {
  expect(formatWon(0)).toBe('0원');
  expect(formatWon(12500)).toBe('12,500원');
  expect(formatWon(3000000)).toBe('3,000,000원');
});

test('decimal strings lose trailing zeros and keep every digit', () => {
  expect(formatDecimal('1.50000000')).toBe('1.5');
  expect(formatDecimal('10.00000000')).toBe('10');
  expect(formatDecimal('1234567.0001')).toBe('1,234,567.0001');
  expect(formatDecimal('0.12345678')).toBe('0.12345678');
  expect(formatUsd('1234.5000')).toBe('1,234.5달러');
});

test('signedPercent shows the sign of a percentage from the API without trailing zeros', () => {
  expect(signedPercent('13.31')).toBe('+13.31%');
  expect(signedPercent('100.00')).toBe('+100%');
  expect(signedPercent('-0.05')).toBe('-0.05%');
  expect(signedPercent('-1.50')).toBe('-1.5%');
  expect(signedPercent('0.00')).toBe('0%');
  expect(signedPercent('-0.00')).toBe('0%');
});
