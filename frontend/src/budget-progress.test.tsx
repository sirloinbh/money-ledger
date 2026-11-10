import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { BudgetProgress } from './budget-progress';

const base = { hidden: false, remaining: null, over: null, percent: null };
const november = {
  month: '2026-11',
  budgets: [
    {
      ...base,
      categoryId: 1,
      name: '식비',
      spent: 337500,
      budget: 300000,
      budgetMonth: '2026-11',
      remaining: 0,
      over: 37500,
      percent: '112.5',
    },
    {
      ...base,
      categoryId: 3,
      name: '주거',
      spent: 1000,
      budget: 80000,
      budgetMonth: '2026-08',
      remaining: 79000,
      over: 0,
      percent: '1.3',
    },
    { ...base, categoryId: 4, name: '통신', spent: 12000, budget: null, budgetMonth: null },
    {
      ...base,
      categoryId: 7,
      name: '여가',
      hidden: true,
      spent: 7000,
      budget: null,
      budgetMonth: null,
    },
  ],
};

type Call = { url: string; method: string; body?: unknown };
let calls: Call[];
let answer: (call: Call) => Promise<Response>;
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T15:30:00Z')); // 2026-11-03 in Seoul
  calls = [];
  answer = (call) =>
    call.method === 'PUT'
      ? json({ budget: call.body })
      : json(call.url.endsWith('2026-11') ? november : { month: '2026-10', budgets: [] });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const call = {
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      return answer(call);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

/** A link-like button that moves the summary month, as the monthly summary does. */
function GoMonth({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(`/ledger?month=${to}`)}>
      {to}로
    </button>
  );
}

const show = (path = '/ledger', version = 0) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <BudgetProgress version={version} />
      <GoMonth to="2026-10" />
    </MemoryRouter>,
  );
const row = (name: string) =>
  screen.getByRole('button', { name: `${name} 예산 수정` }).closest('li') as HTMLElement;
const gets = () => calls.filter((call) => call.method === 'GET').map((call) => call.url);

test('the summary month: over, under and unset budgets, each said in words', async () => {
  show();
  await screen.findByText('카테고리별 예산');
  await screen.findByRole('button', { name: '식비 예산 수정' });
  expect(gets()).toEqual(['/api/ledger/budgets?month=2026-11']);
  expect(screen.getByText('2026년 11월 기준')).toBeInTheDocument();

  // Over: the excess in words next to an icon, in the error color, and a full red bar.
  const food = row('식비');
  expect(food).toHaveTextContent('337,500원 / 300,000원');
  const excess = within(food).getByText('37,500원 초과 (112.5%)');
  expect(excess).toHaveClass('text-destructive');
  expect(excess.querySelector('svg')).not.toBeNull();
  const foodBar = food.querySelector('[aria-hidden="true"] > div') as HTMLElement;
  expect(foodBar).toHaveClass('bg-destructive');
  expect(foodBar.style.width).toBe('100%');

  // Under: what is left, and the month the budget carries on from.
  const housing = row('주거');
  expect(housing).toHaveTextContent('1,000원 / 80,000원');
  expect(within(housing).getByText('79,000원 남음 (1.3%)')).toBeInTheDocument();
  expect(within(housing).getByText('2026년 8월에 정한 예산')).toBeInTheDocument();
  const housingBar = housing.querySelector('[aria-hidden="true"] > div') as HTMLElement;
  expect(housingBar.style.width).toBe('1.3%');
  expect(housingBar).not.toHaveClass('bg-destructive');

  // No budget: 미설정 instead of a progress bar.
  const phone = row('통신');
  expect(within(phone).getByText('미설정')).toBeInTheDocument();
  expect(phone).toHaveTextContent('지출 12,000원 · 예산을 정하면 진행률이 보입니다');
  expect(phone.querySelector('[aria-hidden="true"] > div')).toBeNull();
  expect(row('여가')).toHaveTextContent('여가 (숨김)');
});

