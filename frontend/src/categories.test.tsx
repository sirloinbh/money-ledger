import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { App } from './app';

type Category = { id: number; kind: string; name: string; hidden: boolean };
type Sent = { path: string; method: string; body: unknown };

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const defaults: Category[] = [
  { id: 1, kind: 'expense', name: '식비', hidden: false },
  { id: 2, kind: 'expense', name: '옛 항목', hidden: true },
  { id: 3, kind: 'income', name: '급여', hidden: false },
];

// A small stand-in for the API. `fail` answers the next write with an error.
function api(start: Category[] = defaults, options: { loadError?: boolean } = {}) {
  const state = {
    items: [...start],
    sent: [] as Sent[],
    fail: undefined as { status: number; error: string } | undefined,
    loadError: options.loadError ?? false,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      if (path === '/api/health') return json({ today: '2026-11-02' });
      if (method === 'GET') {
        if (state.loadError) return json({ error: '서버 오류가 발생했습니다' }, 500);
        return json({ categories: state.items });
      }
      const body = JSON.parse(String(init.body)) as Partial<Category>;
      state.sent.push({ path, method, body });
      if (state.fail) return json({ error: state.fail.error }, state.fail.status);
      if (method === 'POST') {
        const category = { id: 100, hidden: false, ...body } as Category;
        state.items.push(category);
        return json({ category }, 201);
      }
      const id = Number(path.split('/').pop());
      const category = { ...state.items.find((item) => item.id === id)!, ...body };
      state.items = state.items.map((item) => (item.id === id ? category : item));
      return json({ category });
    }),
  );
  return state;
}

async function open() {
  window.history.replaceState(null, '', '/ledger/categories');
  render(<App />);
  await screen.findByRole('heading', { level: 2, name: '지출' });
}

const group = (label: string) =>
  screen
    .getByRole('heading', { level: 2, name: label })
    .closest<HTMLElement>('[data-slot="card"]')!;

test('asks for hidden categories too and shows them marked, grouped by kind', async () => {
  api();
  await open();
  expect(vi.mocked(fetch)).toHaveBeenCalledWith(
    '/api/categories?includeHidden=true',
    expect.anything(),
  );
  const expense = within(group('지출'));
  expect(expense.getByText('식비')).toBeInTheDocument();
  expect(expense.getByText('옛 항목')).toBeInTheDocument();
  expect(expense.getByText('숨김')).toBeInTheDocument();
  expect(expense.queryByText('급여')).not.toBeInTheDocument();
  expect(within(group('수입')).getByText('급여')).toBeInTheDocument();
  expect(within(group('수입')).queryByText('숨김')).not.toBeInTheDocument();
});

