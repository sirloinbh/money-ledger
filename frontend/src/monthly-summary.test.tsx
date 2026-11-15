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
    { categoryId: 4, name: 'Transport', hidden: true, amount: 50000, share: '50.0' },
    { categoryId: 1, name: 'Food', hidden: false, amount: 42000, share: '42.0' },
    { categoryId: null, name: 'Uncategorized', hidden: false, amount: 8000, share: '8.0' },
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
  return <output aria-label="Address">{useLocation().search}</output>;
}

const show = (path = '/ledger', version = 0) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <MonthlySummary version={version} />
      <Address />
    </MemoryRouter>,
  );
const address = () => screen.getByLabelText('Address').textContent;
const total = (label: string) =>
  screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;

test('this month in Seoul: the totals, the chart, and the same values in a table', async () => {
  show();
  await screen.findByRole('table');
  expect(urls).toEqual(['/api/ledger/summary?month=2026-11']);
  expect(screen.getByText('November 2026')).toBeInTheDocument();
  expect(total('Income')).toBe('₩3,050,000');
  expect(total('Expense')).toBe('₩100,000');
  expect(total('Balance')).toBe('₩2,950,000');
  expect(await screen.findByTestId('chart')).toHaveTextContent('Transport,Food,Uncategorized');

  const rows = within(screen.getByRole('table'))
    .getAllByRole('row')
    .map((row) => row.textContent);
  expect(rows).toEqual([
    'CategoryAmountShare',
    'Transport (hidden)₩50,00050.0%',
    'Food₩42,00042.0%',
    'Uncategorized₩8,0008.0%',
    'Total₩100,000100%',
  ]);
});

test('the month buttons move the summary and keep the list filters in the address', async () => {
  show('/ledger?from=2026-10-01&to=2026-10-31&kind=expense');
  await screen.findByRole('table');
  fireEvent.click(screen.getByRole('button', { name: 'Summary previous month' }));
  expect(await screen.findByText('There is no expense this month.')).toBeInTheDocument();
  expect(screen.getByText('October 2026')).toBeInTheDocument();
  expect(urls.at(-1)).toBe('/api/ledger/summary?month=2026-10');
  expect(address()).toBe('?from=2026-10-01&to=2026-10-31&kind=expense&month=2026-10');

  // Back on this month the address does not need the month.
  fireEvent.click(screen.getByRole('button', { name: 'Summary next month' }));
  await screen.findByRole('table');
  expect(address()).toBe('?from=2026-10-01&to=2026-10-31&kind=expense');
});

test('the month in the address survives a reload; a month the server would refuse is this month', async () => {
  const first = show('/ledger?month=2025-12');
  await screen.findByText('December 2025');
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
  await screen.findByText('There is no expense this month.');
  expect(total('Balance')).toBe('-₩1,500');
});

test('a failed load says so and can be retried', async () => {
  answer = () => json({ error: 'Server error' }, 500);
  show();
  expect(await screen.findByText('Could not load the summary.')).toBeInTheDocument();
  answer = () => json(november);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading summary' }));
  await screen.findByRole('table');
  expect(screen.queryByText('Could not load the summary.')).not.toBeInTheDocument();
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
  await vi.waitFor(() => expect(total('Income')).toBe('₩3,060,000'));
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
  fireEvent.click(screen.getByRole('button', { name: 'Summary previous month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Summary next month' }));
  await vi.waitFor(() => expect(urls.at(-1)).toBe('/api/ledger/summary?month=2026-11'));
  finishOctober();
  await screen.findByRole('table');
  expect(screen.getByText('November 2026')).toBeInTheDocument();
  expect(total('Income')).toBe('₩3,050,000');
});

test('a month that fails to load does not show the previous month under its name', async () => {
  show();
  await screen.findByRole('table');
  answer = () => json({ error: 'Server error' }, 500);
  fireEvent.click(screen.getByRole('button', { name: 'Summary previous month' }));
  expect(await screen.findByText('Could not load the summary.')).toBeInTheDocument();
  expect(screen.getByText('October 2026')).toBeInTheDocument();
  expect(screen.queryByText('₩3,050,000')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

test('retrying keeps focus in the summary: on its title', async () => {
  answer = () => json({ error: 'Server error' }, 500);
  show();
  const retry = await screen.findByRole('button', { name: 'Retry loading summary' });
  answer = () => json(november);
  retry.focus();
  fireEvent.click(retry);
  expect(screen.getByRole('heading', { name: 'Monthly summary' })).toHaveFocus();
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
