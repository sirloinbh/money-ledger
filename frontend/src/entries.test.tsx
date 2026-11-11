import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { EntryManager } from './entries';

// The list filters live in the address, so the manager renders inside a router.
const Router = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={['/ledger']}>{children}</MemoryRouter>
);

type Entry = {
  id: number;
  date: string;
  kind: 'income' | 'expense';
  amount: number;
  categoryId: number | null;
  categoryName: string | null;
  merchant: string;
  memo: string;
};

const categories = [
  { id: 1, kind: 'expense', name: 'Food', hidden: false },
  { id: 2, kind: 'expense', name: 'Leisure', hidden: true },
  { id: 3, kind: 'income', name: 'Salary', hidden: false },
];

let stored: Entry[];
let requests: { method: string; url: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status }),
  );

// A small in-memory /api/ledger/entries (newest first) and a fixed category list.
function fakeApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body
        ? (JSON.parse(init.body as string) as Omit<Entry, 'id' | 'categoryName'>)
        : undefined;
      requests.push({ method, url, body });
      if (url === '/api/ledger/categories') return json({ categories });
      if (method === 'GET')
        return json({
          entries: [...stored].sort((a, b) => b.date.localeCompare(a.date)),
          total: stored.length,
        });
      const id = Number(url.split('/').pop());
      if (method === 'DELETE') {
        stored = stored.filter((entry) => entry.id !== id);
        return json(undefined, 204);
      }
      // Without a category the entry stays Uncategorized here (no rules in this fake).
      const name = categories.find((category) => category.id === body!.categoryId)?.name ?? null;
      if (method === 'POST') {
        const entry = { ...body!, id: stored.length + 10, categoryName: name };
        stored = [...stored, entry];
        return json({ entry }, 201);
      }
      const entry = { ...body!, id, categoryName: name };
      stored = stored.map((current) => (current.id === id ? entry : current));
      return json({ entry });
    }),
  );
}

beforeEach(() => {
  // 2026-11-03 00:30 in Seoul is still 2026-11-02 in UTC.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T15:30:00Z'));
  stored = [
    {
      id: 1,
      date: '2026-11-01',
      kind: 'expense',
      amount: 5000,
      categoryId: 2,
      categoryName: 'Leisure',
      merchant: '',
      memo: 'Movie',
    },
  ];
  requests = [];
  fakeApi();
});

afterEach(() => {
  vi.useRealTimers();
});

const optionLabels = () =>
  within(screen.getByLabelText('Category', { selector: '#entry-category' }))
    .getAllByRole('option')
    .map((option) => option.textContent);

const ready = async () => {
  render(<EntryManager />, { wrapper: Router });
  await screen.findByRole('list', { name: 'Entry list' });
  await screen.findByRole('option', { name: 'Food' });
};

test('a new entry starts on today in Seoul and offers only visible categories of its kind', async () => {
  await ready();
  expect(screen.getByLabelText('Date')).toHaveValue('2026-11-03');
  expect(screen.getByRole('radio', { name: 'Expense' })).toBeChecked();
  expect(optionLabels()).toEqual(['Uncategorized', 'Food']);

  fireEvent.click(screen.getByRole('radio', { name: 'Income' }));
  expect(optionLabels()).toEqual(['Uncategorized', 'Salary']);
});

test('recording sends whole won, keeps the date and kind, and lists the entry', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '12,500' } });
  fireEvent.change(screen.getByLabelText('Category', { selector: '#entry-category' }), {
    target: { value: '1' },
  });
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Lunch' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));

  expect(await screen.findByRole('status')).toHaveTextContent('Expense ₩12,500 recorded');
  expect(requests).toContainEqual({
    method: 'POST',
    url: '/api/ledger/entries',
    body: {
      date: '2026-11-03',
      kind: 'expense',
      amount: 12500,
      categoryId: 1,
      merchant: '',
      memo: 'Lunch',
    },
  });
  expect(screen.getByLabelText('Amount (KRW)')).toHaveValue('');
  expect(screen.getByLabelText('Note')).toHaveValue('');
  expect(screen.getByLabelText('Date')).toHaveValue('2026-11-03');
  const first = within(screen.getByRole('list', { name: 'Entry list' })).getAllByRole(
    'listitem',
  )[0];
  expect(first).toHaveTextContent('2026-11-03');
  expect(first).toHaveTextContent('-₩12,500');
});

test.each(['-1', '1.5', 'abc', ''])('the amount "%s" is refused before sending', async (amount) => {
  await ready();
  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText('Category', { selector: '#entry-category' }), {
    target: { value: '1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Enter the amount as a whole number of won, 0 or more',
  );
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
});

test('an entry without a category is sent as Uncategorized with its merchant', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Merchant'), { target: { value: 'Starbucks Gangnam' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));

  expect(await screen.findByRole('status')).toHaveTextContent('Expense ₩1,000 recorded');
  expect(requests).toContainEqual({
    method: 'POST',
    url: '/api/ledger/entries',
    body: {
      date: '2026-11-03',
      kind: 'expense',
      amount: 1000,
      categoryId: null,
      merchant: 'Starbucks Gangnam',
      memo: '',
    },
  });
  expect(screen.getByLabelText('Merchant')).toHaveValue('');
  const first = within(screen.getByRole('list', { name: 'Entry list' })).getAllByRole(
    'listitem',
  )[0];
  expect(first).toHaveTextContent('Uncategorized');
  expect(first).toHaveTextContent('Starbucks Gangnam');
});

