import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { EntryManager } from './entries';

type Entry = {
  id: number;
  date: string;
  kind: 'income' | 'expense';
  amount: number;
  categoryId: number;
  categoryName: string;
  memo: string;
};

const categories = [
  { id: 1, kind: 'expense', name: '식비', hidden: false },
  { id: 2, kind: 'expense', name: '여가', hidden: true },
  { id: 3, kind: 'income', name: '급여', hidden: false },
];

let stored: Entry[];
let requests: { method: string; url: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status }),
  );

// A small in-memory /api/ledger/entries (newest first) and a fixed category list.
function fakeApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body
        ? (JSON.parse(init.body as string) as Omit<Entry, 'id' | 'categoryName'>)
        : undefined;
      requests.push({ method, url, body });
      if (url === '/api/ledger/categories') return json({ categories });
      if (method === 'GET')
        return json({ entries: [...stored].sort((a, b) => b.date.localeCompare(a.date)) });
      const id = Number(url.split('/').pop());
      if (method === 'DELETE') {
        stored = stored.filter((entry) => entry.id !== id);
        return json(undefined, 204);
      }
      const name = categories.find((category) => category.id === body!.categoryId)!.name;
      if (method === 'POST') {
        const entry = { ...body!, id: stored.length + 10, categoryName: name };
        stored = [...stored, entry];
        return json({ entry }, 201);
      }
      const entry = { ...body!, id, categoryName: name };
      stored = stored.map((current) => (current.id === id ? entry : current));
      return json({ entry });
    }),
  );
}

beforeEach(() => {
  // 2026-11-03 00:30 in Seoul is still 2026-11-02 in UTC.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T15:30:00Z'));
  stored = [
    {
      id: 1,
      date: '2026-11-01',
      kind: 'expense',
      amount: 5000,
      categoryId: 2,
      categoryName: '여가',
      memo: '영화',
    },
  ];
  requests = [];
  fakeApi();
});

afterEach(() => {
  vi.useRealTimers();
});

const optionLabels = () =>
  within(screen.getByLabelText('카테고리'))
    .getAllByRole('option')
    .map((option) => option.textContent);

const ready = async () => {
  render(<EntryManager />);
  await screen.findByRole('list', { name: '최근 내역' });
  await screen.findByRole('option', { name: '식비' });
};

test('a new entry starts on today in Seoul and offers only visible categories of its kind', async () => {
  await ready();
  expect(screen.getByLabelText('날짜')).toHaveValue('2026-11-03');
  expect(screen.getByRole('radio', { name: '지출' })).toBeChecked();
  expect(optionLabels()).toEqual(['고르세요', '식비']);

  fireEvent.click(screen.getByRole('radio', { name: '수입' }));
  expect(optionLabels()).toEqual(['고르세요', '급여']);
});

test('recording sends whole won, keeps the date and kind, and lists the entry', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('금액(원)'), { target: { value: '12,500' } });
  fireEvent.change(screen.getByLabelText('카테고리'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('메모'), { target: { value: '점심' } });
  fireEvent.click(screen.getByRole('button', { name: '기록' }));

  expect(await screen.findByRole('status')).toHaveTextContent('지출 12,500원을 기록했습니다');
  expect(requests).toContainEqual({
    method: 'POST',
    url: '/api/ledger/entries',
    body: { date: '2026-11-03', kind: 'expense', amount: 12500, categoryId: 1, memo: '점심' },
  });
  expect(screen.getByLabelText('금액(원)')).toHaveValue('');
  expect(screen.getByLabelText('메모')).toHaveValue('');
  expect(screen.getByLabelText('날짜')).toHaveValue('2026-11-03');
  const first = within(screen.getByRole('list', { name: '최근 내역' })).getAllByRole('listitem')[0];
  expect(first).toHaveTextContent('2026-11-03');
  expect(first).toHaveTextContent('-12,500원');
});

test.each(['-1', '1.5', '만원', ''])(
  'the amount "%s" is refused before sending',
  async (amount) => {
    await ready();
    fireEvent.change(screen.getByLabelText('금액(원)'), { target: { value: amount } });
    fireEvent.change(screen.getByLabelText('카테고리'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '기록' }));
    expect(screen.getByRole('alert')).toHaveTextContent('금액은 0원 이상의 정수로 입력하세요');
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
  },
);

test('an entry without a category is refused before sending', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('금액(원)'), { target: { value: '1000' } });
  fireEvent.click(screen.getByRole('button', { name: '기록' }));
  expect(screen.getByRole('alert')).toHaveTextContent('카테고리를 고르세요');
});

