import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { RuleManager, UncategorizedEntries } from './classification';

type Entry = {
  id: number;
  date: string;
  kind: 'income' | 'expense';
  amount: number;
  categoryId: number | null;
  merchant: string;
  memo: string;
};
type Rule = { id: number; keyword: string; kind: 'income' | 'expense'; categoryId: number };

const categories = [
  { id: 1, kind: 'expense', name: '식비', hidden: false },
  { id: 2, kind: 'expense', name: '생활', hidden: false },
  { id: 3, kind: 'income', name: '급여', hidden: false },
];
const nameOf = (id: number) => categories.find((category) => category.id === id)!.name;

let entries: Entry[];
let rules: Rule[];
let requests: { method: string; url: string; body: unknown }[];
let failNext: { status: number; error: string } | undefined;

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status }),
  );

// An in-memory ledger: uncategorized list, classify (with remember), apply-rules and rules.
function fakeApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : undefined;
      requests.push({ method, url, body });
      if (method !== 'GET' && failNext) {
        const { status, error } = failNext;
        failNext = undefined;
        return json({ error }, status);
      }
      if (url.startsWith('/api/ledger/categories')) return json({ categories });
      if (url === '/api/ledger/entries?uncategorized=true') {
        return json({ entries: entries.filter((entry) => entry.categoryId === null) });
      }
      if (url === '/api/ledger/entries/classify') {
        const ids = body!.entryIds as number[];
        const categoryId = body!.categoryId as number;
        const hit = entries.filter((entry) => ids.includes(entry.id) && entry.categoryId === null);
        hit.forEach((entry) => (entry.categoryId = categoryId));
        const merchants = [...new Set(hit.map((entry) => entry.merchant).filter(Boolean))];
        if (body!.remember) {
          merchants.forEach((keyword) =>
            rules.push({ id: rules.length + 1, keyword, kind: 'expense', categoryId }),
          );
        }
        return json({
          classified: hit.length,
          skipped: ids.length - hit.length,
          rulesSaved: body!.remember ? merchants.length : 0,
        });
      }
      if (url === '/api/ledger/entries/apply-rules') {
        let classified = 0;
        for (const entry of entries.filter((item) => item.categoryId === null)) {
          const rule = rules.find((item) => entry.merchant.includes(item.keyword));
          if (rule) {
            entry.categoryId = rule.categoryId;
            classified += 1;
          }
        }
        return json({ classified });
      }
      if (url === '/api/ledger/rules' && method === 'GET') {
        return json({
          rules: rules.map((rule) => ({
            ...rule,
            categoryName: nameOf(rule.categoryId),
            categoryHidden: false,
          })),
        });
      }
      if (url === '/api/ledger/rules' && method === 'POST') {
        const categoryId = body!.categoryId as number;
        const rule = {
          id: rules.length + 1,
          keyword: body!.keyword as string,
          kind: 'expense' as const,
          categoryId,
        };
        rules.push(rule);
        return json({ rule }, 201);
      }
      if (method === 'DELETE') {
        const id = Number(url.split('/').pop());
        rules = rules.filter((rule) => rule.id !== id);
        return json(undefined, 204);
      }
      return json({ error: 'unexpected request' }, 500);
    }),
  );
}

const entry = (id: number, merchant: string, kind: 'income' | 'expense' = 'expense'): Entry => ({
  id,
  date: '2026-11-05',
  kind,
  amount: 1000 * id,
  categoryId: null,
  merchant,
  memo: '',
});

beforeEach(() => {
  entries = [entry(1, '김밥천국'), entry(2, '김밥천국'), entry(3, ''), entry(4, '회사', 'income')];
  rules = [];
  requests = [];
  failNext = undefined;
  fakeApi();
});

const posts = () => requests.filter((request) => request.method === 'POST');
const row = (text: string) =>
  within(screen.getByRole('list', { name: '미분류 내역' }))
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(text))!;

