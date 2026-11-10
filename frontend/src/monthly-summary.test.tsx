import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { MonthlySummary } from './monthly-summary';

// The chart itself is checked in category-share-chart.test.tsx; here it only reports what it was given.
vi.mock('./category-share-chart', () => ({
  CategoryShareChart: ({ categories }: { categories: { name: string }[] }) => (
    <p data-testid="chart">{categories.map((category) => category.name).join(',')}</p>
  ),
}));

const november = {
  month: '2026-11',
  income: 3050000,
  expense: 100000,
  balance: 2950000,
  categories: [
    { categoryId: 4, name: '교통', hidden: true, amount: 50000, share: '50.0' },
    { categoryId: 1, name: '식비', hidden: false, amount: 42000, share: '42.0' },
    { categoryId: null, name: '미분류', hidden: false, amount: 8000, share: '8.0' },
  ],
};

let urls: string[];
let answer: (url: string) => Promise<Response>;
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T15:30:00Z')); // 2026-11-03 in Seoul
  urls = [];
  answer = (url) => {
    const month = new URL(url, 'http://x').searchParams.get('month')!;
    return json(
      month === '2026-11' ? november : { month, income: 0, expense: 0, balance: 0, categories: [] },
    );
  };
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
      <MonthlySummary version={version} />
      <Address />
    </MemoryRouter>,
  );
const address = () => screen.getByLabelText('주소').textContent;
const total = (label: string) =>
  screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;

test('this month in Seoul: the totals, the chart, and the same values in a table', async () => {
  show();
  await screen.findByRole('table');
  expect(urls).toEqual(['/api/ledger/summary?month=2026-11']);
  expect(screen.getByText('2026년 11월')).toBeInTheDocument();
  expect(total('수입')).toBe('3,050,000원');
  expect(total('지출')).toBe('100,000원');
  expect(total('잔액')).toBe('2,950,000원');
  expect(await screen.findByTestId('chart')).toHaveTextContent('교통,식비,미분류');

  const rows = within(screen.getByRole('table'))
    .getAllByRole('row')
    .map((row) => row.textContent);
  expect(rows).toEqual([
    '카테고리금액비중',
    '교통 (숨김)50,000원50.0%',
    '식비42,000원42.0%',
    '미분류8,000원8.0%',
    '합계100,000원100%',
  ]);
});

test('the month buttons move the summary and keep the list filters in the address', async () => {
  show('/ledger?from=2026-10-01&to=2026-10-31&kind=expense');
  await screen.findByRole('table');
  fireEvent.click(screen.getByRole('button', { name: '요약 이전 달' }));
  expect(await screen.findByText('이 달에는 지출이 없습니다.')).toBeInTheDocument();
  expect(screen.getByText('2026년 10월')).toBeInTheDocument();
  expect(urls.at(-1)).toBe('/api/ledger/summary?month=2026-10');
  expect(address()).toBe('?from=2026-10-01&to=2026-10-31&kind=expense&month=2026-10');

  // Back on this month the address does not need the month.
  fireEvent.click(screen.getByRole('button', { name: '요약 다음 달' }));
  await screen.findByRole('table');
  expect(address()).toBe('?from=2026-10-01&to=2026-10-31&kind=expense');
});

test('the month in the address survives a reload; a month the server would refuse is this month', async () => {
  const first = show('/ledger?month=2025-12');
  await screen.findByText('2025년 12월');
  expect(urls.at(-1)).toBe('/api/ledger/summary?month=2025-12');
  first.unmount();

  show('/ledger?month=2026-13');
  await screen.findByRole('table');
  expect(urls.at(-1)).toBe('/api/ledger/summary?month=2026-11');
});

test('a negative balance is shown with its sign', async () => {
  answer = () =>
    json({ month: '2026-11', income: 1000, expense: 2500, balance: -1500, categories: [] });
  show();
  await screen.findByText('이 달에는 지출이 없습니다.');
  expect(total('잔액')).toBe('-1,500원');
});

test('a failed load says so and can be retried', async () => {
  answer = () => json({ error: '서버 오류' }, 500);
  show();
  expect(await screen.findByText('요약을 불러오지 못했습니다.')).toBeInTheDocument();
  answer = () => json(november);
  fireEvent.click(screen.getByRole('button', { name: '요약 다시 시도' }));
  await screen.findByRole('table');
  expect(screen.queryByText('요약을 불러오지 못했습니다.')).not.toBeInTheDocument();
});

test('a new version (an entry changed elsewhere on the page) reloads the totals', async () => {
  const view = show();
  await screen.findByRole('table');
  answer = () => json({ ...november, income: 3060000, balance: 2960000 });
  view.rerender(
    <MemoryRouter initialEntries={['/ledger']}>
      <MonthlySummary version={1} />
      <Address />
    </MemoryRouter>,
  );
  await vi.waitFor(() => expect(total('수입')).toBe('3,060,000원'));
  expect(urls).toHaveLength(2);
});

test('an older month that answers last does not replace the month shown', async () => {
  let finishOctober: () => void = () => {};
  answer = (url) =>
    url.endsWith('2026-10')
      ? new Promise((resolve) => {
          finishOctober = () =>
            resolve(
              new Response(
                JSON.stringify({
                  month: '2026-10',
                  income: 9,
                  expense: 0,
                  balance: 9,
                  categories: [],
                }),
              ),
            );
        })
      : json(november);
  show();
  await screen.findByRole('table');
  fireEvent.click(screen.getByRole('button', { name: '요약 이전 달' }));
  fireEvent.click(screen.getByRole('button', { name: '요약 다음 달' }));
  await vi.waitFor(() => expect(urls.at(-1)).toBe('/api/ledger/summary?month=2026-11'));
  finishOctober();
  await screen.findByRole('table');
  expect(screen.getByText('2026년 11월')).toBeInTheDocument();
  expect(total('수입')).toBe('3,050,000원');
});

test('a month that fails to load does not show the previous month under its name', async () => {
  show();
  await screen.findByRole('table');
  answer = () => json({ error: '서버 오류' }, 500);
  fireEvent.click(screen.getByRole('button', { name: '요약 이전 달' }));
  expect(await screen.findByText('요약을 불러오지 못했습니다.')).toBeInTheDocument();
  expect(screen.getByText('2026년 10월')).toBeInTheDocument();
  expect(screen.queryByText('3,050,000원')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

test('retrying keeps focus in the summary: on its title', async () => {
  answer = () => json({ error: '서버 오류' }, 500);
  show();
  const retry = await screen.findByRole('button', { name: '요약 다시 시도' });
  answer = () => json(november);
  retry.focus();
  fireEvent.click(retry);
  expect(screen.getByRole('heading', { name: '월별 요약' })).toHaveFocus();
  await screen.findByRole('table');
});

test('months outside 1900–2100 in the address fall back to this month', async () => {
  const first = show('/ledger?month=2101-01');
  await screen.findByRole('table');
  expect(urls.at(-1)).toBe('/api/ledger/summary?month=2026-11');
  first.unmount();
  show('/ledger?month=1899-12');
  await screen.findByRole('table');
  expect(urls.at(-1)).toBe('/api/ledger/summary?month=2026-11');
  show('/ledger?month=2100-12');
  await vi.waitFor(() => expect(urls.at(-1)).toBe('/api/ledger/summary?month=2100-12'));
});
