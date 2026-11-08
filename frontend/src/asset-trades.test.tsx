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
    return json({ error: '2026-01-10 매도 수량이 그때 보유 수량(15)보다 많습니다' }, 400);
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
      name: '비상금 통장',
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
      name: '삼성전자',
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
      name: '애플',
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
  await screen.findByRole('heading', { name: '현금(예적금 포함)' });
};

const openTrades = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: `${name} 거래 내역` }));
  const panel = screen.getByRole('region', { name: `${name} 거래 내역` });
  await within(panel).findByText('보유 수량');
  return panel;
};

test('only stock and other assets have trades, shown with the position from the server', async () => {
  await ready();
  expect(screen.queryByRole('button', { name: '비상금 통장 거래 내역' })).not.toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: '삼성전자 거래 내역' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).not.toHaveAttribute('aria-controls');
  const panel = await openTrades('삼성전자');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const summary = (label: string) => within(panel).getByText(label).nextElementSibling;
  expect(summary('보유 수량')).toHaveTextContent('15');
  expect(summary('평균 단가')).toHaveTextContent('1,161.4667원');
  expect(summary('원화 원가')).toHaveTextContent('17,422원');
  expect(summary('실현 손익')).toHaveTextContent('+1,602원');
  expect(
    within(panel).getByText('7,500원 · 비용 90원 · 보유 15 · 실현 손익 +1,602원'),
  ).toBeInTheDocument();
  // A won asset has no rate field.
  expect(within(panel).queryByLabelText('환율(1달러당 원)')).not.toBeInTheDocument();
});

test('a buy is sent with decimal strings and won costs', async () => {
  await ready();
  const panel = await openTrades('삼성전자');
  fireEvent.change(within(panel).getByLabelText('거래일'), { target: { value: '2026-01-02' } });
  fireEvent.change(within(panel).getByLabelText('수량'), { target: { value: '10' } });
  fireEvent.change(within(panel).getByLabelText('단가(원)'), { target: { value: '1,000' } });
  fireEvent.change(within(panel).getByLabelText('수수료(원)'), { target: { value: '100' } });
  fireEvent.click(within(panel).getByRole('button', { name: '거래 추가' }));
  expect(await within(panel).findByRole('status')).toHaveTextContent(
    '2026-01-02 매수를 기록했습니다',
  );
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
  const panel = await openTrades('애플');
  fireEvent.change(within(panel).getByLabelText('거래일'), { target: { value: '2026-02-02' } });
  fireEvent.change(within(panel).getByLabelText('수량'), { target: { value: '2' } });
  fireEvent.change(within(panel).getByLabelText('단가(달러)'), { target: { value: '100.5' } });
  fireEvent.click(within(panel).getByRole('button', { name: '거래 추가' }));
  expect(within(panel).getByRole('alert')).toHaveTextContent(
    '그날 환율(1달러당 원)을 소수 4자리까지 입력하세요',
  );
  expect(within(panel).getByLabelText('환율(1달러당 원)')).toHaveAttribute('aria-invalid', 'true');
  expect(requests.some((request) => request.method === 'POST')).toBe(false);

  fireEvent.change(within(panel).getByLabelText('환율(1달러당 원)'), {
    target: { value: '1,300' },
  });
  fireEvent.click(within(panel).getByRole('button', { name: '거래 추가' }));
  await within(panel).findByRole('status');
  expect(requests.find((request) => request.method === 'POST')?.body).toMatchObject({
    price: '100.5',
    fxRate: '1300',
  });
});

test('a sell above what is held shows the server message', async () => {
  await ready();
  const panel = await openTrades('삼성전자');
  fireEvent.click(within(panel).getByRole('radio', { name: '매도' }));
  fireEvent.change(within(panel).getByLabelText('거래일'), { target: { value: '2026-01-10' } });
  fireEvent.change(within(panel).getByLabelText('수량'), { target: { value: '100' } });
  fireEvent.change(within(panel).getByLabelText('단가(원)'), { target: { value: '1500' } });
  fireEvent.click(within(panel).getByRole('button', { name: '거래 추가' }));
  expect(await within(panel).findByRole('alert')).toHaveTextContent(
    '2026-01-10 매도 수량이 그때 보유 수량(15)보다 많습니다',
  );
});

test('a won price with decimals and a future date are refused before sending', async () => {
  await ready();
  const panel = await openTrades('삼성전자');
  fireEvent.change(within(panel).getByLabelText('수량'), { target: { value: '1' } });
  fireEvent.change(within(panel).getByLabelText('단가(원)'), { target: { value: '1000.5' } });
  fireEvent.click(within(panel).getByRole('button', { name: '거래 추가' }));
  expect(within(panel).getByRole('alert')).toHaveTextContent(
    '단가는 0보다 큰 원 단위 정수로 입력하세요',
  );
  fireEvent.change(within(panel).getByLabelText('단가(원)'), { target: { value: '1000' } });
  fireEvent.change(within(panel).getByLabelText('거래일'), { target: { value: '2099-01-01' } });
  fireEvent.submit(within(panel).getByRole('form', { name: '삼성전자 거래 추가' }));
  expect(within(panel).getByRole('alert')).toHaveTextContent(
    '오늘 이후 날짜의 거래는 기록할 수 없습니다',
  );
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
});

