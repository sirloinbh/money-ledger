import { act, fireEvent, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { EntryManager } from './entries';
import { ledgerKey } from './ledger-query';
import { findLive, getLive, queryLive } from './test/live';
import { renderWithQuery, testQueryClient } from './test/query';
import { unexpectedRequest } from './test/unexpected';

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
// When set, the next list load answers with this error (a reload that fails).
let failNextList: string | undefined;

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status }),
  );

// A small in-memory /api/ledger/entries (newest first), a fixed category list, and the CSV import, which adds
// one entry per row sent. Any other request fails the test (#183).
function fakeApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body
        ? (JSON.parse(init.body as string) as Omit<Entry, 'id' | 'categoryName'>)
        : undefined;
      requests.push({ method, url, body });
      const path = url.split('?')[0];
      if (method === 'GET' && url === '/api/ledger/categories') return json({ categories });
      if (method === 'GET' && path === '/api/ledger/entries') {
        if (failNextList) {
          const error = failNextList;
          failNextList = undefined;
          return json({ error }, 500);
        }
        return json({
          entries: [...stored].sort((a, b) => b.date.localeCompare(a.date)),
          total: stored.length,
        });
      }
      if (method === 'POST' && url === '/api/ledger/entries/csv/preview') {
        const { rows } = init.body
          ? (JSON.parse(init.body as string) as { rows: unknown[] })
          : { rows: [] };
        return json({ rows: rows.length, valid: rows.length, problems: [], duplicates: [] });
      }
      if (method === 'POST' && url === '/api/ledger/entries/csv/import') {
        const { rows } = JSON.parse(init.body as string) as {
          rows: { date: string; amount: string; merchant: string }[];
        };
        stored = [
          ...stored,
          ...rows.map((row, index) => ({
            id: 100 + index,
            date: row.date,
            kind: 'expense' as const,
            amount: Number(row.amount),
            categoryId: null,
            categoryName: null,
            merchant: row.merchant,
            memo: '',
          })),
        ];
        return json({ imported: rows.length, skipped: 0 });
      }
      const known =
        (method === 'POST' && url === '/api/ledger/entries') ||
        ((method === 'PUT' || method === 'DELETE') && /^\/api\/ledger\/entries\/\d+$/.test(url));
      if (!known) return unexpectedRequest(method, url);
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
  failNextList = undefined;
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
  renderWithQuery(<EntryManager />, { wrapper: Router });
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

  expect(await findLive('status')).toHaveTextContent('Expense ₩12,500 recorded');
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

test.each(['-1', '1.5', 'abc', '', '1,000,000,000,001'])(
  'the amount "%s" is refused before sending',
  async (amount) => {
    await ready();
    fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: amount } });
    fireEvent.change(screen.getByLabelText('Category', { selector: '#entry-category' }), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    expect(getLive('alert')).toHaveTextContent(
      'Enter the amount as a whole number of won, from 0 to ₩1 trillion',
    );
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
  },
);