test('the ledger page links to the categories and back', async () => {
  api();
  window.history.replaceState(null, '', '/ledger');
  render(<App />);
  fireEvent.click(await screen.findByRole('link', { name: '카테고리 관리' }));
  expect(await screen.findByRole('heading', { level: 1, name: '카테고리' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/ledger/categories');
  expect(
    within(screen.getByRole('navigation', { name: '주 메뉴' })).getByRole('link', {
      name: '가계부',
    }),
  ).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('link', { name: '가계부로 돌아가기' }));
  expect(await screen.findByRole('heading', { level: 1, name: '가계부' })).toBeInTheDocument();
});

test('adding sends the kind of its group, lists the category and clears the field', async () => {
  const state = api();
  await open();
  const income = within(group('수입'));
  const field = income.getByLabelText('새 수입 카테고리');
  fireEvent.change(field, { target: { value: '부수입' } });
  fireEvent.click(income.getByRole('button', { name: '수입 카테고리 추가' }));
  expect(await income.findByText('부수입')).toBeInTheDocument();
  expect(state.sent).toEqual([
    { path: '/api/categories', method: 'POST', body: { kind: 'income', name: '부수입' } },
  ]);
  expect(field).toHaveValue('');
  expect(await screen.findByText('카테고리를 추가했습니다: 부수입')).toBeInTheDocument();
});

test('a duplicate name shows the server message and keeps what was typed', async () => {
  const state = api();
  state.fail = { status: 409, error: '같은 종류에 같은 이름의 카테고리가 있습니다' };
  await open();
  const expense = within(group('지출'));
  const field = expense.getByLabelText('새 지출 카테고리');
  fireEvent.change(field, { target: { value: '식비' } });
  fireEvent.click(expense.getByRole('button', { name: '지출 카테고리 추가' }));
  expect(
    await screen.findByText('같은 종류에 같은 이름의 카테고리가 있습니다'),
  ).toBeInTheDocument();
  expect(field).toHaveValue('식비');
});

test('renaming saves the new name and returns focus to the edit button', async () => {
  const state = api();
  await open();
  const expense = within(group('지출'));
  fireEvent.click(expense.getByRole('button', { name: '식비 이름 수정' }));
  const field = expense.getByLabelText('식비 새 이름');
  expect(field).toHaveFocus();
  fireEvent.change(field, { target: { value: '외식' } });
  fireEvent.click(expense.getByRole('button', { name: '저장' }));
  expect(await expense.findByText('외식')).toBeInTheDocument();
  expect(state.sent).toEqual([
    { path: '/api/categories/1', method: 'PATCH', body: { name: '외식' } },
  ]);
  expect(expense.getByRole('button', { name: '외식 이름 수정' })).toHaveFocus();
});

test('a refused rename stays open with the typed name and the error', async () => {
  const state = api();
  state.fail = { status: 409, error: '같은 종류에 같은 이름의 카테고리가 있습니다' };
  await open();
  const expense = within(group('지출'));
  fireEvent.click(expense.getByRole('button', { name: '식비 이름 수정' }));
  const field = expense.getByLabelText('식비 새 이름');
  fireEvent.change(field, { target: { value: '옛 항목' } });
  fireEvent.click(expense.getByRole('button', { name: '저장' }));
  expect(
    await screen.findByText('같은 종류에 같은 이름의 카테고리가 있습니다'),
  ).toBeInTheDocument();
  expect(field).toHaveValue('옛 항목');
});

test('Escape cancels a rename without sending anything', async () => {
  const state = api();
  await open();
  const expense = within(group('지출'));
  fireEvent.click(expense.getByRole('button', { name: '식비 이름 수정' }));
  const field = expense.getByLabelText('식비 새 이름');
  fireEvent.change(field, { target: { value: '바뀐 이름' } });
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(expense.getByText('식비')).toBeInTheDocument();
  expect(expense.getByRole('button', { name: '식비 이름 수정' })).toHaveFocus();
  expect(state.sent).toEqual([]);
});

test('hiding and showing again update the row', async () => {
  const state = api();
  await open();
  const expense = within(group('지출'));
  fireEvent.click(expense.getByRole('button', { name: '식비 숨기기' }));
  fireEvent.click(await expense.findByRole('button', { name: '식비 다시 표시' }));
  await expense.findByRole('button', { name: '식비 숨기기' });
  expect(state.sent).toEqual([
    { path: '/api/categories/1', method: 'PATCH', body: { hidden: true } },
    { path: '/api/categories/1', method: 'PATCH', body: { hidden: false } },
  ]);
});

test('a pending request keeps focus on the button and ignores a second press', async () => {
  const state = api();
  await open();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const answer = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (...args) => {
    await gate;
    return answer(...args);
  });
  const expense = within(group('지출'));
  const hide = expense.getByRole('button', { name: '식비 숨기기' });
  hide.focus();
  fireEvent.click(hide);
  await waitFor(() => expect(hide).toHaveAttribute('aria-disabled', 'true'));
  expect(hide).toBeEnabled();
  expect(hide).toHaveFocus();
  expect(within(hide).getByRole('status', { name: '저장하는 중' })).toBeInTheDocument();
  fireEvent.click(hide);
  release();
  await expense.findByRole('button', { name: '식비 다시 표시' });
  expect(state.sent).toHaveLength(1);
});

test('a kind with no categories says so', async () => {
  api([{ id: 1, kind: 'expense', name: '식비', hidden: false }]);
  await open();
  expect(within(group('수입')).getByText('아직 카테고리가 없습니다.')).toBeInTheDocument();
});

test('a failed load shows the error and can be retried', async () => {
  const state = api(defaults, { loadError: true });
  window.history.replaceState(null, '', '/ledger/categories');
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('서버 오류가 발생했습니다');
  state.loadError = false;
  const retry = screen.getByRole('button', { name: '다시 불러오기' });
  retry.focus();
  fireEvent.click(retry);
  await screen.findByRole('heading', { level: 2, name: '지출' });
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.getByLabelText('카테고리 목록')).toHaveFocus();
});

test('Escape and cancel wait while a rename is being saved', async () => {
  const state = api();
  await open();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const answer = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (...args) => {
    await gate;
    return answer(...args);
  });
  const expense = within(group('지출'));
  fireEvent.click(expense.getByRole('button', { name: '식비 이름 수정' }));
  const field = expense.getByLabelText('식비 새 이름');
  fireEvent.change(field, { target: { value: '외식' } });
  fireEvent.click(expense.getByRole('button', { name: '저장' }));
  const cancel = expense.getByRole('button', { name: '취소' });
  await waitFor(() => expect(cancel).toHaveAttribute('aria-disabled', 'true'));
  fireEvent.keyDown(field, { key: 'Escape' });
  fireEvent.click(cancel);
  expect(field).toBeInTheDocument();
  release();
  expect(await expense.findByText('외식')).toBeInTheDocument();
  expect(expense.getByRole('button', { name: '외식 이름 수정' })).toHaveFocus();
  expect(state.sent).toHaveLength(1);
});
