import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { MockHoldings } from './mock-holdings';

const samsung = {
  security: { id: 1, symbol: '005930', name: '삼성전자', currency: 'KRW', active: false },
  quantity: '10.00000000',
  price: '80000.0000',
  priceDate: '2026-11-09',
  priceStale: false,
  fxRate: null,
  fxDate: null,
  costKrw: 706_000,
  valueKrw: 800_000,
  profitKrw: 94_000,
  returnPct: '13.31',
};
const apple = {
  security: { id: 2, symbol: 'AAPL', name: 'Apple Inc', currency: 'USD', active: true },
  quantity: '2.00000000',
  price: '231.5000',
  priceDate: '2026-11-02',
  priceStale: true,
  fxRate: '1400.0000',
  fxDate: '2026-11-09',
  costKrw: 641_024,
  valueKrw: 630_000,
  profitKrw: -11_024,
  returnPct: '-1.72',
};

let answer: { status: number; body: unknown };
let urls: string[];

beforeEach(() => {
  urls = [];
  answer = {
    status: 200,
    body: {
      summary: {
        initialCashKrw: 10_000_000,
        cashKrw: 8_652_976,
        costKrw: 1_347_024,
        valueKrw: 1_430_000,
        totalKrw: 10_082_976,
        profitKrw: 82_976,
        returnPct: '0.83',
      },
      holdings: [samsung, apple],
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
    }),
  );
});

const term = (scope: HTMLElement, label: string) =>
  within(scope).getByText(label, { selector: 'dt' }).nextElementSibling;

test('shows the total, profit and return of the account and each holding as the server sent them', async () => {
  render(<MockHoldings accountId={7} refreshKey={0} onOrdered={() => undefined} />);
  const list = await screen.findByRole('list', { name: '보유 종목과 수익률' });
  expect(urls).toEqual(['/api/mock/accounts/7/holdings']);

  const section = screen.getByRole('region', { name: '보유 종목과 수익률' }).querySelector('dl')!;
  expect(term(section, '총자산')).toHaveTextContent('10,082,976원');
  expect(term(section, '평가금액')).toHaveTextContent('1,430,000원');
  expect(term(section, '계좌 손익')).toHaveTextContent('+82,976원');
  expect(term(section, '수익률')).toHaveTextContent('+0.83%');

  const [first, second] = within(list).getAllByRole('listitem');
  // An inactive security keeps its last close and is marked.
  expect(first).toHaveTextContent('삼성전자005930거래 중단');
  expect(first).toHaveTextContent('10주 · 11월 9일 종가 80,000원');
  expect(term(first, '평가금액')).toHaveTextContent('800,000원');
  expect(term(first, '매입원가')).toHaveTextContent('706,000원');
  expect(term(first, '손익')).toHaveTextContent('+94,000원 (+13.31%)');

  expect(second).not.toHaveTextContent('거래 중단');
  expect(second).toHaveTextContent(
    '2주 · 시세 지연 · 11월 2일 종가 231.5달러 · 환율 1,400원(11월 9일)',
  );
  expect(term(second, '손익')).toHaveTextContent('-11,024원 (-1.72%)');
});

test('without holdings it says so; the return of an untouched account is 0%', async () => {
  answer = {
    status: 200,
    body: {
      summary: {
        initialCashKrw: 10_000_000,
        cashKrw: 10_000_000,
        costKrw: 0,
        valueKrw: 0,
        totalKrw: 10_000_000,
        profitKrw: 0,
        returnPct: '0.00',
      },
      holdings: [],
    },
  };
  render(<MockHoldings accountId={7} refreshKey={0} onOrdered={() => undefined} />);
  expect(await screen.findByText(/보유 종목이 없습니다/)).toBeInTheDocument();
  const section = screen.getByRole('region', { name: '보유 종목과 수익률' }).querySelector('dl')!;
  expect(term(section, '수익률')).toHaveTextContent('0%');
  expect(term(section, '계좌 손익')).toHaveTextContent('0원');
});

test('a new refresh key or account reloads; a failure shows the reason', async () => {
  const { rerender } = render(
    <MockHoldings accountId={7} refreshKey={0} onOrdered={() => undefined} />,
  );
  await screen.findByRole('list');
  rerender(<MockHoldings accountId={7} refreshKey={1} onOrdered={() => undefined} />);
  rerender(<MockHoldings accountId={8} refreshKey={1} onOrdered={() => undefined} />);
  await vi.waitFor(() =>
    expect(urls).toEqual([
      '/api/mock/accounts/7/holdings',
      '/api/mock/accounts/7/holdings',
      '/api/mock/accounts/8/holdings',
    ]),
  );

  answer = { status: 500, body: { error: '서버 오류가 발생했습니다' } };
  rerender(<MockHoldings accountId={9} refreshKey={1} onOrdered={() => undefined} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('서버 오류가 발생했습니다');
  // Values of the earlier account are not shown for the new one.
  expect(screen.queryByRole('list')).toBeNull();
});

test('a holding opens the order form, so a suspended security found by no search can be sold', async () => {
  const preview = {
    security: { id: 1, symbol: '005930', name: '삼성전자', currency: 'KRW' },
    price: '80000.0000',
    priceDate: '2026-11-09',
    priceStale: false,
    fxRate: null,
    fxDate: null,
    amountKrw: 800_000,
    feeKrw: 0,
    cashKrw: 8_652_976,
    cashAfterKrw: 9_452_976,
    heldQuantity: '10.00000000',
    problem: null,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      urls.push(`${init.method ?? 'GET'} ${url}`);
      const reply = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (url === '/api/mock/accounts') return reply({ account: { id: 7 }, closedAccounts: [] });
      if (url.includes('/preview')) return reply(preview);
      if (init.method === 'POST') {
        return reply({ order: { priceDate: '2026-11-09' }, cashKrw: 9_452_976 }, 201);
      }
      return reply(answer.body);
    }),
  );
  const onOrdered = vi.fn();
  const { rerender } = render(<MockHoldings accountId={7} refreshKey={0} onOrdered={onOrdered} />);
  const button = await screen.findByRole('button', { name: '삼성전자 주문' });
  expect(button).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');

  fireEvent.click(screen.getByRole('button', { name: '매도' }));
  fireEvent.change(screen.getByLabelText('수량(주)'), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: '주문 확인' }));
  const dialog = await screen.findByRole('dialog', { name: '삼성전자 10주 매도' });
  expect(dialog).toHaveTextContent('보유 10주 중 10주를 팝니다');
  fireEvent.click(within(dialog).getByRole('button', { name: '매도' }));
  await vi.waitFor(() => expect(onOrdered).toHaveBeenCalledTimes(1));
  expect(urls).toContain(
    'GET /api/mock/accounts/7/orders/preview?securityId=1&side=sell&quantity=10',
  );

  // The page bumps the key; the holding is gone, and with it its form, so the result is said here.
  answer = {
    status: 200,
    body: { ...(answer.body as object), holdings: [apple] },
  };
  rerender(<MockHoldings accountId={7} refreshKey={1} onOrdered={onOrdered} />);
  expect(await screen.findByText('삼성전자 보유분을 모두 팔았습니다')).toHaveAttribute(
    'role',
    'status',
  );
  expect(screen.queryByLabelText('수량(주)')).toBeNull();
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
});
