import { expect, test } from 'vitest';

import { formatWon, serviceToday } from './format';

test('today follows Asia/Seoul across the UTC day boundary', () => {
  expect(serviceToday(new Date('2026-11-02T14:59:59Z'))).toBe('2026-11-02');
  expect(serviceToday(new Date('2026-11-02T15:00:00Z'))).toBe('2026-11-03');
});

test('won amounts get thousands separators and 원', () => {
  expect(formatWon(0)).toBe('0원');
  expect(formatWon(12500)).toBe('12,500원');
  expect(formatWon(3000000)).toBe('3,000,000원');
});
