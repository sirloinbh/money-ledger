import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { MockAccount } from './mock-account';

type Account = {
  id: number;
  initialCashKrw: number;
  cashKrw: number;
  createdAt: string;
  closedAt: string | null;
};

let open: Account | null;
let closed: Account[];
let requests: { method: string; url: string; body: unknown }[];
// The account that holds one share of Samsung Electronics (#53), if any.
let heldBy: number | undefined;
// When set, the next POST answers with this error instead.
let failNext: { status: number; error: string } | undefined;

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const account = (id: number, amount: number): Account => ({
  id,
  initialCashKrw: amount,
  cashKrw: amount,
  createdAt: '2026-11-05T01:00:00.000Z',
  closedAt: null,
});

function fakeApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body
        ? (JSON.parse(init.body as string) as { initialCashKrw: number })
        : undefined;
      requests.push({ method, url, body });
      if (method === 'GET' && url.endsWith('/holdings')) {
        const cash = open?.cashKrw ?? 0;
        return json({
          summary: {
            initialCashKrw: open?.initialCashKrw ?? 0,
            cashKrw: cash,
            costKrw: 0,
            valueKrw: 0,
            totalKrw: cash,
            profitKrw: 0,
            returnPct: '0.00',
          },
          holdings:
            open && open.id === heldBy
              ? [
                  {
                    security: {
                      id: 1,
                      symbol: '005930',
                      name: 'Samsung Electronics',
                      currency: 'KRW',
                      active: true,
                    },
                    quantity: '1.00000000',
                    price: '70600.0000',
                    priceDate: '2026-11-06',
                    priceStale: false,
                    fxRate: null,
                    fxDate: null,
                    costKrw: 70_600,
                    valueKrw: 70_600,
                    profitKrw: 0,
                    returnPct: '0.00',
                  },
                ]
              : [],
        });
      }
      if (method === 'GET' && url.includes('/orders')) {
        return json({ orders: [], hasMore: false, securities: [] });
      }
      if (method === 'GET' && url.endsWith('/snapshots')) {
        return json({ startDate: '2026-11-05', initialCashKrw: 10_000_000, snapshots: [] });
      }
      if (method === 'GET') return json({ account: open, closedAccounts: closed });
      if (failNext) {
        const { status, error } = failNext;
        failNext = undefined;
        return json({ error }, status);
      }
      if (url.endsWith('/reset') && open) {
        closed = [{ ...open, closedAt: '2026-11-05T02:00:00.000Z' }, ...closed];
      }
      open = account(open ? open.id + 1 : 1, body!.initialCashKrw);
      return json({ account: open }, url.endsWith('/reset') ? 200 : 201);
    }),
  );
}

const posts = () => requests.filter((request) => request.method === 'POST');

beforeEach(() => {
  open = null;
  closed = [];
  requests = [];
  failNext = undefined;
  heldBy = undefined;
  fakeApi();
});

/** Waits until one of the status regions (notice or spinner) shows the text. */
async function expectStatus(text: string) {
  await vi.waitFor(() =>
    expect(screen.getAllByRole('status').some((el) => el.textContent?.includes(text))).toBe(true),
  );
}

