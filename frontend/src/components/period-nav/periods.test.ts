// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/period-nav/
import { expect, test } from 'vitest';

import {
  addDays,
  dayLabel,
  lastWeeks,
  periodRange,
  rangeLabel,
  readDateParam,
  stepDays,
  weekDays,
  weekStart,
  writeDateParam,
} from './periods';

test('addDays crosses month, year and leap day boundaries', () => {
  expect(addDays('2026-11-27', -1)).toBe('2026-11-26');
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
});

test('the week starts on Sunday by default and on Monday when asked', () => {
  // 2026-11-27 is a Friday.
  expect(weekStart('2026-11-27')).toBe('2026-11-22');
  expect(weekStart('2026-11-22')).toBe('2026-11-22');
  expect(weekStart('2026-11-27', 1)).toBe('2026-11-23');
  expect(weekStart('2026-11-22', 1)).toBe('2026-11-16');
  expect(weekDays('2026-11-22')).toHaveLength(7);
  expect(weekDays('2026-11-22')[6]).toBe('2026-11-28');
});

test('lastWeeks lists the weeks that end with the current one, oldest first', () => {
  const weeks = lastWeeks('2026-11-27', 12);
  expect(weeks).toHaveLength(12);
  expect(weeks[11]).toBe('2026-11-22');
  expect(weeks[0]).toBe('2026-09-06');
});

test('periodRange gives the day, the week and the 12 weeks around a date', () => {
  expect(periodRange('day', '2026-11-27')).toEqual({ from: '2026-11-27', to: '2026-11-27' });
  expect(periodRange('week', '2026-11-27')).toEqual({ from: '2026-11-22', to: '2026-11-28' });
  expect(periodRange('week', '2026-11-27', 1)).toEqual({ from: '2026-11-23', to: '2026-11-29' });
  expect(periodRange('12weeks', '2026-11-27')).toEqual({ from: '2026-09-06', to: '2026-11-28' });
  expect(stepDays('day')).toBe(1);
  expect(stepDays('week')).toBe(7);
  expect(stepDays('12weeks')).toBe(84);
});

test('the date address parameter accepts only real dates and drops today', () => {
  const read = (query: string) => readDateParam(new URLSearchParams(query), '2026-11-27');
  expect(read('date=2026-10-01')).toBe('2026-10-01');
  expect(read('')).toBe('2026-11-27');
  expect(read('date=2026-02-30')).toBe('2026-11-27');
  expect(read('date=1850-01-01')).toBe('2026-11-27');
  expect(read('date=soon')).toBe('2026-11-27');
  const params = new URLSearchParams('tab=a&date=2026-10-01');
  expect(writeDateParam(params, '2026-10-02', '2026-11-27').toString()).toBe(
    'tab=a&date=2026-10-02',
  );
  expect(writeDateParam(params, '2026-11-27', '2026-11-27').toString()).toBe('tab=a');
  expect(params.get('date')).toBe('2026-10-01');
});

test('labels are English and written out', () => {
  expect(dayLabel('2026-11-27')).toBe('Fri, Nov 27, 2026');
  expect(rangeLabel('2026-11-27', '2026-11-27')).toBe('Fri, Nov 27, 2026');
  expect(rangeLabel('2026-11-22', '2026-11-28')).toBe('Nov 22 – Nov 28');
});
