import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { AssetManager } from './assets';
import { serviceToday } from './format';

// #47 Current prices on the asset screen against a fake server. The server works out every value; the fake
// returns fixed ones so the screen's wording (price basis, delays, rate, gain) and its requests can be checked.

type Asset = Record<string, unknown> & { id: number; name: string };

const base = {
  type: 'stock',
  currency: 'KRW',
  quantity: '10.00000000',
  valueKrw: null,
  valueForeign: null,
  memo: '',
  depreciation: null,
  prepaid: null,
  hasTrades: false,
  security: null,
  manualPrice: null,
  price: null,
  fx: null,
  currentValueKrw: null,
  currentValueForeign: null,
  valueIssue: null,
  costKrw: null,
  profitKrw: null,
  returnPercent: null,
};

const samsung = {
  id: 5930,
  market: 'KOSPI',
  symbol: '005930',
  name: 'Samsung Electronics',
  active: true,
};
const apple = { id: 1, market: 'NASDAQ', symbol: 'AAPL', name: 'Apple Inc', active: true };

let stored: Asset[];
let requests: { method: string; url: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  stored = [
    {
      ...base,
      id: 1,
      name: 'Samsung Electronics',
      security: samsung,
      price: {
        price: '71500.0000',
        currency: 'KRW',
        source: 'close',
        date: '2026-11-05',
        stale: false,
      },
      currentValueKrw: 715_000,
      hasTrades: true,
      costKrw: 700_000,
      profitKrw: 15_000,
      returnPercent: '2.14',
    },
    {
      ...base,
      id: 2,
      name: 'Apple',
      currency: 'USD',
      quantity: '2.00000000',
      security: apple,
      price: {
        price: '110.2500',
        currency: 'USD',
        source: 'close',
        date: '2026-10-30',
        stale: true,
      },
      fx: { fxRate: '1400.5000', rateDate: '2026-11-03', stale: true },
      currentValueKrw: 308_810,
      currentValueForeign: '220.5000',
      hasTrades: true,
      costKrw: 320_000,
      profitKrw: -11_190,
      returnPercent: '-3.50',
    },
    {
      ...base,
      id: 3,
      name: 'Bitcoin',
      type: 'other',
      quantity: '0.05000000',
      manualPrice: { price: '95000000.0000', pricedOn: '2026-11-09' },
      price: {
        price: '95000000.0000',
        currency: 'KRW',
        source: 'manual',
        date: '2026-11-09',
        stale: false,
      },
      currentValueKrw: 4_750_000,
    },
    {
      ...base,
      id: 4,
      name: 'Halted Corp',
      security: { ...samsung, id: 1, symbol: '000001', name: 'Halted Corp', active: false },
      price: {
        price: '5000.0000',
        currency: 'KRW',
        source: 'close',
        date: '2026-10-01',
        stale: true,
      },
      currentValueKrw: 50_000,
    },
    {
      ...base,
      id: 5,
      name: 'Dollar deposit',
      type: 'cash',
      currency: 'USD',
      quantity: null,
      valueForeign: '100.5000',
      currentValueForeign: '100.5000',
      valueIssue: 'no_fx',
    },
    {
      ...base,
      id: 6,
      name: 'Microsoft',
      currency: 'USD',
      quantity: '1.00000000',
      security: { ...apple, id: 2, symbol: 'MSFT', name: null },
      valueIssue: 'no_price',
    },
  ];
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? (JSON.parse(init.body as string) as object) : undefined;
      requests.push({ method, url, body });
      if (url.startsWith('/api/prices/securities')) {
        return json({
          securities: [
            {
              ...apple,
              kind: 'stock',
              currency: 'USD',
              quote: {
                close: '110.2500',
                currency: 'USD',
                tradeDate: '2026-11-06',
                fetchedAt: null,
                stale: false,
              },
            },
          ],
        });
      }
      if (url.includes('/trades')) {
        return json({
          trades: [],
          position: { quantity: null, averagePrice: null, costKrw: 0, realizedKrw: 0 },
        });
      }
      if (method === 'GET') {
        return json({
          assets: stored,
          totals: { assetsKrw: 5_823_810, debtsKrw: 0, netKrw: 5_823_810, uncounted: 2 },
        });
      }
      const saved = { ...base, ...body, id: method === 'POST' ? 99 : Number(url.split('/').pop()) };
      return json({ asset: saved }, method === 'POST' ? 201 : 200);
    }),
  );
});

const ready = async () => {
  render(<AssetManager />);
  await screen.findByRole('heading', { name: 'Stocks (incl. ETFs and funds)' });
};
const row = (name: string) =>
  screen.getByText(name, { selector: 'span.font-medium' }).closest('li')!;