test('a server refusal shows its Korean message and keeps the input', async () => {
  await ready();
  vi.mocked(fetch).mockImplementationOnce(() => json({ error: '없는 날짜입니다' }, 400));
  fireEvent.change(screen.getByLabelText('금액(원)'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('카테고리'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: '기록' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('없는 날짜입니다');
  expect(screen.getByLabelText('금액(원)')).toHaveValue('1000');
});

test('editing fills the form, keeps the hidden category it has, and saves with PUT', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '2026-11-01 여가 5,000원 수정' }));
  expect(screen.getByRole('heading', { name: '내역 수정' })).toBeInTheDocument();
  expect(screen.getByLabelText('날짜')).toHaveValue('2026-11-01');
  expect(screen.getByLabelText('금액(원)')).toHaveValue('5000');
  expect(optionLabels()).toEqual(['고르세요', '식비', '여가 (숨김)']);
  expect(screen.getByLabelText('카테고리')).toHaveValue('2');

  fireEvent.change(screen.getByLabelText('금액(원)'), { target: { value: '7000' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  expect(await screen.findByRole('status')).toHaveTextContent('내역을 수정했습니다');
  expect(requests).toContainEqual({
    method: 'PUT',
    url: '/api/ledger/entries/1',
    body: { date: '2026-11-01', kind: 'expense', amount: 7000, categoryId: 2, memo: '영화' },
  });
  expect(screen.getByRole('heading', { name: '새 내역' })).toBeInTheDocument();
  expect(screen.getByLabelText('날짜')).toHaveValue('2026-11-03');
});

test('cancelling an edit goes back to an empty new entry', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '2026-11-01 여가 5,000원 수정' }));
  fireEvent.click(screen.getByRole('button', { name: '수정 취소' }));
  expect(screen.getByRole('heading', { name: '새 내역' })).toBeInTheDocument();
  expect(screen.getByLabelText('금액(원)')).toHaveValue('');
  expect(optionLabels()).toEqual(['고르세요', '식비']);
});

test('deleting asks first, then removes the entry', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '2026-11-01 여가 5,000원 삭제' }));
  const dialog = screen.getByRole('dialog', { name: '내역을 삭제할까요?' });
  expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
  fireEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
  expect(await screen.findByText('아직 기록한 내역이 없습니다.')).toBeInTheDocument();
  expect(requests).toContainEqual({
    method: 'DELETE',
    url: '/api/ledger/entries/1',
    body: undefined,
  });
  expect(screen.getByRole('status')).toHaveTextContent('내역을 삭제했습니다');
});

test('a new categories version reloads the category choices', async () => {
  const { rerender } = render(<EntryManager categoriesVersion={0} />);
  await screen.findByRole('option', { name: '식비' });
  categories[0] = { ...categories[0], hidden: true };
  try {
    rerender(<EntryManager categoriesVersion={1} />);
    await vi.waitFor(() => expect(optionLabels()).toEqual(['고르세요']));
  } finally {
    categories[0] = { ...categories[0], hidden: false };
  }
});

test('opening an edit moves focus to the date field of the form', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '2026-11-01 여가 5,000원 수정' }));
  expect(screen.getByLabelText('날짜')).toHaveFocus();
});

test('a refused field is marked invalid and points at the message', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('금액(원)'), { target: { value: '-5' } });
  fireEvent.click(screen.getByRole('button', { name: '기록' }));
  const amount = screen.getByLabelText('금액(원)');
  expect(amount).toHaveAttribute('aria-invalid', 'true');
  expect(amount).toHaveAccessibleDescription('금액은 0원 이상의 정수로 입력하세요');
  fireEvent.change(amount, { target: { value: '5' } });
  expect(amount).not.toHaveAttribute('aria-invalid');
});

test('while a save runs, edit and cancel wait and the button says so', async () => {
  await ready();
  let finish = () => {};
  const api = vi.mocked(fetch);
  const real = api.getMockImplementation()!;
  api.mockImplementationOnce(
    (url, init) =>
      new Promise((resolve) => {
        finish = () => resolve(real(url, init));
      }),
  );
  fireEvent.change(screen.getByLabelText('금액(원)'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('카테고리'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: '기록' }));
  expect(await screen.findByRole('button', { name: '저장 중…' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: '2026-11-01 여가 5,000원 수정' }));
  expect(screen.getByRole('heading', { name: '새 내역' })).toBeInTheDocument();

  finish();
  expect(await screen.findByRole('status')).toHaveTextContent('지출 1,000원을 기록했습니다');
  expect(screen.getByRole('button', { name: '기록' })).toBeInTheDocument();
});

test('a category change reloads the list, and a chosen category hidden meanwhile is unchosen', async () => {
  const { rerender } = render(<EntryManager categoriesVersion={0} />);
  await screen.findByRole('option', { name: '식비' });
  fireEvent.change(screen.getByLabelText('카테고리'), { target: { value: '1' } });
  const listLoads = () =>
    requests.filter((request) => request.method === 'GET' && request.url === '/api/ledger/entries')
      .length;
  const before = listLoads();

  categories[0] = { ...categories[0], hidden: true };
  try {
    rerender(<EntryManager categoriesVersion={1} />);
    await vi.waitFor(() => expect(optionLabels()).toEqual(['고르세요']));
    expect(listLoads()).toBe(before + 1);
    expect(screen.getByLabelText('카테고리')).toHaveValue('');

    fireEvent.change(screen.getByLabelText('금액(원)'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: '기록' }));
    expect(screen.getByRole('alert')).toHaveTextContent('카테고리를 고르세요');
    expect(screen.getByLabelText('카테고리')).toHaveAttribute('aria-invalid', 'true');
  } finally {
    categories[0] = { ...categories[0], hidden: false };
  }
});