test('the month in the address, and another month reloads and closes an open form', async () => {
  show('/ledger?month=2026-11');
  fireEvent.click(await screen.findByRole('button', { name: '식비 예산 수정' }));
  expect(screen.getByLabelText('식비 예산(원)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '2026-10로' }));
  expect(await screen.findByText('지출 카테고리가 없습니다.')).toBeInTheDocument();
  expect(gets()).toEqual([
    '/api/ledger/budgets?month=2026-11',
    '/api/ledger/budgets?month=2026-10',
  ]);
  expect(screen.getByText('2026년 10월 기준')).toBeInTheDocument();
  expect(screen.queryByLabelText('식비 예산(원)')).not.toBeInTheDocument();
});

test('수정 saves the budget from this month on, with thousands commas, then reloads', async () => {
  show();
  const edit = await screen.findByRole('button', { name: '식비 예산 수정' });
  fireEvent.click(edit);
  const input = screen.getByLabelText('식비 예산(원)');
  expect(input).toHaveValue('300000');
  await vi.waitFor(() => expect(input).toHaveFocus());
  expect(
    screen.getByText('2026년 11월부터 적용됩니다. 비우거나 0이면 미설정입니다.'),
  ).toBeInTheDocument();

  fireEvent.change(input, { target: { value: '350,000' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(
    await screen.findByText('식비 예산을 2026년 11월부터 350,000원으로 정했습니다'),
  ).toBeInTheDocument();
  expect(calls.find((call) => call.method === 'PUT')).toEqual({
    url: '/api/ledger/budgets/1',
    method: 'PUT',
    body: { month: '2026-11', amount: 350000 },
  });
  await vi.waitFor(() => expect(gets()).toHaveLength(2));
  expect(screen.queryByLabelText('식비 예산(원)')).not.toBeInTheDocument();
  await vi.waitFor(() =>
    expect(screen.getByRole('button', { name: '식비 예산 수정' })).toHaveFocus(),
  );
});

test('an empty field saves 0: no budget from this month on', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: '주거 예산 수정' }));
  fireEvent.change(screen.getByLabelText('주거 예산(원)'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(
    await screen.findByText('주거 예산을 2026년 11월부터 미설정으로 바꿨습니다'),
  ).toBeInTheDocument();
  expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
    month: '2026-11',
    amount: 0,
  });
});

test('a budget that is not a whole number is refused before any request', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: '통신 예산 수정' }));
  const input = screen.getByLabelText('통신 예산(원)');
  expect(input).toHaveValue('');
  for (const value of ['12.5', '-100', '1만', '1,00']) {
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(screen.getByRole('alert')).toHaveTextContent('예산은 0원 이상의 정수로 입력하세요');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  }
  expect(calls.some((call) => call.method === 'PUT')).toBe(false);
});

test('a failed save says why and keeps the form with what was typed', async () => {
  answer = (call) =>
    call.method === 'PUT'
      ? json({ error: '지출 카테고리를 찾을 수 없습니다' }, 404)
      : json(november);
  show();
  fireEvent.click(await screen.findByRole('button', { name: '식비 예산 수정' }));
  fireEvent.change(screen.getByLabelText('식비 예산(원)'), { target: { value: '1000' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('지출 카테고리를 찾을 수 없습니다');
  expect(screen.getByLabelText('식비 예산(원)')).toHaveValue('1000');
});

test('취소 closes the form without saving and returns the focus', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: '식비 예산 수정' }));
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(screen.queryByLabelText('식비 예산(원)')).not.toBeInTheDocument();
  await vi.waitFor(() =>
    expect(screen.getByRole('button', { name: '식비 예산 수정' })).toHaveFocus(),
  );
  expect(calls.some((call) => call.method === 'PUT')).toBe(false);
});

test('a failed load says so, and 다시 시도 loads it again', async () => {
  answer = () => json({ error: '서버 오류' }, 500);
  show();
  expect(await screen.findByText('예산을 불러오지 못했습니다.')).toBeInTheDocument();
  answer = () => json(november);
  fireEvent.click(screen.getByRole('button', { name: '예산 다시 시도' }));
  expect(screen.getByRole('heading', { name: '카테고리별 예산' })).toHaveFocus();
  expect(await screen.findByRole('button', { name: '식비 예산 수정' })).toBeInTheDocument();
});

test('a change elsewhere (version) reloads the same month', async () => {
  const { rerender } = show();
  await screen.findByRole('button', { name: '식비 예산 수정' });
  rerender(
    <MemoryRouter initialEntries={['/ledger']}>
      <BudgetProgress version={1} />
      <GoMonth to="2026-10" />
    </MemoryRouter>,
  );
  await vi.waitFor(() => expect(gets()).toHaveLength(2));
  expect(gets()[1]).toBe(gets()[0]);
});

