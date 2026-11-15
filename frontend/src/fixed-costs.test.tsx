import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';

type Item = {
  id: number;
  name: string;
  categoryId: number;
  categoryName: string;
  amount: number;
  variable: boolean;
  dayOfMonth: number;
  startMonth: string;
  active: boolean;
  entry: { id: number; date: string; amount: number; estimated: boolean } | null;
};

let items: Item[];
let added: number;
let requests: { method: string; url: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const rent: Item = {
  id: 1,
  name: 'Rent',
  categoryId: 3,
  categoryName: '주거',
  amount: 500_000,
  variable: false,
  dayOfMonth: 1,
  startMonth: '2026-11',
  active: true,
  entry: { id: 10, date: '2026-11-01', amount: 500_000, estimated: false },
};
const power: Item = {
  id: 2,
  name: 'Electricity',
  categoryId: 3,
  categoryName: '주거',
  amount: 40_000,
  variable: true,
  dayOfMonth: 31,
  startMonth: '2026-10',
  active: true,
  entry: { id: 11, date: '2026-11-30', amount: 52_000, estimated: true },
};

// A small in-memory /api/ledger/fixed-costs for November 2026, with the expense categories.
function fakeApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body: unknown = init.body ? JSON.parse(init.body as string) : undefined;
      requests.push({ method, url, body });
      if (url === '/api/ledger/categories') {
        return json({
          categories: [
            { id: 3, kind: 'expense', name: '주거', hidden: false },
            { id: 4, kind: 'expense', name: '통신', hidden: false },
            { id: 9, kind: 'income', name: '급여', hidden: false },
          ],
        });
      }
      if (url.endsWith('/generate')) return json({ added });
      if (method === 'GET') {
        const fixed = items.reduce((sum, item) => sum + (item.entry?.amount ?? 0), 0);
        return json({ month: '2026-11', fixedCosts: items, totals: { fixed, other: 123_000 } });
      }
      if (method === 'POST') {
        const created = {
          ...(body as Item),
          id: 3,
          categoryName: '통신',
          active: true,
          entry: null,
        };
        items = [...items, created];
        return json({ fixedCost: created }, 201);
      }
      const id = Number(url.split('/')[4]);
      if (method === 'PUT') {
        const { amount } = body as { amount: number };
        items = items.map((item) =>
          item.id === id ? { ...item, entry: { ...item.entry!, amount, estimated: false } } : item,
        );
        return json({ entry: { id, amount, estimated: false } });
      }
      items = items.map((item) => (item.id === id ? { ...item, ...(body as object) } : item));
      return json({ fixedCost: items.find((item) => item.id === id) });
    }),
  );
}

// A fresh module for each test, so "add the due entries once per page load" starts again.
let FixedCostManager: typeof import('./fixed-costs').FixedCostManager;
beforeEach(async () => {
  items = [rent, power];
  added = 0;
  requests = [];
  fakeApi();
  vi.resetModules();
  ({ FixedCostManager } = await import('./fixed-costs'));
});

const show = (onChange?: () => void) =>
  render(
    <MemoryRouter initialEntries={['/ledger?month=2026-11']}>
      <FixedCostManager onChange={onChange} />
    </MemoryRouter>,
  );
const list = () => screen.findByRole('list', { name: 'Fixed costs' });
const sent = (method: string) => requests.filter((request) => request.method === method);

test('the month splits fixed costs from other spending and lists each item', async () => {
  show();
  const items = within(await list()).getAllByRole('listitem');
  expect(screen.getByText('Fixed costs ₩552,000')).toBeInTheDocument();
  expect(screen.getByText('Other spending ₩123,000')).toBeInTheDocument();
  expect(items[0]).toHaveTextContent('Added ₩500,000 on 2026-11-01');
  expect(items[1]).toHaveTextContent('Variable');
  expect(items[1]).toHaveTextContent('day 31 (or the last day)');
  expect(items[1]).toHaveTextContent('Estimate ₩52,000 on 2026-11-30 · needs the actual amount');
  // Due entries are added before the list is read.
  expect(requests[0]).toMatchObject({ method: 'POST', url: '/api/ledger/fixed-costs/generate' });
});

test('entries added on open reload the rest of the page', async () => {
  added = 2;
  const onChange = vi.fn();
  show(onChange);
  await list();
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
});

