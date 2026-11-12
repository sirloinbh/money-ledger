import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { CategoryShareChart } from './category-share-chart';

const categories = [
  { categoryId: 4, name: 'Transport', hidden: true, amount: 50000, share: '50.0' },
  { categoryId: 1, name: 'Food', hidden: false, amount: 42000, share: '42.0' },
  { categoryId: null, name: 'Uncategorized', hidden: false, amount: 8000, share: '8.0' },
];

// jsdom has no layout, so the bars themselves are checked in a real browser (docs/changes/40-*.md).
test('the chart is one image named by its largest category, pointing at the table', () => {
  render(<CategoryShareChart categories={categories} />);
  const chart = screen.getByRole('img');
  expect(chart).toHaveAccessibleName(
    'Expense by category horizontal bar chart. The largest item is Transport ₩50,000 (50.0%). All values are in the table below.',
  );
});

test('the chart grows with the number of categories', () => {
  const { rerender } = render(<CategoryShareChart categories={categories.slice(0, 1)} />);
  const one = Number.parseInt(screen.getByRole('img').style.height, 10);
  rerender(<CategoryShareChart categories={categories} />);
  const three = Number.parseInt(screen.getByRole('img').style.height, 10);
  expect(three - one).toBe(2 * 36);
});
