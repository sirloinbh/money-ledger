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

const valid = { date: '2026-11-03', kind: 'expense', amount: 12500, categoryId: 1, memo: '점심' };

const invalid = [
  { label: 'a negative amount', change: { amount: -1 }, error: '금액은 0원 이상이어야 합니다' },
  {
    label: 'a fractional amount',
    change: { amount: 1.5 },
    error: '금액은 원 단위 정수로 입력하세요',
  },
  {
    label: 'an amount sent as text',
    change: { amount: '1000' },
    error: '금액을 숫자로 입력하세요',
  },
  { label: 'February 30', change: { date: '2026-02-30' }, error: '없는 날짜입니다' },
  {
    label: 'the year 0000',
    change: { date: '0000-01-01' },
    error: '날짜는 1900년부터 2100년 사이로 입력하세요',
  },
  {
    label: 'the year 2101',
    change: { date: '2101-01-01' },
    error: '날짜는 1900년부터 2100년 사이로 입력하세요',
  },
  {
    label: 'a slash date',
    change: { date: '2026/11/03' },
    error: '날짜를 YYYY-MM-DD 형식으로 입력하세요',
  },
  { label: 'a category id of 0', change: { categoryId: 0 }, error: '카테고리를 고르세요' },
  {
    label: 'a merchant over 50 characters',
    change: { merchant: '가'.repeat(51) },
    error: '가맹점은 50자 이하로 입력하세요',
  },
  {
    label: 'an unknown kind',
    change: { kind: 'transfer' },
    error: '종류는 수입 또는 지출 중에서 고르세요',
  },
  {
    label: 'a memo over 200 characters',
    change: { memo: '가'.repeat(201) },
    error: '메모는 200자 이하로 입력하세요',
  },
];

for (const { label, change, error } of invalid) {
  test(`an entry with ${label} is a Korean 400 before the DB`, async () => {
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

test('a malformed entry id is a Korean 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/ledger/entries/abc', { method: 'DELETE' });
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'Invalid 내역 ID' });
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
  { label: 'does not exist', category: undefined, error: '카테고리를 찾을 수 없습니다' },
  {
    label: 'is of the other kind',
    category: { kind: 'income', hidden: false },
    error: '카테고리의 종류가 내역의 종류와 다릅니다',
  },
  {
    label: 'is hidden',
    category: { kind: 'expense', hidden: true },
    error: '숨긴 카테고리에는 새 내역을 넣을 수 없습니다',
  },
];

for (const { label, category, error } of categoryCases) {
  test(`a new entry whose category ${label} is a Korean 400`, async () => {
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
    assert.deepEqual(response.data, { error: '숨긴 카테고리에는 새 내역을 넣을 수 없습니다' });
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
    category_name: '여가',
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
    assert.deepEqual(response.data, { error: '숨긴 카테고리에는 새 내역을 넣을 수 없습니다' });
  });
});

test('a write that matched nothing for no known reason is a Korean 409', async () => {
  const pool = updateRace([
    { kind: 'expense', hidden: false },
    { kind: 'expense', hidden: false },
  ]);
  await withApi(pool, async (call) => {
    const response = await call('/api/ledger/entries/7', { method: 'PUT', body: valid });
    assert.equal(response.status, 409);
    assert.deepEqual(response.data, { error: '카테고리가 방금 바뀌었습니다. 다시 시도하세요' });
  });
});

// #39 List filters are checked before the DB, with Korean messages.
const invalidQueries = [
  { query: 'from=2026-02-30', error: '없는 날짜입니다' },
  { query: 'to=2026/11/30', error: '날짜를 YYYY-MM-DD 형식으로 입력하세요' },
  { query: 'from=2026-11-30&to=2026-11-01', error: '시작일이 종료일보다 늦습니다' },
  { query: 'kind=transfer', error: '종류는 수입 또는 지출 중에서 고르세요' },
  { query: 'category=0', error: '카테고리가 올바르지 않습니다' },
  { query: 'category=abc', error: '카테고리가 올바르지 않습니다' },
  { query: `q=${'가'.repeat(51)}`, error: '검색어는 50자 이하로 입력하세요' },
  { query: 'page=0', error: '쪽 번호가 올바르지 않습니다' },
  { query: 'page=1&page=2', error: '쪽 번호가 올바르지 않습니다' },
  { query: 'size=101', error: '한 쪽에 100건까지 볼 수 있습니다' },
];

for (const { query, error } of invalidQueries) {
  test(`listing with ${query.slice(0, 40)} is a Korean 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call(`/api/ledger/entries?${encodeURI(query)}`);
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}
