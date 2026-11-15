import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { CategoryManager } from './categories';

type Category = { id: number; kind: 'income' | 'expense'; name: string; hidden: boolean };

let stored: Category[];
let requests: { method: string; url: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

// A small in-memory version of /api/ledger/categories with the server's duplicate rule.
function fakeApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body: unknown = init.body ? JSON.parse(init.body as string) : undefined;
      requests.push({ method, url, body });
      const taken = (kind: string, name: string, id?: number) =>
        stored.some(
          (category) => category.kind === kind && category.name === name && category.id !== id,
        );
      if (method === 'GET') return json({ categories: stored });
      if (method === 'POST') {
        const { kind, name } = body as Category;
        if (taken(kind, name))
          return json({ error: 'A category with this name already exists for this kind' }, 409);
        const category = { id: stored.length + 1, kind, name, hidden: false };
        stored = [...stored, category];
        return json({ category }, 201);
      }
      const id = Number(url.split('/').pop());
      const current = stored.find((category) => category.id === id)!;
      const next = { ...current, ...(body as Partial<Category>) };
      if (taken(next.kind, next.name, id))
        return json({ error: 'A category with this name already exists for this kind' }, 409);
      stored = stored.map((category) => (category.id === id ? next : category));
      return json({ category: next });
    }),
  );
}

beforeEach(() => {
  stored = [
    { id: 1, kind: 'expense', name: 'Food', hidden: false },
    { id: 2, kind: 'expense', name: 'Transport', hidden: true },
    { id: 3, kind: 'income', name: 'Salary', hidden: false },
  ];
  requests = [];
  fakeApi();
});

const list = (name: string) => screen.findByRole('list', { name });

test('expense and income categories are listed separately and hidden ones are marked', async () => {
  render(<CategoryManager />);
  const expense = await list('Expense category');
  const income = screen.getByRole('list', { name: 'Income category' });
  expect(
    within(expense)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual([expect.stringContaining('Food'), expect.stringContaining('TransportHidden')]);
  expect(within(income).getByText('Salary')).toBeInTheDocument();
  expect(within(income).queryByText('Food')).not.toBeInTheDocument();
  // Hidden categories are not counted: Food of the two expenses, and Salary.
  expect(screen.getAllByText('1 in use')).toHaveLength(2);
});

test('adding a category sends the trimmed name and shows it in its list', async () => {
  render(<CategoryManager />);
  await list('Expense category');
  fireEvent.change(screen.getByLabelText('New expense category'), { target: { value: '  Pets ' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
  expect(await screen.findByRole('status')).toHaveTextContent('Pets category added');
  expect(requests).toContainEqual({
    method: 'POST',
    url: '/api/ledger/categories',
    body: { kind: 'expense', name: 'Pets' },
  });
  expect(
    within(screen.getByRole('list', { name: 'Expense category' })).getByText('Pets'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('New expense category')).toHaveValue('');
});

test('a duplicate name shows the server message and keeps the input', async () => {
  render(<CategoryManager />);
  await list('Expense category');
  fireEvent.change(screen.getByLabelText('New expense category'), { target: { value: 'Food' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'A category with this name already exists for this kind',
  );
  expect(screen.getByLabelText('New expense category')).toHaveValue('Food');
});

test('the add button is disabled until a name is typed', async () => {
  render(<CategoryManager />);
  await list('Expense category');
  fireEvent.change(screen.getByLabelText('New income category'), { target: { value: '   ' } });
  expect(screen.getAllByRole('button', { name: 'Add' })[1]).toBeDisabled();
});

test('hiding and showing again change the category through the API', async () => {
  render(<CategoryManager />);
  await list('Expense category');
  fireEvent.click(screen.getByRole('button', { name: 'Hide Food' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Food category hidden');
  expect(requests).toContainEqual({
    method: 'PATCH',
    url: '/api/ledger/categories/1',
    body: { hidden: true },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Show Transport again' }));
  expect(await screen.findByText('Transport category is visible again')).toBeInTheDocument();
  expect(requests).toContainEqual({
    method: 'PATCH',
    url: '/api/ledger/categories/2',
    body: { hidden: false },
  });
});

test('renaming saves the new name and cancelling keeps the old one', async () => {
  render(<CategoryManager />);
  await list('Expense category');
  fireEvent.click(screen.getByRole('button', { name: 'Rename Food' }));
  fireEvent.change(screen.getByLabelText('Food new name'), { target: { value: 'Dining out' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Food')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Rename Food' }));
  fireEvent.change(screen.getByLabelText('Food new name'), { target: { value: 'Dining out' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Category renamed to Dining out');
  expect(screen.getByRole('button', { name: 'Hide Dining out' })).toBeInTheDocument();
});

test('a failure to load is reported as an alert', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
  render(<CategoryManager />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server');
  expect(screen.queryByText('Loading categories')).not.toBeInTheDocument();
});

test('opening rename again starts from the saved name, and focus returns to the button', async () => {
  render(<CategoryManager />);
  await list('Expense category');
  fireEvent.click(screen.getByRole('button', { name: 'Rename Food' }));
  expect(screen.getByLabelText('Food new name')).toHaveFocus();
  fireEvent.change(screen.getByLabelText('Food new name'), { target: { value: '  Dining out ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  const renameButton = await screen.findByRole('button', { name: 'Rename Dining out' });
  // Focus moves in an effect after the row re-renders, so wait for it rather than checking once.
  await vi.waitFor(() => expect(renameButton).toHaveFocus());

  fireEvent.click(renameButton);
  expect(screen.getByLabelText('Dining out new name')).toHaveValue('Dining out');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Rename Dining out' })).toHaveFocus();
});

test('a change that saved but could not reload says both and still clears the input', async () => {
  render(<CategoryManager />);
  await list('Expense category');
  const api = vi.mocked(fetch);
  const saveThenFail = api.getMockImplementation()!;
  api.mockImplementation((url, init) =>
    (init?.method ?? 'GET') === 'GET'
      ? Promise.reject(new TypeError('offline'))
      : saveThenFail(url, init),
  );
  fireEvent.change(screen.getByLabelText('New expense category'), { target: { value: 'Pets' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Pets category added. Could not reload the list',
  );
  expect(screen.getByLabelText('New expense category')).toHaveValue('');
});

test('a second submit while saving sends nothing', async () => {
  render(<CategoryManager />);
  await list('Expense category');
  fireEvent.change(screen.getByLabelText('New expense category'), { target: { value: 'Pets' } });
  const form = screen.getByLabelText('New expense category').closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(screen.getAllByRole('button', { name: 'Add' })[0]).toBeEnabled();
  expect(await screen.findByRole('status')).toHaveTextContent('Pets category added');
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
});
