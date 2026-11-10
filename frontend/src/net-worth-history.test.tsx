import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { serviceToday } from './format';
import { dayValue, periodStart, type Snapshot, timeTicks, wonAxisLabel } from './net-worth';
import { NetWorthHistory } from './net-worth-history';

// #49 The "순자산 추이" card against a fake server. The real chart is checked in net-worth-chart.test.tsx and in a
// real browser (docs/changes/49-*.md); here it only reports what it was given.
vi.mock('./net-worth-chart', () => ({
  NetWorthChart: ({ snapshots, from, to }: { snapshots: Snapshot[]; from: string; to: string }) => (
    <p data-testid="chart">
      {from}~{to}:{snapshots.map((row) => `${row.date}=${row.netKrw}`).join(',')}
    </p>
  ),
}));

const today = serviceToday();
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

beforeEach(() => {
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
      if (failList) return json({ error: '서버 오류' }, 500);
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
  expect(screen.getByRole('button', { name: '3개월' })).toHaveAttribute('aria-pressed', 'true');
  // Opened again (another page and back): no second save.
  unmount();
  render(<NetWorthHistory />);
  await screen.findByTestId('chart');
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
});

test('the periods read their own range; the whole history has no start', async () => {
  render(<NetWorthHistory />);
  await screen.findByTestId('chart');
  fireEvent.click(screen.getByRole('button', { name: '1년' }));
  await vi.waitFor(() =>
    expect(gets().at(-1)).toBe(`/api/portfolio/net-worth?from=${periodStart(today, '1y')}`),
  );
  fireEvent.click(screen.getByRole('button', { name: '전체' }));
  // The whole history starts at the first save.
  expect(await screen.findByText(/2026-01-02~/)).toHaveTextContent(
    `2026-01-02~${today}:2026-01-02=9000000,${today}=12500000`,
  );
  expect(gets().at(-1)).toBe('/api/portfolio/net-worth');
  expect(
    screen.getByText(`전체 기록 ~ ${today.slice(0, 4)}년`, { exact: false }),
  ).toBeInTheDocument();
});

test('the table lists every saved day, newest first, with how many were left out', async () => {
  render(<NetWorthHistory />);
  fireEvent.click(await screen.findByRole('button', { name: '전체' }));
  const toggle = await screen.findByText('표로 보기(2일)');
  fireEvent.click(toggle);
  const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
  expect(rows.map((row) => row.textContent)).toEqual([
    `${today.slice(2).replaceAll('-', '.')}1개 빠짐12,500,00013,500,0001,000,000`,
    '26.01.029,000,00010,000,0001,000,000',
  ]);
});

test('a period without saves says so instead of a flat chart', async () => {
  saved = [];
  render(<NetWorthHistory />);
  expect(await screen.findByText('이 기간에는 기록이 없습니다.')).toBeInTheDocument();
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
});

test('"지금 값으로 저장" saves again, says what was saved and reads the list again', async () => {
  render(<NetWorthHistory />);
  await screen.findByTestId('chart');
  const before = gets().length;
  fireEvent.click(screen.getByRole('button', { name: '지금 값으로 저장' }));
  expect(await screen.findByRole('status')).toHaveTextContent(/순자산 13,000,000원을 저장했습니다/);
  await vi.waitFor(() => expect(gets().length).toBe(before + 1));
  expect(await screen.findByTestId('chart')).toHaveTextContent(`${today}=13000000`);
});

test('a refused save shows the server message', async () => {
  render(<NetWorthHistory />);
  await screen.findByTestId('chart');
  saveError = '합계가 너무 커서 순자산을 저장하지 못했습니다';
  fireEvent.click(screen.getByRole('button', { name: '지금 값으로 저장' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(saveError);
});

test('a failed list can be tried again', async () => {
  failList = true;
  render(<NetWorthHistory />);
  const retry = await screen.findByRole('button', { name: '순자산 기록 다시 시도' });
  failList = false;
  fireEvent.click(retry);
  expect(await screen.findByTestId('chart')).toBeInTheDocument();
  expect(screen.queryByText('순자산 기록을 불러오지 못했습니다.')).not.toBeInTheDocument();
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
  expect(labels('2026-10-10', '2026-11-10')).toEqual(['10.10', '10.17', '10.24', '10.31', '11.7']);
  // Up to a year: each month's first day, across the new year.
  expect(labels('2026-08-10', '2026-11-10')).toEqual(['26.9', '26.10', '26.11']);
  expect(labels('2025-11-10', '2026-11-10')).toEqual([
    '25.12',
    '26.1',
    '26.2',
    '26.3',
    '26.4',
    '26.5',
    '26.6',
    '26.7',
    '26.8',
    '26.9',
    '26.10',
    '26.11',
  ]);
  expect(labels('2026-09-01', '2026-11-10')).toEqual(['26.9', '26.10', '26.11']);
  // Longer: January and July.
  expect(labels('2024-12-20', '2026-11-10')).toEqual(['25.1', '25.7', '26.1', '26.7']);
});

test('won axis labels keep enough decimals for a narrow spread', () => {
  const narrow = wonAxisLabel([276_000_000, 282_500_000]);
  expect([276_000_000, 278_000_000, 280_000_000].map(narrow)).toEqual([
    '2.76억',
    '2.78억',
    '2.8억',
  ]);
  const wide = wonAxisLabel([210_000_000, 282_500_000]);
  expect([200_000_000, 250_000_000].map(wide)).toEqual(['2억', '2.5억']);
  expect([-3_000_000, 0, 5_000_000].map(wonAxisLabel([-3_000_000, 5_000_000]))).toEqual([
    '-300만',
    '0',
    '500만',
  ]);
  expect(wonAxisLabel([5_000])(5_000)).toBe('5,000');
});
