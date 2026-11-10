import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useSearchParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { EntryManager } from './entries';
import {
  apiQuery,
  monthRange,
  periodLabel,
  readFilters,
  shiftMonth,
  writeFilters,
} from './entry-filters-state';

describe('filter helpers', () => {
  test('a month runs from its first to its last day, leap years included', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  test('months shift across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  test('without a period in the address the list is this month; an empty one is every date', () => {
    expect(readFilters(new URLSearchParams(''), '2026-11-03')).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      kind: '',
      category: '',
      q: '',
      page: 1,
    });
    expect(readFilters(new URLSearchParams('from=&to=&page=x&kind=x'), '2026-11-03')).toEqual({
      from: '',
      to: '',
      kind: '',
      category: '',
      q: '',
      page: 1,
    });
  });

  test('the address keeps an empty period, the API query leaves it out', () => {
    const filters = {
      from: '',
      to: '',
      kind: 'expense',
      category: 'none',
      q: ' 커피 ',
      page: 2,
    } as const;
    expect(writeFilters(filters).toString()).toBe(
      'from=&to=&kind=expense&category=none&q=%EC%BB%A4%ED%94%BC&page=2',
    );
    expect(apiQuery(filters, 50)).toBe(
      'kind=expense&category=none&q=%EC%BB%A4%ED%94%BC&page=2&size=50',
    );
  });

  test('values the server would refuse are dropped from the address', () => {
    const read = (search: string) => readFilters(new URLSearchParams(search), '2026-11-03');
    expect(read('from=2026-13-01&to=2026-11-30&category=abc')).toMatchObject({
      from: '',
      to: '2026-11-30',
      category: '',
    });
    expect(read('from=2026-02-30&to=0999-01-01&category=none')).toMatchObject({
      from: '',
      to: '',
      category: 'none',
    });
    // A start after the end: back to this month.
    expect(read('from=2026-11-30&to=2026-11-01')).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-30',
    });
  });

  test('a whole month is named by its month, other periods by their dates', () => {
    expect(periodLabel({ from: '2026-11-01', to: '2026-11-30' })).toBe('2026년 11월');
    expect(periodLabel({ from: '2026-11-01', to: '2026-11-15' })).toBe('2026-11-01 ~ 2026-11-15');
    expect(periodLabel({ from: '2026-11-01', to: '' })).toBe('2026-11-01부터');
    expect(periodLabel({ from: '', to: '' })).toBe('전체 기간');
  });
});

const entry = (id: number, date: string) => ({
  id,
  date,
  kind: 'expense',
  amount: 1000 * id,
  categoryId: 1,
  categoryName: '식비',
  merchant: '',
  memo: `내역 ${id}`,
});

let listUrls: string[];
let answer: (url: string) => Promise<Response>;
// Saves and deletes; `log` records list loads and writes in the order they finish.
let write: (url: string, init: RequestInit) => Promise<Response>;
let log: string[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T15:30:00Z')); // 2026-11-03 in Seoul
  listUrls = [];
  log = [];
  write = () => json({ entry: entry(9, '2026-11-03') }, 201);
  answer = () => json({ entries: [entry(1, '2026-11-02')], total: 1, page: 1, pageSize: 50 });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      if ((init.method ?? 'GET') !== 'GET') {
        return write(url, init).then((response) => {
          log.push(`${init.method} done`);
          return response;
        });
      }
      if (url === '/api/ledger/categories') {
        return json({
          categories: [
            { id: 1, kind: 'expense', name: '식비', hidden: false },
            { id: 2, kind: 'expense', name: '여가', hidden: true },
            { id: 3, kind: 'income', name: '급여', hidden: false },
          ],
        });
      }
      listUrls.push(url);
      return answer(url).then((response) => {
        log.push(`GET ${new URL(url, 'http://x').searchParams.get('from')}`);
        return response;
      });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function Address() {
  const location = useLocation();
  return <output aria-label="주소">{location.search}</output>;
}

const show = async (path = '/ledger') => {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <EntryManager />
      <Address />
    </MemoryRouter>,
  );
  // The filter's category choices are loaded: more than 전체 and 미분류.
  await vi.waitFor(() =>
    expect(
      within(screen.getByLabelText('카테고리', { selector: '#filter-category' })).getAllByRole(
        'option',
      ).length,
    ).toBeGreaterThan(2),
  );
  return view;
};
const lastList = () => listUrls.at(-1);
const address = () => screen.getByLabelText('주소').textContent;

