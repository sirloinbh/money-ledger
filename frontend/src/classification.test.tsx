import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
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
  { id: 1, kind: 'expense', name: 'Food', hidden: false },
  { id: 2, kind: 'expense', name: 'Living', hidden: false },
  { id: 3, kind: 'income', name: 'Salary', hidden: false },
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
          rulesAdded: body!.remember ? merchants.length : 0,
          rulesUpdated: 0,
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
  entries = [
    entry(1, 'Kimbap Place'),
    entry(2, 'Kimbap Place'),
    entry(3, ''),
    entry(4, 'Employer', 'income'),
  ];
  rules = [];
  requests = [];
  failNext = undefined;
  fakeApi();
});

const posts = () => requests.filter((request) => request.method === 'POST');
const row = (text: string) =>
  within(screen.getByRole('list', { name: 'Uncategorized entries' }))
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(text))!;

test('selected entries are classified at once and their merchant is remembered', async () => {
  const onChange = vi.fn();
  render(<UncategorizedEntries onChange={onChange} />);
  expect(
    await screen.findByRole('heading', { name: 'Uncategorized entries (4)' }),
  ).toBeInTheDocument();
  await screen.findByRole('option', { name: 'Food' });

  fireEvent.click(within(row('₩1,000')).getByRole('checkbox'));
  fireEvent.click(within(row('₩2,000')).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: '1' } });
  expect(screen.getByRole('checkbox', { name: /save as a rule/ })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Classify 2 selected' }));

  expect(await screen.findByRole('status')).toHaveTextContent(
    '2 entries classified as Food. Saved 1 merchant rule',
  );
  expect(posts()).toEqual([
    {
      method: 'POST',
      url: '/api/ledger/entries/classify',
      body: { entryIds: [1, 2], categoryId: 1, remember: true },
    },
  ]);
  expect(onChange).toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Uncategorized entries (2)' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Classify 0 selected' })).toBeInTheDocument();
});

test('without remember no rule is asked for', async () => {
  render(<UncategorizedEntries />);
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.click(within(row('₩3,000')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('checkbox', { name: /save as a rule/ }));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Classify 1 selected' }));
  await screen.findByRole('status');
  expect(posts()[0].body).toEqual({ entryIds: [3], categoryId: 2, remember: false });
});

test.each([
  { label: 'no entry', pick: [], category: '1', message: 'Select the entries to classify' },
  { label: 'no category', pick: ['₩1,000'], category: '', message: 'Choose a category' },
  {
    label: 'an income entry with an expense category',
    pick: ['₩1,000', '₩4,000'],
    category: '1',
    message: 'Some entries are a different kind from the chosen category',
  },
])('classifying with $label is refused before sending', async ({ pick, category, message }) => {
  render(<UncategorizedEntries />);
  await screen.findByRole('option', { name: 'Food' });
  for (const text of pick) fireEvent.click(within(row(text)).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: category } });
  fireEvent.click(screen.getByRole('button', { name: /^Classify \d+ selected$/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(posts()).toEqual([]);
});

test('select all picks every uncategorized entry', async () => {
  render(<UncategorizedEntries />);
  await screen.findByRole('heading', { name: 'Uncategorized entries (4)' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
  expect(screen.getByRole('button', { name: 'Classify 4 selected' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
  expect(screen.getByRole('button', { name: 'Classify 0 selected' })).toBeInTheDocument();
});

test('applying rules reports how many were classified and focus survives an emptied list', async () => {
  rules = [{ id: 1, keyword: 'Kimbap', kind: 'expense', categoryId: 1 }];
  entries = [entry(1, 'Kimbap Place')];
  render(<UncategorizedEntries />);
  const apply = await screen.findByRole('button', { name: 'Reclassify with rules' });
  apply.focus();
  fireEvent.click(apply);
  expect(await screen.findByRole('status')).toHaveTextContent('1 entry classified by rules');
  expect(screen.getByText('There are no uncategorized entries.')).toBeInTheDocument();
  await vi.waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Uncategorized entries' })).toHaveFocus(),
  );
});

test('applying rules with nothing to match says so', async () => {
  render(<UncategorizedEntries />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reclassify with rules' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'No uncategorized entries match the rules',
  );
});

test('a server refusal of the classification is shown', async () => {
  render(<UncategorizedEntries />);
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.click(within(row('₩1,000')).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: '1' } });
  failNext = { status: 400, error: 'Cannot classify into a hidden category' };
  fireEvent.click(screen.getByRole('button', { name: 'Classify 1 selected' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Cannot classify into a hidden category',
  );
  expect(screen.getByRole('heading', { name: 'Uncategorized entries (4)' })).toBeInTheDocument();
});

test('a rule is added with its category and listed', async () => {
  const onChange = vi.fn();
  render(<RuleManager onChange={onChange} />);
  expect(await screen.findByText('There are no classification rules yet.')).toBeInTheDocument();
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: ' Starbucks ' } });
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));

  expect(await screen.findByRole('status')).toHaveTextContent("Rule 'Starbucks' added");
  expect(posts()[0].body).toEqual({ keyword: 'Starbucks', categoryId: 1 });
  expect(onChange).toHaveBeenCalled();
  const list = screen.getByRole('list', { name: 'Classification rules' });
  expect(list).toHaveTextContent('Starbucks');
  expect(list).toHaveTextContent('Food');
  expect(screen.getByLabelText('Keyword')).toHaveValue('');
});

test.each([
  { keyword: '  ', category: '1', field: 'Keyword', message: 'Enter a keyword' },
  { keyword: 'Starbucks', category: '', field: 'Category', message: 'Choose a category' },
])(
  'a rule with $field missing is refused before sending',
  async ({ keyword, category, field, message }) => {
    render(<RuleManager />);
    await screen.findByRole('option', { name: 'Food' });
    fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: keyword } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: category } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
    expect(posts()).toEqual([]);
  },
);

