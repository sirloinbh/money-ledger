import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { MockOrder } from './mock-order';

const krwPreview = {
  security: { id: 1, symbol: '005930', name: 'Samsung Electronics', currency: 'KRW' },
  price: '70600.0000',
  priceDate: '2026-11-06',
  priceStale: false,
  fxRate: null,
  fxDate: null,
  amountKrw: 706_000,
  feeKrw: 0,
  cashKrw: 10_000_000,
  cashAfterKrw: 9_294_000,
  heldQuantity: '0',
  problem: null,
};

type Request = { method: string; url: string; body: Record<string, unknown> | undefined };
let requests: Request[];
let account: { id: number } | null;
let preview: Record<string, unknown>;
// Answers for the next POSTs, in order; 'offline' means the request never reached the server.
let postAnswers: ({ status: number; body: unknown } | 'offline')[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  requests = [];
  account = { id: 7 };
  preview = krwPreview;
  postAnswers = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : undefined;
      requests.push({ method, url, body });
      if (url === '/api/mock/accounts') return json({ account, closedAccounts: [] });
      if (url.includes('/preview')) return json(preview);
      const answer = postAnswers.shift() ?? {
        status: 201,
        body: { order: { priceDate: '2026-11-06' }, cashKrw: 9_294_000 },
      };
      if (answer === 'offline') return Promise.reject(new TypeError('fetch failed'));
      return json(answer.body, answer.status);
    }),
  );
});

const posts = () => requests.filter((request) => request.method === 'POST');

const orderFor = (quantity: string) => {
  fireEvent.change(screen.getByLabelText('Quantity (shares)'), { target: { value: quantity } });
  fireEvent.click(screen.getByRole('button', { name: 'Review order' }));
};

test('a buy shows which close it fills at, then fills once and reports the new cash', async () => {
  const onOrdered = vi.fn();
  render(<MockOrder securityId={1} title="Samsung Electronics" onOrdered={onOrdered} />);
  orderFor('10');

  const dialog = await screen.findByRole('dialog', {
    name: 'Buy 10 shares of Samsung Electronics',
  });
  expect(dialog).toHaveTextContent('Fills at the Nov 6 close of ₩70,600');
  expect(dialog).toHaveTextContent('Fill amount ₩706,000 · fee ₩0');
  expect(dialog).toHaveTextContent('Cash after order ₩9,294,000');
  expect(requests[1].url).toBe(
    '/api/mock/accounts/7/orders/preview?securityId=1&side=buy&quantity=10',
  );

  fireEvent.click(within(dialog).getByRole('button', { name: 'Buy' }));
  expect(
    await screen.findByText(
      'Bought 10 shares of Samsung Electronics at the Nov 6 close. Cash ₩9,294,000',
    ),
  ).toHaveAttribute('role', 'status');
  expect(posts()).toHaveLength(1);
  const { requestKey, ...rest } = posts()[0].body!;
  expect(rest).toEqual({
    securityId: 1,
    side: 'buy',
    quantity: '10',
    expectedPrice: '70600.0000',
    expectedPriceDate: '2026-11-06',
    expectedFxRate: null,
  });
  expect(requestKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(onOrdered).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Quantity (shares)')).toHaveValue('');
});

test('a US sale shows the rate and a delayed close, and sends side sell', async () => {
  preview = {
    ...krwPreview,
    security: { id: 2, symbol: 'AAPL', name: 'Apple Inc', currency: 'USD' },
    price: '231.5000',
    priceStale: true,
    fxRate: '1384.5000',
    fxDate: '2026-11-06',
    amountKrw: 961_535,
    cashAfterKrw: 10_961_535,
    heldQuantity: '3.00000000',
  };
  render(<MockOrder securityId={2} title="Apple Inc" onOrdered={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
  expect(screen.getByRole('button', { name: 'Sell' })).toHaveAttribute('aria-pressed', 'true');
  orderFor('3');
  const dialog = await screen.findByRole('dialog', { name: 'Sell 3 shares of Apple Inc' });
  expect(dialog).toHaveTextContent('Fills at the Nov 6 close of $231.5 (delayed quote)');
  expect(dialog).toHaveTextContent('Converted to won at ₩1,384.5 per dollar (Nov 6 base rate)');
  expect(dialog).toHaveTextContent('Selling 3 of the 3 shares held');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Sell' }));
  await screen.findByText(/(Bought|Sold) \d+ shares/);
  expect(posts()[0].body?.side).toBe('sell');
});

test('a bad quantity, no account and a refused preview never reach the order', async () => {
  render(<MockOrder securityId={1} title="Samsung Electronics" onOrdered={() => undefined} />);
  orderFor('1.5');
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Enter the quantity as a whole number of shares',
  );
  expect(screen.getByLabelText('Quantity (shares)')).toHaveAttribute('aria-invalid', 'true');
  expect(requests).toHaveLength(0);

  account = null;
  orderFor('1');
  expect(await screen.findByText('Create a mock trading account first')).toBeInTheDocument();

  account = { id: 7 };
  preview = { ...krwPreview, problem: 'Not enough cash', cashAfterKrw: null };
  orderFor('1000');
  expect(await screen.findByText('Not enough cash')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(posts()).toHaveLength(0);
});

test('a lost connection keeps the request key for the retry; a refusal starts a new one', async () => {
  postAnswers = ['offline'];
  const onOrdered = vi.fn();
  render(<MockOrder securityId={1} title="Samsung Electronics" onOrdered={onOrdered} />);
  orderFor('10');
  let dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Buy' }));
  expect(
    await screen.findByText(
      'Cannot reach the server. The order may have been filled, so check your account cash',
    ),
  ).toBeInTheDocument();
  // The account card is reloaded in case the order filled.
  expect(onOrdered).toHaveBeenCalledTimes(1);

  // Closed and confirmed again: the same order goes with the same key, so it cannot fill twice.
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  postAnswers = [{ status: 409, body: { error: 'Not enough cash' } }];
  orderFor('10');
  dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Buy' }));
  expect(await screen.findByText('Not enough cash')).toBeInTheDocument();
  expect(posts()[1].body?.requestKey).toBe(posts()[0].body?.requestKey);
  // A refusal closes the dialog so the reason is visible.
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  orderFor('10');
  dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Buy' }));
  await screen.findByText(/(Bought|Sold) \d+ shares/);
  expect(posts()[2].body?.requestKey).not.toBe(posts()[0].body?.requestKey);
});

test('a 5xx after sending (e.g. a proxy timeout) is treated like a lost connection', async () => {
  postAnswers = [{ status: 502, body: {} }];
  const onOrdered = vi.fn();
  render(<MockOrder securityId={1} title="Samsung Electronics" onOrdered={onOrdered} />);
  orderFor('10');
  let dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Buy' }));
  expect(
    await screen.findByText(/The order may have been filled, so check your account cash/),
  ).toBeInTheDocument();
  expect(onOrdered).toHaveBeenCalledTimes(1);
  // The retry goes with the same key.
  fireEvent.click(within(dialog).getByRole('button', { name: 'Buy' }));
  await screen.findByText(/Bought \d+ shares/);
  expect(posts()[1].body?.requestKey).toBe(posts()[0].body?.requestKey);
  dialog = screen.queryByRole('dialog') as HTMLElement;
  expect(dialog).toBeNull();
});
