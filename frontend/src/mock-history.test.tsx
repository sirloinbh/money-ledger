import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { MockHistory } from './mock-history';
import { mockKey } from './mock-query';
import { findLive } from './test/live';
import { renderWithQuery, testQueryClient } from './test/query';
import { unexpectedRequest } from './test/unexpected';

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
// The orders page for a URL, or a Response to answer with as is (a failure).
let answer: (url: string) => unknown;
// When set, answers wait for it, so a test can look at the screen while a load is running.
let gate: Promise<void> | undefined;

beforeEach(() => {
  urls = [];
  gate = undefined;
  answer = () => ({ orders: [order(3, 'sell'), apple, order(1)], hasMore: false, securities });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      urls.push(url);
      const method = init.method ?? 'GET';
      // Only account 7's orders are served; any other request fails the test (#183).
      if (method !== 'GET' || url.split('?')[0] !== '/api/mock/accounts/7/orders') {
        return unexpectedRequest(method, url);
      }
      const result = answer(url);
      await gate;
      return result instanceof Response ? result : new Response(JSON.stringify(result));
    }),
  );
});

test('shows each order with the close it filled at, its rate and the cash after it', async () => {
  renderWithQuery(<MockHistory accountId={7} />);
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
  renderWithQuery(<MockHistory accountId={7} />);
  await screen.findByRole('list');
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-11-01' } });
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-11-09' } });
  fireEvent.change(screen.getByLabelText('Security'), { target: { value: '2' } });
  answer = () => ({ orders: [], hasMore: false, securities });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(await screen.findByText('No trades match the filters.')).toBeInTheDocument();
  expect(urls[1]).toBe('/api/mock/accounts/7/orders?from=2026-11-01&to=2026-11-09&securityId=2');

  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  // The unfiltered list was just loaded, so it shows again from the cache (#213).
  expect(await screen.findByRole('list')).toBeInTheDocument();
  expect(urls).toHaveLength(2);
  expect(screen.getByLabelText('Start date')).toHaveValue('');
});

test('a start after the end is refused before asking the server', async () => {
  renderWithQuery(<MockHistory accountId={7} />);
  await screen.findByRole('list');
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-11-09' } });
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-11-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(await findLive('alert')).toHaveTextContent('The start date cannot be after the end date');
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
  renderWithQuery(<MockHistory accountId={7} />);
  await screen.findByRole('list');
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(51));
  expect(urls[1]).toBe('/api/mock/accounts/7/orders?before=11');
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
});

test('an order after Load more starts the list again from the newest (#213)', async () => {
  const firstPage = (newest: number) => ({
    orders: Array.from({ length: 50 }, (_, index) => order(newest - index)),
    hasMore: true,
    securities,
  });
  answer = (url) =>
    url.includes('before=') ? { orders: [order(1)], hasMore: false, securities } : firstPage(60);
  renderWithQuery(<MockHistory accountId={7} />);
  await screen.findByRole('list');
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(51));

  // An order on the page puts a new trade first: the first 50 load again, and the older pages go.
  answer = () => firstPage(61);
  await mockChanged();
  await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(50));
  expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
});

test('a refetch without a change (the window got focus again) is not announced as an update', async () => {
  answer = () => ({ orders: [order(2), order(1)], hasMore: false, securities });
  renderWithQuery(<MockHistory accountId={7} />);
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
  const refetched = testQueryClient().refetchQueries({ queryKey: mockKey });
  await vi.waitFor(() => expect(urls).toHaveLength(2));
  // Let the list render with its load running.
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(testQueryClient().isFetching({ queryKey: mockKey })).toBe(1);
  expect(screen.queryByText('Updating trade history')).toBeNull();
  expect(screen.getByRole('list')).not.toHaveAttribute('aria-busy');
  await act(async () => {
    finish(
      new Response(JSON.stringify({ orders: [order(2), order(1)], hasMore: false, securities })),
    );
    await refetched;
  });
});

