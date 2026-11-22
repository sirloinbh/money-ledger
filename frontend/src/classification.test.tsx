import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { RuleManager, UncategorizedEntries } from './classification';
import { ledgerKey } from './ledger-query';
import { findLive, queryLive } from './test/live';
import { renderWithQuery, testQueryClient } from './test/query';

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
// #154 Entry ID to the suggested category; `suggestionsFail` makes loading them fail.
let suggested: Map<number, number>;
let suggestionsFail: boolean;

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
        const kind = categories.find((category) => category.id === categoryId)!.kind;
        // As the server: entries of the other kind are skipped (#199).
        const hit = entries.filter(
          (entry) => ids.includes(entry.id) && entry.categoryId === null && entry.kind === kind,
        );
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
      if (url === '/api/ledger/entries/suggestions') {
        if (suggestionsFail) return json({ error: 'down' }, 500);
        return json({
          suggestions: entries
            .filter((entry) => entry.categoryId === null && suggested.has(entry.id))
            .map((entry) => ({
              entryId: entry.id,
              categoryId: suggested.get(entry.id)!,
              categoryName: nameOf(suggested.get(entry.id)!),
              from: `${entry.merchant} (earlier)`,
            })),
        });
      }
      if (url === '/api/ledger/entries/apply-suggestions') {
        const ids = body!.entryIds as number[];
        const hit = entries.filter(
          (entry) => ids.includes(entry.id) && entry.categoryId === null && suggested.has(entry.id),
        );
        hit.forEach((entry) => (entry.categoryId = suggested.get(entry.id)!));
        return json({ classified: hit.length, skipped: ids.length - hit.length });
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
  suggested = new Map();
  suggestionsFail = false;
  fakeApi();
});

const posts = () => requests.filter((request) => request.method === 'POST');
const row = (text: string) =>
  within(screen.getByRole('list', { name: 'Uncategorized entries' }))
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(text))!;

