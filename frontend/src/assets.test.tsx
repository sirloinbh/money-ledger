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
};

let stored: Asset[];
let requests: { method: string; url: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status }),
  );

// Totals the way the server does: won values only, debts apart.
function totals() {
  const sum = (debt: boolean) =>
    stored
      .filter((asset) => (asset.type === 'debt') === debt)
      .reduce((total, asset) => total + (asset.valueKrw ?? 0), 0);
  return {
    assetsKrw: sum(false),
    debtsKrw: sum(true),
    netKrw: sum(false) - sum(true),
    uncounted: stored.filter((asset) => asset.valueKrw === null).length,
  };
}

function fakeApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? (JSON.parse(init.body as string) as Omit<Asset, 'id'>) : undefined;
      requests.push({ method, url, body });
      if (method === 'GET') return json({ assets: stored, totals: totals() });
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
      return json({ asset: saved }, method === 'POST' ? 201 : 200);
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
