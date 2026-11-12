import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { MockHistory } from './mock-history';

const order = (id: number, side: 'buy' | 'sell' = 'buy') => ({
  id,
  security: { id: 1, symbol: '005930', name: 'Samsung Electronics' },
  side,
  quantity: '10.00000000',
  price: '70600.0000',
  currency: 'KRW',
  priceDate: '2026-11-06',
  fxRate: null,
  fxDate: null,
  amountKrw: 706_000,
  feeKrw: 0,
  cashAfterKrw: 9_294_000,
  createdAt: '2026-11-09T01:30:00.000Z',
});
const apple = {
  ...order(2),
  security: { id: 2, symbol: 'AAPL', name: 'Apple Inc' },
  quantity: '2.00000000',
  price: '231.5000',
  currency: 'USD',
  fxRate: '1384.5000',
  fxDate: '2026-11-06',
  amountKrw: 641_024,
};
const securities = [
  { id: 2, symbol: 'AAPL', name: 'Apple Inc' },
  { id: 1, symbol: '005930', name: 'Samsung Electronics' },
];

let urls: string[];
let answer: (url: string) => unknown;

beforeEach(() => {
  urls = [];
  answer = () => ({ orders: [order(3, 'sell'), apple, order(1)], hasMore: false, securities });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      return Promise.resolve(new Response(JSON.stringify(answer(url))));
    }),
  );
});

test('shows each order with the close it filled at, its rate and the cash after it', async () => {
  render(<MockHistory accountId={7} refreshKey={0} />);
  const list = await screen.findByRole('list', { name: 'Trade history' });
  const items = within(list).getAllByRole('listitem');
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveTextContent('SellSamsung Electronics 10 shares');
  expect(items[1]).toHaveTextContent('BuyApple Inc 2 shares');
  expect(items[1]).toHaveTextContent('Nov 6 close $231.5 · rate ₩1,384.5 (Nov 6)');
  expect(items[1]).toHaveTextContent('Fill amount ₩641,024 · fee ₩0 · cash after order ₩9,294,000');
  expect(urls).toEqual(['/api/mock/accounts/7/orders']);
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  // The security filter lists every traded security.
  expect(
    within(screen.getByLabelText('Security'))
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['All securities', 'Apple Inc (AAPL)', 'Samsung Electronics (005930)']);
});

test('filters by period and security, and the filter can be cleared', async () => {
  render(<MockHistory accountId={7} refreshKey={0} />);
  await screen.findByRole('list');
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-11-01' } });
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-11-09' } });
  fireEvent.change(screen.getByLabelText('Security'), { target: { value: '2' } });
  answer = () => ({ orders: [], hasMore: false, securities });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(await screen.findByText('No trades match the filters.')).toBeInTheDocument();
  expect(urls[1]).toBe('/api/mock/accounts/7/orders?from=2026-11-01&to=2026-11-09&securityId=2');

  answer = () => ({ orders: [order(1)], hasMore: false, securities });
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(await screen.findByRole('list')).toBeInTheDocument();
  expect(urls[2]).toBe('/api/mock/accounts/7/orders');
  expect(screen.getByLabelText('Start date')).toHaveValue('');
});

test('a start after the end is refused before asking the server', async () => {
  render(<MockHistory accountId={7} refreshKey={0} />);
  await screen.findByRole('list');
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-11-09' } });
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-11-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The start date cannot be after the end date',
  );
  expect(screen.getByLabelText('Start date')).toHaveAttribute('aria-invalid', 'true');
  expect(urls).toHaveLength(1);
});

test('Load more adds the next 50 after the last one shown, with the same filter', async () => {
  answer = (url) =>
    url.includes('before=')
      ? { orders: [order(1)], hasMore: false, securities }
      : {
          orders: Array.from({ length: 50 }, (_, index) => order(60 - index)),
          hasMore: true,
          securities,
        };
  render(<MockHistory accountId={7} refreshKey={0} />);
  await screen.findByRole('list');
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(51));
  expect(urls[1]).toBe('/api/mock/accounts/7/orders?before=11');
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
});

test('Load more while a new filter is loading does not add the old list to the new one', async () => {
  answer = () => ({
    orders: Array.from({ length: 50 }, (_, index) => order(60 - index)),
    hasMore: true,
    securities,
  });
  render(<MockHistory accountId={7} refreshKey={0} />);
  await screen.findByRole('list');

  let finish: (response: Response) => void = () => undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }),
  );
  fireEvent.change(screen.getByLabelText('Security'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  expect(urls).toEqual(['/api/mock/accounts/7/orders', '/api/mock/accounts/7/orders?securityId=2']);

  finish(new Response(JSON.stringify({ orders: [apple], hasMore: false, securities })));
  await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  expect(screen.getByRole('listitem')).toHaveTextContent('Apple Inc');
});

test('no order yet says so; a new refresh key (an order on the page) reloads', async () => {
  answer = () => ({ orders: [], hasMore: false, securities: [] });
  const { rerender } = render(<MockHistory accountId={7} refreshKey={0} />);
  expect(await screen.findByText('No trades yet.')).toBeInTheDocument();
  answer = () => ({ orders: [order(1)], hasMore: false, securities });
  rerender(<MockHistory accountId={7} refreshKey={1} />);
  expect(await screen.findByRole('list')).toBeInTheDocument();
  expect(urls).toHaveLength(2);
});
