import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// #195 Today's save on app open: once per service day and page load, and tried again after a failure.

let posts: number;
let fail: boolean;

// A fresh module for each test: the save is remembered for the life of the page.
let saveTodayOnce: typeof import('./net-worth').saveTodayOnce;
beforeEach(async () => {
  posts = 0;
  fail = false;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T10:00:00+09:00'));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      posts += 1;
      return Promise.resolve(
        fail
          ? new Response(JSON.stringify({ error: 'down' }), { status: 500 })
          : new Response(JSON.stringify({ snapshot: {} }), { status: 200 }),
      );
    }),
  );
  vi.resetModules();
  ({ saveTodayOnce } = await import('./net-worth'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a day is saved once', async () => {
  await saveTodayOnce();
  await saveTodayOnce();
  expect(posts).toBe(1);
});

test('a failed save is quiet and the next open of a card tries again', async () => {
  fail = true;
  await expect(saveTodayOnce()).resolves.toBeUndefined();
  fail = false;
  await saveTodayOnce();
  await saveTodayOnce();
  expect(posts).toBe(2);
});

test('a tab still open after midnight in Seoul saves the new day', async () => {
  await saveTodayOnce();
  // 23:59 is still the same service day.
  vi.setSystemTime(new Date('2026-11-22T23:59:00+09:00'));
  await saveTodayOnce();
  expect(posts).toBe(1);
  vi.setSystemTime(new Date('2026-11-23T00:01:00+09:00'));
  await saveTodayOnce();
  expect(posts).toBe(2);
});
