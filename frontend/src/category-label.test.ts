import { expect, test } from 'vitest';

import { categoryLabel } from './category-label';

test('the seeded Korean default categories show their English label', () => {
  expect(
    ['식비', '교통', '주거', '통신', '생활', '의료', '여가', '기타', '급여', '부수입'].map(
      categoryLabel,
    ),
  ).toEqual([
    'Food',
    'Transport',
    'Housing',
    'Telecom',
    'Living',
    'Medical',
    'Leisure',
    'Other',
    'Salary',
    'Side income',
  ]);
});

test('a renamed or added category is shown as typed', () => {
  expect(categoryLabel('Groceries')).toBe('Groceries');
  expect(categoryLabel('커피')).toBe('커피');
  expect(categoryLabel('constructor')).toBe('constructor');
});
