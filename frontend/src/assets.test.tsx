import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { AssetManager } from './assets';

type Asset = {
  id: number;
  name: string;
  type: string;
  currency: 'KRW' | 'USD';
  quantity: string | null;
  valueKrw: number | null;
  valueForeign: string | null;
  memo: string;
  depreciation?: {
    purchasePriceKrw: number;
    purchasedOn: string;
    usefulLifeMonths: number;
    salvageValueKrw: number;
  } | null;
};

let stored: Asset[];
let requests: { method: string; url: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status }),
  );

// The server works out a depreciated value from the date; the fake says it is half the purchase price.
const withCurrent = (asset: Asset) => ({
  ...asset,
  depreciation: asset.depreciation ?? null,
  prepaid: null,
  currentValueKrw: asset.depreciation ? asset.depreciation.purchasePriceKrw / 2 : asset.valueKrw,
});

// Totals the way the server does: current won values only, debts apart.
function totals() {
  const valued = stored.map(withCurrent);
  const sum = (debt: boolean) =>
    valued
      .filter((asset) => (asset.type === 'debt') === debt)
      .reduce((total, asset) => total + (asset.currentValueKrw ?? 0), 0);
  return {
    assetsKrw: sum(false),
    debtsKrw: sum(true),
    netKrw: sum(false) - sum(true),
    uncounted: valued.filter((asset) => asset.currentValueKrw === null).length,
  };
}

function fakeApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? (JSON.parse(init.body as string) as Omit<Asset, 'id'>) : undefined;
      requests.push({ method, url, body });
      if (method === 'GET') return json({ assets: stored.map(withCurrent), totals: totals() });
      const id = Number(url.split('/').pop());
      if (method === 'DELETE') {
        stored = stored.filter((asset) => asset.id !== id);
        return json(undefined, 204);
      }
      const saved = { ...body!, id: method === 'POST' ? stored.length + 10 : id };
      stored =
        method === 'POST'
          ? [...stored, saved]
          : stored.map((asset) => (asset.id === id ? saved : asset));
      return json({ asset: withCurrent(saved) }, method === 'POST' ? 201 : 200);
    }),
  );
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
    },
    {
      id: 2,
      name: '전세 대출',
      type: 'debt',
      currency: 'KRW',
      quantity: null,
      valueKrw: 7000000,
      valueForeign: null,
      memo: '',
    },
    {
      id: 3,
      name: '애플',
      type: 'stock',
      currency: 'USD',
      quantity: '1.50000000',
      valueKrw: null,
      valueForeign: null,
      memo: '해외',
    },
  ];
  requests = [];
  fakeApi();
});

const ready = async () => {
  render(<AssetManager />);
  await screen.findByRole('heading', { name: '현금(예적금 포함)' });
};

const summary = (label: string) =>
  within(screen.getByRole('region', { name: '합계' })).getByText(label).nextElementSibling;

test('assets are grouped by type and debts are totalled apart from assets', async () => {
  await ready();
  expect(summary('자산 합계')).toHaveTextContent('5,000,000원');
  expect(summary('부채 합계')).toHaveTextContent('7,000,000원');
  expect(summary('순자산')).toHaveTextContent('-2,000,000원');
  expect(screen.getByText(/원화 평가금액이 없는 1개/)).toBeInTheDocument();
  const stocks = screen.getByRole('list', { name: '주식(ETF·펀드 포함)' });
  expect(within(stocks).getByText('USD · 수량 1.5 · 해외')).toBeInTheDocument();
  expect(within(stocks).getByText('평가금액 없음')).toBeInTheDocument();
  expect(
    within(screen.getByRole('list', { name: '부채' })).getByText('7,000,000원'),
  ).toBeInTheDocument();
});

