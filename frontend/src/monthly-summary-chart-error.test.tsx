import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, test, vi } from 'vitest';

import { MonthlySummary } from './monthly-summary';

// The chart file cannot be loaded (an old tab after a deploy, offline).
vi.mock('./category-share-chart', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

test('a chart file that fails to load leaves the summary and its table in place', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            month: '2026-11',
            income: 0,
            expense: 1000,
            balance: -1000,
            categories: [
              { categoryId: 1, name: '식비', hidden: false, amount: 1000, share: '100.0' },
            ],
          }),
        ),
      ),
    ),
  );
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(
    <MemoryRouter initialEntries={['/ledger?month=2026-11']}>
      <MonthlySummary />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText('차트를 불러오지 못했습니다. 아래 표에서 값을 확인하세요.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '월별 요약' })).toBeInTheDocument();
  expect(screen.getByRole('table')).toHaveTextContent('식비1,000원100.0%');
});