test('a value shows its price basis, delays, rate, gain and why it is left out', async () => {
  await ready();
  const korean = within(row('Samsung Electronics'));
  expect(korean.getByText('₩715,000')).toBeInTheDocument();
  expect(
    korean.getByText('Samsung Electronics · 005930 · KOSPI · KRW · quantity 10'),
  ).toBeInTheDocument();
  expect(korean.getByText('₩71,500 · Nov 5 close')).toBeInTheDocument();
  expect(korean.getByText('Valuation gain/loss +₩15,000 (+2.14%)')).toBeInTheDocument();

  const us = within(row('Apple'));
  expect(us.getByText('₩308,810')).toBeInTheDocument();
  expect(us.getByText('$220.5')).toBeInTheDocument();
  expect(us.getByText('$110.25 · Delayed · Oct 30 close')).toBeInTheDocument();
  expect(us.getByText('Exchange rate ₩1,400.5 · Rate delayed · as of Nov 3')).toBeInTheDocument();
  expect(us.getByText('Valuation gain/loss -₩11,190 (-3.5%)')).toBeInTheDocument();

  const coin = within(row('Bitcoin'));
  expect(coin.getByText('₩95,000,000 · Entered by hand · Nov 9')).toBeInTheDocument();
  expect(coin.getByText('No cost basis · record a trade to see gain/loss')).toBeInTheDocument();

  expect(within(row('Halted Corp')).getByText('Trading halted')).toBeInTheDocument();

  const dollars = within(row('Dollar deposit'));
  expect(dollars.getByText('$100.5')).toBeInTheDocument();
  expect(dollars.getByText('No exchange rate · left out of the totals')).toBeInTheDocument();

  const missing = within(row('Microsoft'));
  expect(missing.getByText('No quote')).toBeInTheDocument();
  expect(
    missing.getByText('No close received yet, so it is left out of the totals'),
  ).toBeInTheDocument();

  expect(
    screen.getByText(/2 without a quote, exchange rate, or valuation left out/),
  ).toBeInTheDocument();
});

test('a stock is linked from the search and takes the security currency', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Apple 2' } });
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'stock' } });
  const query = screen.getByLabelText('Link a security (optional)');
  fireEvent.change(query, { target: { value: 'aapl' } });
  // Enter searches; it does not save the asset.
  fireEvent.keyDown(query, { key: 'Enter' });
  const results = await screen.findByRole('list', { name: 'Security search results' });
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
  expect(
    within(results).getByText('Apple Inc · AAPL · NASDAQ · $110.25 (Nov 6 close)'),
  ).toBeInTheDocument();
  fireEvent.click(within(results).getByRole('button', { name: 'Link Apple Inc' }));

  expect(screen.getByText('Apple Inc · AAPL · NASDAQ')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Dollar (USD)' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Won (KRW)' })).toBeDisabled();
  // A linked stock is valued at the close: no hand price.
  expect(screen.queryByLabelText(/Current price \(per unit/)).not.toBeInTheDocument();
  // Nor a hand value: a value typed before linking would be read in the security's currency (#47 review).
  expect(screen.queryByLabelText(/Valuation \(/)).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Quantity (optional)'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await screen.findByRole('status');
  expect(requests.find((request) => request.method === 'POST')?.body).toMatchObject({
    type: 'stock',
    currency: 'USD',
    quantity: '3',
    securityId: 1,
    manualPrice: null,
  });
});

test('unlinking brings back the search and the hand price', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Samsung Electronics' }));
  expect(screen.getByText('Samsung Electronics · 005930 · KOSPI')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Unlink Samsung Electronics' }));
  expect(screen.getByLabelText('Link a security (optional)')).toBeInTheDocument();
  expect(screen.getByLabelText('Current price (per unit, KRW, optional)')).toBeInTheDocument();
});

test('a hand price is sent with today when no date is given', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ethereum' } });
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'other' } });
  fireEvent.change(screen.getByLabelText('Quantity (optional)'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Current price (per unit, KRW, optional)'), {
    target: { value: '5,000,000' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await screen.findByRole('status');
  expect(requests.find((request) => request.method === 'POST')?.body).toMatchObject({
    type: 'other',
    quantity: '2',
    securityId: null,
    manualPrice: { price: '5000000', pricedOn: serviceToday() },
  });
});

test.each([
  {
    label: 'a fractional won price',
    fill: { quantity: '1', price: '100.5' },
    field: 'Current price (per unit, KRW, optional)',
    message: 'Enter a current price above 0 as a whole number of won',
  },
  {
    label: 'a price without a quantity',
    fill: { price: '100', value: '1' },
    field: 'Quantity (optional)',
    message: 'Enter a quantity to set a current price',
  },
  {
    label: 'a date without a price',
    fill: { quantity: '1', date: '2026-11-01' },
    field: 'Current price (per unit, KRW, optional)',
    message: 'Enter the current price',
  },
])('$label is refused before sending', async ({ fill, field, message }) => {
  await ready();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Coin' } });
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'other' } });
  const labels = {
    quantity: 'Quantity (optional)',
    price: 'Current price (per unit, KRW, optional)',
    value: 'Valuation (KRW)',
    date: 'Current-price date (today if empty)',
  } as const;
  for (const [key, value] of Object.entries(fill)) {
    fireEvent.change(screen.getByLabelText(labels[key as keyof typeof labels]), {
      target: { value },
    });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(screen.getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
});

test('editing a hand-priced asset fills its price and date', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Bitcoin' }));
  expect(screen.getByLabelText('Current price (per unit, KRW, optional)')).toHaveValue('95000000');
  expect(screen.getByLabelText('Current-price date (today if empty)')).toHaveValue('2026-11-09');
});

test('a new USD trade starts with the newest stored rate', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Apple trades' }));
  const rate = await screen.findByLabelText('Exchange rate (KRW per USD)');
  expect(rate).toHaveValue('1400.5');
  expect(rate).toHaveAccessibleDescription(
    'Nov 3 base rate was prefilled. You can change it to the rate on the trade date.',
  );
  // A changed rate is kept; the won trade panel has no rate at all.
  fireEvent.change(rate, { target: { value: '1390' } });
  expect(rate).toHaveValue('1390');
  // Once changed it is the user's own rate: the "filled in" note goes away.
  expect(rate).not.toHaveAccessibleDescription(/base rate was prefilled/);
  expect(screen.queryByText(/base rate was prefilled/)).not.toBeInTheDocument();
});
