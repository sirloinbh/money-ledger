// Managed file. Edit it in sirloinbh/project-standards templates/query/frontend/src/lib/
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { RequestError } from './api';
import { apiKey, createQueryClient, shouldRetry, useApiMutation, useApiQuery } from './query';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function setup(fetch: ReturnType<typeof vi.fn>, config = {}) {
  vi.stubGlobal('fetch', fetch);
  const client = createQueryClient({ defaultOptions: { queries: { retryDelay: 0 } }, ...config });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

// Each test ends without a late request (#980). The rendered hooks unmount first: the app's own cleanup runs after
// this hook, and a stale query still mounted would read again when focus resets below. A fetch that fails the test
// stands in while focus resets, so a query left mounted shows up here instead of as a stray request in the app.
afterEach(async () => {
  cleanup();
  const late = vi.fn(() => Promise.reject(new Error('request after the test ended')));
  vi.stubGlobal('fetch', late);
  focusManager.setFocused(undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
  expect(late).not.toHaveBeenCalled();
});

test('shouldRetry allows one more try for network, timeout and 5xx failures only', () => {
  expect(shouldRetry(0, new RequestError('x', undefined, 'network'))).toBe(true);
  expect(shouldRetry(0, new RequestError('x', undefined, 'timeout'))).toBe(true);
  expect(shouldRetry(0, new RequestError('x', 503, 'http'))).toBe(true);
  expect(shouldRetry(1, new RequestError('x', 503, 'http'))).toBe(false);
  expect(shouldRetry(0, new RequestError('x', 404, 'http'))).toBe(false);
  expect(shouldRetry(0, new RequestError('x', 400, 'http'))).toBe(false);
  expect(shouldRetry(0, new RequestError('x', undefined, 'abort'))).toBe(false);
  expect(shouldRetry(0, new Error('not a request error'))).toBe(false);
});

test('createQueryClient sets the shared defaults and lets a caller override them', () => {
  const defaults = createQueryClient().getDefaultOptions();
  expect(defaults.queries).toMatchObject({ staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: true });
  expect(defaults.mutations).toMatchObject({ retry: false });
  const custom = createQueryClient({ defaultOptions: { queries: { staleTime: 0 } } }).getDefaultOptions();
  expect(custom.queries).toMatchObject({ staleTime: 0, retry: shouldRetry });
});

test('apiKey puts the path first and the parts after it', () => {
  expect(apiKey('/api/goals')).toEqual(['/api/goals']);
  expect(apiKey('/api/goals', 7, 'open')).toEqual(['/api/goals', 7, 'open']);
});

test('useApiQuery loads the path, and leaving the screen aborts the request', async () => {
  let signal: AbortSignal | undefined;
  // /api/slow never answers on its own, so it is still in flight when the screen goes away; it ends only
  // when its signal aborts. A timed answer could arrive before the unmount on a busy machine (#981).
  const fetch = vi.fn((path: string, init?: RequestInit) => {
    if (path !== '/api/slow') return Promise.resolve(json(200, [{ id: 1 }]));
    signal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) =>
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
    );
  });
  const { wrapper } = setup(fetch);
  const done = renderHook(() => useApiQuery<{ id: number }[]>(apiKey('/api/goals'), '/api/goals'), { wrapper });
  await waitFor(() => expect(done.result.current.data).toEqual([{ id: 1 }]));
  expect(fetch).toHaveBeenCalledWith('/api/goals', expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }));

  const pending = renderHook(() => useApiQuery(apiKey('/api/slow'), '/api/slow'), { wrapper });
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/slow', expect.anything()));
  pending.unmount();
  await waitFor(() => expect(signal?.aborted).toBe(true));
});

test('a 4xx answer is not retried and keeps the server message; a 5xx is retried once', async () => {
  const missing = vi.fn(() => Promise.resolve(json(404, { error: 'Goal not found' })));
  const first = setup(missing);
  const a = renderHook(() => useApiQuery(apiKey('/api/goals/9'), '/api/goals/9'), { wrapper: first.wrapper });
  await waitFor(() => expect(a.result.current.isError).toBe(true));
  expect(a.result.current.error).toMatchObject({ message: 'Goal not found', status: 404 });
  expect(missing).toHaveBeenCalledTimes(1);

  const flaky = vi.fn().mockResolvedValueOnce(json(503, { error: 'Busy' })).mockResolvedValue(json(200, { ok: true }));
  const second = setup(flaky);
  const b = renderHook(() => useApiQuery(apiKey('/api/health'), '/api/health'), { wrapper: second.wrapper });
  await waitFor(() => expect(b.result.current.data).toEqual({ ok: true }));
  expect(flaky).toHaveBeenCalledTimes(2);
});

