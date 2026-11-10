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
// The account that holds one share of 삼성전자 (#53), if any.
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
                      name: '삼성전자',
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

test('without an account the form suggests 1,000만 원 and creates it', async () => {
  render(<MockAccount />);
  const amount = await screen.findByLabelText('시작 금액(원)');
  expect(amount).toHaveValue('10,000,000');
  expect(screen.getByText(/가계부와 자산 포트폴리오 합계에 들어가지 않습니다/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '계좌 만들기' }));

  const title = await screen.findByRole('heading', { level: 2, name: '모의투자 계좌' });
  expect(posts()).toEqual([
    { method: 'POST', url: '/api/mock/accounts', body: { initialCashKrw: 10_000_000 } },
  ]);
  await vi.waitFor(() => expect(title).toHaveFocus());
  expect(screen.getByRole('status')).toHaveTextContent(
    '10,000,000원으로 모의투자 계좌를 만들었습니다',
  );
  const balance = screen.getByText('현금 잔고').parentElement!;
  expect(balance).toHaveTextContent('10,000,000원');
});

test('a custom starting amount is sent as a won integer', async () => {
  render(<MockAccount />);
  fireEvent.change(await screen.findByLabelText('시작 금액(원)'), {
    target: { value: '50000000' },
  });
  fireEvent.click(screen.getByRole('button', { name: '계좌 만들기' }));
  await screen.findByRole('heading', { level: 2, name: '모의투자 계좌' });
  expect(posts()[0].body).toEqual({ initialCashKrw: 50_000_000 });
});

