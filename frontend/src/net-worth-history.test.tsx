import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  dayLabel,
  dayValue,
  periodStart,
  type Snapshot,
  timeTicks,
  wonAxisLabel,
} from './net-worth';
import type * as History from './net-worth-history';
import { findLive } from './test/live';

// #49 The "Net worth trend" card against a fake server. The real chart is checked in net-worth-chart.test.tsx and in a
// real browser (docs/changes/49-*.md); here it only reports what it was given.
vi.mock('./net-worth-chart', () => ({
  NetWorthChart: ({ snapshots, from, to }: { snapshots: Snapshot[]; from: string; to: string }) => (
    <p data-testid="chart">
      {from}~{to}:{snapshots.map((row) => `${row.date}=${row.netKrw}`).join(',')}
    </p>
  ),
}));

// A fixed service day (#182): 2026-11-16 in Seoul. The clock is set to it in each test.
const today = '2026-11-16';
// Imported afresh for each test (#182): today's save runs once per page load through a module-level promise,
// so a shared module would send it in the first test only.
let NetWorthHistory: typeof History.NetWorthHistory;
const day = (date: string, netKrw: number, uncounted = 0): Snapshot => ({
  date,
  assetsKrw: netKrw + 1_000_000,
  debtsKrw: 1_000_000,
  netKrw,
  uncounted,
});

let saved: Snapshot[];
let requests: { method: string; url: string }[];
let failList: boolean;
let saveError: string | undefined;

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T03:00:00Z'));
  vi.resetModules();
  ({ NetWorthHistory } = await import('./net-worth-history'));
  saved = [day('2026-01-02', 9_000_000), day(today, 12_500_000, 1)];
  requests = [];
  failList = false;
  saveError = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      requests.push({ method, url });
      if (method === 'POST') {
        if (saveError) return json({ error: saveError }, 422);
        const snapshot = day(today, 13_000_000);
        saved = [...saved.filter((row) => row.date !== today), snapshot];
        return json({ snapshot });
      }
      if (failList) return json({ error: 'Server error' }, 500);
      const from = new URL(url, 'http://test').searchParams.get('from');
      return json({ today, snapshots: saved.filter((row) => !from || row.date >= from) });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const gets = () =>
  requests.filter((request) => request.method === 'GET').map((request) => request.url);

test("opening saves today's values once before reading the last 3 months", async () => {
  const { unmount } = render(<NetWorthHistory />);
  const from = periodStart(today, '3m')!;
  // The save from opening is in the list: today is the newly saved value.
  expect(await screen.findByTestId('chart')).toHaveTextContent(
    `${from}~${today}:${today}=13000000`,
  );
  expect(requests.map((request) => request.method)).toEqual(['POST', 'GET']);
  expect(gets()).toEqual([`/api/portfolio/net-worth?from=${from}`]);
  expect(screen.getByRole('button', { name: '3 months' })).toHaveAttribute('aria-pressed', 'true');
  // Opened again (another page and back): no second save.
  unmount();
  render(<NetWorthHistory />);
  await screen.findByTestId('chart');
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
});

test('the periods read their own range; the whole history has no start', async () => {
  render(<NetWorthHistory />);
  await screen.findByTestId('chart');
  fireEvent.click(screen.getByRole('button', { name: '1 year' }));
  await vi.waitFor(() =>
    expect(gets().at(-1)).toBe(`/api/portfolio/net-worth?from=${periodStart(today, '1y')}`),
  );
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  // The whole history starts at the first save.
  expect(await screen.findByText(/2026-01-02~/)).toHaveTextContent(
    `2026-01-02~${today}:2026-01-02=9000000,${today}=13000000`,
  );
  expect(gets().at(-1)).toBe('/api/portfolio/net-worth');
  expect(screen.getByText(`All records – ${dayLabel(today)}`)).toBeInTheDocument();
});

test('a failed period switch hides the previous period instead of showing it under the new dates', async () => {
  render(<NetWorthHistory />);
  await screen.findByTestId('chart');
  failList = true;
  fireEvent.click(screen.getByRole('button', { name: '1 year' }));
  expect(await screen.findByText('Could not load the net worth records.')).toBeInTheDocument();
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Net worth period' })).toBeInTheDocument();
  // Try again with the server back: the chosen period is shown.
  failList = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try loading the net worth records again' }));
  expect(await screen.findByTestId('chart')).toHaveTextContent(`${periodStart(today, '1y')}~`);
});