test('without an account the form suggests ₩10,000,000 and creates it', async () => {
  render(<MockAccount />);
  const amount = await screen.findByLabelText('Starting amount (KRW)');
  expect(amount).toHaveValue('10,000,000');
  expect(screen.getByText(/not part of the ledger or asset portfolio totals/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

  const title = await screen.findByRole('heading', { level: 2, name: 'Mock trading account' });
  expect(posts()).toEqual([
    { method: 'POST', url: '/api/mock/accounts', body: { initialCashKrw: 10_000_000 } },
  ]);
  await vi.waitFor(() => expect(title).toHaveFocus());
  // A loading spinner can also be a status while the account reloads, so find the notice by its text.
  await expectStatus('Mock trading account created with ₩10,000,000');
  const balance = screen.getByText('Cash balance').parentElement!;
  expect(balance).toHaveTextContent('₩10,000,000');
});

test('a custom starting amount is sent as a won integer', async () => {
  render(<MockAccount />);
  fireEvent.change(await screen.findByLabelText('Starting amount (KRW)'), {
    target: { value: '50000000' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByRole('heading', { level: 2, name: 'Mock trading account' });
  expect(posts()[0].body).toEqual({ initialCashKrw: 50_000_000 });
});

test.each([
  { value: '9,999', message: 'The starting amount must be at least ₩10,000' },
  { value: '10,000,000,001', message: 'Enter a starting amount of ₩10 billion or less' },
  { value: '1,2,3', message: 'Enter the starting amount as a whole number of won' },
  { value: '10000.5', message: 'Enter the starting amount as a whole number of won' },
])('a starting amount of $value is refused before sending', async ({ value, message }) => {
  render(<MockAccount />);
  const amount = await screen.findByLabelText('Starting amount (KRW)');
  fireEvent.change(amount, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(amount).toHaveAttribute('aria-invalid', 'true');
  expect(posts()).toEqual([]);
});

test('a 409 from another tab shows the error and the account the server has', async () => {
  render(<MockAccount />);
  await screen.findByLabelText('Starting amount (KRW)');
  failNext = { status: 409, error: 'A mock trading account already exists' };
  open = account(7, 20_000_000);
  const submit = screen.getByRole('button', { name: 'Create account' });
  submit.focus();
  fireEvent.click(submit);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'A mock trading account already exists',
  );
  const title = await screen.findByRole('heading', { level: 2, name: 'Mock trading account' });
  // The create button went away with the form; focus is not left on the page body.
  await vi.waitFor(() => expect(title).toHaveFocus());
});

test('an account that is gone (404) closes the dialog and focuses the create form', async () => {
  open = account(1, 10_000_000);
  render(<MockAccount />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reset' }));
  const dialog = await screen.findByRole('dialog');
  failNext = { status: 404, error: 'Mock trading account not found' };
  open = null;
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Mock trading account not found');
  const amount = await screen.findByLabelText('Starting amount (KRW)');
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await vi.waitFor(() => expect(amount).toHaveFocus());
});

test('reset asks first, then keeps the old account and starts again', async () => {
  open = { ...account(1, 10_000_000), cashKrw: 4_000_000 };
  render(<MockAccount />);
  const amount = await screen.findByLabelText('New starting amount (KRW)');
  expect(amount).toHaveValue('10,000,000');
  fireEvent.change(amount, { target: { value: '30,000,000' } });

  const trigger = screen.getByRole('button', { name: 'Reset' });
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'Reset the mock trading account?' });
  expect(dialog).toHaveTextContent('cash ₩4,000,000');
  expect(dialog).toHaveTextContent('The new account starts with ₩30,000,000');
  expect(posts()).toEqual([]);

  fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));

  await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(posts()).toEqual([
    { method: 'POST', url: '/api/mock/accounts/1/reset', body: { initialCashKrw: 30_000_000 } },
  ]);
  await expectStatus('Account reset. Starting over with ₩30,000,000');
  expect(screen.getByText('Cash balance').parentElement!).toHaveTextContent('₩30,000,000');
  const history = screen.getByRole('list', { name: 'Previous accounts' });
  expect(history).toHaveTextContent('Started with ₩10,000,000 · last cash ₩4,000,000');
  await vi.waitFor(() => expect(trigger).toHaveFocus());
});

test('cancelling the reset sends nothing', async () => {
  open = account(1, 10_000_000);
  render(<MockAccount />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reset' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(posts()).toEqual([]);
});

test('an invalid reset amount is refused without opening the dialog', async () => {
  open = account(1, 10_000_000);
  render(<MockAccount />);
  const amount = await screen.findByLabelText('New starting amount (KRW)');
  fireEvent.change(amount, { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The starting amount must be at least ₩10,000',
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(amount).toHaveAttribute('aria-invalid', 'true');
});

test('an account already reset elsewhere closes the dialog and shows the new account', async () => {
  open = account(1, 10_000_000);
  render(<MockAccount />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reset' }));
  const dialog = await screen.findByRole('dialog');
  failNext = {
    status: 409,
    error: 'This account was already reset. Refresh the page and try again',
  };
  open = { ...account(2, 20_000_000), cashKrw: 20_000_000 };
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This account was already reset');
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('Cash balance').parentElement!).toHaveTextContent('₩20,000,000');
  expect(posts()).toHaveLength(1);
});

test('a failed load is shown as an error instead of the form', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => json({ error: 'A server error occurred' }, 500)),
  );
  render(<MockAccount />);
  expect(await screen.findByRole('alert')).toHaveTextContent('A server error occurred');
  expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument();
});

test('a new refresh key (an order elsewhere on the page) reloads the cash', async () => {
  open = account(1, 10_000_000);
  const { rerender } = render(<MockAccount refreshKey={0} />);
  await screen.findByText(/No holdings/);
  // Cash and the initial amount in the account card, and the total of the holdings summary.
  expect(screen.getAllByText('₩10,000,000')).toHaveLength(3);
  open = { ...open, cashKrw: 9_294_000 };
  rerender(<MockAccount refreshKey={1} />);
  // The cash and the total both follow the order.
  await vi.waitFor(() => expect(screen.getAllByText('₩9,294,000')).toHaveLength(2));
  const gets = (path: string) => requests.filter((request) => request.url === path);
  expect(gets('/api/mock/accounts')).toHaveLength(2);
  expect(gets('/api/mock/accounts/1/holdings')).toHaveLength(2);
});

test('a holding order form left open does not carry over to the account after a reset', async () => {
  open = account(1, 10_000_000);
  heldBy = 1;
  render(<MockAccount />);
  fireEvent.click(await screen.findByRole('button', { name: 'Samsung Electronics order' }));
  expect(screen.getByRole('form', { name: 'Samsung Electronics mock order' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));
  expect(await screen.findByText(/Account reset/)).toBeInTheDocument();
  await screen.findByText(/No holdings/);
  // The new account never held Samsung Electronics, so nothing says it was sold.
  expect(screen.queryByText(/Sold all your/)).toBeNull();
  expect(screen.queryByRole('form', { name: 'Samsung Electronics mock order' })).toBeNull();
});
