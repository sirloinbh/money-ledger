import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { withApi } from './helpers.js';

// Validation runs before the DB: a pool that fails the test if any query reaches it.
const noDb = {
  query: async () => {
    throw new Error('the request should have been rejected before the DB');
  },
} as unknown as Pool;

const valid = { date: '2026-11-03', kind: 'expense', amount: 12500, categoryId: 1, memo: 'Lunch' };

const invalid = [
  { label: 'a negative amount', change: { amount: -1 }, error: 'The amount must be ₩0 or more' },
  {
    label: 'a fractional amount',
    change: { amount: 1.5 },
    error: 'Enter the amount as a whole number of won',
  },
  {
    label: 'an amount sent as text',
    change: { amount: '1000' },
    error: 'Enter the amount as a number',
  },
  { label: 'February 30', change: { date: '2026-02-30' }, error: 'That date does not exist' },
  {
    label: 'the year 0000',
    change: { date: '0000-01-01' },
    error: 'Enter a date between 1900 and 2100',
  },
  {
    label: 'the year 2101',
    change: { date: '2101-01-01' },
    error: 'Enter a date between 1900 and 2100',
  },
  {
    label: 'a slash date',
    change: { date: '2026/11/03' },
    error: 'Enter the date as YYYY-MM-DD',
  },
  { label: 'a category id of 0', change: { categoryId: 0 }, error: 'Choose a category' },
  {
    label: 'a merchant over 50 characters',
    change: { merchant: '가'.repeat(51) },
    error: 'The merchant must be 50 characters or fewer',
  },
  {
    label: 'an unknown kind',
    change: { kind: 'transfer' },
    error: 'Choose income or expense as the kind',
  },
  {
    label: 'a memo over 200 characters',
    change: { memo: '가'.repeat(201) },
    error: 'The note must be 200 characters or fewer',
  },
];

for (const { label, change, error } of invalid) {
  test(`an entry with ${label} is a 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call('/api/ledger/entries', {
        method: 'POST',
        body: { ...valid, ...change },
      });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

test('a malformed entry id is a 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/ledger/entries/abc', { method: 'DELETE' });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'Invalid entry ID' });
  });
});

// A pool that answers the category lookup with `category` (or nothing).
const withCategory = (category?: { kind: string; hidden: boolean }) =>
  ({
    query: async (sql: string) => {
      if (sql.includes('FROM ledger_categories WHERE id'))
        return { rows: category ? [category] : [] };
      throw new Error('the request should have been rejected before writing');
    },
  }) as unknown as Pool;

const categoryCases = [
  { label: 'does not exist', category: undefined, error: 'Category not found' },
  {
    label: 'is of the other kind',
    category: { kind: 'income', hidden: false },
    error: "The category's kind does not match the entry's kind",
  },
  {
    label: 'is hidden',
    category: { kind: 'expense', hidden: true },
    error: 'Cannot add a new entry to a hidden category',
  },
];

for (const { label, category, error } of categoryCases) {
  test(`a new entry whose category ${label} is a 400`, async () => {
    await withApi(withCategory(category), async (call) => {
      const response = await call('/api/ledger/entries', { method: 'POST', body: valid });
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

test('a category hidden between the check and the write is refused, not written', async () => {
  const lookups: { kind: string; hidden: boolean }[] = [
    { kind: 'expense', hidden: false }, // the check
    { kind: 'expense', hidden: true }, // after the conditional insert wrote nothing
  ];
  const sql: string[] = [];
  const racing = {
    query: async (text: string) => {
      sql.push(text);
      if (text.includes('FROM ledger_categories WHERE id')) return { rows: [lookups.shift()] };
      if (text.includes('INSERT INTO ledger_entries')) return { rows: [] };
      throw new Error(`unexpected query: ${text}`);
    },
  } as unknown as Pool;
  await withApi(racing, async (call) => {
    const response = await call('/api/ledger/entries', { method: 'POST', body: valid });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'Cannot add a new entry to a hidden category' });
  });
  assert.match(
    sql.find((text) => text.includes('INSERT'))!,
    /NOT c\.hidden/,
  );
});

// A pool scripted by query: the entry lookup, category lookups in order, and an UPDATE that writes nothing.
function updateRace(categories: { kind: string; hidden: boolean }[]) {
  const entryRow = {
    id: '7',
    entry_date: '2026-11-01',
    kind: 'expense',
    amount: '5000',
    category_id: '2',
    category_name: 'Leisure',
    memo: '',
  };
  return {
    query: async (text: string) => {
      // The UPDATE also says "WHERE e.id = $1", so it is matched first.
      if (text.includes('UPDATE ledger_entries')) return { rows: [] };
      if (text.includes('WHERE e.id = $1')) return { rows: [entryRow] };
      if (text.includes('FROM ledger_categories WHERE id')) return { rows: [categories.shift()] };
      throw new Error(`unexpected query: ${text}`);
    },
  } as unknown as Pool;
}

test('an edit whose new category was hidden meanwhile is refused, not written', async () => {
  const pool = updateRace([
    { kind: 'expense', hidden: false },
    { kind: 'expense', hidden: true },
  ]);
  await withApi(pool, async (call) => {
    const response = await call('/api/ledger/entries/7', { method: 'PUT', body: valid });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'Cannot add a new entry to a hidden category' });
  });
});

test('a write that matched nothing for no known reason is a 409', async () => {
  const pool = updateRace([
    { kind: 'expense', hidden: false },
    { kind: 'expense', hidden: false },
  ]);
  await withApi(pool, async (call) => {
    const response = await call('/api/ledger/entries/7', { method: 'PUT', body: valid });
    assert.equal(response.status, 409);
    assert.deepEqual(response.data, { error: 'The category just changed. Try again' });
  });
});

// #39 List filters are checked before the DB, with messages.
const invalidQueries = [
  { query: 'from=2026-02-30', error: 'That date does not exist' },
  { query: 'to=2026/11/30', error: 'Enter the date as YYYY-MM-DD' },
  { query: 'from=2026-11-30&to=2026-11-01', error: 'The start date is after the end date' },
  { query: 'kind=transfer', error: 'Choose income or expense as the kind' },
  { query: 'category=0', error: 'The category is not valid' },
  { query: 'category=abc', error: 'The category is not valid' },
  { query: `q=${'가'.repeat(51)}`, error: 'The search term must be 50 characters or fewer' },
  { query: 'page=0', error: 'The page number is not valid' },
  { query: 'page=1&page=2', error: 'The page number is not valid' },
  { query: 'size=101', error: 'You can view at most 100 entries per page' },
];

for (const { query, error } of invalidQueries) {
  test(`listing with ${query.slice(0, 40)} is a 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call(`/api/ledger/entries?${encodeURI(query)}`);
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}
