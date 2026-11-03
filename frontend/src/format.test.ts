import { expect, test } from 'vitest';

import { formatDecimal, formatUsd, formatWon, serviceToday } from './format';

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