test('selected entries are classified at once and their merchant is remembered', async () => {
  const onChange = vi.fn();
  render(<UncategorizedEntries onChange={onChange} />);
  expect(await screen.findByRole('heading', { name: '미분류 내역 (4건)' })).toBeInTheDocument();
  await screen.findByRole('option', { name: '식비' });

  fireEvent.click(within(row('1,000원')).getByRole('checkbox'));
  fireEvent.click(within(row('2,000원')).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('분류할 카테고리'), { target: { value: '1' } });
  expect(screen.getByRole('checkbox', { name: /규칙으로 저장/ })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '선택한 2건 분류' }));

  expect(await screen.findByRole('status')).toHaveTextContent(
    '2건을 식비(으)로 분류했습니다. 가맹점 1개를 규칙으로 저장했습니다',
  );
  expect(posts()).toEqual([
    {
      method: 'POST',
      url: '/api/ledger/entries/classify',
      body: { entryIds: [1, 2], categoryId: 1, remember: true },
    },
  ]);
  expect(onChange).toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: '미분류 내역 (2건)' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '선택한 0건 분류' })).toBeInTheDocument();
});

test('without remember no rule is asked for', async () => {
  render(<UncategorizedEntries />);
  await screen.findByRole('option', { name: '식비' });
  fireEvent.click(within(row('3,000원')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('checkbox', { name: /규칙으로 저장/ }));
  fireEvent.change(screen.getByLabelText('분류할 카테고리'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: '선택한 1건 분류' }));
  await screen.findByRole('status');
  expect(posts()[0].body).toEqual({ entryIds: [3], categoryId: 2, remember: false });
});

