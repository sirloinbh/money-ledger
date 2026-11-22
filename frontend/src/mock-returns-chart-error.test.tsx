import { fireEvent, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { MockReturns } from './mock-returns';
import { renderWithQuery } from './test/query';

// The chart file cannot be loaded the first time (an old tab after a deploy, offline), then can.
// The factory runs once and returns the module; reading its export fails the first time (#182). The screen's
// `lazy(() => import(...).then((module) => module.MockReturnChart))` then rejects like a failed download, without relying
// on Vitest running a throwing factory again.
const chartFile = vi.hoisted(() => ({ reads: 0 }));
vi.mock('./mock-return-chart', () => ({
  get MockReturnChart() {
    chartFile.reads += 1;
    if (chartFile.reads === 1) throw new Error('Failed to fetch dynamically imported module');
    return () => <p>Chart</p>;
  },
}));

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
  renderWithQuery(<MockReturns accountId={7} />);
  expect(
    await screen.findByText('Could not load the chart. Check the values in the table below.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('table')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Chart')).toBeInTheDocument();
});