test('the table lists every saved day, newest first, with how many were left out', async () => {
  // The quiet save on opening is refused, so today keeps the value with an item left out.
  saveError = 'Not saved in this test';
  render(<NetWorthHistory />);
  fireEvent.click(await screen.findByRole('button', { name: 'All' }));
  const toggle = await screen.findByText('Show as a table (2 days)');
  fireEvent.click(toggle);
  const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
  expect(rows.map((row) => row.textContent)).toEqual([
    `${dayLabel(today)}1 item left out12,500,00013,500,0001,000,000`,
    'Jan 2, 20269,000,00010,000,0001,000,000',
  ]);
});

test('a period without saves says so instead of a flat chart', async () => {
  saved = [];
  // The quiet save on opening is refused, so nothing is saved at all.
  saveError = 'Not saved in this test';
  render(<NetWorthHistory />);
  expect(await screen.findByText('No records in this period.')).toBeInTheDocument();
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
});

test('"Save current values" saves again, says what was saved and reads the list again', async () => {
  render(<NetWorthHistory />);
  await screen.findByTestId('chart');
  const before = gets().length;
  fireEvent.click(screen.getByRole('button', { name: 'Save current values' }));
  expect(await findLive('status')).toHaveTextContent(/Saved the net worth of ₩13,000,000 for /);
  await vi.waitFor(() => expect(gets().length).toBe(before + 1));
  expect(await screen.findByTestId('chart')).toHaveTextContent(`${today}=13000000`);
});

test('a refused save shows the server message', async () => {
  render(<NetWorthHistory />);
  await screen.findByTestId('chart');
  saveError = 'The totals are too large to save the net worth';
  fireEvent.click(screen.getByRole('button', { name: 'Save current values' }));
  expect(await findLive('alert')).toHaveTextContent(saveError);
});

test('a failed list can be tried again', async () => {
  failList = true;
  render(<NetWorthHistory />);
  const retry = await screen.findByRole('button', {
    name: 'Try loading the net worth records again',
  });
  failList = false;
  fireEvent.click(retry);
  expect(await screen.findByTestId('chart')).toBeInTheDocument();
  expect(screen.queryByText('Could not load the net worth records.')).not.toBeInTheDocument();
});

test('a period starts the same day months back, or that month’s last day', () => {
  expect(periodStart('2026-11-10', '1m')).toBe('2026-10-10');
  expect(periodStart('2026-11-10', '3m')).toBe('2026-08-10');
  expect(periodStart('2026-11-10', '1y')).toBe('2025-11-10');
  expect(periodStart('2026-01-15', '3m')).toBe('2025-10-15');
  expect(periodStart('2026-05-31', '3m')).toBe('2026-02-28');
  expect(periodStart('2024-03-31', '1m')).toBe('2024-02-29');
  expect(periodStart('2026-11-10', 'all')).toBeUndefined();
});

test('axis ticks are evenly spaced days, not the saved days', () => {
  const labels = (from: string, to: string) => {
    const axis = timeTicks(dayValue(from), dayValue(to));
    return axis.ticks.map(axis.label);
  };
  // About a month: every 7 days from the start.
  expect(labels('2026-10-10', '2026-11-10')).toEqual(['10/10', '10/17', '10/24', '10/31', '11/7']);
  // Up to a year: each month's first day, across the new year.
  expect(labels('2026-08-10', '2026-11-10')).toEqual(["Sep '26", "Oct '26", "Nov '26"]);
  expect(labels('2025-11-10', '2026-11-10')).toEqual([
    "Dec '25",
    "Jan '26",
    "Feb '26",
    "Mar '26",
    "Apr '26",
    "May '26",
    "Jun '26",
    "Jul '26",
    "Aug '26",
    "Sep '26",
    "Oct '26",
    "Nov '26",
  ]);
  expect(labels('2026-09-01', '2026-11-10')).toEqual(["Sep '26", "Oct '26", "Nov '26"]);
  // Longer: January and July.
  expect(labels('2024-12-20', '2026-11-10')).toEqual(["Jan '25", "Jul '25", "Jan '26", "Jul '26"]);
});

test('won axis labels keep enough decimals for a narrow spread', () => {
  const narrow = wonAxisLabel([2_760_000_000, 2_825_000_000]);
  expect([2_760_000_000, 2_780_000_000, 2_800_000_000].map(narrow)).toEqual([
    '2.76B',
    '2.78B',
    '2.8B',
  ]);
  const wide = wonAxisLabel([2_100_000_000, 2_825_000_000]);
  expect([2_000_000_000, 2_500_000_000].map(wide)).toEqual(['2B', '2.5B']);
  expect([-3_000_000, 0, 5_000_000].map(wonAxisLabel([-3_000_000, 5_000_000]))).toEqual([
    '-3M',
    '0',
    '5M',
  ]);
  expect(wonAxisLabel([5_000])(5_000)).toBe('5,000');
});
