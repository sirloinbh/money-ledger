import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { MockReturns } from './mock-returns';

// The chart file cannot be loaded the first time (an old tab after a deploy, offline), then can.
const chartFile = vi.hoisted(() => ({ loads: 0 }));
vi.mock('./mock-return-chart', () => {
  chartFile.loads += 1;
  if (chartFile.loads === 1) throw new Error('Failed to fetch dynamically imported module');
  return { MockReturnChart: () => <p>Chart</p> };
});

test('a chart file that fails to load leaves the table, and Try again loads it again', async () => {
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
    await screen.findByText('Could not load the chart. Check the values in the table below.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('table')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Chart')).toBeInTheDocument();
});
