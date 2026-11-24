import { act, fireEvent, screen } from '@testing-library/react';
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

let body: unknown;
let urls: string[];

beforeEach(() => {
  // 2026-11-10 in Seoul.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T03:00:00Z'));
  urls = [];
  body = { account: result };
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
  expect(await screen.findByText('+17.81%')).toBeInTheDocument();
  expect(screen.getByText('₩10,000,000')).toBeInTheDocument();
  expect(screen.getByText('₩16,781,000')).toBeInTheDocument();
  expect(screen.getByText('+₩5,000,000')).toBeInTheDocument();
  expect(urls).toEqual(['/api/mock/accounts/7/return?from=2026-10-10']);
});

test('3 months and All ask for a longer period', async () => {
  renderWithQuery(<ReturnComparison accountId={7} />);
  await screen.findByText('+17.81%');
  expect(screen.getByRole('button', { name: '1 month' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '3 months' }));
  await screen.findByText('+17.81%');
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  await screen.findByText('+17.81%');
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
  body = { account: result };
  await act(() => testQueryClient().invalidateQueries({ queryKey: mockKey }));
  expect(await screen.findByText('+17.81%')).toBeInTheDocument();
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