test('the list starts on this month in Seoul', async () => {
  await show();
  await screen.findByRole('list', { name: '내역 목록' });
  expect(lastList()).toBe('/api/ledger/entries?from=2026-11-01&to=2026-11-30&page=1&size=50');
  expect(screen.getByText('2026년 11월')).toBeInTheDocument();
  expect(screen.getByText('1건')).toBeInTheDocument();
});

test('applied filters go to the address and the request, and survive a reload', async () => {
  const first = await show();
  fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-10-15' } });
  fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-11-15' } });
  fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'expense' } });
  fireEvent.change(screen.getByLabelText('카테고리', { selector: '#filter-category' }), {
    target: { value: '1' },
  });
  fireEvent.change(screen.getByLabelText('검색어'), { target: { value: '점심' } });
  fireEvent.click(screen.getByRole('button', { name: '조회' }));

  await vi.waitFor(() =>
    expect(lastList()).toBe(
      `/api/ledger/entries?from=2026-10-15&to=2026-11-15&kind=expense&category=1&q=${encodeURIComponent('점심')}&page=1&size=50`,
    ),
  );
  const saved = address();
  expect(saved).toContain('from=2026-10-15');

  // A reload: the same address shows the same filters and asks for the same list.
  first.unmount();
  listUrls = [];
  await show(`/ledger${saved}`);
  expect(screen.getByLabelText('시작일')).toHaveValue('2026-10-15');
  expect(screen.getByLabelText('검색어')).toHaveValue('점심');
  expect(screen.getByLabelText('카테고리', { selector: '#filter-category' })).toHaveValue('1');
  expect(screen.getByText('2026-10-15 ~ 2026-11-15')).toBeInTheDocument();
  await vi.waitFor(() =>
    expect(lastList()).toContain('from=2026-10-15&to=2026-11-15&kind=expense'),
  );
});

test('choosing a kind drops a category of the other kind and offers only its own', async () => {
  await show();
  const category = screen.getByLabelText('카테고리', { selector: '#filter-category' });
  fireEvent.change(category, { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'expense' } });
  expect(category).toHaveValue('');
  expect(
    within(category)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['전체', '미분류', '식비', '여가 (숨김)']);
});

test('a start after the end is refused before any request', async () => {
  await show();
  await screen.findByRole('list', { name: '내역 목록' });
  const before = listUrls.length;
  fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-11-20' } });
  fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-11-10' } });
  fireEvent.click(screen.getByRole('button', { name: '조회' }));
  expect(screen.getByRole('alert')).toHaveTextContent('시작일이 종료일보다 늦습니다');
  expect(screen.getByLabelText('시작일')).toHaveAttribute('aria-invalid', 'true');
  expect(listUrls.length).toBe(before);
});

test('the month buttons move by whole months and keep the other filters', async () => {
  await show('/ledger?from=2026-01-01&to=2026-01-31&kind=income');
  fireEvent.click(screen.getByRole('button', { name: '이전 달' }));
  await screen.findByText('2025년 12월');
  expect(lastList()).toBe(
    '/api/ledger/entries?from=2025-12-01&to=2025-12-31&kind=income&page=1&size=50',
  );
  fireEvent.click(screen.getByRole('button', { name: '이번 달' }));
  await screen.findByText('2026년 11월');
  fireEvent.click(screen.getByRole('button', { name: '초기화' }));
  await vi.waitFor(() => expect(address()).toBe('?from=2026-11-01&to=2026-11-30'));
});

