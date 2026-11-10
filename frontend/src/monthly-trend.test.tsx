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
  return <output aria-label="주소">{useLocation().search}</output>;
}

const show = (path = '/ledger', version = 0) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <MonthlyTrend version={version} />
      <Address />
    </MemoryRouter>,
  );
const address = () => screen.getByLabelText('주소').textContent;
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
  expect(screen.getByText('2026년 1월 ~ 2026년 12월')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '12개월' })).toHaveAttribute('aria-pressed', 'true');

  // The table, newest first; months without entries are 0, so nothing is missing.
  expect(rows().slice(0, 4)).toEqual([
    '월수입(원)지출(원)잔액(원)',
    '2026년 12월000',
    '2026년 11월50,000900,000-850,000',
    '2026년 10월3,000,00030,0002,970,000',
  ]);
  expect(rows()).toHaveLength(13);
});

test('the period buttons: 6 and 24 months in the address, 12 is the default', async () => {
  show('/ledger?month=2026-10&from=2026-11-01');
  await screen.findByTestId('chart');
  fireEvent.click(screen.getByRole('button', { name: '6개월' }));
  expect(await screen.findByText('2026년 7월 ~ 2026년 12월')).toBeInTheDocument();
  expect(urls.at(-1)).toBe('/api/ledger/trend?from=2026-07&to=2026-12');
  expect(address()).toBe('?month=2026-10&from=2026-11-01&trend=6');
  expect(screen.getByRole('button', { name: '6개월' })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByRole('button', { name: '24개월' }));
  await screen.findByText('2025년 1월 ~ 2026년 12월');
  expect(urls.at(-1)).toBe('/api/ledger/trend?from=2025-01&to=2026-12');
  await vi.waitFor(() => expect(rows()).toHaveLength(25));

  fireEvent.click(screen.getByRole('button', { name: '12개월' }));
  await screen.findByText('2026년 1월 ~ 2026년 12월');
  expect(address()).toBe('?month=2026-10&from=2026-11-01');
});

test('a period from the address, and one that is not a choice falls back to 12 months', async () => {
  show('/ledger?trend=24');
  await screen.findByTestId('chart');
  expect(urls).toEqual(['/api/ledger/trend?from=2025-01&to=2026-12']);
  screen.getByRole('button', { name: '24개월' });
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
  expect(await screen.findByText('이 기간에는 내역이 없습니다.')).toBeInTheDocument();
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  expect(rows()).toHaveLength(7);
});

test('a failure says so, hides the previous period, and 다시 시도 loads it again', async () => {
  show();
  await screen.findByTestId('chart');
  answer = () => json({ error: '서버 오류' }, 500);
  fireEvent.click(screen.getByRole('button', { name: '6개월' }));
  expect(await screen.findByText('추이를 불러오지 못했습니다.')).toBeInTheDocument();
  // The 12 months are not shown under the 6-month title.
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();

  answer = (url) => json(period(...range(url)));
  fireEvent.click(screen.getByRole('button', { name: '추이 다시 시도' }));
  expect(screen.getByRole('heading', { name: '월별 추이' })).toHaveFocus();
  expect(await screen.findByTestId('chart')).toHaveTextContent(
    '2026-07,2026-08,2026-09,2026-10,2026-11,2026-12',
  );
  expect(screen.queryByText('추이를 불러오지 못했습니다.')).not.toBeInTheDocument();
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
  fireEvent.click(screen.getByRole('button', { name: '6개월' }));
  expect(await screen.findByTestId('chart')).toHaveTextContent('2026-07');
  late(new Response(JSON.stringify(period('2026-01', '2026-12'))));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByTestId('chart')).toHaveTextContent(
    '2026-07,2026-08,2026-09,2026-10,2026-11,2026-12',
  );
});
