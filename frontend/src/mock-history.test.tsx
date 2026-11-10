import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { MockHistory } from './mock-history';

const order = (id: number, side: 'buy' | 'sell' = 'buy') => ({
  id,
  security: { id: 1, symbol: '005930', name: '삼성전자' },
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
  { id: 1, symbol: '005930', name: '삼성전자' },
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
  const list = await screen.findByRole('list', { name: '거래 내역' });
  const items = within(list).getAllByRole('listitem');
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveTextContent('매도삼성전자 10주');
  expect(items[1]).toHaveTextContent('매수Apple Inc 2주');
  expect(items[1]).toHaveTextContent('11월 6일 종가 231.5달러 · 환율 1,384.5원(11월 6일)');
  expect(items[1]).toHaveTextContent('체결 금액 641,024원 · 수수료 0원 · 주문 후 현금 9,294,000원');
  expect(urls).toEqual(['/api/mock/accounts/7/orders']);
  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull();
  // The security filter lists every traded security.
  expect(
    within(screen.getByLabelText('종목'))
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['전체 종목', 'Apple Inc (AAPL)', '삼성전자 (005930)']);
});

test('filters by period and security, and the filter can be cleared', async () => {
  render(<MockHistory accountId={7} refreshKey={0} />);
  await screen.findByRole('list');
  fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-11-01' } });
  fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-11-09' } });
  fireEvent.change(screen.getByLabelText('종목'), { target: { value: '2' } });
  answer = () => ({ orders: [], hasMore: false, securities });
  fireEvent.click(screen.getByRole('button', { name: '조회' }));
  expect(await screen.findByText('조건에 맞는 거래가 없습니다.')).toBeInTheDocument();
  expect(urls[1]).toBe('/api/mock/accounts/7/orders?from=2026-11-01&to=2026-11-09&securityId=2');

  answer = () => ({ orders: [order(1)], hasMore: false, securities });
  fireEvent.click(screen.getByRole('button', { name: '필터 지우기' }));
  expect(await screen.findByRole('list')).toBeInTheDocument();
  expect(urls[2]).toBe('/api/mock/accounts/7/orders');
  expect(screen.getByLabelText('시작일')).toHaveValue('');
});

test('a start after the end is refused before asking the server', async () => {
  render(<MockHistory accountId={7} refreshKey={0} />);
  await screen.findByRole('list');
  fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-11-09' } });
  fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-11-01' } });
  fireEvent.click(screen.getByRole('button', { name: '조회' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '시작일은 종료일보다 늦을 수 없습니다',
  );
  expect(screen.getByLabelText('시작일')).toHaveAttribute('aria-invalid', 'true');
  expect(urls).toHaveLength(1);
});

test('더 보기 adds the next 50 after the last one shown, with the same filter', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: '더 보기' }));
  await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(51));
  expect(urls[1]).toBe('/api/mock/accounts/7/orders?before=11');
  expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull();
});

test('더 보기 while a new filter is loading does not add the old list to the new one', async () => {
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
  fireEvent.change(screen.getByLabelText('종목'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: '조회' }));
  fireEvent.click(screen.getByRole('button', { name: '더 보기' }));
  expect(urls).toEqual(['/api/mock/accounts/7/orders', '/api/mock/accounts/7/orders?securityId=2']);

  finish(new Response(JSON.stringify({ orders: [apple], hasMore: false, securities })));
  await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  expect(screen.getByRole('listitem')).toHaveTextContent('Apple Inc');
});

test('no order yet says so; a new refresh key (an order on the page) reloads', async () => {
  answer = () => ({ orders: [], hasMore: false, securities: [] });
  const { rerender } = render(<MockHistory accountId={7} refreshKey={0} />);
  expect(await screen.findByText('아직 거래가 없습니다.')).toBeInTheDocument();
  answer = () => ({ orders: [order(1)], hasMore: false, securities });
  rerender(<MockHistory accountId={7} refreshKey={1} />);
  expect(await screen.findByRole('list')).toBeInTheDocument();
  expect(urls).toHaveLength(2);
});
