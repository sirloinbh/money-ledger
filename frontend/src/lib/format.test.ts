// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/lib/
import { expect, test } from 'vitest';

import { optionalNumber } from '../components/ui/number-step';
import { formatDate, formatDuration, formatNumber, plural, serviceToday } from './format';

test('plural picks the singular only for exactly one and groups the count', () => {
  expect(plural(1, 'set')).toBe('1 set');
  expect(plural(0, 'set')).toBe('0 sets');
  expect(plural(3, 'set')).toBe('3 sets');
  expect(plural(1200, 'set')).toBe('1,200 sets');
  expect(plural(-1, 'point')).toBe('-1 point');
  expect(plural(2, 'person', 'people')).toBe('2 people');
  expect(plural(1, 'person', 'people')).toBe('1 person');
});

test('formatNumber groups digits, trims to two decimals and hides what is not a number', () => {
  expect(formatNumber(1234567)).toBe('1,234,567');
  expect(formatNumber(1234.5)).toBe('1,234.5');
  expect(formatNumber(1.23456)).toBe('1.23');
  expect(formatNumber(1.23456, 4)).toBe('1.2346');
  expect(formatNumber(-0.5)).toBe('-0.5');
  expect(formatNumber(Number.NaN)).toBe('');
  expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('');
});

test('formatDuration writes hours and minutes', () => {
  expect(formatDuration(0)).toBe('0m');
  expect(formatDuration(45)).toBe('45m');
  expect(formatDuration(60)).toBe('1h');
  expect(formatDuration(135)).toBe('2h 15m');
  expect(formatDuration(1500)).toBe('25h');
  expect(formatDuration(59.6)).toBe('1h');
  expect(formatDuration(-5)).toBe('0m');
  expect(formatDuration(Number.NaN)).toBe('0m');
});

test('formatDate writes a day in three styles and returns bad text unchanged', () => {
  expect(formatDate('2026-11-28')).toBe('Nov 28, 2026');
  expect(formatDate('2026-11-28', 'short')).toBe('Nov 28');
  expect(formatDate('2026-11-28', 'long')).toBe('Sat, Nov 28, 2026');
  expect(formatDate('2024-02-29')).toBe('Feb 29, 2024');
  expect(formatDate('2026-02-30')).toBe('2026-02-30');
  expect(formatDate('yesterday')).toBe('yesterday');
});

test('serviceToday is the day in Asia/Seoul, not in UTC', () => {
  expect(serviceToday(new Date('2026-11-27T14:59:59Z'))).toBe('2026-11-27');
  expect(serviceToday(new Date('2026-11-27T15:00:00Z'))).toBe('2026-11-28');
  expect(serviceToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('optionalNumber (the shared amount reader) accepts up to 15 significant digits', () => {
  expect(optionalNumber('123456789012345')).toBe(123456789012345);
  expect(optionalNumber('1234567890.12345')).toBe(1234567890.12345);
  expect(optionalNumber('0.000000000000001')).toBe(1e-15);
  expect(optionalNumber('-123456789012345')).toBe(-123456789012345);
  expect(optionalNumber('1234567890123456')).toBeNaN();
  expect(optionalNumber('12345678901234.567')).toBeNaN();
  expect(optionalNumber('')).toBeNull();
});