test('a save that ends after the summary moved to another month reloads that month', async () => {
  let finish: (value: Response) => void = () => undefined;
  answer = (call) =>
    call.method === 'PUT'
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : json(call.url.endsWith('2026-11') ? november : { month: '2026-10', budgets: [] });
  show();
  fireEvent.click(await screen.findByRole('button', { name: '식비 예산 수정' }));
  fireEvent.change(screen.getByLabelText('식비 예산(원)'), { target: { value: '1000' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  fireEvent.click(screen.getByRole('button', { name: '2026-10로' }));
  expect(await screen.findByText('지출 카테고리가 없습니다.')).toBeInTheDocument();

  finish(new Response(JSON.stringify({ budget: {} })));
  await vi.waitFor(() => expect(gets()).toHaveLength(3));
  expect(gets()[2]).toBe('/api/ledger/budgets?month=2026-10');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByText('2026년 10월 기준')).toBeInTheDocument();
  expect(screen.getByText('지출 카테고리가 없습니다.')).toBeInTheDocument();
  expect(
    screen
      .getByRole('heading', { name: '카테고리별 예산' })
      .closest('section')!
      .querySelector('[aria-busy]'),
  ).toBeNull();
});

test('a row that is no longer listed after the save gives the focus to the title', async () => {
  let saved = false;
  answer = (call) => {
    if (call.method === 'PUT') {
      saved = true;
      return json({ budget: call.body });
    }
    // A hidden category listed only for its budget: unset, it is left out.
    return json(
      saved
        ? { ...november, budgets: november.budgets.filter((budget) => budget.name !== '통신') }
        : november,
    );
  };
  show();
  fireEvent.click(await screen.findByRole('button', { name: '통신 예산 수정' }));
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  await vi.waitFor(() =>
    expect(screen.queryByRole('button', { name: '통신 예산 수정' })).not.toBeInTheDocument(),
  );
  await vi.waitFor(() =>
    expect(screen.getByRole('heading', { name: '카테고리별 예산' })).toHaveFocus(),
  );
});

test('a save that ends late leaves another row being edited alone, and the focus where it is', async () => {
  let finish: (value: Response) => void = () => undefined;
  answer = (call) =>
    call.method === 'PUT'
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : json(november);
  show();
  fireEvent.click(await screen.findByRole('button', { name: '식비 예산 수정' }));
  fireEvent.change(screen.getByLabelText('식비 예산(원)'), { target: { value: '1000' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  // While the save is on its way, another row is opened and typed in.
  fireEvent.click(screen.getByRole('button', { name: '주거 예산 수정' }));
  const other = screen.getByLabelText('주거 예산(원)');
  fireEvent.change(other, { target: { value: '90000' } });
  await vi.waitFor(() => expect(other).toHaveFocus());

  finish(new Response(JSON.stringify({ budget: {} })));
  expect(
    await screen.findByText('식비 예산을 2026년 11월부터 1,000원으로 정했습니다'),
  ).toBeInTheDocument();
  await vi.waitFor(() => expect(gets()).toHaveLength(2));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.getByLabelText('주거 예산(원)')).toHaveValue('90000');
  expect(screen.getByLabelText('주거 예산(원)')).toHaveFocus();
});

test('a save that ends after a month change leaves the focus on what was pressed', async () => {
  let finish: (value: Response) => void = () => undefined;
  answer = (call) =>
    call.method === 'PUT'
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : json(call.url.endsWith('2026-11') ? november : { month: '2026-10', budgets: [] });
  show();
  fireEvent.click(await screen.findByRole('button', { name: '식비 예산 수정' }));
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  const monthButton = screen.getByRole('button', { name: '2026-10로' });
  monthButton.focus();
  fireEvent.click(monthButton);
  await screen.findByText('지출 카테고리가 없습니다.');
  finish(new Response(JSON.stringify({ budget: {} })));
  await vi.waitFor(() => expect(gets()).toHaveLength(3));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(monthButton).toHaveFocus();
});

test('while another month loads, the dimmed rows of the last one cannot be edited', async () => {
  let october: (value: Response) => void = () => undefined;
  answer = (call) =>
    call.url.endsWith('2026-11')
      ? json(november)
      : new Promise<Response>((resolve) => {
          october = resolve;
        });
  show();
  await screen.findByRole('button', { name: '식비 예산 수정' });
  fireEvent.click(screen.getByRole('button', { name: '2026-10로' }));
  await vi.waitFor(() => expect(screen.getByText('2026년 10월 기준')).toBeInTheDocument());
  // November's rows stay dimmed until October arrives: no 수정, and their own month in the labels.
  expect(screen.getByRole('button', { name: '식비 예산 수정' })).toBeDisabled();
  expect(screen.getByText('2026년 8월에 정한 예산')).toBeInTheDocument();
  expect(screen.queryByText('2026년 11월에 정한 예산')).not.toBeInTheDocument();
  october(new Response(JSON.stringify({ month: '2026-10', budgets: [] })));
  expect(await screen.findByText('지출 카테고리가 없습니다.')).toBeInTheDocument();
});

test('an error about a form goes away with the form when the month changes', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: '식비 예산 수정' }));
  fireEvent.change(screen.getByLabelText('식비 예산(원)'), { target: { value: 'abc' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(screen.getByRole('alert')).toHaveTextContent('예산은 0원 이상의 정수로 입력하세요');
  fireEvent.click(screen.getByRole('button', { name: '2026-10로' }));
  await screen.findByText('지출 카테고리가 없습니다.');
  expect(screen.queryByText('예산은 0원 이상의 정수로 입력하세요')).not.toBeInTheDocument();
});
