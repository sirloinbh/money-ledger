import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { TrendChart } from './trend-chart';

const months = [
  { month: '2026-10', income: 3000000, expense: 30000, balance: 2970000 },
  { month: '2026-11', income: 50000, expense: 900000, balance: -850000 },
];

// jsdom has no layout, so the lines themselves are checked in a real browser (docs/changes/41-*.md).
test('the chart is one image naming its period and pointing at the table', () => {
  render(<TrendChart months={months} />);
  expect(screen.getByRole('img')).toHaveAccessibleName(
    'Monthly income, expense, and balance line chart from October 2026 to November 2026. All values are in the table under the view switch.',
  );
});

test('the legend names the three lines in a fixed order, in text colors', () => {
  const { container } = render(<TrendChart months={months} />);
  const items = [...container.querySelectorAll('li')];
  expect(items.map((item) => item.textContent)).toEqual(['Income', 'Expense', 'Balance']);
  // The series color is on the key mark beside the text, never on the text itself.
  expect(items.map((item) => (item.firstElementChild as HTMLElement).style.background)).toEqual([
    'var(--chart-series-1)',
    'var(--chart-series-2)',
    'var(--chart-series-3)',
  ]);
});