test('a won asset is added with its value as a whole number', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: ' 아파트 ' } });
  fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'real_estate' } });
  fireEvent.change(screen.getByLabelText('평가금액(원)'), { target: { value: '300,000,000' } });
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  expect(await screen.findByRole('status')).toHaveTextContent('아파트을(를) 추가했습니다');
  expect(requests).toContainEqual({
    method: 'POST',
    url: '/api/portfolio/assets',
    body: {
      name: '아파트',
      type: 'real_estate',
      currency: 'KRW',
      quantity: null,
      valueKrw: 300000000,
      valueForeign: null,
      memo: '',
    },
  });
  expect(summary('자산 합계')).toHaveTextContent('305,000,000원');
  expect(screen.getByLabelText('이름')).toHaveValue('');
});

test('a USD asset with a quantity sends decimal strings', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: '테슬라' } });
  fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'stock' } });
  fireEvent.click(screen.getByRole('radio', { name: '달러(USD)' }));
  fireEvent.change(screen.getByLabelText('수량(선택)'), { target: { value: '0.25' } });
  fireEvent.change(screen.getByLabelText('평가금액(달러)'), { target: { value: '1,234.56' } });
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  await screen.findByRole('status');
  expect(requests.find((request) => request.method === 'POST')?.body).toMatchObject({
    currency: 'USD',
    quantity: '0.25',
    valueKrw: null,
    valueForeign: '1234.56',
  });
  expect(screen.getByText('1,234.56달러')).toBeInTheDocument();
});

test.each([
  { label: 'no name', fill: { 평가금액: '1' }, field: '이름', message: '자산 이름을 입력하세요' },
  {
    label: 'neither quantity nor value',
    fill: { 이름: '현금' },
    field: '평가금액(원)',
    message: '수량이 없는 자산은 평가금액을 입력하세요',
  },
  {
    label: 'a fractional won value',
    fill: { 이름: '현금', 평가금액: '10.5' },
    field: '평가금액(원)',
    message: '원화 평가금액은 0 이상의 원 단위 정수로 입력하세요',
  },
  {
    label: 'a comma that is not a thousands separator',
    fill: { 이름: '현금', 평가금액: '1,2,3' },
    field: '평가금액(원)',
    message: '원화 평가금액은 0 이상의 원 단위 정수로 입력하세요',
  },
  {
    label: 'a value over 1,000조 won',
    fill: { 이름: '현금', 평가금액: '1000000000000001' },
    field: '평가금액(원)',
    message: '평가금액은 1,000조 원 이하로 입력하세요',
  },
  {
    label: 'a zero quantity',
    fill: { 이름: '현금', 수량: '0' },
    field: '수량(선택)',
    message: '수량은 0보다 큰 수로, 소수 8자리까지 입력하세요',
  },
])('$label is refused before sending and marks the field', async ({ fill, field, message }) => {
  await ready();
  const labels: Record<string, string> = {
    이름: '이름',
    평가금액: '평가금액(원)',
    수량: '수량(선택)',
  };
  for (const [key, value] of Object.entries(fill)) {
    fireEvent.change(screen.getByLabelText(labels[key]), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(screen.getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
});

test('a debt has no quantity field and asks for the amount still owed', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'debt' } });
  expect(screen.queryByLabelText('수량(선택)')).not.toBeInTheDocument();
  expect(screen.getByLabelText('남은 금액(원)')).toBeInTheDocument();
});

test('editing fills the form, moves focus to it, and saves with PUT', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '애플 수정' }));
  expect(screen.getByLabelText('이름')).toHaveFocus();
  expect(screen.getByLabelText('수량(선택)')).toHaveValue('1.5');
  expect(screen.getByRole('radio', { name: '달러(USD)' })).toBeChecked();
  fireEvent.change(screen.getByLabelText('평가금액(달러)'), { target: { value: '300' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  expect(await screen.findByRole('status')).toHaveTextContent('애플을(를) 수정했습니다');
  expect(requests).toContainEqual({
    method: 'PUT',
    url: '/api/portfolio/assets/3',
    body: {
      name: '애플',
      type: 'stock',
      currency: 'USD',
      quantity: '1.5',
      valueKrw: null,
      valueForeign: '300',
      memo: '해외',
    },
  });
  expect(screen.getByRole('heading', { name: '새 자산' })).toBeInTheDocument();
});

test('deleting asks first, then removes the asset and moves focus to the list title', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '전세 대출 삭제' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '삭제' }));
  expect(await screen.findByText('전세 대출을(를) 삭제했습니다')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: '부채' })).not.toBeInTheDocument();
  expect(summary('순자산')).toHaveTextContent('5,000,000원');
  await vi.waitFor(() =>
    expect(screen.getByRole('heading', { name: '보유 자산과 부채' })).toHaveFocus(),
  );
});

