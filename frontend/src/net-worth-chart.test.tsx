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
    'Net worth line chart from Aug 10, 2026 to Nov 10, 2026. 2 days saved; the last one (Nov 10, 2026) is ₩12,345,000. Every value is in the table below.',
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
  expect(screen.getByRole('img')).toHaveAccessibleName(/1 day saved; .* is -₩300,000./);
});

test('an empty list draws nothing instead of failing (#202)', () => {
  render(<NetWorthChart snapshots={[]} from="2026-11-01" to="2026-11-22" />);
  expect(screen.getByText('Nothing to draw yet.')).toBeInTheDocument();
  expect(screen.queryByRole('img')).toBeNull();
});