test('a revisited screen shows cached data without a request while it is fresh', async () => {
  const fetch = vi.fn(() => Promise.resolve(json(200, ['a'])));
  const { wrapper } = setup(fetch);
  const first = renderHook(() => useApiQuery<string[]>(apiKey('/api/tags'), '/api/tags'), { wrapper });
  await waitFor(() => expect(first.result.current.data).toEqual(['a']));
  first.unmount();
  const again = renderHook(() => useApiQuery<string[]>(apiKey('/api/tags'), '/api/tags'), { wrapper });
  expect(again.result.current.data).toEqual(['a']);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('stale data is refetched when the window gets focus again', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json(200, ['old'])).mockResolvedValue(json(200, ['new']));
  const { wrapper } = setup(fetch, { defaultOptions: { queries: { staleTime: 0, retryDelay: 0 } } });
  const { result } = renderHook(() => useApiQuery<string[]>(apiKey('/api/tags'), '/api/tags'), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual(['old']));
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() => expect(result.current.data).toEqual(['new']));
});

test('a mutation sends its request, then refetches the invalidated keys before it ends', async () => {
  const calls: string[] = [];
  const fetch = vi.fn((path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (init?.method === 'POST') return Promise.resolve(json(201, { id: 2 }));
    return Promise.resolve(json(200, calls.filter((c) => c.startsWith('POST')).length ? ['a', 'b'] : ['a']));
  });
  const { wrapper } = setup(fetch);
  const list = renderHook(() => useApiQuery<string[]>(apiKey('/api/goals'), '/api/goals'), { wrapper });
  await waitFor(() => expect(list.result.current.data).toEqual(['a']));
  const onSuccess = vi.fn();
  const save = renderHook(
    () => useApiMutation<{ id: number }, { name: string }>((variables) => ({ path: '/api/goals', body: variables }), { invalidate: [apiKey('/api/goals')], onSuccess }),
    { wrapper },
  );
  await act(async () => {
    await save.result.current.mutateAsync({ name: 'Run' });
  });
  expect(calls).toEqual(['GET /api/goals', 'POST /api/goals', 'GET /api/goals']);
  expect(fetch).toHaveBeenCalledWith('/api/goals', expect.objectContaining({ method: 'POST', body: '{"name":"Run"}' }));
  expect(onSuccess).toHaveBeenCalledWith({ id: 2 }, { name: 'Run' });
  await waitFor(() => expect(list.result.current.data).toEqual(['a', 'b']));
});

test('a first read that started before a write and answers last is not what the screen shows (#1008)', async () => {
  let saved = false;
  const resolvers: Array<() => void> = [];
  const fetch = vi.fn((_path: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      saved = true;
      return Promise.resolve(json(201, { id: 2 }));
    }
    // A read answers with what the server holds when it was started: the first one holds the old rows.
    const before = !saved;
    return new Promise<Response>((resolve) => {
      resolvers.push(() => resolve(json(200, before ? ['old'] : ['saved'])));
    });
  });
  const { wrapper } = setup(fetch);
  const list = renderHook(() => useApiQuery<string[]>(apiKey('/api/goals'), '/api/goals'), { wrapper });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const save = renderHook(() => useApiMutation<{ id: number }, string>((name) => ({ path: '/api/goals', body: { name } }), { invalidate: [apiKey('/api/goals')] }), { wrapper });
  const writing = act(async () => {
    await save.result.current.mutateAsync('Run');
  });
  // GET (before the write), POST, then the GET that starts after it.
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  resolvers[1]?.();
  await writing;
  resolvers[0]?.();
  await waitFor(() => expect(list.result.current.data).toEqual(['saved']));
});

test('a mutation sends the request headers it is given, next to the JSON content type', async () => {
  const fetch = vi.fn(() => Promise.resolve(json(201, { id: 3 })));
  const { wrapper } = setup(fetch);
  const { result } = renderHook(
    () => useApiMutation<{ id: number }, string>((key) => ({ path: '/api/meals', body: { name: 'Rice' }, headers: { 'Idempotency-Key': key } })),
    { wrapper },
  );
  await act(async () => {
    await result.current.mutateAsync('add-1');
  });
  expect(fetch).toHaveBeenCalledWith(
    '/api/meals',
    expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'Idempotency-Key': 'add-1', 'content-type': 'application/json' }) as unknown }),
  );
});

test('a failed mutation is not retried and reports the error', async () => {
  const fetch = vi.fn(() => Promise.resolve(json(400, { error: 'Name is required' })));
  const { wrapper } = setup(fetch);
  const onError = vi.fn();
  const { result } = renderHook(() => useApiMutation<unknown, void>(() => ({ path: '/api/goals', method: 'POST', body: {} }), { onError }), { wrapper });
  await act(async () => {
    await result.current.mutateAsync().catch(() => undefined);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Name is required', status: 400 }));
});
