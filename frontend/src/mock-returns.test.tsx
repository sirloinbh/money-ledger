import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { MockReturns } from './mock-returns';

// The chart itself is checked in mock-return-chart.test.tsx; here it only reports the days it was given.
vi.mock('./mock-return-chart', () => ({
  MockReturnChart: ({ points }: { points: { date: string }[] }) => (
    <p data-testid="chart">{points.map((point) => point.date).join(',')}</p>
  ),
}));

const day = (date: string, totalKrw: number, returnPct: string) => ({
  date,
  totalKrw,
  profitKrw: totalKrw - 10_000_000,
  returnPct,
});

let body: unknown;
let urls: string[];

beforeEach(() => {
  // 2026-11-10 in Seoul.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T03:00:00Z'));
  urls = [];
  body = {
    startDate: '2026-07-01',
    initialCashKrw: 10_000_000,
    snapshots: [
      day('2026-08-15', 9_900_000, '-1.00'),
      day('2026-10-10', 10_050_000, '0.50'),
      day('2026-10-20', 10_100_000, '1.00'),
      day('2026-11-09', 10_194_000, '1.94'),
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      return Promise.resolve(new Response(JSON.stringify(body)));
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

test('1 month by default; 3 months and everything start further back, from 0% on the first day', async () => {
  render(<MockReturns accountId={7} refreshKey={0} />);
  expect(await screen.findByTestId('chart')).toHaveTextContent('2026-10-10,2026-10-20,2026-11-09');
  expect(urls).toEqual(['/api/mock/accounts/7/snapshots']);
  expect(screen.getByRole('button', { name: '1 month' })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByRole('button', { name: '3 months' }));
  expect(screen.getByTestId('chart')).toHaveTextContent(
    '2026-08-15,2026-10-10,2026-10-20,2026-11-09',
  );
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  expect(screen.getByTestId('chart')).toHaveTextContent(
    '2026-07-01,2026-08-15,2026-10-10,2026-10-20,2026-11-09',
  );

  // The table has every shown value, newest first, with the start at 0%.
  const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
  expect(rows[0]).toHaveTextContent('2026-11-09₩10,194,000+₩194,000+1.94%');
  expect(rows[3]).toHaveTextContent('2026-08-15₩9,900,000-₩100,000-1%');
  expect(rows[4]).toHaveTextContent('2026-07-01₩10,000,000₩00%');
});

test('a saved value on the first day replaces the 0% start; fewer than two points draw no line', async () => {
  body = {
    startDate: '2026-11-09',
    initialCashKrw: 10_000_000,
    snapshots: [day('2026-11-09', 10_000_000, '0.00')],
  };
  render(<MockReturns accountId={7} refreshKey={0} />);
  expect(await screen.findByText(/Only one value so far/)).toBeInTheDocument();
  expect(screen.queryByTestId('chart')).toBeNull();

  body = {
    startDate: '2026-11-09',
    initialCashKrw: 10_000_000,
    snapshots: [day('2026-11-09', 10_000_000, '0.00'), day('2026-11-10', 10_010_000, '0.10')],
  };
  // An order elsewhere on the page reloads the values.
  render(<MockReturns accountId={7} refreshKey={1} />);
  expect(await screen.findByTestId('chart')).toHaveTextContent('2026-11-09,2026-11-10');
});

test('no saved value in the period says so; a failed load shows the reason', async () => {
  body = { startDate: '2026-07-01', initialCashKrw: 10_000_000, snapshots: [] };
  const { unmount } = render(<MockReturns accountId={7} refreshKey={0} />);
  expect(await screen.findByText('No values are saved for this period.')).toBeInTheDocument();
  unmount();

  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'A server error occurred' }), { status: 500 }),
      ),
    ),
  );
  render(<MockReturns accountId={7} refreshKey={0} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('A server error occurred');
});