test('a server refusal shows its Korean message and keeps the input', async () => {
  await ready();
  vi.mocked(fetch).mockImplementationOnce(() => json({ error: 'That date does not exist' }, 400));
  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Category', { selector: '#entry-category' }), {
    target: { value: '1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('That date does not exist');
  expect(screen.getByLabelText('Amount (KRW)')).toHaveValue('1000');
});

test('editing fills the form, keeps the hidden category it has, and saves with PUT', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Edit 2026-11-01 Leisure ₩5,000' }));
  expect(screen.getByRole('heading', { name: 'Edit entry' })).toBeInTheDocument();
  expect(screen.getByLabelText('Date')).toHaveValue('2026-11-01');
  expect(screen.getByLabelText('Amount (KRW)')).toHaveValue('5000');
  expect(optionLabels()).toEqual(['Uncategorized', 'Food', 'Leisure (hidden)']);
  expect(screen.getByLabelText('Category', { selector: '#entry-category' })).toHaveValue('2');

  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '7000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Entry updated');
  expect(requests).toContainEqual({
    method: 'PUT',
    url: '/api/ledger/entries/1',
    body: {
      date: '2026-11-01',
      kind: 'expense',
      amount: 7000,
      categoryId: 2,
      merchant: '',
      memo: 'Movie',
    },
  });
  expect(screen.getByRole('heading', { name: 'New entry' })).toBeInTheDocument();
  expect(screen.getByLabelText('Date')).toHaveValue('2026-11-03');
});

test('cancelling an edit goes back to an empty new entry', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Edit 2026-11-01 Leisure ₩5,000' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
  expect(screen.getByRole('heading', { name: 'New entry' })).toBeInTheDocument();
  expect(screen.getByLabelText('Amount (KRW)')).toHaveValue('');
  expect(optionLabels()).toEqual(['Uncategorized', 'Food']);
});

test('deleting asks first, then removes the entry', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Delete 2026-11-01 Leisure ₩5,000' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete this entry?' });
  expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('No entries match the filters.')).toBeInTheDocument();
  expect(requests).toContainEqual({
    method: 'DELETE',
    url: '/api/ledger/entries/1',
    body: undefined,
  });
  expect(screen.getByRole('status')).toHaveTextContent('Entry deleted');
});

test('a new categories version reloads the category choices', async () => {
  const { rerender } = render(<EntryManager categoriesVersion={0} />, { wrapper: Router });
  await screen.findByRole('option', { name: 'Food' });
  categories[0] = { ...categories[0], hidden: true };
  try {
    rerender(<EntryManager categoriesVersion={1} />);
    await vi.waitFor(() => expect(optionLabels()).toEqual(['Uncategorized']));
  } finally {
    categories[0] = { ...categories[0], hidden: false };
  }
});

test('opening an edit moves focus to the date field of the form', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Edit 2026-11-01 Leisure ₩5,000' }));
  expect(screen.getByLabelText('Date')).toHaveFocus();
});

test('a refused field is marked invalid and points at the message', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '-5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
  const amount = screen.getByLabelText('Amount (KRW)');
  expect(amount).toHaveAttribute('aria-invalid', 'true');
  expect(amount).toHaveAccessibleDescription(
    'Enter the amount as a whole number of won, 0 or more',
  );
  fireEvent.change(amount, { target: { value: '5' } });
  expect(amount).not.toHaveAttribute('aria-invalid');
});

