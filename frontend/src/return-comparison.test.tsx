import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { mockKey } from './mock-query';
import { ReturnComparison } from './return-comparison';
import { findLive } from './test/live';
import { forgetQueryClient, renderWithQuery, testQueryClient } from './test/query';

const result = {
  startDate: '2026-10-11',
  endDate: '2026-11-09',
  startValueKrw: 10_000_000,
  endValueKrw: 16_781_000,
  netCashFlowKrw: 5_000_000,
  days: 20,
  returnPct: '17.81',
};

const benchmarks = [
  {
    id: 'deposit',
    name: 'Deposit at the Bank of Korea base rate',
    annualPct: '2.5000',
    returnPct: '0.21',
  },
  { id: 'buffett', name: 'Warren Buffett', annualPct: '20', returnPct: '1.53' },
  { id: 'renaissance', name: 'Renaissance fund', annualPct: '66', returnPct: '4.02' },
];

let body: unknown;
let urls: string[];

beforeEach(() => {
  // 2026-11-10 in Seoul.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T03:00:00Z'));
  urls = [];
  body = { account: result, benchmarks };
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

test('shows the return with the values it starts and ends from, and the money added', async () => {
  renderWithQuery(<ReturnComparison accountId={7} />);
  expect(await screen.findAllByText('+17.81%')).toHaveLength(2);
  expect(screen.getByText('₩10,000,000')).toBeInTheDocument();
  expect(screen.getByText('₩16,781,000')).toBeInTheDocument();
  expect(screen.getByText('+₩5,000,000')).toBeInTheDocument();
  expect(urls).toEqual(['/api/mock/accounts/7/return?from=2026-10-10']);
});

test('lines the return up with the deposit and the two fixed yearly rates', async () => {
  renderWithQuery(<ReturnComparison accountId={7} />);
  const table = await screen.findByRole('table');
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows.map((row) => row.textContent)).toEqual([
    'Your trades-+17.81%',
    'Deposit at the Bank of Korea base rate2.5%+0.21%',
    'Warren Buffett20%+1.53%',
    'Renaissance fund66%+4.02%',
  ]);
});

test('a deposit without a stored base rate says so, and the fixed rates still show', async () => {
  body = {
    account: result,
    benchmarks: [{ ...benchmarks[0], annualPct: null, returnPct: null }, ...benchmarks.slice(1)],
  };
  renderWithQuery(<ReturnComparison accountId={7} />);
  const table = await screen.findByRole('table');
  expect(within(table).getByText('No rate yet')).toBeInTheDocument();
  expect(within(table).getByText('+1.53%')).toBeInTheDocument();
});

test('3 months and All ask for a longer period', async () => {
  renderWithQuery(<ReturnComparison accountId={7} />);
  await screen.findAllByText('+17.81%');
  expect(screen.getByRole('button', { name: '1 month' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '3 months' }));
  await screen.findAllByText('+17.81%');
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  await screen.findAllByText('+17.81%');
  expect(urls).toEqual([
    '/api/mock/accounts/7/return?from=2026-10-10',
    '/api/mock/accounts/7/return?from=2026-08-10',
    '/api/mock/accounts/7/return',
  ]);
});

test('says so when the period has no return yet, and reloads with every mock change', async () => {
  body = { account: { ...result, returnPct: null, days: 0, netCashFlowKrw: 0 } };
  renderWithQuery(<ReturnComparison accountId={7} />);
  expect(await screen.findByText(/No return yet for this period/)).toBeInTheDocument();
  body = { account: result, benchmarks };
  await act(() => testQueryClient().invalidateQueries({ queryKey: mockKey }));
  expect(await screen.findAllByText('+17.81%')).toHaveLength(2);
});

test('a failed load shows the reason', async () => {
  forgetQueryClient();
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'A server error occurred' }), { status: 500 }),
      ),
    ),
  );
  renderWithQuery(<ReturnComparison accountId={7} />);
  expect(await findLive('alert')).toHaveTextContent('A server error occurred');
});
