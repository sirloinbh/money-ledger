import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { NetWorthChart } from './net-worth-chart';

const snapshot = (date: string, netKrw: number) => ({
  date,
  assetsKrw: netKrw + 500_000,
  debtsKrw: 500_000,
  netKrw,
  uncounted: 0,
});

// jsdom has no layout, so the line itself is checked in a real browser (docs/changes/49-*.md).
test('the chart is one image naming the period, the number of days and the latest value', () => {
  render(
    <NetWorthChart
      snapshots={[snapshot('2026-09-01', 10_000_000), snapshot('2026-11-10', 12_345_000)]}
      from="2026-08-10"
      to="2026-11-10"
    />,
  );
  expect(screen.getByRole('img')).toHaveAccessibleName(
    '2026년 8월 10일부터 2026년 11월 10일까지 순자산 꺾은선 차트. 기록은 2일이고 마지막 기록(2026년 11월 10일)은 12,345,000원입니다. 모든 값은 아래 표로 보기에 있습니다.',
  );
});

test('one saved day on a one-day axis still renders', () => {
  render(
    <NetWorthChart
      snapshots={[snapshot('2026-11-10', -300_000)]}
      from="2026-11-10"
      to="2026-11-10"
    />,
  );
  expect(screen.getByRole('img')).toHaveAccessibleName(/기록은 1일이고 .*-300,000원입니다/);
});