test('pages: the count, the page number and the next page', async () => {
  answer = (url) => {
    const page = Number(new URL(url, 'http://x').searchParams.get('page'));
    return json({ entries: [entry(page, '2026-11-02')], total: 120, page, pageSize: 50 });
  };
  await show();
  expect(await screen.findByText('1 / 3쪽')).toBeInTheDocument();
  expect(screen.getByText('120건')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '이전 쪽' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(screen.getByRole('button', { name: '다음 쪽' }));
  expect(await screen.findByText('2 / 3쪽')).toBeInTheDocument();
  expect(lastList()).toContain('&page=2&size=50');
  expect(address()).toContain('page=2');
  // Changing a filter starts again on the first page.
  fireEvent.click(screen.getByRole('button', { name: '조회' }));
  expect(await screen.findByText('1 / 3쪽')).toBeInTheDocument();
});

test('no match and a failed load each say so; a failed load can be retried', async () => {
  answer = () => json({ entries: [], total: 0, page: 1, pageSize: 50 });
  await show();
  expect(await screen.findByText('조건에 맞는 내역이 없습니다.')).toBeInTheDocument();

  answer = () => json({ error: '시작일이 종료일보다 늦습니다' }, 400);
  fireEvent.click(screen.getByRole('button', { name: '이전 달' }));
  expect(await screen.findByText('내역을 불러오지 못했습니다.')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('시작일이 종료일보다 늦습니다');

  answer = () => json({ entries: [entry(4, '2026-10-02')], total: 1, page: 1, pageSize: 50 });
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByRole('list', { name: '내역 목록' })).toHaveTextContent('내역 4');
});

test('an older answer that arrives last does not replace the list for the current filters', async () => {
  let finishOctober: () => void = () => {};
  answer = (url) => {
    if (url.includes('from=2026-10-01')) {
      return new Promise((resolve) => {
        finishOctober = () =>
          resolve(new Response(JSON.stringify({ entries: [entry(10, '2026-10-02')], total: 1 })));
      });
    }
    return json({ entries: [entry(11, '2026-11-02')], total: 1 });
  };
  await show();
  await screen.findByText('내역 11');
  fireEvent.click(screen.getByRole('button', { name: '이전 달' }));
  await vi.waitFor(() => expect(lastList()).toContain('from=2026-10-01'));
  fireEvent.click(screen.getByRole('button', { name: '이번 달' }));
  await vi.waitFor(() => expect(lastList()).toContain('from=2026-11-01'));
  await screen.findByText('1건');
  finishOctober();
  await vi.waitFor(() => expect(log).toContain('GET 2026-10-01'));
  expect(screen.getByRole('list', { name: '내역 목록' })).toHaveTextContent('내역 11');
  expect(screen.queryByText('내역 10')).not.toBeInTheDocument();
});

test('a save that ends after the filters changed reloads the new list, after the save', async () => {
  let finishSave: () => void = () => {};
  write = () =>
    new Promise((resolve) => {
      finishSave = () =>
        resolve(new Response(JSON.stringify({ entry: entry(9, '2026-11-03') }), { status: 201 }));
    });
  await show();
  fireEvent.change(screen.getByLabelText('금액(원)'), { target: { value: '9000' } });
  fireEvent.click(screen.getByRole('button', { name: '기록' }));
  fireEvent.click(screen.getByRole('button', { name: '다음 달' }));
  await vi.waitFor(() => expect(log).toContain('GET 2026-12-01'));
  finishSave();
  await screen.findByText('지출 9,000원을 기록했습니다');
  // The last load is of December and comes after the save.
  expect(log.slice(log.indexOf('POST done'))).toContain('GET 2026-12-01');
  expect(lastList()).toContain('from=2026-12-01');
});

test('changing the page keeps the page buttons, and focus, while the next page loads', async () => {
  let finishPage2: () => void = () => {};
  answer = (url) => {
    const page = Number(new URL(url, 'http://x').searchParams.get('page'));
    if (page === 2) {
      return new Promise((resolve) => {
        finishPage2 = () =>
          resolve(new Response(JSON.stringify({ entries: [entry(2, '2026-11-01')], total: 60 })));
      });
    }
    return json({ entries: [entry(1, '2026-11-02')], total: 60 });
  };
  await show();
  const next = await screen.findByRole('button', { name: '다음 쪽' });
  next.focus();
  fireEvent.click(next);
  expect(await screen.findByText('불러오는 중…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '다음 쪽' })).toHaveFocus();
  finishPage2();
  expect(await screen.findByText('2 / 2쪽')).toBeInTheDocument();
  // The last page: unavailable but still focused.
  expect(screen.getByRole('button', { name: '다음 쪽' })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('button', { name: '다음 쪽' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: '다음 쪽' }));
  expect(address()).toContain('page=2');
});

test('a page past the end goes to the last page', async () => {
  answer = (url) => {
    const page = Number(new URL(url, 'http://x').searchParams.get('page'));
    return json({ entries: page > 1 ? [] : [entry(1, '2026-11-02')], total: 50 });
  };
  await show('/ledger?from=2026-11-01&to=2026-11-30&page=2');
  await vi.waitFor(() => expect(address()).toBe('?from=2026-11-01&to=2026-11-30'));
  expect(await screen.findByText('50건')).toBeInTheDocument();
});

test('a category the filter cannot offer is dropped from the address', async () => {
  await show('/ledger?from=2026-11-01&to=2026-11-30&kind=income&category=1');
  await vi.waitFor(() => expect(address()).toBe('?from=2026-11-01&to=2026-11-30&kind=income'));
  expect(screen.getByLabelText('카테고리', { selector: '#filter-category' })).toHaveValue('');
  expect(lastList()).not.toContain('category=');
});

test('a load started before a save that answers last does not hide the saved entry', async () => {
  let finishSave: () => void = () => {};
  write = () =>
    new Promise((resolve) => {
      finishSave = () =>
        resolve(new Response(JSON.stringify({ entry: entry(9, '2026-12-01') }), { status: 201 }));
    });
  let finishBefore: () => void = () => {};
  let decemberLoads = 0;
  answer = (url) => {
    if (!url.includes('from=2026-12-01')) return json({ entries: [], total: 0 });
    decemberLoads += 1;
    if (decemberLoads === 1) {
      // Read before the save committed: without the new entry, and it answers last.
      return new Promise((resolve) => {
        finishBefore = () => resolve(new Response(JSON.stringify({ entries: [], total: 0 })));
      });
    }
    return json({ entries: [entry(9, '2026-12-01')], total: 1 });
  };
  await show();
  fireEvent.change(screen.getByLabelText('금액(원)'), { target: { value: '9000' } });
  fireEvent.click(screen.getByRole('button', { name: '기록' }));
  fireEvent.click(screen.getByRole('button', { name: '다음 달' }));
  await vi.waitFor(() => expect(decemberLoads).toBe(1));
  finishSave();
  await screen.findByText('내역 9');
  finishBefore();
  await vi.waitFor(() => expect(log.filter((line) => line === 'GET 2026-12-01')).toHaveLength(2));
  expect(screen.getByRole('list', { name: '내역 목록' })).toHaveTextContent('내역 9');
});

test('a failed page load keeps the page buttons, and focus, next to the message', async () => {
  answer = (url) => {
    const page = Number(new URL(url, 'http://x').searchParams.get('page'));
    return page === 2
      ? json({ error: '서버 오류' }, 500)
      : json({ entries: [entry(1, '2026-11-02')], total: 60 });
  };
  await show();
  const next = await screen.findByRole('button', { name: '다음 쪽' });
  next.focus();
  fireEvent.click(next);
  expect(await screen.findByText('내역을 불러오지 못했습니다.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '다음 쪽' })).toHaveFocus();
  expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
});

test('applying filters keeps the summary month (#40) in the address', async () => {
  await show('/ledger?month=2026-09');
  fireEvent.change(screen.getByLabelText('검색어'), { target: { value: '점심' } });
  fireEvent.click(screen.getByRole('button', { name: '조회' }));
  await vi.waitFor(() => expect(address()).toContain('q='));
  expect(new URLSearchParams(address()).get('month')).toBe('2026-09');
  expect(
    writeFilters(
      readFilters(new URLSearchParams(''), '2026-11-03'),
      new URLSearchParams('month=2026-09&page=3'),
    ).toString(),
  ).toBe('month=2026-09&from=2026-11-01&to=2026-11-30');
});

function MonthButton() {
  const [, setSearchParams] = useSearchParams();
  return (
    <button
      type="button"
      onClick={() =>
        setSearchParams((prev) => {
          const params = new URLSearchParams(prev);
          params.set('month', '2026-09');
          return params;
        })
      }
    >
      요약 달 바꾸기
    </button>
  );
}

test('changing the summary month (#40) keeps what is typed in the filter form', async () => {
  render(
    <MemoryRouter initialEntries={['/ledger']}>
      <EntryManager />
      <MonthButton />
      <Address />
    </MemoryRouter>,
  );
  await screen.findByRole('list', { name: '내역 목록' });
  fireEvent.change(screen.getByLabelText('검색어'), { target: { value: '점심' } });
  fireEvent.change(screen.getByLabelText('종류'), { target: { value: 'income' } });
  const loads = listUrls.length;
  fireEvent.click(screen.getByRole('button', { name: '요약 달 바꾸기' }));
  await vi.waitFor(() => expect(address()).toContain('month=2026-09'));
  expect(screen.getByLabelText('검색어')).toHaveValue('점심');
  expect(screen.getByLabelText('종류')).toHaveValue('income');
  // The list does not reload for a key that is not a filter.
  expect(listUrls.length).toBe(loads);
});