test('selected entries are classified at once and their merchant is remembered', async () => {
  renderWithQuery(<UncategorizedEntries />);
  expect(
    await screen.findByRole('heading', { name: 'Uncategorized entries (4)' }),
  ).toBeInTheDocument();
  await screen.findByRole('option', { name: 'Food' });

  fireEvent.click(within(row('₩1,000')).getByRole('checkbox'));
  fireEvent.click(within(row('₩2,000')).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: '1' } });
  expect(screen.getByRole('checkbox', { name: /save as a rule/ })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Classify 2 selected' }));

  expect(await findLive('status')).toHaveTextContent(
    '2 entries classified as Food. Saved 1 merchant rule',
  );
  expect(posts()).toEqual([
    {
      method: 'POST',
      url: '/api/ledger/entries/classify',
      body: { entryIds: [1, 2], categoryId: 1, remember: true },
    },
  ]);
  expect(screen.getByRole('heading', { name: 'Uncategorized entries (2)' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Classify 0 selected' })).toBeInTheDocument();
});

test('without remember no rule is asked for', async () => {
  renderWithQuery(<UncategorizedEntries />);
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.click(within(row('₩3,000')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('checkbox', { name: /save as a rule/ }));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Classify 1 selected' }));
  await findLive('status');
  expect(posts()[0].body).toEqual({ entryIds: [3], categoryId: 2, remember: false });
});

test.each([
  { label: 'no entry', pick: [], category: '1', message: 'Select the entries to classify' },
  { label: 'no category', pick: ['₩1,000'], category: '', message: 'Choose a category' },
  {
    label: 'only income entries and an expense category',
    pick: ['₩4,000'],
    category: '1',
    message: 'None of the selected entries is the kind of this category',
  },
])('classifying with $label is refused before sending', async ({ pick, category, message }) => {
  renderWithQuery(<UncategorizedEntries />);
  await screen.findByRole('option', { name: 'Food' });
  for (const text of pick) fireEvent.click(within(row(text)).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: category } });
  fireEvent.click(screen.getByRole('button', { name: /^Classify \d+ selected$/ }));
  expect(await findLive('alert')).toHaveTextContent(message);
  expect(posts()).toEqual([]);
});

test('select all picks every uncategorized entry', async () => {
  renderWithQuery(<UncategorizedEntries />);
  await screen.findByRole('heading', { name: 'Uncategorized entries (4)' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
  expect(screen.getByRole('button', { name: 'Classify 4 selected' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
  expect(screen.getByRole('button', { name: 'Classify 0 selected' })).toBeInTheDocument();
});

test('applying rules reports how many were classified and focus survives an emptied list', async () => {
  rules = [{ id: 1, keyword: 'Kimbap', kind: 'expense', categoryId: 1 }];
  entries = [entry(1, 'Kimbap Place')];
  renderWithQuery(<UncategorizedEntries />);
  const apply = await screen.findByRole('button', { name: 'Reclassify with rules' });
  apply.focus();
  fireEvent.click(apply);
  expect(await findLive('status')).toHaveTextContent('1 entry classified by rules');
  expect(screen.getByText('There are no uncategorized entries.')).toBeInTheDocument();
  await vi.waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Uncategorized entries' })).toHaveFocus(),
  );
});

test('applying rules with nothing to match says so', async () => {
  renderWithQuery(<UncategorizedEntries />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reclassify with rules' }));
  expect(await findLive('status')).toHaveTextContent('No uncategorized entries match the rules');
});

test('a server refusal of the classification is shown', async () => {
  renderWithQuery(<UncategorizedEntries />);
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.click(within(row('₩1,000')).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: '1' } });
  failNext = { status: 400, error: 'Cannot classify into a hidden category' };
  fireEvent.click(screen.getByRole('button', { name: 'Classify 1 selected' }));
  expect(await findLive('alert')).toHaveTextContent('Cannot classify into a hidden category');
  expect(screen.getByRole('heading', { name: 'Uncategorized entries (4)' })).toBeInTheDocument();
});

test('a rule is added with its category and listed', async () => {
  renderWithQuery(<RuleManager />);
  expect(await screen.findByText('There are no classification rules yet.')).toBeInTheDocument();
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: ' Starbucks ' } });
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));

  expect(await findLive('status')).toHaveTextContent("Rule 'Starbucks' added");
  expect(posts()[0].body).toEqual({ keyword: 'Starbucks', categoryId: 1 });
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
    renderWithQuery(<RuleManager />);
    await screen.findByRole('option', { name: 'Food' });
    fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: keyword } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: category } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(await findLive('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
    expect(posts()).toEqual([]);
  },
);

test('a duplicate keyword shows the server message', async () => {
  renderWithQuery(<RuleManager />);
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: 'Starbucks' } });
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: '1' } });
  failNext = { status: 409, error: 'A keyword already exists for this kind' };
  fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
  expect(await findLive('alert')).toHaveTextContent('A keyword already exists for this kind');
  expect(screen.getByLabelText('Keyword')).toHaveValue('Starbucks');
});

