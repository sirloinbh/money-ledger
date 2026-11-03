import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { CategoryManager } from './categories';

type Category = { id: number; kind: 'income' | 'expense'; name: string; hidden: boolean };

let stored: Category[];
let requests: { method: string; url: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

// A small in-memory version of /api/ledger/categories with the server's duplicate rule.
function fakeApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body: unknown = init.body ? JSON.parse(init.body as string) : undefined;
      requests.push({ method, url, body });
      const taken = (kind: string, name: string, id?: number) =>
        stored.some(
          (category) => category.kind === kind && category.name === name && category.id !== id,
        );
      if (method === 'GET') return json({ categories: stored });
      if (method === 'POST') {
        const { kind, name } = body as Category;
        if (taken(kind, name))
          return json({ error: '같은 종류에 이미 있는 카테고리 이름입니다' }, 409);
        const category = { id: stored.length + 1, kind, name, hidden: false };
        stored = [...stored, category];
        return json({ category }, 201);
      }
      const id = Number(url.split('/').pop());
      const current = stored.find((category) => category.id === id)!;
      const next = { ...current, ...(body as Partial<Category>) };
      if (taken(next.kind, next.name, id))
        return json({ error: '같은 종류에 이미 있는 카테고리 이름입니다' }, 409);
      stored = stored.map((category) => (category.id === id ? next : category));
      return json({ category: next });
    }),
  );
}

beforeEach(() => {
  stored = [
    { id: 1, kind: 'expense', name: '식비', hidden: false },
    { id: 2, kind: 'expense', name: '교통', hidden: true },
    { id: 3, kind: 'income', name: '급여', hidden: false },
  ];
  requests = [];
  fakeApi();
});

const list = (name: string) => screen.findByRole('list', { name });

test('expense and income categories are listed separately and hidden ones are marked', async () => {
  render(<CategoryManager />);
  const expense = await list('지출 카테고리');
  const income = screen.getByRole('list', { name: '수입 카테고리' });
  expect(
    within(expense)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual([expect.stringContaining('식비'), expect.stringContaining('교통숨김')]);
  expect(within(income).getByText('급여')).toBeInTheDocument();
  expect(within(income).queryByText('식비')).not.toBeInTheDocument();
  // Hidden categories are not counted: 식비 of the two expenses, and 급여.
  expect(screen.getAllByText('1개 사용 중')).toHaveLength(2);
});

test('adding a category sends the trimmed name and shows it in its list', async () => {
  render(<CategoryManager />);
  await list('지출 카테고리');
  fireEvent.change(screen.getByLabelText('새 지출 카테고리'), { target: { value: '  반려동물 ' } });
  fireEvent.click(screen.getAllByRole('button', { name: '추가' })[0]);
  expect(await screen.findByRole('status')).toHaveTextContent('반려동물 카테고리를 추가했습니다');
  expect(requests).toContainEqual({
    method: 'POST',
    url: '/api/ledger/categories',
    body: { kind: 'expense', name: '반려동물' },
  });
  expect(
    within(screen.getByRole('list', { name: '지출 카테고리' })).getByText('반려동물'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('새 지출 카테고리')).toHaveValue('');
});

test('a duplicate name shows the server message and keeps the input', async () => {
  render(<CategoryManager />);
  await list('지출 카테고리');
  fireEvent.change(screen.getByLabelText('새 지출 카테고리'), { target: { value: '식비' } });
  fireEvent.click(screen.getAllByRole('button', { name: '추가' })[0]);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '같은 종류에 이미 있는 카테고리 이름입니다',
  );
  expect(screen.getByLabelText('새 지출 카테고리')).toHaveValue('식비');
});

test('the add button is disabled until a name is typed', async () => {
  render(<CategoryManager />);
  await list('지출 카테고리');
  fireEvent.change(screen.getByLabelText('새 수입 카테고리'), { target: { value: '   ' } });
  expect(screen.getAllByRole('button', { name: '추가' })[1]).toBeDisabled();
});

test('hiding and showing again change the category through the API', async () => {
  render(<CategoryManager />);
  await list('지출 카테고리');
  fireEvent.click(screen.getByRole('button', { name: '식비 숨기기' }));
  expect(await screen.findByRole('status')).toHaveTextContent('식비 카테고리를 숨겼습니다');
  expect(requests).toContainEqual({
    method: 'PATCH',
    url: '/api/ledger/categories/1',
    body: { hidden: true },
  });

  fireEvent.click(screen.getByRole('button', { name: '교통 다시 보이기' }));
  expect(await screen.findByText('교통 카테고리를 다시 보이게 했습니다')).toBeInTheDocument();
  expect(requests).toContainEqual({
    method: 'PATCH',
    url: '/api/ledger/categories/2',
    body: { hidden: false },
  });
});

test('renaming saves the new name and cancelling keeps the old one', async () => {
  render(<CategoryManager />);
  await list('지출 카테고리');
  fireEvent.click(screen.getByRole('button', { name: '식비 이름 바꾸기' }));
  fireEvent.change(screen.getByLabelText('식비 새 이름'), { target: { value: '외식' } });
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(screen.getByText('식비')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '식비 이름 바꾸기' }));
  fireEvent.change(screen.getByLabelText('식비 새 이름'), { target: { value: '외식' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    '카테고리 이름을 외식(으)로 바꿨습니다',
  );
  expect(screen.getByRole('button', { name: '외식 숨기기' })).toBeInTheDocument();
});

test('a failure to load is reported as an alert', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
  render(<CategoryManager />);
  expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다');
  expect(screen.queryByText('카테고리를 불러오는 중입니다')).not.toBeInTheDocument();
});