test('while a save runs, opening an edit waits and the button says so', async () => {
  await ready();
  let finish = () => {};
  const api = vi.mocked(fetch);
  const real = api.getMockImplementation()!;
  api.mockImplementationOnce(
    (url, init) =>
      new Promise((resolve) => {
        finish = () => resolve(real(url, init));
      }),
  );
  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Category', { selector: '#entry-category' }), {
    target: { value: '1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
  expect(await screen.findByRole('button', { name: 'Saving…' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Edit 2026-11-01 Leisure ₩5,000' }));
  expect(screen.getByRole('heading', { name: 'New entry' })).toBeInTheDocument();

  finish();
  expect(await screen.findByRole('status')).toHaveTextContent('Expense ₩1,000 recorded');
  expect(screen.getByRole('button', { name: 'Add entry' })).toBeInTheDocument();
});

test('a category change reloads the list, and a chosen category hidden meanwhile is unchosen', async () => {
  const { rerender } = render(<EntryManager categoriesVersion={0} />, { wrapper: Router });
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.change(screen.getByLabelText('Category', { selector: '#entry-category' }), {
    target: { value: '1' },
  });
  const listLoads = () =>
    requests.filter(
      (request) => request.method === 'GET' && request.url.startsWith('/api/ledger/entries?'),
    ).length;
  const before = listLoads();

  categories[0] = { ...categories[0], hidden: true };
  try {
    rerender(<EntryManager categoriesVersion={1} />);
    // The lost choice shows as "Choose again" instead of silently turning into Uncategorized.
    await vi.waitFor(() => expect(optionLabels()).toEqual(['Choose again', 'Uncategorized']));
    expect(listLoads()).toBe(before + 1);
    expect(screen.getByLabelText('Category', { selector: '#entry-category' })).toHaveValue('stale');

    fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The chosen category cannot be used. Choose a category again',
    );
    expect(screen.getByLabelText('Category', { selector: '#entry-category' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(requests.some((request) => request.method === 'POST')).toBe(false);

    // Choosing Uncategorized on purpose is allowed.
    fireEvent.change(screen.getByLabelText('Category', { selector: '#entry-category' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    await screen.findByRole('status');
    expect(requests.find((request) => request.method === 'POST')?.body).toMatchObject({
      categoryId: null,
    });
  } finally {
    categories[0] = { ...categories[0], hidden: false };
  }
});

test('after a delete focus goes to the section title; after cancelling, back to the delete button', async () => {
  await ready();
  const remove = screen.getByRole('button', { name: 'Delete 2026-11-01 Leisure ₩5,000' });
  fireEvent.click(remove);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await vi.waitFor(() => expect(remove).toHaveFocus());

  fireEvent.click(remove);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
  await screen.findByText('No entries match the filters.');
  await vi.waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Income and expense entries' })).toHaveFocus(),
  );
});

test('what is typed while a save runs is kept', async () => {
  await ready();
  let finish = () => {};
  const api = vi.mocked(fetch);
  const real = api.getMockImplementation()!;
  api.mockImplementationOnce(
    (url, init) =>
      new Promise((resolve) => {
        finish = () => resolve(real(url, init));
      }),
  );
  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Category', { selector: '#entry-category' }), {
    target: { value: '1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
  await screen.findByRole('button', { name: 'Saving…' });
  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '2000' } });
  finish();
  expect(await screen.findByRole('status')).toHaveTextContent('Expense ₩1,000 recorded');
  expect(screen.getByLabelText('Amount (KRW)')).toHaveValue('2000');
});

test('editing an uncategorized entry keeps Uncategorized and its merchant', async () => {
  stored = [
    {
      id: 5,
      date: '2026-11-02',
      kind: 'expense',
      amount: 3000,
      categoryId: null,
      categoryName: null,
      merchant: 'Neighborhood bakery',
      memo: '',
    },
  ];
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Edit 2026-11-02 Uncategorized ₩3,000' }));
  expect(screen.getByLabelText('Category', { selector: '#entry-category' })).toHaveValue('');
  expect(screen.getByLabelText('Merchant')).toHaveValue('Neighborhood bakery');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Entry updated');
  expect(requests.find((request) => request.method === 'PUT')?.body).toEqual({
    date: '2026-11-02',
    kind: 'expense',
    amount: 3000,
    categoryId: null,
    merchant: 'Neighborhood bakery',
    memo: '',
  });
});

test('an entry classified elsewhere while being edited keeps that category when saved', async () => {
  stored = [
    {
      id: 5,
      date: '2026-11-02',
      kind: 'expense',
      amount: 3000,
      categoryId: null,
      categoryName: null,
      merchant: 'Neighborhood bakery',
      memo: '',
    },
  ];
  const { rerender } = render(<EntryManager entriesVersion={0} />, { wrapper: Router });
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.click(
    await screen.findByRole('button', { name: 'Edit 2026-11-02 Uncategorized ₩3,000' }),
  );
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Breakfast' } });

  // The bulk classification below the form puts it in Food.
  stored = [{ ...stored[0], categoryId: 1, categoryName: 'Food' }];
  rerender(<EntryManager entriesVersion={1} />);
  await vi.waitFor(() =>
    expect(screen.getByLabelText('Category', { selector: '#entry-category' })).toHaveValue('1'),
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'The category of the entry being edited was changed elsewhere and has been applied',
  );
  expect(screen.getByLabelText('Note')).toHaveValue('Breakfast');

  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Entry updated')).toBeInTheDocument();
  expect(requests.find((request) => request.method === 'PUT')?.body).toMatchObject({
    categoryId: 1,
    memo: 'Breakfast',
  });
});

test('while categories have not loaded, a chosen category is not flagged', async () => {
  vi.mocked(fetch).mockImplementation((url: string | URL | Request) =>
    String(url) === '/api/ledger/categories'
      ? new Promise<Response>(() => undefined) // never answers
      : json({ entries: stored, total: stored.length }),
  );
  render(<EntryManager />, { wrapper: Router });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit 2026-11-01 Leisure ₩5,000' }));
  expect(
    within(screen.getByLabelText('Category', { selector: '#entry-category' })).queryByRole(
      'option',
      { name: 'Choose again' },
    ),
  ).toBeNull();
});