test('a server refusal shows its Korean message', async () => {
  await ready();
  vi.mocked(fetch).mockImplementationOnce(() =>
    json({ error: '달러 자산의 평가금액은 달러로 입력하세요' }, 400),
  );
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: '현금' } });
  fireEvent.change(screen.getByLabelText('평가금액(원)'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '달러 자산의 평가금액은 달러로 입력하세요',
  );
  expect(screen.getByLabelText('이름')).toHaveValue('현금');
});

test('cancelling an edit keeps focus in the form and a USD value round-trips', async () => {
  stored[2] = { ...stored[2], valueForeign: '1234.5000' };
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '애플 수정' }));
  expect(screen.getByLabelText('평가금액(달러)')).toHaveValue('1234.5');
  fireEvent.click(screen.getByRole('button', { name: '수정 취소' }));
  expect(screen.getByLabelText('이름')).toHaveFocus();
  expect(screen.getByLabelText('이름')).toHaveValue('');
});

// #63
test('a depreciating asset is entered as a purchase price, date and useful life', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: '노트북' } });
  fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'depreciable' } });
  expect(screen.queryByLabelText('평가금액(원)')).not.toBeInTheDocument();
  expect(screen.queryByRole('radio', { name: '달러(USD)' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('잔존 가치(원)')).toHaveValue('0'); // decision: 0 won by default
  fireEvent.change(screen.getByLabelText('구입가(원)'), { target: { value: '1,200,000' } });
  fireEvent.change(screen.getByLabelText('구입일'), { target: { value: '2026-01-15' } });
  fireEvent.change(screen.getByLabelText('기본 사용 기간'), { target: { value: '60' } });
  expect(screen.getByLabelText('사용 기간(개월)')).toHaveValue('60');
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  expect(await screen.findByRole('status')).toHaveTextContent('노트북을(를) 추가했습니다');
  expect(requests).toContainEqual({
    method: 'POST',
    url: '/api/portfolio/assets',
    body: {
      name: '노트북',
      type: 'depreciable',
      currency: 'KRW',
      quantity: null,
      valueKrw: null,
      valueForeign: null,
      memo: '',
      depreciation: {
        purchasePriceKrw: 1200000,
        purchasedOn: '2026-01-15',
        usefulLifeMonths: 60,
        salvageValueKrw: 0,
      },
    },
  });
  const list = screen.getByRole('list', { name: '감가상각 대상' });
  expect(
    within(list).getByText('구입가 1,200,000원 · 2026-01-15 구입 · 사용 기간 60개월'),
  ).toBeInTheDocument();
  expect(within(list).getByText('600,000원')).toBeInTheDocument(); // the current value from the server
  expect(summary('자산 합계')).toHaveTextContent('5,600,000원');
});

test('the useful life presets are 10, 5 and 7 years and the months can be changed', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'depreciable' } });
  const preset = screen.getByLabelText('기본 사용 기간');
  expect(
    within(preset)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['직접 입력', '침대(10년)', '컴퓨터(5년)', '가전제품(7년)']);
  fireEvent.change(preset, { target: { value: '84' } });
  expect(screen.getByLabelText('사용 기간(개월)')).toHaveValue('84');
  fireEvent.change(screen.getByLabelText('사용 기간(개월)'), { target: { value: '90' } });
  expect(preset).toHaveValue('');
});