test.each([
  { label: 'no entry', pick: [], category: '1', message: '분류할 내역을 고르세요' },
  { label: 'no category', pick: ['1,000원'], category: '', message: '카테고리를 고르세요' },
  {
    label: 'an income entry with an expense category',
    pick: ['1,000원', '4,000원'],
    category: '1',
    message: '고른 카테고리와 종류가 다른 내역이 있습니다',
  },
])('classifying with $label is refused before sending', async ({ pick, category, message }) => {
  render(<UncategorizedEntries />);
  await screen.findByRole('option', { name: '식비' });
  for (const text of pick) fireEvent.click(within(row(text)).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('분류할 카테고리'), { target: { value: category } });
  fireEvent.click(screen.getByRole('button', { name: /건 분류$/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(posts()).toEqual([]);
});

test('select all picks every uncategorized entry', async () => {
  render(<UncategorizedEntries />);
  await screen.findByRole('heading', { name: '미분류 내역 (4건)' });
  fireEvent.click(screen.getByRole('checkbox', { name: '전체 선택' }));
  expect(screen.getByRole('button', { name: '선택한 4건 분류' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: '전체 선택' }));
  expect(screen.getByRole('button', { name: '선택한 0건 분류' })).toBeInTheDocument();
});

test('applying rules reports how many were classified and focus survives an emptied list', async () => {
  rules = [{ id: 1, keyword: '김밥', kind: 'expense', categoryId: 1 }];
  entries = [entry(1, '김밥천국')];
  render(<UncategorizedEntries />);
  const apply = await screen.findByRole('button', { name: '규칙으로 다시 분류' });
  apply.focus();
  fireEvent.click(apply);
  expect(await screen.findByRole('status')).toHaveTextContent('1건을 규칙으로 분류했습니다');
  expect(screen.getByText('미분류 내역이 없습니다.')).toBeInTheDocument();
  await vi.waitFor(() =>
    expect(screen.getByRole('heading', { name: '미분류 내역' })).toHaveFocus(),
  );
});

test('applying rules with nothing to match says so', async () => {
  render(<UncategorizedEntries />);
  fireEvent.click(await screen.findByRole('button', { name: '규칙으로 다시 분류' }));
  expect(await screen.findByRole('status')).toHaveTextContent('규칙에 맞는 미분류 내역이 없습니다');
});

test('a server refusal of the classification is shown', async () => {
  render(<UncategorizedEntries />);
  await screen.findByRole('option', { name: '식비' });
  fireEvent.click(within(row('1,000원')).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('분류할 카테고리'), { target: { value: '1' } });
  failNext = { status: 400, error: '숨긴 카테고리로는 분류할 수 없습니다' };
  fireEvent.click(screen.getByRole('button', { name: '선택한 1건 분류' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '숨긴 카테고리로는 분류할 수 없습니다',
  );
  expect(screen.getByRole('heading', { name: '미분류 내역 (4건)' })).toBeInTheDocument();
});

test('a rule is added with its category and listed', async () => {
  const onChange = vi.fn();
  render(<RuleManager onChange={onChange} />);
  expect(await screen.findByText('아직 분류 규칙이 없습니다.')).toBeInTheDocument();
  await screen.findByRole('option', { name: '식비' });
  fireEvent.change(screen.getByLabelText('키워드'), { target: { value: ' 스타벅스 ' } });
  fireEvent.change(screen.getByLabelText('카테고리'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: '규칙 추가' }));

  expect(await screen.findByRole('status')).toHaveTextContent("'스타벅스' 규칙을 추가했습니다");
  expect(posts()[0].body).toEqual({ keyword: '스타벅스', categoryId: 1 });
  expect(onChange).toHaveBeenCalled();
  const list = screen.getByRole('list', { name: '분류 규칙 목록' });
  expect(list).toHaveTextContent('스타벅스');
  expect(list).toHaveTextContent('식비');
  expect(screen.getByLabelText('키워드')).toHaveValue('');
});

test.each([
  { keyword: '  ', category: '1', field: '키워드', message: '키워드를 입력하세요' },
  { keyword: '스타벅스', category: '', field: '카테고리', message: '카테고리를 고르세요' },
])(
  'a rule with $field missing is refused before sending',
  async ({ keyword, category, field, message }) => {
    render(<RuleManager />);
    await screen.findByRole('option', { name: '식비' });
    fireEvent.change(screen.getByLabelText('키워드'), { target: { value: keyword } });
    fireEvent.change(screen.getByLabelText('카테고리'), { target: { value: category } });
    fireEvent.click(screen.getByRole('button', { name: '규칙 추가' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
    expect(posts()).toEqual([]);
  },
);

test('a duplicate keyword shows the server message', async () => {
  render(<RuleManager />);
  await screen.findByRole('option', { name: '식비' });
  fireEvent.change(screen.getByLabelText('키워드'), { target: { value: '스타벅스' } });
  fireEvent.change(screen.getByLabelText('카테고리'), { target: { value: '1' } });
  failNext = { status: 409, error: '같은 종류에 이미 있는 키워드입니다' };
  fireEvent.click(screen.getByRole('button', { name: '규칙 추가' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('같은 종류에 이미 있는 키워드입니다');
  expect(screen.getByLabelText('키워드')).toHaveValue('스타벅스');
});

test('deleting a rule asks first and then moves focus to the rules heading', async () => {
  rules = [{ id: 1, keyword: '스타벅스', kind: 'expense', categoryId: 1 }];
  render(<RuleManager />);
  fireEvent.click(await screen.findByRole('button', { name: '스타벅스 규칙 삭제' }));
  const dialog = await screen.findByRole('dialog', { name: '규칙을 삭제할까요?' });
  expect(dialog).toHaveTextContent('이미 분류한 내역은 그대로 둡니다');
  fireEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
  // The confirm button's spinner is a status too: wait for the message itself.
  expect(await screen.findByText("'스타벅스' 규칙을 삭제했습니다")).toBeInTheDocument();
  expect(screen.getByText('아직 분류 규칙이 없습니다.')).toBeInTheDocument();
  await vi.waitFor(() => expect(screen.getByRole('heading', { name: '분류 규칙' })).toHaveFocus());
});
