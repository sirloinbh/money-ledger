import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, test, vi } from 'vitest';

import { MonthlySummary } from './monthly-summary';

// The chart file cannot be loaded the first time (an old tab after a deploy, offline), then can.
const chartFile = vi.hoisted(() => ({ loads: 0 }));
vi.mock('./category-share-chart', () => {
  chartFile.loads += 1;
  if (chartFile.loads === 1) throw new Error('Failed to fetch dynamically imported module');
  return { CategoryShareChart: () => <p>차트</p> };
});

const summary = (month: string) => ({
  month,
  income: 0,
  expense: 1000,
  balance: -1000,
  categories: [{ categoryId: 1, name: '식비', hidden: false, amount: 1000, share: '100.0' }],
});

test('a chart file that fails to load leaves the summary and its table, and loads again on another month', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(JSON.stringify(summary(new URL(url, 'http://x').searchParams.get('month')!))),
      ),
    ),
  );
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(
    <MemoryRouter initialEntries={['/ledger?month=2026-10']}>
      <MonthlySummary />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText('차트를 불러오지 못했습니다. 아래 표에서 값을 확인하세요.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '월별 요약' })).toBeInTheDocument();
  expect(screen.getByRole('table')).toHaveTextContent('식비1,000원100.0%');

  fireEvent.click(screen.getByRole('button', { name: '요약 다음 달' }));
  expect(await screen.findByText('차트')).toBeInTheDocument();
  expect(
    screen.queryByText('차트를 불러오지 못했습니다. 아래 표에서 값을 확인하세요.'),
  ).not.toBeInTheDocument();
});