test.each([
  {
    label: 'no purchase price',
    fill: { 구입일: '2026-01-01', 기간: '60' },
    field: '구입가(원)',
    message: '구입가는 1,000조 원 이하의 원 단위 정수로 입력하세요',
  },
  {
    label: 'no purchase date',
    fill: { 구입가: '1000', 기간: '60' },
    field: '구입일',
    message: '구입일을 입력하세요',
  },
  {
    label: 'a useful life of 0 months',
    fill: { 구입가: '1000', 구입일: '2026-01-01', 기간: '0' },
    field: '사용 기간(개월)',
    message: '사용 기간은 1~1200개월 사이의 정수로 입력하세요',
  },
  {
    label: 'a salvage value above the price',
    fill: { 구입가: '1000', 구입일: '2026-01-01', 기간: '60', 잔존: '1001' },
    field: '잔존 가치(원)',
    message: '잔존 가치는 구입가보다 클 수 없습니다',
  },
])(
  'a depreciating asset with $label is refused before sending',
  async ({ fill, field, message }) => {
    await ready();
    const labels: Record<string, string> = {
      구입가: '구입가(원)',
      구입일: '구입일',
      기간: '사용 기간(개월)',
      잔존: '잔존 가치(원)',
    };
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '침대' } });
    fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'depreciable' } });
    for (const [key, value] of Object.entries(fill)) {
      fireEvent.change(screen.getByLabelText(labels[key]), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
  },
);

test('a purchase date outside 1900–2100 is not sent', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: '침대' } });
  fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'depreciable' } });
  fireEvent.change(screen.getByLabelText('구입가(원)'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('사용 기간(개월)'), { target: { value: '60' } });
  const date = screen.getByLabelText<HTMLInputElement>('구입일');
  expect(date).toHaveAttribute('min', '1900-01-01');
  expect(date).toHaveAttribute('max', '2100-12-31');
  fireEvent.change(date, { target: { value: '0201-01-01' } });
  // The browser's range check stops the submit first.
  expect(date.validity.rangeUnderflow).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  // Our own check covers a submit that skips the browser's (the same range as the server).
  fireEvent.submit(screen.getByRole('form', { name: '새 자산' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    '구입일은 1900년부터 2100년 사이로 입력하세요',
  );
  expect(date).toHaveAttribute('aria-invalid', 'true');
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
});

test('editing a #45 depreciable row offers its value as the purchase price', async () => {
  stored.push({
    id: 5,
    name: '옛 TV',
    type: 'depreciable',
    currency: 'KRW',
    quantity: null,
    valueKrw: 700000,
    valueForeign: null,
    memo: '',
  });
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '옛 TV 수정' }));
  expect(screen.getByLabelText('구입가(원)')).toHaveValue('700000');
  expect(screen.getByLabelText('구입일')).toHaveValue('');
});

test('editing a depreciating asset fills its schedule', async () => {
  stored.push({
    id: 4,
    name: '침대',
    type: 'depreciable',
    currency: 'KRW',
    quantity: null,
    valueKrw: null,
    valueForeign: null,
    memo: '',
    depreciation: {
      purchasePriceKrw: 2000000,
      purchasedOn: '2025-03-01',
      usefulLifeMonths: 120,
      salvageValueKrw: 100000,
    },
  });
  await ready();
  expect(screen.getByText(/· 잔존 가치 100,000원$/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '침대 수정' }));
  expect(screen.getByLabelText('구입가(원)')).toHaveValue('2000000');
  expect(screen.getByLabelText('구입일')).toHaveValue('2025-03-01');
  expect(screen.getByLabelText('기본 사용 기간')).toHaveValue('120');
  expect(screen.getByLabelText('잔존 가치(원)')).toHaveValue('100000');
});

test('a total too large to show says so instead of a wrong number', async () => {
  const api = vi.mocked(fetch);
  api.mockImplementationOnce(() =>
    json({
      assets: stored.map(withCurrent),
      totals: { assetsKrw: null, debtsKrw: 7000000, netKrw: null, uncounted: 1 },
    }),
  );
  await ready();
  expect(summary('자산 합계')).toHaveTextContent('너무 커서 표시할 수 없음');
  expect(summary('부채 합계')).toHaveTextContent('7,000,000원');
  expect(summary('순자산')).toHaveTextContent('너무 커서 표시할 수 없음');
});
