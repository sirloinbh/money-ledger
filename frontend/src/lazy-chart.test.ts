import { expect, test } from 'vitest';

import { axisName } from './lazy-chart';

// #202 Axis names are cut by width, not by a fixed 8 characters.

test('English names that fit the axis are whole', () => {
  expect(axisName('Real estate')).toBe('Real estate');
  expect(axisName('Transportation')).toBe('Transportati…');
  expect(axisName('Transportati')).toBe('Transportati');
});

test('a wide character counts as two', () => {
  expect(axisName('주거비')).toBe('주거비');
  expect(axisName('경조사비와선물')).toBe('경조사비와선…');
  // Mixed: 6 + 2 = 8 units, fits.
  expect(axisName('ETF 투자')).toBe('ETF 투자');
});

test('the cut name plus "…" stays within the limit', () => {
  const units = (text: string) =>
    [...text].reduce((sum, char) => sum + (/[가-힣]/.test(char) ? 2 : 1), 0);
  for (const name of ['Investment funds', '해외주식과국내주식', 'Cash and 예금 accounts']) {
    expect(units(axisName(name))).toBeLessThanOrEqual(13);
  }
});
