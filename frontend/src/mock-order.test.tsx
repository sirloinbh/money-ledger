import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { MockOrder } from './mock-order';

const krwPreview = {
  security: { id: 1, symbol: '005930', name: '삼성전자', currency: 'KRW' },
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
  fireEvent.change(screen.getByLabelText('수량(주)'), { target: { value: quantity } });
  fireEvent.click(screen.getByRole('button', { name: '주문 확인' }));
};

test('a buy shows which close it fills at, then fills once and reports the new cash', async () => {
  const onOrdered = vi.fn();
  render(<MockOrder securityId={1} title="삼성전자" onOrdered={onOrdered} />);
  orderFor('10');

  const dialog = await screen.findByRole('dialog', { name: '삼성전자 10주 매수' });
  expect(dialog).toHaveTextContent('11월 6일 종가 70,600원으로 체결합니다');
  expect(dialog).toHaveTextContent('체결 금액 706,000원 · 수수료 0원');
  expect(dialog).toHaveTextContent('주문 후 현금 9,294,000원');
  expect(requests[1].url).toBe(
    '/api/mock/accounts/7/orders/preview?securityId=1&side=buy&quantity=10',
  );

  fireEvent.click(within(dialog).getByRole('button', { name: '매수' }));
  expect(
    await screen.findByText('삼성전자 10주를 11월 6일 종가로 매수했습니다. 현금 9,294,000원'),
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
  expect(screen.getByLabelText('수량(주)')).toHaveValue('');
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
  fireEvent.click(screen.getByRole('button', { name: '매도' }));
  expect(screen.getByRole('button', { name: '매도' })).toHaveAttribute('aria-pressed', 'true');
  orderFor('3');
  const dialog = await screen.findByRole('dialog', { name: 'Apple Inc 3주 매도' });
  expect(dialog).toHaveTextContent('11월 6일 종가 231.5달러로 체결합니다 (시세 지연)');
  expect(dialog).toHaveTextContent('환율 1,384.5원(11월 6일 매매기준율)으로 원화로 바꿉니다');
  fireEvent.click(within(dialog).getByRole('button', { name: '매도' }));
  await screen.findByText(/종가로 (매수|매도)했습니다/);
  expect(posts()[0].body?.side).toBe('sell');
});

test('a bad quantity, no account and a refused preview never reach the order', async () => {
  render(<MockOrder securityId={1} title="삼성전자" onOrdered={() => undefined} />);
  orderFor('1.5');
  expect(await screen.findByRole('alert')).toHaveTextContent('수량은 1주 단위의 정수로 입력하세요');
  expect(screen.getByLabelText('수량(주)')).toHaveAttribute('aria-invalid', 'true');
  expect(requests).toHaveLength(0);

  account = null;
  orderFor('1');
  expect(await screen.findByText('모의투자 계좌를 먼저 만드세요')).toBeInTheDocument();

  account = { id: 7 };
  preview = { ...krwPreview, problem: '현금이 부족합니다', cashAfterKrw: null };
  orderFor('1000');
  expect(await screen.findByText('현금이 부족합니다')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(posts()).toHaveLength(0);
});

test('a lost connection keeps the request key for the retry; a refusal starts a new one', async () => {
  postAnswers = ['offline'];
  const onOrdered = vi.fn();
  render(<MockOrder securityId={1} title="삼성전자" onOrdered={onOrdered} />);
  orderFor('10');
  let dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '매수' }));
  expect(
    await screen.findByText(
      '서버에 연결할 수 없습니다. 주문이 체결됐을 수 있으니 계좌 현금을 확인하세요',
    ),
  ).toBeInTheDocument();
  // The account card is reloaded in case the order filled.
  expect(onOrdered).toHaveBeenCalledTimes(1);

  // Closed and confirmed again: the same order goes with the same key, so it cannot fill twice.
  fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
  postAnswers = [{ status: 409, body: { error: '현금이 부족합니다' } }];
  orderFor('10');
  dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '매수' }));
  expect(await screen.findByText('현금이 부족합니다')).toBeInTheDocument();
  expect(posts()[1].body?.requestKey).toBe(posts()[0].body?.requestKey);
  // A refusal closes the dialog so the reason is visible.
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  orderFor('10');
  dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '매수' }));
  await screen.findByText(/종가로 (매수|매도)했습니다/);
  expect(posts()[2].body?.requestKey).not.toBe(posts()[0].body?.requestKey);
});
