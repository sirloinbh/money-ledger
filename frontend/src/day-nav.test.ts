import { describe, expect, it } from 'vitest';

import { readDay, weekdayName } from './day-nav';

describe('day navigation helpers', () => {
  it('reads a real date from the address and falls back to today', () => {
    const today = '2026-11-27';
    expect(readDay(new URLSearchParams('date=2026-11-01'), today)).toBe('2026-11-01');
    expect(readDay(new URLSearchParams(''), today)).toBe(today);
    expect(readDay(new URLSearchParams('date=2026-02-30'), today)).toBe(today);
    expect(readDay(new URLSearchParams('date=1899-12-31'), today)).toBe(today);
    expect(readDay(new URLSearchParams('date=abc'), today)).toBe(today);
  });

  it('names days', () => {
    expect(weekdayName('2026-11-27')).toBe('Fri');
  });
});
