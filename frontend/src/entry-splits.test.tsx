import { fireEvent, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { EntryManager } from './entries';
import { partsFromDraft } from './entry-model';
import { findLive } from './test/live';
import { renderWithQuery } from './test/query';
import { unexpectedRequest } from './test/unexpected';

// #292 The split editor of the entry form: parts with a category and an amount that add up to the payment.
const Router = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={['/ledger']}>{children}</MemoryRouter>
);

const categories = [
  { id: 1, kind: 'expense', name: 'Food', hidden: false },
  { id: 2, kind: 'expense', name: 'Household', hidden: false },
  { id: 3, kind: 'income', name: 'Salary', hidden: false },
];
const split = {
  id: 7,
  date: '2026-11-01',
  kind: 'expense',
  amount: 30000,
  categoryId: 2,
  categoryName: 'Household',
  merchant: 'Coupang',
  memo: '',
  paymentMethod: null,
  splits: [
    { categoryId: 1, categoryName: 'Food', amount: 10000 },
    { categoryId: 2, categoryName: 'Household', amount: 20000 },
  ],
};

let stored: unknown[];
let requests: { method: string; url: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  stored = [split];
  requests = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T15:30:00Z'));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      requests.push({ method, url, body });
      const path = url.split('?')[0];
      if (method === 'GET' && url === '/api/ledger/categories') return json({ categories });
      if (method === 'GET' && path === '/api/ledger/entries') {
        return json({ entries: stored, total: stored.length });
      }
      if (method === 'POST' && url === '/api/ledger/entries')
        return json({ entry: { ...body, id: 9 } }, 201);
      if (method === 'PUT' && url === '/api/ledger/entries/7')
        return json({ entry: { ...body, id: 7 } });
      return unexpectedRequest(method, url);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

const ready = async () => {
  renderWithQuery(<EntryManager />, { wrapper: Router });
  await screen.findByRole('list', { name: 'Entry list' });
  await screen.findByRole('option', { name: 'Food' });
};
const summary = () => screen.getByText(/is left to assign|add up to the payment|over the payment/);
const part = (n: number, category: string, amount: string) => {
  fireEvent.change(screen.getByLabelText(`Part ${n} category`), { target: { value: category } });
  fireEvent.change(screen.getByLabelText(`Part ${n} amount`), { target: { value: amount } });
};

test('a split entry lists its parts', async () => {
  await ready();
  const item = within(screen.getByRole('list', { name: 'Entry list' })).getAllByRole('listitem')[0];
  expect(item).toHaveTextContent('Split');
  expect(item).toHaveTextContent('Food ₩10,000 · Household ₩20,000');
});

test('a payment is split into parts that add up, and the parts are sent', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '30,000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Split this payment' }));
  expect(screen.queryByLabelText('Category', { selector: '#entry-category' })).toBeNull();
  part(1, '1', '10000');
  expect(summary()).toHaveTextContent('₩20,000 is left to assign.');
  part(2, '2', '20000');
  expect(summary()).toHaveTextContent('The parts add up to the payment.');
  fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));

  expect(await findLive('status')).toHaveTextContent('Expense ₩30,000 recorded');
  const post = requests.find((request) => request.method === 'POST');
  expect(post?.body).toMatchObject({
    amount: 30000,
    splits: [
      { categoryId: 1, amount: 10000 },
      { categoryId: 2, amount: 20000 },
    ],
  });
});

test('parts that do not add up are refused before sending', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '30000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Split this payment' }));
  part(1, '1', '10000');
  part(2, '2', '19000');
  expect(summary()).toHaveTextContent('₩1,000 is left to assign.');
  fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
  expect(await findLive('alert')).toHaveTextContent(
    'The parts add up to ₩29,000 but the payment is ₩30,000',
  );
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
});

test('editing a split entry shows its parts and undoing the split saves one category', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
  expect(screen.getByLabelText('Part 1 amount')).toHaveValue('10000');
  expect(screen.getByLabelText('Part 2 category')).toHaveValue('2');
  fireEvent.click(screen.getByRole('button', { name: 'Undo the split' }));
  // The single category is the first part's.
  expect(screen.getByLabelText('Category', { selector: '#entry-category' })).toHaveValue('1');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await findLive('status')).toHaveTextContent('Entry updated');
  const put = requests.find((request) => request.method === 'PUT');
  expect(put?.body).toMatchObject({ amount: 30000, categoryId: 1, splits: null });
});

test('partsFromDraft names what is wrong with a part', () => {
  const ok = [
    { categoryId: '1', amount: '600' },
    { categoryId: '2', amount: '400' },
  ];
  expect(partsFromDraft(ok, 1000)).toEqual({
    parts: [
      { categoryId: 1, amount: 600 },
      { categoryId: 2, amount: 400 },
    ],
  });
  expect(partsFromDraft([{ categoryId: '', amount: '600' }, ok[1]], 1000)).toEqual({
    error: 'Choose a category for part 1',
  });
  expect(partsFromDraft([ok[0], { categoryId: '2', amount: '0' }], 600)).toEqual({
    error: 'Enter an amount of ₩1 or more for part 2',
  });
  expect(partsFromDraft([ok[0], { categoryId: '1', amount: '400' }], 1000)).toEqual({
    error: 'Use each category once. Add the amounts of the same category together',
  });
  expect(partsFromDraft(ok, 999)).toEqual({
    error: 'The parts add up to ₩1,000 but the payment is ₩999',
  });
});
