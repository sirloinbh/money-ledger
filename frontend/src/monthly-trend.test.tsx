import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { shiftMonth } from './entry-filters-state';
import { MonthlyTrend } from './monthly-trend';

// The chart itself is checked in trend-chart.test.tsx; here it only reports what it was given.
vi.mock('./trend-chart', () => ({
  TrendChart: ({ months }: { months: { month: string }[] }) => (
    <p data-testid="chart">{months.map((month) => month.month).join(',')}</p>
  ),
}));

type Month = { month: string; income: number; expense: number; balance: number };

/** What the server answers: every month of the period, November with entries, the rest 0. */
const period = (from: string, to: string): { from: string; to: string; months: Month[] } => {
  const months: Month[] = [];
  for (let month = from; month <= to; month = shiftMonth(month, 1)) {
    months.push(
      month === '2026-11'
        ? { month, income: 50000, expense: 900000, balance: -850000 }
        : month === '2026-10'
          ? { month, income: 3000000, expense: 30000, balance: 2970000 }
          : { month, income: 0, expense: 0, balance: 0 },
    );
  }
  return { from, to, months };
};

let urls: string[];
let answer: (url: string) => Promise<Response>;
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const range = (url: string) => {
  const params = new URL(url, 'http://x').searchParams;
  return [params.get('from')!, params.get('to')!] as const;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-30T15:30:00Z')); // 2026-12-01 in Seoul
  urls = [];
  answer = (url) => json(period(...range(url)));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      return answer(url);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function Address() {
  return <output aria-label="Address">{useLocation().search}</output>;
}

const show = (path = '/ledger', version = 0) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <MonthlyTrend version={version} />
      <Address />
    </MemoryRouter>,
  );
const address = () => screen.getByLabelText('Address').textContent;
const rows = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .map((row) => row.textContent);

test('12 months up to this month in Seoul, every month in the chart and in the table', async () => {
  show();
  // 2026-12-01 in Seoul although it is still November in UTC.
  expect(await screen.findByTestId('chart')).toHaveTextContent(
    '2026-01,2026-02,2026-03,2026-04,2026-05,2026-06,2026-07,2026-08,2026-09,2026-10,2026-11,2026-12',
  );
  expect(urls).toEqual(['/api/ledger/trend?from=2026-01&to=2026-12']);
  expect(screen.getByText('January 2026 ~ December 2026')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '12 months' })).toHaveAttribute('aria-pressed', 'true');

  // The table, newest first; months without entries are 0, so nothing is missing.
  expect(rows().slice(0, 4)).toEqual([
    'MonthIncome (KRW)Expense (KRW)Balance (KRW)',
    'December 2026000',
    'November 202650,000900,000-850,000',
    'October 20263,000,00030,0002,970,000',
  ]);
  expect(rows()).toHaveLength(13);
});

test('the period buttons: 6 and 24 months in the address, 12 is the default', async () => {
  show('/ledger?month=2026-10&from=2026-11-01');
  await screen.findByTestId('chart');
  fireEvent.click(screen.getByRole('button', { name: '6 months' }));
  expect(await screen.findByText('July 2026 ~ December 2026')).toBeInTheDocument();
  expect(urls.at(-1)).toBe('/api/ledger/trend?from=2026-07&to=2026-12');
  expect(address()).toBe('?month=2026-10&from=2026-11-01&trend=6');
  expect(screen.getByRole('button', { name: '6 months' })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByRole('button', { name: '24 months' }));
  await screen.findByText('January 2025 ~ December 2026');
  expect(urls.at(-1)).toBe('/api/ledger/trend?from=2025-01&to=2026-12');
  await vi.waitFor(() => expect(rows()).toHaveLength(25));

  fireEvent.click(screen.getByRole('button', { name: '12 months' }));
  await screen.findByText('January 2026 ~ December 2026');
  expect(address()).toBe('?month=2026-10&from=2026-11-01');
});

test('a period from the address, and one that is not a choice falls back to 12 months', async () => {
  show('/ledger?trend=24');
  await screen.findByTestId('chart');
  expect(urls).toEqual(['/api/ledger/trend?from=2025-01&to=2026-12']);
  screen.getByRole('button', { name: '24 months' });
});

test('a period with no entries at all says so instead of a flat chart', async () => {
  answer = (url) => {
    const [from, to] = range(url);
    const months = period(from, to).months.map((month) => ({
      ...month,
      income: 0,
      expense: 0,
      balance: 0,
    }));
    return json({ from, to, months });
  };
  show('/ledger?trend=6');
  expect(await screen.findByText('There are no entries in this period.')).toBeInTheDocument();
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  expect(rows()).toHaveLength(7);
});

test('a failure says so, hides the previous period, and Try again loads it again', async () => {
  show();
  await screen.findByTestId('chart');
  answer = () => json({ error: 'Server error' }, 500);
  fireEvent.click(screen.getByRole('button', { name: '6 months' }));
  expect(await screen.findByText('Could not load the trend.')).toBeInTheDocument();
  // The 12 months are not shown under the 6-month title.
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();

  answer = (url) => json(period(...range(url)));
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading trend' }));
  expect(screen.getByRole('heading', { name: 'Monthly trend' })).toHaveFocus();
  expect(await screen.findByTestId('chart')).toHaveTextContent(
    '2026-07,2026-08,2026-09,2026-10,2026-11,2026-12',
  );
  expect(screen.queryByText('Could not load the trend.')).not.toBeInTheDocument();
});

test('a change elsewhere (version) reloads the same period', async () => {
  const { rerender } = show();
  await screen.findByTestId('chart');
  rerender(
    <MemoryRouter initialEntries={['/ledger']}>
      <MonthlyTrend version={1} />
      <Address />
    </MemoryRouter>,
  );
  await vi.waitFor(() => expect(urls).toHaveLength(2));
  expect(urls[1]).toBe(urls[0]);
});

test('a late answer for a period left behind is ignored', async () => {
  let late: (value: Response) => void = () => undefined;
  answer = (url) =>
    range(url)[0] === '2026-01'
      ? new Promise<Response>((resolve) => {
          late = resolve;
        })
      : json(period(...range(url)));
  show();
  fireEvent.click(screen.getByRole('button', { name: '6 months' }));
  expect(await screen.findByTestId('chart')).toHaveTextContent('2026-07');
  late(new Response(JSON.stringify(period('2026-01', '2026-12'))));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByTestId('chart')).toHaveTextContent(
    '2026-07,2026-08,2026-09,2026-10,2026-11,2026-12',
  );
});