test('an entry without a category is sent as Uncategorized with its merchant', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Merchant'), { target: { value: 'Starbucks Gangnam' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));

  expect(await findLive('status')).toHaveTextContent('Expense ₩1,000 recorded');
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

test('a server refusal shows its message and keeps the input', async () => {
  await ready();
  vi.mocked(fetch).mockImplementationOnce(() => json({ error: 'That date does not exist' }, 400));
  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Category', { selector: '#entry-category' }), {
    target: { value: '1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
  expect(await findLive('alert')).toHaveTextContent('That date does not exist');
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
  expect(await findLive('status')).toHaveTextContent('Entry updated');
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
  expect(getLive('status')).toHaveTextContent('Entry deleted');
});

// A change in another section of the Ledger page reloads every ledger read (#213).
const ledgerChangedElsewhere = () =>
  act(() => testQueryClient().invalidateQueries({ queryKey: ledgerKey }));

test('a category change elsewhere reloads the category choices', async () => {
  renderWithQuery(<EntryManager />, { wrapper: Router });
  await screen.findByRole('option', { name: 'Food' });
  categories[0] = { ...categories[0], hidden: true };
  try {
    await ledgerChangedElsewhere();
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
    'Enter the amount as a whole number of won, from 0 to ₩1 trillion',
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
  expect(await findLive('status')).toHaveTextContent('Expense ₩1,000 recorded');
  expect(screen.getByRole('button', { name: 'Add entry' })).toBeInTheDocument();
});

test('a category change reloads the list, and a chosen category hidden meanwhile is unchosen', async () => {
  renderWithQuery(<EntryManager />, { wrapper: Router });
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
    await ledgerChangedElsewhere();
    // The lost choice shows as "Choose again" instead of silently turning into Uncategorized.
    await vi.waitFor(() => expect(optionLabels()).toEqual(['Choose again', 'Uncategorized']));
    expect(listLoads()).toBe(before + 1);
    expect(screen.getByLabelText('Category', { selector: '#entry-category' })).toHaveValue('stale');

    fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    expect(getLive('alert')).toHaveTextContent(
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
    await findLive('status');
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
  expect(await findLive('status')).toHaveTextContent('Expense ₩1,000 recorded');
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
  expect(await findLive('status')).toHaveTextContent('Entry updated');
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
  renderWithQuery(<EntryManager />, { wrapper: Router });
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.click(
    await screen.findByRole('button', { name: 'Edit 2026-11-02 Uncategorized ₩3,000' }),
  );
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Breakfast' } });

  // The bulk classification below the form puts it in Food.
  stored = [{ ...stored[0], categoryId: 1, categoryName: 'Food' }];
  await ledgerChangedElsewhere();
  await vi.waitFor(() =>
    expect(screen.getByLabelText('Category', { selector: '#entry-category' })).toHaveValue('1'),
  );
  expect(getLive('status')).toHaveTextContent(
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
  renderWithQuery(<EntryManager />, { wrapper: Router });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit 2026-11-01 Leisure ₩5,000' }));
  expect(
    within(screen.getByLabelText('Category', { selector: '#entry-category' })).queryByRole(
      'option',
      { name: 'Choose again' },
    ),
  ).toBeNull();
});

test('after a save here, a later change elsewhere still reloads the list (#198)', async () => {
  renderWithQuery(<EntryManager />, { wrapper: Router });
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '3000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
  expect(await findLive('status')).toHaveTextContent('Expense ₩3,000 recorded');

  // Later an entry is classified elsewhere on the page.
  stored = stored.map((entry) => ({ ...entry, memo: 'Classified elsewhere' }));
  await ledgerChangedElsewhere();
  expect(await screen.findAllByText('Classified elsewhere')).not.toHaveLength(0);
});

test('a delete blocks a save until it is done (#198)', async () => {
  let finishDelete: (response: Response) => void = () => undefined;
  const api = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url: string | URL | Request, init?: RequestInit) =>
    init?.method === 'DELETE'
      ? new Promise<Response>((resolve) => {
          requests.push({ method: 'DELETE', url: String(url), body: undefined });
          finishDelete = resolve;
        })
      : api(url, init),
  );
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Delete 2026-11-01 Leisure ₩5,000' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
  await vi.waitFor(() => expect(requests.some((r) => r.method === 'DELETE')).toBe(true));

  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '3000' } });
  // The dialog is still open while the delete runs, so the form behind it is hidden from the tree.
  fireEvent.click(screen.getByRole('button', { name: 'Add entry', hidden: true }));
  expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);

  stored = [];
  finishDelete(new Response(null, { status: 204 }));
  expect(await screen.findByText('Entry deleted')).toBeInTheDocument();
});

/** After the next change is saved, the reload of `path` fails once (#262). */
function failReloadAfterSave(path: string) {
  const api = vi.mocked(fetch).getMockImplementation()!;
  let saved = false;
  vi.mocked(fetch).mockImplementation((url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') saved = true;
    else if (saved && String(url).startsWith(path)) {
      saved = false;
      return Promise.reject(new TypeError('offline'));
    }
    return api(url, init);
  });
}

test('a saved entry or delete whose list fails to reload is a note, not an error (#262)', async () => {
  await ready();
  failReloadAfterSave('/api/ledger/entries');
  fireEvent.change(screen.getByLabelText('Amount (KRW)'), { target: { value: '12500' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
  expect(await findLive('status')).toHaveTextContent(
    'Expense ₩12,500 recorded. The list could not be reloaded; reload the page to see it',
  );
  expect(queryLive('alert')).toBeNull();

  failReloadAfterSave('/api/ledger/entries');
  fireEvent.click(screen.getByRole('button', { name: 'Delete 2026-11-01 Leisure ₩5,000' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete this entry?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await vi.waitFor(() =>
    expect(getLive('status')).toHaveTextContent(
      'Entry deleted. The list could not be reloaded; reload the page to see it',
    ),
  );
  expect(queryLive('alert')).toBeNull();
});

// #183 After a CSV import the list must show the new rows (#213: through `ledgerKey`, with every other ledger
// read), and a failed reload says so.
const importOneRow = async () => {
  const file = new File(['date,merchant,amount\n2026-11-02,Bakery,4500\n'], 'card.csv', {
    type: 'text/csv',
  });
  fireEvent.change(screen.getByLabelText('CSV file to import'), { target: { files: [file] } });
  await screen.findByRole('group', { name: /Columns of card\.csv/ });
  fireEvent.click(screen.getByRole('button', { name: 'Check the rows' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import 1 entry' }));
};

test('a CSV import reloads the list once and makes the other ledger reads stale', async () => {
  testQueryClient().setQueryData(['/api/ledger', 'summary', '2026-10'], { month: '2026-10' });
  await ready();
  const loads = () =>
    requests.filter((r) => r.method === 'GET' && r.url.startsWith('/api/ledger/entries?'));
  const before = loads().length;
  await importOneRow();
  expect(await screen.findByText('Bakery')).toBeInTheDocument();
  expect(loads()).toHaveLength(before + 1);
  expect(
    testQueryClient().getQueryState(['/api/ledger', 'summary', '2026-10'])?.isInvalidated,
  ).toBe(true);
});

test('a failed reload after a CSV import says so', async () => {
  await ready();
  failNextList = 'Cannot connect to the database';
  await importOneRow();
  expect(await screen.findByText('Cannot connect to the database')).toBeInTheDocument();
  expect(screen.queryByText('Bakery')).toBeNull();
});
