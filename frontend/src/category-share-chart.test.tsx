import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { CategoryShareChart } from './category-share-chart';

const categories = [
  { categoryId: 4, name: '교통', hidden: true, amount: 50000, share: '50.0' },
  { categoryId: 1, name: '식비', hidden: false, amount: 42000, share: '42.0' },
  { categoryId: null, name: '미분류', hidden: false, amount: 8000, share: '8.0' },
];

// jsdom has no layout, so the bars themselves are checked in a real browser (docs/changes/40-*.md).
test('the chart is one image named by its largest category, pointing at the table', () => {
  render(<CategoryShareChart categories={categories} />);
  const chart = screen.getByRole('img');
  expect(chart).toHaveAccessibleName(
    '카테고리별 지출 가로 막대 차트. 가장 큰 항목은 교통 50,000원(50.0%)입니다. 모든 값은 아래 표에 있습니다.',
  );
});

test('the chart grows with the number of categories', () => {
  const { rerender } = render(<CategoryShareChart categories={categories.slice(0, 1)} />);
  const one = Number.parseInt(screen.getByRole('img').style.height, 10);
  rerender(<CategoryShareChart categories={categories} />);
  const three = Number.parseInt(screen.getByRole('img').style.height, 10);
  expect(three - one).toBe(2 * 36);
});