test('deleting a rule asks first and then moves focus to the rules heading', async () => {
  rules = [{ id: 1, keyword: 'Starbucks', kind: 'expense', categoryId: 1 }];
  renderWithQuery(<RuleManager />);
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

// Another section's change reloads every ledger list (#213), as the Ledger page does after a save there.
const ledgerChangedElsewhere = () =>
  act(() => testQueryClient().invalidateQueries({ queryKey: ledgerKey }));

test('a classification made here loads the list once more, not twice', async () => {
  renderWithQuery(<UncategorizedEntries />);
  await screen.findByRole('option', { name: 'Food' });
  const loads = () =>
    requests.filter((request) => request.url === '/api/ledger/entries?uncategorized=true').length;
  expect(loads()).toBe(1);
  fireEvent.click(within(row('₩1,000')).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Classify 1 selected' }));
  // onChange is reported right after the classification, before the list reloads, so a second load caused by
  // it would already be counted once the reloaded list is shown (#182: no sleep needed).
  await screen.findByRole('heading', { name: 'Uncategorized entries (3)' });
  expect(loads()).toBe(2);
});

test('updated and skipped counts are reported in words', async () => {
  vi.mocked(fetch).mockImplementation((url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (path.startsWith('/api/ledger/categories')) return json({ categories });
    if (path === '/api/ledger/entries/classify' && init?.method === 'POST') {
      return json({ classified: 1, skipped: 1, rulesAdded: 0, rulesUpdated: 1 });
    }
    if (path === '/api/ledger/entries/suggestions') return json({ suggestions: [] });
    return json({ entries: [entry(1, 'Kimbap Place'), entry(2, 'Kimbap Place')] });
  });
  renderWithQuery(<UncategorizedEntries />);
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Classify 2 selected' }));
  expect(await findLive('status')).toHaveTextContent(
    '1 entry classified as Food. 1 skipped (a different kind, or already classified or changed). 1 existing rule changed to Food',
  );
});

test('a category of the other kind marks the category field', async () => {
  renderWithQuery(<UncategorizedEntries />);
  await screen.findByRole('option', { name: 'Salary' });
  fireEvent.click(within(row('₩1,000')).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Classify 1 selected' }));
  expect(await findLive('alert')).toHaveTextContent(
    'None of the selected entries is the kind of this category',
  );
  expect(screen.getByLabelText('Category to apply')).toHaveAttribute('aria-invalid', 'true');
});

test('the rules reload when categories change, so names and hidden marks are current', async () => {
  rules = [{ id: 1, keyword: 'Starbucks', kind: 'expense', categoryId: 1 }];
  renderWithQuery(<RuleManager />);
  await screen.findByRole('list', { name: 'Classification rules' });
  const loads = () => requests.filter((request) => request.url === '/api/ledger/rules').length;
  const before = loads();
  // A category saved in the Categories section reloads every ledger read.
  await ledgerChangedElsewhere();
  await vi.waitFor(() => expect(loads()).toBe(before + 1));
});

test('a suggestion is shown on its entry and used alone, without a rule', async () => {
  suggested = new Map([
    [1, 1],
    [2, 1],
  ]);
  renderWithQuery(<UncategorizedEntries />);
  await screen.findByRole('heading', { name: 'Uncategorized entries (4)' });
  expect(row('₩1,000')).toHaveTextContent('Suggested: Food (from Kimbap Place (earlier))');
  expect(row('₩3,000')).not.toHaveTextContent('Suggested');
  // The checkbox keeps its own name: the suggestion sits outside its label.
  expect(within(row('₩1,000')).getByRole('checkbox')).not.toHaveAccessibleName(/Suggested/);

  fireEvent.click(
    within(row('₩1,000')).getByRole('button', {
      name: 'Use Food for Kimbap Place, ₩1,000 on 2026-11-05',
    }),
  );
  expect(await findLive('status')).toHaveTextContent('1 entry classified by suggestion');
  expect(posts()).toEqual([
    { method: 'POST', url: '/api/ledger/entries/apply-suggestions', body: { entryIds: [1] } },
  ]);
  expect(screen.getByRole('heading', { name: 'Uncategorized entries (3)' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Apply 1 suggestion' })).toBeInTheDocument();
});

test('every shown suggestion is applied at once and skips are reported', async () => {
  suggested = new Map([
    [1, 1],
    [2, 2],
  ]);
  renderWithQuery(<UncategorizedEntries />);
  await screen.findByRole('heading', { name: 'Uncategorized entries (4)' });
  // Classified elsewhere after the list loaded: the server skips it.
  entries[1].categoryId = 2;
  fireEvent.click(screen.getByRole('button', { name: 'Apply 2 suggestions' }));
  expect(await findLive('status')).toHaveTextContent(
    '1 entry classified by suggestion. 1 skipped (changed meanwhile)',
  );
  expect(posts()[0].body).toEqual({ entryIds: [1, 2] });
  expect(screen.queryByRole('button', { name: /^Apply \d+ suggestion/ })).not.toBeInTheDocument();
});

test('without suggestions, or when they fail to load, the list still works', async () => {
  suggestionsFail = true;
  renderWithQuery(<UncategorizedEntries />);
  expect(
    await screen.findByRole('heading', { name: 'Uncategorized entries (4)' }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Suggested/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Apply \d+ suggestion/ })).not.toBeInTheDocument();
  expect(queryLive('alert')).toBeNull();
});

test('after a classification here, a later change elsewhere still reloads the list (#198)', async () => {
  renderWithQuery(<UncategorizedEntries />);
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.click(within(row('₩1,000')).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Classify 1 selected' }));
  await screen.findByRole('heading', { name: 'Uncategorized entries (3)' });

  // Later an entry is added elsewhere on the page.
  entries.push(entry(5, 'Bookshop'));
  await ledgerChangedElsewhere();
  expect(await screen.findByRole('heading', { name: 'Uncategorized entries (4)' })).toBeVisible();
});

test('after a rule added here, a later change elsewhere still reloads the rules (#198)', async () => {
  renderWithQuery(<RuleManager />);
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: 'Kimbap' } });
  fireEvent.change(screen.getByLabelText('Category', { selector: '#rule-category' }), {
    target: { value: '1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
  expect(await findLive('status')).toHaveTextContent("Rule 'Kimbap' added");

  rules.push({ id: 9, keyword: 'Bookshop', kind: 'expense', categoryId: 2 });
  await ledgerChangedElsewhere();
  expect(await screen.findByText('Bookshop')).toBeInTheDocument();
});

test('a selection with an entry of the other kind classifies the rest and reports the skip (#199)', async () => {
  renderWithQuery(<UncategorizedEntries />);
  await screen.findByRole('option', { name: 'Food' });
  fireEvent.click(within(row('₩1,000')).getByRole('checkbox'));
  fireEvent.click(within(row('₩4,000')).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Classify 2 selected' }));
  expect(await findLive('status')).toHaveTextContent(
    '1 entry classified as Food. 1 skipped (a different kind, or already classified or changed)',
  );
  expect(posts()[0].body).toMatchObject({ entryIds: [1, 4], categoryId: 1 });
  expect(screen.getByRole('heading', { name: 'Uncategorized entries (3)' })).toBeVisible();
});

/** After the next change is saved, the reload of `path` fails once (#262). */
function failReloadAfterSave(path: string) {
  const api = vi.mocked(fetch).getMockImplementation()!;
  let saved = false;
  vi.mocked(fetch).mockImplementation((url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') saved = true;
    else if (saved && String(url).startsWith(path)) {
      saved = false;
      return Promise.reject(new TypeError('offline'));
    }
    return api(url, init);
  });
}

test('a classification or rule saved while its list fails to reload is a note, not an error (#262)', async () => {
  const { unmount } = renderWithQuery(<UncategorizedEntries />);
  await screen.findByRole('heading', { name: 'Uncategorized entries (4)' });
  await screen.findByRole('option', { name: 'Food' });
  failReloadAfterSave('/api/ledger/entries?uncategorized=true');
  fireEvent.click(within(row('₩1,000')).getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Category to apply'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Classify 1 selected' }));
  expect(await findLive('status')).toHaveTextContent(
    'The list could not be reloaded; reload the page to see it',
  );
  expect(queryLive('alert')).toBeNull();
  unmount();

  // The classification above saved a merchant rule, so the rule list is not empty.
  renderWithQuery(<RuleManager />);
  await screen.findByRole('list', { name: 'Classification rules' });
  await screen.findByRole('option', { name: 'Food' });
  failReloadAfterSave('/api/ledger/rules');
  fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: 'Starbucks' } });
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
  expect(await findLive('status')).toHaveTextContent(
    "Rule 'Starbucks' added. The list could not be reloaded; reload the page to see it",
  );
  expect(queryLive('alert')).toBeNull();
});
