import { describe, expect, it } from 'vitest';

import { dayLabel, readDay, shiftDays, weekdayName, weekStart } from './day-nav';

describe('day navigation helpers', () => {
  it('reads a real date from the address and falls back to today', () => {
    const today = '2026-11-27';
    expect(readDay(new URLSearchParams('date=2026-11-01'), today)).toBe('2026-11-01');
    expect(readDay(new URLSearchParams(''), today)).toBe(today);
    expect(readDay(new URLSearchParams('date=2026-02-30'), today)).toBe(today);
    expect(readDay(new URLSearchParams('date=1899-12-31'), today)).toBe(today);
    expect(readDay(new URLSearchParams('date=abc'), today)).toBe(today);
  });

  it('moves across month and year ends', () => {
    expect(shiftDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDays('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('finds the Sunday of a week', () => {
    expect(weekStart('2026-11-27')).toBe('2026-11-22'); // a Friday
    expect(weekStart('2026-11-22')).toBe('2026-11-22'); // a Sunday
    expect(weekStart('2026-11-28')).toBe('2026-11-22'); // a Saturday
  });

  it('names days', () => {
    expect(weekdayName('2026-11-27')).toBe('Fri');
    expect(dayLabel('2026-11-27')).toBe('Fri, Nov 27, 2026');
  });
});
