import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { AssetManager } from './assets';

// #64 Prepaid assets on the asset screen, against a fake server that keeps the same rules.

type Prepaid = {
  kind: 'amount' | 'period';
  amountKrw: number;
  startsOn: string | null;
  expiresOn: string | null;
};
type Asset = {
  id: number;
  name: string;
  type: string;
  currency: 'KRW';
  quantity: null;
  valueKrw: number | null;
  valueForeign: null;
  memo: string;
  prepaid: Prepaid | null;
};
type Usage = { id: number; usedOn: string; amountKrw: number; memo: string };

let stored: Asset[];
let usages: Record<number, Usage[]>;
let requests: { method: string; url: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status }),
  );

const usedOf = (id: number) =>
  (usages[id] ?? []).reduce((total, usage) => total + usage.amountKrw, 0);

// The server works out values from the date; the fake: a pass is a third of its price, a stored value is
// what is left after its uses.
const view = (asset: Asset) => ({
  ...asset,
  depreciation: null,
  prepaid: asset.prepaid ? { ...asset.prepaid, usedKrw: usedOf(asset.id) } : null,
  currentValueKrw: asset.prepaid
    ? asset.prepaid.kind === 'period'
      ? Math.floor(asset.prepaid.amountKrw / 3)
      : asset.prepaid.amountKrw - usedOf(asset.id)
    : asset.valueKrw,
});

function list() {
  const assets = stored.map(view);
  const sum = assets.reduce((total, asset) => total + (asset.currentValueKrw ?? 0), 0);
  return { assets, totals: { assetsKrw: sum, debtsKrw: 0, netKrw: sum, uncounted: 0 } };
}

function usageApi(url: string, method: string, body: unknown) {
  const match = /assets\/(\d+)\/usages(?:\/(\d+))?/.exec(url)!;
  const assetId = Number(match[1]);
  const entries = (usages[assetId] ??= []);
  if (method === 'GET') return json({ usages: [...entries].reverse() });
  if (method === 'DELETE') {
    usages[assetId] = entries.filter((usage) => usage.id !== Number(match[2]));
    return json(undefined, 204);
  }
  const use = body as Omit<Usage, 'id'>;
  const asset = stored.find((item) => item.id === assetId)!;
  const left = asset.prepaid!.amountKrw - usedOf(assetId);
  if (use.amountKrw > left) {
    return json(
      { error: `잔액보다 많이 쓸 수 없습니다(남은 금액 ${left.toLocaleString('ko-KR')}원)` },
      400,
    );
  }
  const usage = { ...use, id: 100 + entries.length };
  entries.push(usage);
  return json({ usage }, 201);
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
      prepaid: null,
    },
  ];
  usages = {};
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? (JSON.parse(init.body as string) as Omit<Asset, 'id'>) : undefined;
      requests.push({ method, url, body });
      if (url.includes('/usages')) return usageApi(url, method, body);
      if (method === 'GET') return json(list());
      const saved = { ...body!, id: stored.length + 10 };
      stored = [...stored, saved];
      return json({ asset: view(saved) }, 201);
    }),
  );
});

const salon: Asset = {
  id: 6,
  name: '미용실 회원권',
  type: 'prepaid',
  currency: 'KRW',
  quantity: null,
  valueKrw: null,
  valueForeign: null,
  memo: '',
  prepaid: { kind: 'amount', amountKrw: 300000, startsOn: null, expiresOn: '2026-12-31' },
};

const ready = async () => {
  render(<AssetManager />);
  await screen.findByRole('heading', { name: '현금(예적금 포함)' });
};

const summary = (label: string) =>
  within(screen.getByRole('region', { name: '합계' })).getByText(label).nextElementSibling;

test('prepaid is its own type and 기타 no longer mentions it', async () => {
  await ready();
  const options = within(screen.getByLabelText('종류'))
    .getAllByRole('option')
    .map((option) => option.textContent);
  expect(options).toContain('선입금');
  expect(options).toContain('기타(코인 등)');
  expect(options.join()).not.toContain('선입금 등');
});

test('a stored-value prepaid asset is sent with its amount and optional expiry', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: '미용실' } });
  fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'prepaid' } });
  expect(screen.getByRole('radio', { name: '금액권' })).toBeChecked();
  expect(screen.queryByLabelText('시작일')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('평가금액(원)')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('충전액(원)'), { target: { value: '300,000' } });
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  expect(await screen.findByRole('status')).toHaveTextContent('미용실을(를) 추가했습니다');
  expect(requests.find((request) => request.method === 'POST')?.body).toEqual({
    name: '미용실',
    type: 'prepaid',
    currency: 'KRW',
    quantity: null,
    valueKrw: null,
    valueForeign: null,
    memo: '',
    prepaid: { kind: 'amount', amountKrw: 300000, startsOn: null, expiresOn: null },
  });
  expect(
    within(screen.getByRole('list', { name: '선입금' })).getByText(
      '금액권 · 충전액 300,000원 · 사용 0원',
    ),
  ).toBeInTheDocument();
  expect(summary('자산 합계')).toHaveTextContent('5,300,000원');
});

