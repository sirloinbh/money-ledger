import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { MockJournal } from './mock-journal';
import { renderWithQuery } from './test/query';
import { unexpectedRequest } from './test/unexpected';

const entry = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  security: { id: 1, symbol: '005930', name: 'Samsung Electronics' },
  side: 'buy',
  quantity: '10.00000000',
  amountKrw: 706_000,
  note: null,
  reviewNote: null,
  createdAt: '2026-11-09T01:30:00.000Z',
  result: null,
  ...extra,
});

let calls: { method: string; url: string; body?: unknown }[];
let page: { entries: unknown[]; hasMore: boolean };

beforeEach(() => {
  calls = [];
  page = {
    entries: [
      entry(3, {
        side: 'sell',
        result: { kind: 'realized', gainKrw: -1234 },
      }),
      entry(2, {
        note: 'Earnings look strong',
        reviewNote: 'Too early to judge',
        result: { kind: 'current', gainKrw: 20_000 },
      }),
      entry(1),
    ],
    hasMore: false,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, body });
      if (method === 'GET' && url === '/api/mock/accounts/7/orders/journal') {
        return new Response(JSON.stringify(page));
      }
      if (method === 'PATCH' && url === '/api/mock/accounts/7/orders/1/notes') {
        return new Response(JSON.stringify({ order: entry(1, body) }));
      }
      return unexpectedRequest(method, url);
    }),
  );
});

test('shows each order with its notes and the result so far', async () => {
  renderWithQuery(<MockJournal accountId={7} />);
  const list = await screen.findByRole('list', { name: 'Trade journal' });
  const items = within(list).getAllByRole('listitem');
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveTextContent('Realized -₩1,234');
  expect(items[0]).toHaveTextContent('No note');
  expect(items[1]).toHaveTextContent('If sold at the latest close +₩20,000');
  expect(items[1]).toHaveTextContent('Why: Earnings look strong');
  expect(items[1]).toHaveTextContent('Looking back: Too early to judge');
  expect(items[2]).toHaveTextContent('No result yet (no saved close)');
});

test('saves the notes of one order and sends only that order', async () => {
  renderWithQuery(<MockJournal accountId={7} />);
  const list = await screen.findByRole('list', { name: 'Trade journal' });
  const buttons = within(list).getAllByRole('button', { name: /Edit notes/ });
  fireEvent.click(buttons[2]);

  fireEvent.change(screen.getByLabelText('Why I placed this order'), {
    target: { value: 'Dip buy' },
  });
  fireEvent.change(screen.getByLabelText('Looking back'), { target: { value: 'Worked out' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save notes' }));

  await vi.waitFor(() =>
    expect(calls.find((call) => call.method === 'PATCH')).toEqual({
      method: 'PATCH',
      url: '/api/mock/accounts/7/orders/1/notes',
      body: { note: 'Dip buy', reviewNote: 'Worked out' },
    }),
  );
  // The editor closes once saved.
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Save notes' })).toBeNull());
});

test('does not send a note over the limit', async () => {
  renderWithQuery(<MockJournal accountId={7} />);
  const list = await screen.findByRole('list', { name: 'Trade journal' });
  fireEvent.click(within(list).getAllByRole('button', { name: /Edit notes/ })[2]);
  fireEvent.change(screen.getByLabelText('Why I placed this order'), {
    target: { value: 'x'.repeat(1001) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save notes' }));
  expect(await screen.findByText(/Keep each note to 1,000 characters or fewer/)).toBeTruthy();
  expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
});

test('says so when there are no trades', async () => {
  page = { entries: [], hasMore: false };
  renderWithQuery(<MockJournal accountId={7} />);
  expect(await screen.findByText('No trades yet.')).toBeTruthy();
});