test('Load more while a new filter is loading does not add the old list to the new one', async () => {
  answer = () => ({
    orders: Array.from({ length: 50 }, (_, index) => order(60 - index)),
    hasMore: true,
    securities,
  });
  renderWithQuery(<MockHistory accountId={7} />);
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

// An order (or a reset) elsewhere on the page reloads every mock read (#213).
const mockChanged = () => act(() => testQueryClient().invalidateQueries({ queryKey: mockKey }));

test('no order yet says so; an order on the page reloads', async () => {
  answer = () => ({ orders: [], hasMore: false, securities: [] });
  renderWithQuery(<MockHistory accountId={7} />);
  expect(await screen.findByText('No trades yet.')).toBeInTheDocument();
  answer = () => ({ orders: [order(1)], hasMore: false, securities });
  await mockChanged();
  expect(await screen.findByRole('list')).toBeInTheDocument();
  expect(urls).toHaveLength(2);
});

test('while a new filter loads, the old list is marked busy and cannot be continued (#197)', async () => {
  answer = () => ({ orders: [order(3), order(2)], hasMore: true, securities });
  renderWithQuery(<MockHistory accountId={7} />);
  const list = await screen.findByRole('list', { name: 'Trade history' });
  const more = screen.getByRole('button', { name: 'Load more' });
  expect(more).not.toHaveAttribute('aria-disabled');

  let release = () => undefined as void;
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  answer = () => ({ orders: [order(1)], hasMore: false, securities });
  fireEvent.change(screen.getByLabelText('Security'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

  expect(await findLive('status')).toHaveTextContent('Updating trade history');
  expect(list).toHaveAttribute('aria-busy', 'true');
  expect(more).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(more);
  expect(urls).toEqual(['/api/mock/accounts/7/orders', '/api/mock/accounts/7/orders?securityId=1']);

  release();
  await vi.waitFor(() =>
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1),
  );
  expect(screen.queryByText('Updating trade history')).toBeNull();
  expect(screen.getByRole('list')).not.toHaveAttribute('aria-busy');
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
});

test('one share is "1 share", not "1 shares" (#203)', async () => {
  answer = () => ({
    orders: [{ ...order(4), quantity: '1.00000000' }],
    hasMore: false,
    securities,
  });
  renderWithQuery(<MockHistory accountId={7} />);
  const list = await screen.findByRole('list', { name: 'Trade history' });
  expect(within(list).getByRole('listitem')).toHaveTextContent('BuySamsung Electronics 1 share');
  expect(within(list).getByRole('listitem')).not.toHaveTextContent('1 shares');
});

// #183 Error paths: a failed load says why and leaves the screen usable.
const failure = (error: string, status = 500) =>
  new Response(JSON.stringify({ error }), { status });

test('a first load that fails shows the server message instead of a list or a spinner', async () => {
  answer = () => failure('Cannot connect to the database', 503);
  renderWithQuery(<MockHistory accountId={7} />);
  expect(await findLive('alert')).toHaveTextContent('Cannot connect to the database');
  expect(screen.queryByRole('list')).toBeNull();
  expect(screen.queryByText('Loading trade history')).toBeNull();
});

test('a filter that fails to load keeps the old list, no longer busy, and Apply tries again', async () => {
  renderWithQuery(<MockHistory accountId={7} />);
  const list = await screen.findByRole('list', { name: 'Trade history' });
  answer = () => failure('Cannot connect to the database');
  fireEvent.change(screen.getByLabelText('Security'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

  expect(await findLive('alert')).toHaveTextContent('Cannot connect to the database');
  expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  expect(list).not.toHaveAttribute('aria-busy');
  expect(screen.queryByText('Updating trade history')).toBeNull();

  answer = () => ({ orders: [order(1)], hasMore: false, securities });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await vi.waitFor(() =>
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1),
  );
  expect(screen.queryByText('Cannot connect to the database')).toBeNull();
});

test('Load more that fails keeps the shown orders and says why', async () => {
  answer = () => ({ orders: [order(3), order(2)], hasMore: true, securities });
  renderWithQuery(<MockHistory accountId={7} />);
  const list = await screen.findByRole('list', { name: 'Trade history' });
  answer = () => failure('Cannot connect to the database');
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

  expect(await findLive('alert')).toHaveTextContent('Cannot connect to the database');
  expect(urls.at(-1)).toBe('/api/mock/accounts/7/orders?before=2');
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Load more' })).not.toHaveAttribute('aria-disabled');
});
