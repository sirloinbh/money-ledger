import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { RecurringSuggestions } from './recurring-suggestions';
import { renderWithQuery } from './test/query';

// #291 The recurring payment suggestions: shown with the past amounts, registered in one step, or dismissed.
const netflix = {
  merchantKey: 'netflix',
  merchant: 'Netflix',
  amount: 10_900,
  variable: false,
  categoryName: 'Subscriptions',
  dayOfMonth: 5,
  entries: [
    { id: 1, date: '2026-08-05', amount: 10_900 },
    { id: 2, date: '2026-09-05', amount: 10_900 },
    { id: 3, date: '2026-10-05', amount: 10_900 },
  ],
  register: {
    name: 'Netflix',
    categoryId: 7,
    amount: 10_900,
    variable: false,
    dayOfMonth: 5,
    startMonth: '2026-12',
  },
};
const phone = { ...netflix, merchantKey: 'kt', merchant: 'KT', amount: 57_000, variable: true };

let suggestions: unknown[];
let calls: { method: string; url: string; body: unknown }[];

beforeEach(() => {
  suggestions = [netflix, phone];
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/ledger/recurring') {
        return Promise.resolve(
          new Response(
            JSON.stringify({ rule: { months: 3, minMonths: 3, tolerancePct: 10 }, suggestions }),
          ),
        );
      }
      if (url === '/api/ledger/recurring/dismiss') {
        suggestions = suggestions.filter(
          (item) => (item as { merchantKey: string }).merchantKey !== 'netflix',
        );
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url === '/api/ledger/fixed-costs') {
        suggestions = suggestions.filter(
          (item) => (item as { merchantKey: string }).merchantKey !== 'netflix',
        );
        return Promise.resolve(
          new Response(JSON.stringify({ fixedCost: { id: 1 } }), { status: 201 }),
        );
      }
      if (url === '/api/ledger/fixed-costs/generate') {
        return Promise.resolve(new Response(JSON.stringify({ added: 0 })));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

test('shows each merchant with its amount, day, category and the past charges', async () => {
  renderWithQuery(<RecurringSuggestions />);
  expect(await screen.findByText('Netflix')).toBeInTheDocument();
  expect(screen.getByText('₩10,900 on day 5')).toBeInTheDocument();
  expect(screen.getByText('₩57,000 (varies) on day 5')).toBeInTheDocument();
  expect(
    screen.getAllByText(/2026-08-05 ₩10,900, 2026-09-05 ₩10,900, 2026-10-05 ₩10,900/)[0],
  ).toBeInTheDocument();
  expect(
    screen.getByText(/each of the last 3 months, with amounts within 10%/),
  ).toBeInTheDocument();
});

test('one click registers a suggestion with the prepared body, adds its entries and drops it from the list', async () => {
  renderWithQuery(<RecurringSuggestions />);
  fireEvent.click(await screen.findByRole('button', { name: 'Register Netflix as a fixed cost' }));
  expect(await screen.findByText('Registered Netflix as a fixed cost')).toBeInTheDocument();
  expect(calls.filter((call) => call.method === 'POST').map((call) => call.url)).toEqual([
    '/api/ledger/fixed-costs',
    '/api/ledger/fixed-costs/generate',
  ]);
  expect(calls.find((call) => call.url === '/api/ledger/fixed-costs')?.body).toEqual(
    netflix.register,
  );
  await waitFor(() => expect(screen.queryByText('₩10,900 on day 5')).toBeNull());
  expect(screen.getByText('KT')).toBeInTheDocument();
});

test('dismissing sends the merchant key and removes the suggestion', async () => {
  renderWithQuery(<RecurringSuggestions />);
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss Netflix' }));
  expect(await screen.findByText('Netflix will not be suggested again')).toBeInTheDocument();
  expect(calls.find((call) => call.url === '/api/ledger/recurring/dismiss')?.body).toEqual({
    merchantKey: 'netflix',
  });
  await waitFor(() => expect(screen.queryByText('₩10,900 on day 5')).toBeNull());
});

test('nothing is shown when there is nothing to suggest', async () => {
  suggestions = [];
  const { container } = renderWithQuery(<RecurringSuggestions />);
  await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  await waitFor(() => expect(container.querySelector('section')).toBeNull());
});

test('a failed registration says so and keeps the suggestion', async () => {
  renderWithQuery(<RecurringSuggestions />);
  const button = await screen.findByRole('button', { name: 'Register Netflix as a fixed cost' });
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'The category is gone' }), { status: 422 }),
      ),
    ),
  );
  fireEvent.click(button);
  expect(await screen.findByText('The category is gone')).toBeInTheDocument();
  expect(screen.getByText('Netflix')).toBeInTheDocument();
});
