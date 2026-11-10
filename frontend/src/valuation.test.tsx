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

const samsung = { id: 5930, market: 'KOSPI', symbol: '005930', name: '삼성전자', active: true };
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
      name: '삼성전자',
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
      name: '애플',
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
      name: '비트코인',
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
      name: '정지종목',
      security: { ...samsung, id: 1, symbol: '000001', name: '정지종목', active: false },
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
      name: '달러 예금',
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
      name: '마이크로소프트',
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
  await screen.findByRole('heading', { name: '주식(ETF·펀드 포함)' });
};
const row = (name: string) =>
  screen.getByText(name, { selector: 'span.font-medium' }).closest('li')!;

test('a value shows its price basis, delays, rate, gain and why it is left out', async () => {
  await ready();
  const korean = within(row('삼성전자'));
  expect(korean.getByText('715,000원')).toBeInTheDocument();
  expect(korean.getByText('삼성전자 · 005930 · 유가증권 · KRW · 수량 10')).toBeInTheDocument();
  expect(korean.getByText('71,500원 · 11월 5일 종가 기준')).toBeInTheDocument();
  expect(korean.getByText('평가 손익 +15,000원 (+2.14%)')).toBeInTheDocument();

  const us = within(row('애플'));
  expect(us.getByText('308,810원')).toBeInTheDocument();
  expect(us.getByText('220.5달러')).toBeInTheDocument();
  expect(us.getByText('110.25달러 · 시세 지연 · 10월 30일 종가 기준')).toBeInTheDocument();
  expect(us.getByText('환율 1,400.5원 · 환율 지연 · 11월 3일 기준')).toBeInTheDocument();
  expect(us.getByText('평가 손익 -11,190원 (-3.5%)')).toBeInTheDocument();

  const coin = within(row('비트코인'));
  expect(coin.getByText('95,000,000원 · 직접 입력 · 11월 9일')).toBeInTheDocument();
  expect(coin.getByText('원가 없음 · 거래를 기록하면 손익을 보여 줍니다')).toBeInTheDocument();

  expect(within(row('정지종목')).getByText('거래 중단')).toBeInTheDocument();

  const dollars = within(row('달러 예금'));
  expect(dollars.getByText('100.5달러')).toBeInTheDocument();
  expect(dollars.getByText('환율 없음 · 합계에서 뺐습니다')).toBeInTheDocument();

  const missing = within(row('마이크로소프트'));
  expect(missing.getByText('시세 없음')).toBeInTheDocument();
  expect(missing.getByText('아직 받은 종가가 없어 합계에서 뺐습니다')).toBeInTheDocument();

  expect(screen.getByText(/평가금액이 없는 2개는 합계에서 빠졌습니다/)).toBeInTheDocument();
});

test('a stock is linked from the search and takes the security currency', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: '애플 2' } });
  fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'stock' } });
  const query = screen.getByLabelText('종목 연결(선택)');
  fireEvent.change(query, { target: { value: 'aapl' } });
  // Enter searches; it does not save the asset.
  fireEvent.keyDown(query, { key: 'Enter' });
  const results = await screen.findByRole('list', { name: '종목 검색 결과' });
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
  expect(
    within(results).getByText('Apple Inc · AAPL · NASDAQ · 110.25달러 (11월 6일 종가 기준)'),
  ).toBeInTheDocument();
  fireEvent.click(within(results).getByRole('button', { name: 'Apple Inc 연결' }));

  expect(screen.getByText('Apple Inc · AAPL · NASDAQ')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '달러(USD)' })).toBeChecked();
  expect(screen.getByRole('radio', { name: '원화(KRW)' })).toBeDisabled();
  // A linked stock is valued at the close: no hand price.
  expect(screen.queryByLabelText(/현재가\(1개당/)).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('수량(선택)'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
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
  fireEvent.click(screen.getByRole('button', { name: '삼성전자 수정' }));
  expect(screen.getByText('삼성전자 · 005930 · 유가증권')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '삼성전자 연결 해제' }));
  expect(screen.getByLabelText('종목 연결(선택)')).toBeInTheDocument();
  expect(screen.getByLabelText('현재가(1개당, 원, 선택)')).toBeInTheDocument();
});

test('a hand price is sent with today when no date is given', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: '이더리움' } });
  fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'other' } });
  fireEvent.change(screen.getByLabelText('수량(선택)'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('현재가(1개당, 원, 선택)'), {
    target: { value: '5,000,000' },
  });
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
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
    field: '현재가(1개당, 원, 선택)',
    message: '현재가는 0보다 큰 원 단위 정수로 입력하세요',
  },
  {
    label: 'a price without a quantity',
    fill: { price: '100', value: '1' },
    field: '수량(선택)',
    message: '현재가를 넣으려면 수량을 입력하세요',
  },
  {
    label: 'a date without a price',
    fill: { quantity: '1', date: '2026-11-01' },
    field: '현재가(1개당, 원, 선택)',
    message: '현재가를 입력하세요',
  },
])('$label is refused before sending', async ({ fill, field, message }) => {
  await ready();
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: '코인' } });
  fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'other' } });
  const labels = {
    quantity: '수량(선택)',
    price: '현재가(1개당, 원, 선택)',
    value: '평가금액(원)',
    date: '현재가 기준일(비우면 오늘)',
  } as const;
  for (const [key, value] of Object.entries(fill)) {
    fireEvent.change(screen.getByLabelText(labels[key as keyof typeof labels]), {
      target: { value },
    });
  }
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(screen.getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
});

test('editing a hand-priced asset fills its price and date', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '비트코인 수정' }));
  expect(screen.getByLabelText('현재가(1개당, 원, 선택)')).toHaveValue('95000000');
  expect(screen.getByLabelText('현재가 기준일(비우면 오늘)')).toHaveValue('2026-11-09');
});

test('a new USD trade starts with the newest stored rate', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '애플 거래 내역' }));
  const rate = await screen.findByLabelText('환율(1달러당 원)');
  expect(rate).toHaveValue('1400.5');
  expect(rate).toHaveAccessibleDescription(
    '11월 3일 매매기준율을 미리 채웠습니다. 거래한 날 환율로 고칠 수 있습니다.',
  );
  // A changed rate is kept; the won trade panel has no rate at all.
  fireEvent.change(rate, { target: { value: '1390' } });
  expect(rate).toHaveValue('1390');
});