test('a duplicate keyword shows the server message', async () => {
  render(<RuleManager />);
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: 'Starbucks' } });
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: '1' } });
  failNext = { status: 409, error: 'A keyword already exists for this kind' };
  fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'A keyword already exists for this kind',
  );
  expect(screen.getByLabelText('Keyword')).toHaveValue('Starbucks');
});

test('deleting a rule asks first and then moves focus to the rules heading', async () => {
  rules = [{ id: 1, keyword: 'Starbucks', kind: 'expense', categoryId: 1 }];
  render(<RuleManager />);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete rule Starbucks' }));
  const dialog = await screen.findByRole('dialog', { name: 'Delete this rule?' });
  expect(dialog).toHaveTextContent('Entries already classified stay as they are');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  // The confirm button's spinner is a status too: wait for the message itself.
  expect(await screen.findByText("Rule 'Starbucks' deleted")).toBeInTheDocument();
  expect(screen.getByText('There are no classification rules yet.')).toBeInTheDocument();
  await vi.waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Classification rules' })).toHaveFocus(),
  );
});

// Like LedgerPage: a change reported by the list bumps the version it is given.
function Harness() {
  const [version, setVersion] = useState(0);
  return <UncategorizedEntries version={version} onChange={() => setVersion((v) => v + 1)} />;
}

test('a classification made here loads the list once, not again for the version bump', async () => {
  render(<Harness />);
  await screen.findByRole('option', { name: 'Food' });
  const loads = () =>
    requests.filter((request) => request.url === '/api/ledger/entries?uncategorized=true').length;
  expect(loads()).toBe(1);
  fireEvent.click(within(row('₩1,000')).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Classify 1 selected' }));
  await screen.findByRole('heading', { name: 'Uncategorized entries (3)' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(loads()).toBe(2);
});

test('updated and skipped counts are reported in words', async () => {
  vi.mocked(fetch).mockImplementation((url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (path.startsWith('/api/ledger/categories')) return json({ categories });
    if (path === '/api/ledger/entries/classify' && init?.method === 'POST') {
      return json({ classified: 1, skipped: 1, rulesAdded: 0, rulesUpdated: 1 });
    }
    return json({ entries: [entry(1, 'Kimbap Place'), entry(2, 'Kimbap Place')] });
  });
  render(<UncategorizedEntries />);
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Classify 2 selected' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    '1 entry classified as Food. 1 skipped (already classified or changed). 1 existing rule changed to Food',
  );
});

test('a category of the other kind marks the category field', async () => {
  render(<UncategorizedEntries />);
  await screen.findByRole('option', { name: 'Salary' });
  fireEvent.click(within(row('₩1,000')).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Classify 1 selected' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Some entries are a different kind from the chosen category',
  );
  expect(screen.getByLabelText('Category to apply')).toHaveAttribute('aria-invalid', 'true');
});

test('the rules reload when categories change, so names and hidden marks are current', async () => {
  rules = [{ id: 1, keyword: 'Starbucks', kind: 'expense', categoryId: 1 }];
  const { rerender } = render(<RuleManager categoriesVersion={0} />);
  await screen.findByRole('list', { name: 'Classification rules' });
  const loads = () => requests.filter((request) => request.url === '/api/ledger/rules').length;
  const before = loads();
  rerender(<RuleManager categoriesVersion={1} />);
  await vi.waitFor(() => expect(loads()).toBe(before + 1));
});
