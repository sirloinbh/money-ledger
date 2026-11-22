import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { AssetManager } from './assets';
import { type AssetFake, fakeAssetApi } from './test/asset-api';
import { findLive, getLive, queryLive } from './test/live';

// #46 Trades on the asset screen against the shared fake asset server (test/asset-api.ts). The position numbers
// come from the server; the fake returns fixed ones so the screen's display and requests can be checked.

let api: AssetFake;

beforeEach(() => {
  api = fakeAssetApi({
    stored: [
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
    ],
    trades: {
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
    },
  });
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
  expect(await findLive('status', panel)).toHaveTextContent('2026-01-02 Buy recorded');
  expect(api.requests).toContainEqual({
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
  expect(getLive('alert', panel)).toHaveTextContent(
    "Enter that day's exchange rate (won per dollar) with up to 4 decimal places",
  );
  expect(within(panel).getByLabelText('Exchange rate (KRW per USD)')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(api.requests.some((request) => request.method === 'POST')).toBe(false);

  fireEvent.change(within(panel).getByLabelText('Exchange rate (KRW per USD)'), {
    target: { value: '1,300' },
  });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add trade' }));
  await findLive('status', panel);
  expect(api.requests.find((request) => request.method === 'POST')?.body).toMatchObject({
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
  expect(await findLive('alert', panel)).toHaveTextContent(
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
  expect(getLive('alert', panel)).toHaveTextContent(
    'Enter a unit price above 0 as a whole number of won',
  );
  fireEvent.change(within(panel).getByLabelText('Unit price (KRW)'), { target: { value: '1000' } });
  fireEvent.change(within(panel).getByLabelText('Trade date'), { target: { value: '2099-01-01' } });
  fireEvent.submit(within(panel).getByRole('form', { name: 'Add a trade to Samsung Electronics' }));
  expect(getLive('alert', panel)).toHaveTextContent('Trades dated after today cannot be recorded');
  expect(api.requests.some((request) => request.method === 'POST')).toBe(false);
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
  expect(await findLive('status', panel)).toHaveTextContent('2026-01-10 Sell updated');
  expect(api.requests).toContainEqual(
    expect.objectContaining({ method: 'PUT', url: '/api/portfolio/assets/2/trades/7' }),
  );

  fireEvent.click(
    await within(panel).findByRole('button', { name: 'Delete 2026-01-10 Sell 4 × ₩1,500' }),
  );
  expect(api.requests.some((request) => request.method === 'DELETE')).toBe(false);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
  expect(await within(panel).findByText('No trades recorded yet.')).toBeInTheDocument();
  await vi.waitFor(() =>
    expect(
      within(panel).getByRole('heading', { name: 'Samsung Electronics trades' }),
    ).toHaveFocus(),
  );
});

test('editing a USD trade keeps its rate and currency, whatever the asset shows (#191)', async () => {
  // A dollar trade listed under a won asset, as a row written before migration 023 could be.
  api.trades[2] = [
    {
      id: 8,
      side: 'buy',
      tradedOn: '2026-01-05',
      quantity: '2.00000000',
      currency: 'USD',
      price: '100.5000',
      fxRate: '1300.0000',
      amountKrw: 261300,
      feeKrw: 0,
      taxKrw: 0,
      memo: '',
      quantityAfter: '2.00000000',
      realizedKrw: null,
    },
  ];
  await ready();
  const panel = await openTrades('Samsung Electronics');
  fireEvent.click(within(panel).getByRole('button', { name: 'Edit 2026-01-05 Buy 2 × $100.5' }));
  expect(within(panel).getByLabelText('Unit price (USD)')).toHaveValue('100.5');
  expect(within(panel).getByLabelText('Exchange rate (KRW per USD)')).toHaveValue('1300');
  fireEvent.change(within(panel).getByLabelText('Quantity'), { target: { value: '3' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Save changes' }));
  expect(await findLive('status', panel)).toHaveTextContent('2026-01-05 Buy updated');
  expect(api.requests.find((request) => request.method === 'PUT')?.body).toMatchObject({
    quantity: '3',
    price: '100.5',
    fxRate: '1300',
  });
  // Back to a new trade: the asset's own currency again.
  expect(within(panel).getByLabelText('Unit price (KRW)')).toBeInTheDocument();
  expect(within(panel).queryByLabelText('Exchange rate (KRW per USD)')).not.toBeInTheDocument();
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
  api.trades[3] = [];
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
  await findLive('status', panel);
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
  api.stored = api.stored.filter((asset) => asset.id !== 3);
  const panel = await openTrades('Samsung Electronics');
  fireEvent.change(within(panel).getByLabelText('Trade date'), { target: { value: '2026-01-02' } });
  fireEvent.change(within(panel).getByLabelText('Quantity'), { target: { value: '1' } });
  fireEvent.change(within(panel).getByLabelText('Unit price (KRW)'), { target: { value: '1000' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add trade' }));
  expect(await screen.findByRole('heading', { name: 'New asset' })).toBeInTheDocument();
  expect(screen.getByText('Apple was already deleted, so the edit was closed')).toBeInTheDocument();
});

test('a saved trade whose list fails to reload is a note, not an error (#203)', async () => {
  await ready();
  const panel = await openTrades('Samsung Electronics');
  // Only the reload right after the save fails.
  const api = vi.mocked(fetch).getMockImplementation()!;
  let saved = false;
  vi.mocked(fetch).mockImplementation((url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (String(url).includes('/trades') && method === 'POST') saved = true;
    else if (saved && String(url).includes('/trades') && method === 'GET') {
      saved = false;
      return Promise.resolve(new Response(JSON.stringify({ error: 'down' }), { status: 500 }));
    }
    return api(url, init);
  });
  fireEvent.change(within(panel).getByLabelText('Trade date'), { target: { value: '2026-01-02' } });
  fireEvent.change(within(panel).getByLabelText('Quantity'), { target: { value: '10' } });
  fireEvent.change(within(panel).getByLabelText('Unit price (KRW)'), { target: { value: '1000' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add trade' }));
  expect(await findLive('status', panel)).toHaveTextContent(
    '2026-01-02 Buy recorded. The list could not be reloaded; reload the page to see it',
  );
  expect(queryLive('alert', panel)).toBeNull();
});