test('a period pass needs a start and an expiry no earlier than the start', async () => {
  await ready();
  const expiry = () => screen.getByLabelText('만료일(이날까지 사용)');
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: '헬스장' } });
  fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'prepaid' } });
  fireEvent.click(screen.getByRole('radio', { name: '기간권' }));
  fireEvent.change(screen.getByLabelText('결제액(원)'), { target: { value: '270000' } });
  fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-03-01' } });
  fireEvent.change(expiry(), { target: { value: '2026-02-28' } });
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  expect(screen.getByRole('alert')).toHaveTextContent('만료일은 시작일과 같거나 뒤여야 합니다');
  expect(expiry()).toHaveAttribute('aria-invalid', 'true');
  expect(requests.some((request) => request.method === 'POST')).toBe(false);

  fireEvent.change(expiry(), { target: { value: '2026-05-31' } });
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  await screen.findByRole('status');
  expect(requests.find((request) => request.method === 'POST')?.body).toMatchObject({
    prepaid: { kind: 'period', amountKrw: 270000, startsOn: '2026-03-01', expiresOn: '2026-05-31' },
  });
  expect(screen.getByText('기간권 · 결제액 270,000원 · 2026-03-01~2026-05-31')).toBeInTheDocument();
  // Only a stored value has uses.
  expect(screen.queryByRole('button', { name: '헬스장 사용 기록' })).not.toBeInTheDocument();
});

test('uses lower a stored value, a use above the balance shows the server message, and a use can be removed', async () => {
  stored.push(salon);
  await ready();
  const toggle = screen.getByRole('button', { name: '미용실 회원권 사용 기록' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const panel = screen.getByRole('region', { name: '미용실 회원권 사용 기록' });
  expect(await within(panel).findByText('아직 사용 기록이 없습니다.')).toBeInTheDocument();

  fireEvent.change(within(panel).getByLabelText('사용한 날짜'), {
    target: { value: '2026-02-01' },
  });
  fireEvent.change(within(panel).getByLabelText('사용 금액(원)'), {
    target: { value: '50,000' },
  });
  fireEvent.change(within(panel).getByLabelText('메모'), { target: { value: '커트' } });
  fireEvent.click(within(panel).getByRole('button', { name: '사용 추가' }));
  expect(await within(panel).findByRole('status')).toHaveTextContent(
    '50,000원 사용을 기록했습니다',
  );
  expect(requests).toContainEqual({
    method: 'POST',
    url: '/api/portfolio/assets/6/usages',
    body: { usedOn: '2026-02-01', amountKrw: 50000, memo: '커트' },
  });
  expect(within(panel).getByText('2026-02-01 · 커트')).toBeInTheDocument();
  // The list and totals follow: 5,000,000 cash + 250,000 left.
  await vi.waitFor(() => expect(summary('자산 합계')).toHaveTextContent('5,250,000원'));
  expect(
    screen.getByText('금액권 · 충전액 300,000원 · 사용 50,000원 · 2026-12-31 만료'),
  ).toBeInTheDocument();

  fireEvent.change(within(panel).getByLabelText('사용 금액(원)'), {
    target: { value: '250001' },
  });
  fireEvent.click(within(panel).getByRole('button', { name: '사용 추가' }));
  expect(await within(panel).findByRole('alert')).toHaveTextContent(
    '잔액보다 많이 쓸 수 없습니다(남은 금액 250,000원)',
  );
  expect(within(panel).getByLabelText('사용 금액(원)')).toHaveAttribute('aria-invalid', 'true');

  fireEvent.click(
    within(panel).getByRole('button', { name: '2026-02-01 50,000원 사용 기록 지우기' }),
  );
  expect(await within(panel).findByText('아직 사용 기록이 없습니다.')).toBeInTheDocument();
  expect(within(panel).getByRole('heading', { name: '미용실 회원권 사용 기록' })).toHaveFocus();
  await vi.waitFor(() => expect(summary('자산 합계')).toHaveTextContent('5,300,000원'));
});

test('a use of 0 won is refused before sending', async () => {
  stored.push(salon);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '미용실 회원권 사용 기록' }));
  const panel = screen.getByRole('region', { name: '미용실 회원권 사용 기록' });
  fireEvent.change(within(panel).getByLabelText('사용 금액(원)'), { target: { value: '0' } });
  fireEvent.click(within(panel).getByRole('button', { name: '사용 추가' }));
  expect(within(panel).getByRole('alert')).toHaveTextContent(
    '사용 금액은 1원 이상의 원 단위 정수로 입력하세요',
  );
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
});

test('editing a prepaid asset fills its kind, amount and dates', async () => {
  stored.push(salon);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '미용실 회원권 수정' }));
  expect(screen.getByRole('radio', { name: '금액권' })).toBeChecked();
  expect(screen.getByLabelText('충전액(원)')).toHaveValue('300000');
  expect(screen.getByLabelText('만료일(선택)')).toHaveValue('2026-12-31');
});
