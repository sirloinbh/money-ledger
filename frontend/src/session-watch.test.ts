// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/
import { expect, test, vi } from 'vitest';

import { clearRedirectMark, createUnauthorizedHandler, LOOP_WINDOW_MS, REDIRECT_KEY } from './session-watch';

// #596, #669: a 401 sends the visitor to sign-in once; a 401 right after coming back shows an error instead.
const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

test('the first 401 redirects once, however many requests fail together', () => {
  const redirect = vi.fn();
  const onLoop = vi.fn();
  const handle = createUnauthorizedHandler({ storage: memory(), redirect, onLoop });
  handle();
  handle();
  handle();
  expect(redirect).toHaveBeenCalledOnce();
  expect(onLoop).not.toHaveBeenCalled();
});

test('a 401 right after a redirect stops instead of redirecting again', () => {
  const storage = memory();
  let time = 1_000_000;
  const redirect = vi.fn();
  const onLoop = vi.fn();
  createUnauthorizedHandler({ storage, redirect, onLoop, now: () => time })();
  time += 5_000; // the page reloaded after sign-in and its first request answered 401 again
  createUnauthorizedHandler({ storage, redirect, onLoop, now: () => time })();
  expect(redirect).toHaveBeenCalledOnce();
  expect(onLoop).toHaveBeenCalledOnce();
});

test('a session that ends long after the last redirect redirects again', () => {
  const storage = memory();
  let time = 1_000_000;
  const redirect = vi.fn();
  const onLoop = vi.fn();
  createUnauthorizedHandler({ storage, redirect, onLoop, now: () => time })();
  time += LOOP_WINDOW_MS + 1;
  createUnauthorizedHandler({ storage, redirect, onLoop, now: () => time })();
  expect(redirect).toHaveBeenCalledTimes(2);
  expect(onLoop).not.toHaveBeenCalled();
});

test('the retry button clears the mark, so the next attempt redirects', () => {
  const storage = memory();
  const redirect = vi.fn();
  createUnauthorizedHandler({ storage, redirect, onLoop: vi.fn() })();
  expect(storage.getItem(REDIRECT_KEY)).not.toBeNull();
  clearRedirectMark(storage);
  createUnauthorizedHandler({ storage, redirect, onLoop: vi.fn() })();
  expect(redirect).toHaveBeenCalledTimes(2);
});

test('blocked storage still redirects', () => {
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
  const redirect = vi.fn();
  createUnauthorizedHandler({ storage: blocked, redirect, onLoop: vi.fn() })();
  createUnauthorizedHandler({ storage: undefined, redirect, onLoop: vi.fn() })();
  clearRedirectMark(blocked);
  expect(redirect).toHaveBeenCalledTimes(2);
});
