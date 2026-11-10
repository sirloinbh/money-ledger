import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { MockReturns } from './mock-returns';

// The chart file cannot be loaded the first time (an old tab after a deploy, offline), then can.
const chartFile = vi.hoisted(() => ({ loads: 0 }));
vi.mock('./mock-return-chart', () => {
  chartFile.loads += 1;
  if (chartFile.loads === 1) throw new Error('Failed to fetch dynamically imported module');
  return { MockReturnChart: () => <p>차트</p> };
});

test('a chart file that fails to load leaves the table, and 다시 시도 loads it again', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            startDate: '2026-11-01',
            initialCashKrw: 10_000_000,
            snapshots: [
              { date: '2026-11-09', totalKrw: 10_194_000, profitKrw: 194_000, returnPct: '1.94' },
            ],
          }),
        ),
      ),
    ),
  );
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(<MockReturns accountId={7} refreshKey={0} />);
  expect(
    await screen.findByText('차트를 불러오지 못했습니다. 아래 표에서 값을 확인하세요.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('table')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByText('차트')).toBeInTheDocument();
});
