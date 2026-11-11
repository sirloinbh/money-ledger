import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { AssetManager } from './assets';

// #46 Trades on the asset screen against a fake server. The position numbers come from the server; the
// fake returns fixed ones so the screen's display and requests can be checked.

type Asset = {
  id: number;
  name: string;
  type: string;
  currency: 'KRW' | 'USD';
  quantity: string | null;
  valueKrw: number | null;
  valueForeign: string | null;
  memo: string;
  hasTrades: boolean;
};

let stored: Asset[];
let trades: Record<number, object[]>;
let requests: { method: string; url: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status }),
  );

const view = (asset: Asset) => ({
  ...asset,
  // #47 fields: no link, no price, no rate unless a test sets them.
  security: null,
  manualPrice: null,
  price: null,
  fx: null,
  currentValueForeign: asset.valueForeign ?? null,
  valueIssue: null,
  costKrw: null,
  profitKrw: null,
  returnPercent: null,
  depreciation: null,
  prepaid: null,
  currentValueKrw: asset.valueKrw,
});

const position = {
  quantity: '15.00000000',
  averagePrice: '1161.4667',
  costKrw: 17422,
  realizedKrw: 1602,
};

function tradeApi(url: string, method: string, body: unknown) {
  const match = /assets\/(\d+)\/trades(?:\/(\d+))?/.exec(url)!;
  const assetId = Number(match[1]);
  const list = (trades[assetId] ??= []);
  if (method === 'GET') return json({ trades: list, position });
  if (method === 'DELETE') {
    trades[assetId] = list.filter((trade) => (trade as { id: number }).id !== Number(match[2]));
    return json(undefined, 204);
  }
  const trade = body as { side: string; quantity: string };
  if (trade.side === 'sell' && trade.quantity === '100') {
    return json(
      { error: '2026-01-10 sell quantity is more than the quantity held then (15)' },
      400,
    );
  }
  const saved = {
    ...(body as object),
    id: Number(match[2] ?? 100 + list.length),
    currency: stored.find((asset) => asset.id === assetId)!.currency,
    amountKrw: 7500,
    quantityAfter: '15.00000000',
    realizedKrw: trade.side === 'sell' ? 1602 : null,
  };
  trades[assetId] = match[2]
    ? list.map((item) => ((item as { id: number }).id === saved.id ? saved : item))
    : [saved, ...list];
  // The first trade replaces a hand-entered quantity (the fake says the total is 2).
  stored = stored.map((asset) =>
    asset.id === assetId
      ? { ...asset, hasTrades: true, quantity: asset.hasTrades ? asset.quantity : '2.00000000' }
      : asset,
  );
  return json({ trade: saved }, match[2] ? 200 : 201);
}

beforeEach(() => {
  stored = [
    {
      id: 1,
      name: 'Emergency fund account',
      type: 'cash',
      currency: 'KRW',
      quantity: null,
      valueKrw: 5000000,
      valueForeign: null,
      memo: '',
      hasTrades: false,
    },
    {
      id: 2,
      name: 'Samsung Electronics',
      type: 'stock',
      currency: 'KRW',
      quantity: '15.00000000',
      valueKrw: null,
      valueForeign: null,
      memo: '',
      hasTrades: true,
    },
    {
      id: 3,
      name: 'Apple',
      type: 'stock',
      currency: 'USD',
      quantity: '1.00000000',
      valueKrw: null,
      valueForeign: null,
      memo: '',
      hasTrades: false,
    },
  ];
  trades = {
    2: [
      {
        id: 7,
        side: 'sell',
        tradedOn: '2026-01-10',
        quantity: '5.00000000',
        currency: 'KRW',
        price: '1500.0000',
        fxRate: null,
        amountKrw: 7500,
        feeKrw: 75,
        taxKrw: 15,
        memo: '',
        quantityAfter: '15.00000000',
        realizedKrw: 1602,
      },
    ],
  };
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      requests.push({ method, url, body });
      if (url.includes('/trades')) return tradeApi(url, method, body);
      if (method === 'GET') {
        return json({
          assets: stored.map(view),
          totals: { assetsKrw: 5000000, debtsKrw: 0, netKrw: 5000000, uncounted: 2 },
        });
      }
      const id = Number(url.split('/').pop());
      const saved = { ...(body as Asset), id, hasTrades: true };
      stored = stored.map((asset) => (asset.id === id ? saved : asset));
      return json({ asset: view(saved) });
    }),
  );
});

const ready = async () => {
  render(<AssetManager />);
  await screen.findByRole('heading', { name: 'Cash (incl. savings)' });
};

