import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { withApi } from './helpers.js';

type Query = { text: string; values: unknown[] };

// Records every query and answers with the given rows, or fails with the given error.
function fakePool(answer: { rows?: unknown[]; error?: unknown } = {}) {
  const queries: Query[] = [];
  const pool = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      if (answer.error) throw answer.error;
      return { rows: answer.rows ?? [] };
    },
  } as unknown as Pool;
  return { pool, queries };
}

const row = { id: '7', kind: 'expense', name: '식비', hidden: false };
const category = { id: 7, kind: 'expense', name: '식비', hidden: false };
const post = (body: unknown) => ({ method: 'POST', body });
const patch = (body: unknown) => ({ method: 'PATCH', body });

test('the list leaves hidden categories out unless asked and returns numeric ids', async () => {
  const { pool, queries } = fakePool({ rows: [row] });
  await withApi(pool, async (call) => {
    const { status, data } = await call('/api/categories');
    assert.equal(status, 200);
    assert.deepEqual(data, { categories: [category] });
    assert.deepEqual(queries[0].values, [false]);

    await call('/api/categories?includeHidden=true');
    assert.deepEqual(queries[1].values, [true]);
  });
});

test('an invalid includeHidden value is rejected in Korean', async () => {
  const { pool, queries } = fakePool();
  await withApi(pool, async (call) => {
    const { status, data } = await call('/api/categories?includeHidden=maybe');
    assert.equal(status, 400);
    assert.deepEqual(data, { error: '숨김 포함 여부가 올바르지 않습니다' });
    assert.equal(queries.length, 0);
  });
});

test('creating trims the name and answers 201', async () => {
  const { pool, queries } = fakePool({ rows: [row] });
  await withApi(pool, async (call) => {
    const { status, data } = await call(
      '/api/categories',
      post({ kind: 'expense', name: '  식비 ' }),
    );
    assert.equal(status, 201);
    assert.deepEqual(data, { category });
    assert.deepEqual(queries[0].values, ['expense', '식비']);
  });
});

for (const [label, body, message] of [
  ['an unknown kind', { kind: 'transfer', name: '식비' }, '종류는 수입 또는 지출이어야 합니다'],
  ['a missing name', { kind: 'expense' }, '이름을 입력하세요'],
  ['a blank name', { kind: 'expense', name: '   ' }, '이름을 입력하세요'],
  [
    'a 31-character name',
    { kind: 'expense', name: '가'.repeat(31) },
    '이름은 30자 이내로 입력하세요',
  ],
] as const) {
  test(`creating with ${label} is rejected before the database`, async () => {
    const { pool, queries } = fakePool();
    await withApi(pool, async (call) => {
      const { status, data } = await call('/api/categories', post(body));
      assert.equal(status, 400);
      assert.deepEqual(data, { error: message });
      assert.equal(queries.length, 0);
    });
  });
}

test('a 30-character name is accepted', async () => {
  const name = '가'.repeat(30);
  const { pool, queries } = fakePool({ rows: [{ ...row, name }] });
  await withApi(pool, async (call) => {
    const { status } = await call('/api/categories', post({ kind: 'expense', name }));
    assert.equal(status, 201);
    assert.deepEqual(queries[0].values, ['expense', name]);
  });
});

test('a duplicate name becomes a Korean 409 when creating and when renaming', async () => {
  const { pool } = fakePool({
    error: Object.assign(new Error('duplicate key'), { code: '23505' }),
  });
  const message = { error: '같은 종류에 같은 이름의 카테고리가 있습니다' };
  await withApi(pool, async (call) => {
    const created = await call('/api/categories', post({ kind: 'expense', name: '식비' }));
    assert.equal(created.status, 409);
    assert.deepEqual(created.data, message);
    const renamed = await call('/api/categories/7', patch({ name: '식비' }));
    assert.equal(renamed.status, 409);
    assert.deepEqual(renamed.data, message);
  });
});

test('updating sends only the given fields and leaves the rest to the database', async () => {
  const { pool, queries } = fakePool({ rows: [row] });
  await withApi(pool, async (call) => {
    const renamed = await call('/api/categories/7', patch({ name: ' 외식 ' }));
    assert.equal(renamed.status, 200);
    assert.deepEqual(renamed.data, { category });
    assert.deepEqual(queries[0].values, [7, '외식', null]);

    await call('/api/categories/7', patch({ hidden: true }));
    assert.deepEqual(queries[1].values, [7, null, true]);

    await call('/api/categories/7', patch({ hidden: false }));
    assert.deepEqual(queries[2].values, [7, null, false]);
  });
});

test('an update with nothing to change is rejected', async () => {
  const { pool, queries } = fakePool();
  await withApi(pool, async (call) => {
    const { status, data } = await call('/api/categories/7', patch({}));
    assert.equal(status, 400);
    assert.deepEqual(data, { error: '바꿀 내용을 입력하세요' });
    assert.equal(queries.length, 0);
  });
});

test('the kind cannot be changed through an update', async () => {
  const { pool, queries } = fakePool();
  await withApi(pool, async (call) => {
    const { status } = await call('/api/categories/7', patch({ kind: 'income' }));
    assert.equal(status, 400);
    assert.equal(queries.length, 0);
  });
});

test('updating a missing category answers 404', async () => {
  const { pool } = fakePool({ rows: [] });
  await withApi(pool, async (call) => {
    const { status, data } = await call('/api/categories/999', patch({ hidden: true }));
    assert.equal(status, 404);
    assert.deepEqual(data, { error: '카테고리를 찾을 수 없습니다' });
  });
});

test('an invalid id answers 400 before the database', async () => {
  const { pool, queries } = fakePool();
  await withApi(pool, async (call) => {
    const { status, data } = await call('/api/categories/abc', patch({ hidden: true }));
    assert.equal(status, 400);
    assert.deepEqual(data, { error: '카테고리 ID가 올바르지 않습니다' });
    assert.equal(queries.length, 0);
  });
});

test('a malformed JSON body answers 400 instead of a server error', async () => {
  const { pool, queries } = fakePool();
  await withApi(pool, async (call) => {
    const { status, data } = await call('/api/categories', { method: 'POST', rawBody: '{oops' });
    assert.equal(status, 400);
    assert.deepEqual(data, { error: '요청 본문의 JSON 형식이 올바르지 않습니다' });
    assert.equal(queries.length, 0);
  });
});

test('a database failure stays a generic 500', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const { pool } = fakePool({ error: new Error('connection refused') });
    await withApi(pool, async (call) => {
      const { status, data } = await call('/api/categories');
      assert.equal(status, 500);
      assert.deepEqual(data, { error: '서버 오류가 발생했습니다' });
    });
  } finally {
    console.error = original;
  }
});