test('an estimate is confirmed with the actual amount', async () => {
  const onChange = vi.fn();
  show(onChange);
  await list();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Electricity amount' }));
  const actual = screen.getByLabelText('Electricity actual amount (KRW)');
  await vi.waitFor(() => expect(actual).toHaveFocus());
  expect(actual).toHaveValue('52000');
  fireEvent.change(actual, { target: { value: '61,230' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Electricity confirmed at ₩61,230');
  expect(sent('PUT')).toEqual([
    { method: 'PUT', url: '/api/ledger/fixed-costs/2/months/2026-11', body: { amount: 61_230 } },
  ]);
  await vi.waitFor(() =>
    expect(
      within(screen.getByRole('list', { name: 'Fixed costs' })).getAllByRole('listitem')[1],
    ).toHaveTextContent('Added ₩61,230 on 2026-11-30'),
  );
  expect(onChange).toHaveBeenCalled();
});

test('a preset fills the form and the new item is sent with this month as the start', async () => {
  show();
  await list();
  fireEvent.click(screen.getByRole('button', { name: 'Add fixed cost' }));
  const form = screen.getByRole('form', { name: 'New fixed cost' });
  fireEvent.click(within(form).getByRole('button', { name: 'Phone' }));
  expect(within(form).getByLabelText('Name')).toHaveValue('Phone');
  expect(within(form).getByLabelText('Category')).toHaveValue('4');
  expect(within(form).getByRole('checkbox')).toBeChecked();
  fireEvent.change(within(form).getByLabelText('First estimate (KRW)'), {
    target: { value: '65,000' },
  });
  fireEvent.change(within(form).getByLabelText('Day of the month'), { target: { value: '25' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Phone added');
  expect(sent('POST').filter((request) => !request.url.endsWith('/generate'))).toEqual([
    {
      method: 'POST',
      url: '/api/ledger/fixed-costs',
      body: {
        name: 'Phone',
        categoryId: 4,
        amount: 65_000,
        variable: true,
        dayOfMonth: 25,
        startMonth: '2026-11',
      },
    },
  ]);
  // Saving adds what became due at once, not at the next open.
  const created = requests.findIndex(
    (request) => request.method === 'POST' && request.url === '/api/ledger/fixed-costs',
  );
  expect(requests[created + 1]).toMatchObject({ url: '/api/ledger/fixed-costs/generate' });
  expect(screen.queryByRole('form', { name: 'New fixed cost' })).not.toBeInTheDocument();
});

test('a day outside 1 to 31 is refused before sending', async () => {
  show();
  await list();
  fireEvent.click(screen.getByRole('button', { name: 'Add fixed cost' }));
  const form = screen.getByRole('form', { name: 'New fixed cost' });
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Gym' } });
  fireEvent.change(within(form).getByLabelText('Category'), { target: { value: '3' } });
  fireEvent.change(within(form).getByLabelText('Amount (KRW)'), { target: { value: '50000' } });
  const day = within(form).getByLabelText('Day of the month');
  fireEvent.change(day, { target: { value: '32' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a day between 1 and 31');
  expect(day).toHaveAttribute('aria-invalid', 'true');
  expect(day).toHaveFocus();
  expect(sent('POST').filter((request) => !request.url.endsWith('/generate'))).toEqual([]);
});

test('stopping and editing change only the item', async () => {
  show();
  await list();
  fireEvent.click(screen.getByRole('button', { name: 'Stop Rent' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Rent stopped');
  expect(await screen.findByRole('button', { name: 'Start Rent again' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Edit Electricity' }));
  const form = screen.getByRole('form', { name: 'Edit Electricity' });
  expect(within(form).queryByLabelText('Start month')).not.toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText('First estimate (KRW)'), {
    target: { value: '45000' },
  });
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Electricity updated. It applies to entries added from now on',
  );
  expect(sent('PATCH')).toEqual([
    { method: 'PATCH', url: '/api/ledger/fixed-costs/1', body: { active: false } },
    {
      method: 'PATCH',
      url: '/api/ledger/fixed-costs/2',
      body: { name: 'Electricity', categoryId: 3, amount: 45_000, variable: true, dayOfMonth: 31 },
    },
  ]);
});