const openTrades = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: `${name} trades` }));
  const panel = screen.getByRole('region', { name: `${name} trades` });
  await within(panel).findByText('Quantity held');
  return panel;
};

test('only stock and other assets have trades, shown with the position from the server', async () => {
  await ready();
  expect(
    screen.queryByRole('button', { name: 'Emergency fund account trades' }),
  ).not.toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: 'Samsung Electronics trades' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).not.toHaveAttribute('aria-controls');
  const panel = await openTrades('Samsung Electronics');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const summary = (label: string) => within(panel).getByText(label).nextElementSibling;
  expect(summary('Quantity held')).toHaveTextContent('15');
  expect(summary('Average unit price')).toHaveTextContent('₩1,161.4667');
  expect(summary('Cost in KRW')).toHaveTextContent('₩17,422');
  expect(summary('Realized P/L')).toHaveTextContent('+₩1,602');
  expect(
    within(panel).getByText('₩7,500 · costs ₩90 · holding 15 · realized P/L +₩1,602'),
  ).toBeInTheDocument();
  // A won asset has no rate field.
  expect(within(panel).queryByLabelText('Exchange rate (KRW per USD)')).not.toBeInTheDocument();
});

test('a buy is sent with decimal strings and won costs', async () => {
  await ready();
  const panel = await openTrades('Samsung Electronics');
  fireEvent.change(within(panel).getByLabelText('Trade date'), { target: { value: '2026-01-02' } });
  fireEvent.change(within(panel).getByLabelText('Quantity'), { target: { value: '10' } });
  fireEvent.change(within(panel).getByLabelText('Unit price (KRW)'), {
    target: { value: '1,000' },
  });
  fireEvent.change(within(panel).getByLabelText('Fee (KRW)'), { target: { value: '100' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add trade' }));
  expect(await within(panel).findByRole('status')).toHaveTextContent('2026-01-02 Buy recorded');
  expect(requests).toContainEqual({
    method: 'POST',
    url: '/api/portfolio/assets/2/trades',
    body: {
      side: 'buy',
      tradedOn: '2026-01-02',
      quantity: '10',
      price: '1000',
      fxRate: null,
      feeKrw: 100,
      taxKrw: 0,
      memo: '',
    },
  });
});

test('a USD trade needs the rate of the day', async () => {
  await ready();
  const panel = await openTrades('Apple');
  fireEvent.change(within(panel).getByLabelText('Trade date'), { target: { value: '2026-02-02' } });
  fireEvent.change(within(panel).getByLabelText('Quantity'), { target: { value: '2' } });
  fireEvent.change(within(panel).getByLabelText('Unit price (USD)'), {
    target: { value: '100.5' },
  });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add trade' }));
  expect(within(panel).getByRole('alert')).toHaveTextContent(
    "Enter that day's exchange rate (won per dollar) with up to 4 decimal places",
  );
  expect(within(panel).getByLabelText('Exchange rate (KRW per USD)')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(requests.some((request) => request.method === 'POST')).toBe(false);

  fireEvent.change(within(panel).getByLabelText('Exchange rate (KRW per USD)'), {
    target: { value: '1,300' },
  });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add trade' }));
  await within(panel).findByRole('status');
  expect(requests.find((request) => request.method === 'POST')?.body).toMatchObject({
    price: '100.5',
    fxRate: '1300',
  });
});

test('a sell above what is held shows the server message', async () => {
  await ready();
  const panel = await openTrades('Samsung Electronics');
  fireEvent.click(within(panel).getByRole('radio', { name: 'Sell' }));
  fireEvent.change(within(panel).getByLabelText('Trade date'), { target: { value: '2026-01-10' } });
  fireEvent.change(within(panel).getByLabelText('Quantity'), { target: { value: '100' } });
  fireEvent.change(within(panel).getByLabelText('Unit price (KRW)'), { target: { value: '1500' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add trade' }));
  expect(await within(panel).findByRole('alert')).toHaveTextContent(
    '2026-01-10 sell quantity is more than the quantity held then (15)',
  );
});

test('a won price with decimals and a future date are refused before sending', async () => {
  await ready();
  const panel = await openTrades('Samsung Electronics');
  fireEvent.change(within(panel).getByLabelText('Quantity'), { target: { value: '1' } });
  fireEvent.change(within(panel).getByLabelText('Unit price (KRW)'), {
    target: { value: '1000.5' },
  });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add trade' }));
  expect(within(panel).getByRole('alert')).toHaveTextContent(
    'Enter a unit price above 0 as a whole number of won',
  );
  fireEvent.change(within(panel).getByLabelText('Unit price (KRW)'), { target: { value: '1000' } });
  fireEvent.change(within(panel).getByLabelText('Trade date'), { target: { value: '2099-01-01' } });
  fireEvent.submit(within(panel).getByRole('form', { name: 'Samsung Electronics Add trade' }));
  expect(within(panel).getByRole('alert')).toHaveTextContent(
    'Trades dated after today cannot be recorded',
  );
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
});

test('a trade can be edited and, after confirming, deleted', async () => {
  await ready();
  const panel = await openTrades('Samsung Electronics');
  fireEvent.click(within(panel).getByRole('button', { name: 'Edit 2026-01-10 Sell 5 × ₩1,500' }));
  expect(within(panel).getByRole('radio', { name: 'Sell' })).toBeChecked();
  expect(within(panel).getByLabelText('Quantity')).toHaveValue('5');
  expect(within(panel).getByLabelText('Unit price (KRW)')).toHaveValue('1500');
  expect(within(panel).getByLabelText('Tax (KRW)')).toHaveValue('15');
  fireEvent.change(within(panel).getByLabelText('Quantity'), { target: { value: '4' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Save changes' }));
  expect(await within(panel).findByRole('status')).toHaveTextContent('2026-01-10 Sell updated');
  expect(requests).toContainEqual(
    expect.objectContaining({ method: 'PUT', url: '/api/portfolio/assets/2/trades/7' }),
  );

  fireEvent.click(
    await within(panel).findByRole('button', { name: 'Delete 2026-01-10 Sell 4 × ₩1,500' }),
  );
  expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
  expect(await within(panel).findByText('No trades recorded yet.')).toBeInTheDocument();
  await vi.waitFor(() =>
    expect(
      within(panel).getByRole('heading', { name: 'Samsung Electronics trades' }),
    ).toHaveFocus(),
  );
});

test('an asset with trades shows its quantity read-only in the edit form', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Samsung Electronics' }));
  const quantity = screen.getByLabelText('Quantity (trade total)');
  expect(quantity).toHaveValue('15');
  expect(quantity).toHaveAttribute('readonly');
  expect(quantity).toHaveAccessibleDescription(
    'This asset has trades, so its quantity changes only through them.',
  );
  // Without trades the quantity is entered by hand.
  fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Apple' }));
  expect(screen.getByLabelText('Quantity (optional)')).not.toHaveAttribute('readonly');
});

test('a USD asset labels its dollar average and a hand-entered quantity is flagged before the first trade', async () => {
  trades[3] = [];
  await ready();
  const panel = await openTrades('Apple');
  expect(within(panel).getByText('Average unit price (excl. fees)')).toBeInTheDocument();
  expect(
    within(panel).getByText(
      /The current quantity 1 was entered by hand\. Recording the first trade/,
    ),
  ).toBeInTheDocument();
});

test('the open edit form follows a first trade and locks the quantity', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Apple' }));
  expect(screen.getByLabelText('Quantity (optional)')).toHaveValue('1');
  const panel = await openTrades('Apple');
  fireEvent.change(within(panel).getByLabelText('Trade date'), { target: { value: '2026-02-02' } });
  fireEvent.change(within(panel).getByLabelText('Quantity'), { target: { value: '2' } });
  fireEvent.change(within(panel).getByLabelText('Unit price (USD)'), { target: { value: '100' } });
  fireEvent.change(within(panel).getByLabelText('Exchange rate (KRW per USD)'), {
    target: { value: '1300' },
  });
  const add = within(panel).getByRole('button', { name: 'Add trade' });
  add.focus();
  fireEvent.click(add);
  await within(panel).findByRole('status');
  const quantity = await screen.findByLabelText('Quantity (trade total)');
  expect(quantity).toHaveValue('2');
  expect(quantity).toHaveAttribute('readonly');
  // Focus stays in the trades panel rather than jumping to the form.
  expect(add).toHaveFocus();
});

test('an asset deleted elsewhere closes its open edit form on the next reload', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Apple' }));
  expect(screen.getByRole('heading', { name: 'Edit asset' })).toBeInTheDocument();
  // Another tab deletes Apple; a trade on Samsung Electronics reloads the list here.
  stored = stored.filter((asset) => asset.id !== 3);
  const panel = await openTrades('Samsung Electronics');
  fireEvent.change(within(panel).getByLabelText('Trade date'), { target: { value: '2026-01-02' } });
  fireEvent.change(within(panel).getByLabelText('Quantity'), { target: { value: '1' } });
  fireEvent.change(within(panel).getByLabelText('Unit price (KRW)'), { target: { value: '1000' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add trade' }));
  expect(await screen.findByRole('heading', { name: 'New asset' })).toBeInTheDocument();
  expect(screen.getByText('Apple was already deleted, so the edit was closed')).toBeInTheDocument();
});