test('a trade can be edited and, after confirming, deleted', async () => {
  await ready();
  const panel = await openTrades('삼성전자');
  fireEvent.click(within(panel).getByRole('button', { name: '2026-01-10 매도 5 × 1,500원 수정' }));
  expect(within(panel).getByRole('radio', { name: '매도' })).toBeChecked();
  expect(within(panel).getByLabelText('수량')).toHaveValue('5');
  expect(within(panel).getByLabelText('단가(원)')).toHaveValue('1500');
  expect(within(panel).getByLabelText('세금(원)')).toHaveValue('15');
  fireEvent.change(within(panel).getByLabelText('수량'), { target: { value: '4' } });
  fireEvent.click(within(panel).getByRole('button', { name: '수정 저장' }));
  expect(await within(panel).findByRole('status')).toHaveTextContent(
    '2026-01-10 매도를 수정했습니다',
  );
  expect(requests).toContainEqual(
    expect.objectContaining({ method: 'PUT', url: '/api/portfolio/assets/2/trades/7' }),
  );

  fireEvent.click(
    await within(panel).findByRole('button', { name: '2026-01-10 매도 4 × 1,500원 지우기' }),
  );
  expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '지우기' }));
  expect(await within(panel).findByText('아직 거래 기록이 없습니다.')).toBeInTheDocument();
  await vi.waitFor(() =>
    expect(within(panel).getByRole('heading', { name: '삼성전자 거래 내역' })).toHaveFocus(),
  );
});

test('an asset with trades shows its quantity read-only in the edit form', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '삼성전자 수정' }));
  const quantity = screen.getByLabelText('수량(거래 합계)');
  expect(quantity).toHaveValue('15');
  expect(quantity).toHaveAttribute('readonly');
  expect(quantity).toHaveAccessibleDescription('거래 기록이 있어 수량은 거래 내역에서만 바뀝니다.');
  // Without trades the quantity is entered by hand.
  fireEvent.click(screen.getByRole('button', { name: '수정 취소' }));
  fireEvent.click(screen.getByRole('button', { name: '애플 수정' }));
  expect(screen.getByLabelText('수량(선택)')).not.toHaveAttribute('readonly');
});

test('a USD asset labels its dollar average and a hand-entered quantity is flagged before the first trade', async () => {
  trades[3] = [];
  await ready();
  const panel = await openTrades('애플');
  expect(within(panel).getByText('평균 단가(수수료 제외)')).toBeInTheDocument();
  expect(
    within(panel).getByText(/지금 수량 1은\(는\) 직접 넣은 값입니다\. 첫 거래를 기록하면/),
  ).toBeInTheDocument();
});

test('the open edit form follows a first trade and locks the quantity', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '애플 수정' }));
  expect(screen.getByLabelText('수량(선택)')).toHaveValue('1');
  const panel = await openTrades('애플');
  fireEvent.change(within(panel).getByLabelText('거래일'), { target: { value: '2026-02-02' } });
  fireEvent.change(within(panel).getByLabelText('수량'), { target: { value: '2' } });
  fireEvent.change(within(panel).getByLabelText('단가(달러)'), { target: { value: '100' } });
  fireEvent.change(within(panel).getByLabelText('환율(1달러당 원)'), {
    target: { value: '1300' },
  });
  const add = within(panel).getByRole('button', { name: '거래 추가' });
  add.focus();
  fireEvent.click(add);
  await within(panel).findByRole('status');
  const quantity = await screen.findByLabelText('수량(거래 합계)');
  expect(quantity).toHaveValue('2');
  expect(quantity).toHaveAttribute('readonly');
  // Focus stays in the trades panel rather than jumping to the form.
  expect(add).toHaveFocus();
});

test('an asset deleted elsewhere closes its open edit form on the next reload', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '애플 수정' }));
  expect(screen.getByRole('heading', { name: '자산 수정' })).toBeInTheDocument();
  // Another tab deletes 애플; a trade on 삼성전자 reloads the list here.
  stored = stored.filter((asset) => asset.id !== 3);
  const panel = await openTrades('삼성전자');
  fireEvent.change(within(panel).getByLabelText('거래일'), { target: { value: '2026-01-02' } });
  fireEvent.change(within(panel).getByLabelText('수량'), { target: { value: '1' } });
  fireEvent.change(within(panel).getByLabelText('단가(원)'), { target: { value: '1000' } });
  fireEvent.click(within(panel).getByRole('button', { name: '거래 추가' }));
  expect(await screen.findByRole('heading', { name: '새 자산' })).toBeInTheDocument();
  expect(screen.getByText('애플은(는) 이미 삭제되어 수정을 닫았습니다')).toBeInTheDocument();
});