test.each([
  { value: '9,999', message: '시작 금액은 1만 원 이상이어야 합니다' },
  { value: '10,000,000,001', message: '시작 금액은 100억 원 이하로 입력하세요' },
  { value: '1,2,3', message: '시작 금액은 원 단위 정수로 입력하세요' },
  { value: '10000.5', message: '시작 금액은 원 단위 정수로 입력하세요' },
])('a starting amount of $value is refused before sending', async ({ value, message }) => {
  render(<MockAccount />);
  const amount = await screen.findByLabelText('시작 금액(원)');
  fireEvent.change(amount, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '계좌 만들기' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(amount).toHaveAttribute('aria-invalid', 'true');
  expect(posts()).toEqual([]);
});

test('a 409 from another tab shows the error and the account the server has', async () => {
  render(<MockAccount />);
  await screen.findByLabelText('시작 금액(원)');
  failNext = { status: 409, error: '이미 모의투자 계좌가 있습니다' };
  open = account(7, 20_000_000);
  const submit = screen.getByRole('button', { name: '계좌 만들기' });
  submit.focus();
  fireEvent.click(submit);
  expect(await screen.findByRole('alert')).toHaveTextContent('이미 모의투자 계좌가 있습니다');
  const title = await screen.findByRole('heading', { level: 2, name: '모의투자 계좌' });
  // The create button went away with the form; focus is not left on the page body.
  await vi.waitFor(() => expect(title).toHaveFocus());
});

test('an account that is gone (404) closes the dialog and focuses the create form', async () => {
  open = account(1, 10_000_000);
  render(<MockAccount />);
  fireEvent.click(await screen.findByRole('button', { name: '초기화' }));
  const dialog = await screen.findByRole('dialog');
  failNext = { status: 404, error: '모의투자 계좌를 찾을 수 없습니다' };
  open = null;
  fireEvent.click(within(dialog).getByRole('button', { name: '초기화' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('모의투자 계좌를 찾을 수 없습니다');
  const amount = await screen.findByLabelText('시작 금액(원)');
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await vi.waitFor(() => expect(amount).toHaveFocus());
});

test('reset asks first, then keeps the old account and starts again', async () => {
  open = { ...account(1, 10_000_000), cashKrw: 4_000_000 };
  render(<MockAccount />);
  const amount = await screen.findByLabelText('새 시작 금액(원)');
  expect(amount).toHaveValue('10,000,000');
  fireEvent.change(amount, { target: { value: '30,000,000' } });

  const trigger = screen.getByRole('button', { name: '초기화' });
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: '모의투자 계좌를 초기화할까요?' });
  expect(dialog).toHaveTextContent('현금 4,000,000원');
  expect(dialog).toHaveTextContent('새 계좌는 30,000,000원으로 시작합니다');
  expect(posts()).toEqual([]);

  fireEvent.click(within(dialog).getByRole('button', { name: '초기화' }));

  await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(posts()).toEqual([
    { method: 'POST', url: '/api/mock/accounts/1/reset', body: { initialCashKrw: 30_000_000 } },
  ]);
  expect(await screen.findByRole('status')).toHaveTextContent(
    '계좌를 초기화했습니다. 30,000,000원으로 다시 시작합니다',
  );
  expect(screen.getByText('현금 잔고').parentElement!).toHaveTextContent('30,000,000원');
  const history = screen.getByRole('list', { name: '이전 계좌' });
  expect(history).toHaveTextContent('시작 10,000,000원 · 마지막 현금 4,000,000원');
  await vi.waitFor(() => expect(trigger).toHaveFocus());
});

test('cancelling the reset sends nothing', async () => {
  open = account(1, 10_000_000);
  render(<MockAccount />);
  fireEvent.click(await screen.findByRole('button', { name: '초기화' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '취소' }));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(posts()).toEqual([]);
});

test('an invalid reset amount is refused without opening the dialog', async () => {
  open = account(1, 10_000_000);
  render(<MockAccount />);
  const amount = await screen.findByLabelText('새 시작 금액(원)');
  fireEvent.change(amount, { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: '초기화' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '시작 금액은 1만 원 이상이어야 합니다',
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(amount).toHaveAttribute('aria-invalid', 'true');
});

test('an account already reset elsewhere closes the dialog and shows the new account', async () => {
  open = account(1, 10_000_000);
  render(<MockAccount />);
  fireEvent.click(await screen.findByRole('button', { name: '초기화' }));
  const dialog = await screen.findByRole('dialog');
  failNext = {
    status: 409,
    error: '이미 초기화된 계좌입니다. 화면을 새로 고친 뒤 다시 시도하세요',
  };
  open = { ...account(2, 20_000_000), cashKrw: 20_000_000 };
  fireEvent.click(within(dialog).getByRole('button', { name: '초기화' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('이미 초기화된 계좌입니다');
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('현금 잔고').parentElement!).toHaveTextContent('20,000,000원');
  expect(posts()).toHaveLength(1);
});

test('a failed load is shown as an error instead of the form', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => json({ error: '서버 오류가 발생했습니다' }, 500)),
  );
  render(<MockAccount />);
  expect(await screen.findByRole('alert')).toHaveTextContent('서버 오류가 발생했습니다');
  expect(screen.queryByRole('button', { name: '계좌 만들기' })).not.toBeInTheDocument();
});

test('a new refresh key (an order elsewhere on the page) reloads the cash', async () => {
  open = account(1, 10_000_000);
  const { rerender } = render(<MockAccount refreshKey={0} />);
  await screen.findByText(/보유 종목이 없습니다/);
  // Cash and the initial amount in the account card, and the total of the holdings summary.
  expect(screen.getAllByText('10,000,000원')).toHaveLength(3);
  open = { ...open, cashKrw: 9_294_000 };
  rerender(<MockAccount refreshKey={1} />);
  // The cash and the total both follow the order.
  await vi.waitFor(() => expect(screen.getAllByText('9,294,000원')).toHaveLength(2));
  const gets = (path: string) => requests.filter((request) => request.url === path);
  expect(gets('/api/mock/accounts')).toHaveLength(2);
  expect(gets('/api/mock/accounts/1/holdings')).toHaveLength(2);
});

test('a holding order form left open does not carry over to the account after a reset', async () => {
  open = account(1, 10_000_000);
  heldBy = 1;
  render(<MockAccount />);
  fireEvent.click(await screen.findByRole('button', { name: '삼성전자 주문' }));
  expect(screen.getByRole('form', { name: '삼성전자 모의 주문' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '초기화' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '초기화' }));
  expect(await screen.findByText(/계좌를 초기화했습니다/)).toBeInTheDocument();
  await screen.findByText(/보유 종목이 없습니다/);
  // The new account never held 삼성전자, so nothing says it was sold.
  expect(screen.queryByText(/보유분을 모두 팔았습니다/)).toBeNull();
  expect(screen.queryByRole('form', { name: '삼성전자 모의 주문' })).toBeNull();
});
