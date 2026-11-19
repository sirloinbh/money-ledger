// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/lib/
import { afterEach, expect, test, vi } from 'vitest';

import { RequestError, requestForm, requestJson } from './api';

const reply = (status: number, body?: unknown) =>
  vi.fn(() =>
    Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A fetch that never answers until its signal aborts, like a hung request. */
const hung = () =>
  vi.fn(
    (_path: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
      }),
  );

test('a JSON body is sent with its content type and the reply body comes back', async () => {
  const fetch = reply(201, { item: { id: 1 } });
  vi.stubGlobal('fetch', fetch);
  await expect(
    requestJson('/api/items', { method: 'POST', body: { name: 'Book' } }),
  ).resolves.toEqual({
    item: { id: 1 },
  });
  expect(fetch).toHaveBeenCalledWith('/api/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"name":"Book"}',
    signal: expect.any(AbortSignal) as AbortSignal,
  });
});

test('204 No Content resolves with undefined', async () => {
  vi.stubGlobal('fetch', reply(204));
  await expect(requestJson('/api/items/1', { method: 'DELETE' })).resolves.toBeUndefined();
});

test("a failed request rejects with the server's message and status", async () => {
  vi.stubGlobal('fetch', reply(404, { error: 'Textbook not found' }));
  const error = await requestJson('/api/items/9').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RequestError);
  expect(error).toMatchObject({ message: 'Textbook not found', status: 404 });
});

test('a failure without a usable message and an unreachable server have fixed messages', async () => {
  vi.stubGlobal('fetch', reply(502));
  await expect(requestJson('/api/items')).rejects.toMatchObject({
    message: 'Could not process the request',
    status: 502,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  );
  await expect(requestJson('/api/items')).rejects.toMatchObject({
    message: 'Cannot reach the server',
    status: undefined,
  });
});

test('a 2xx answer with a non-JSON or empty body rejects with kind body', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('<html>proxy</html>', { status: 200 }))),
  );
  await expect(requestJson('/api/items')).rejects.toMatchObject({ kind: 'body', status: 200 });
  vi.stubGlobal('fetch', reply(200));
  await expect(requestJson('/api/items')).rejects.toMatchObject({ kind: 'body', status: 200 });
});

test('a non-2xx answer keeps kind http, and an unreachable server is kind network', async () => {
  vi.stubGlobal('fetch', reply(500, { error: 'Boom' }));
  await expect(requestJson('/api/items')).rejects.toMatchObject({ kind: 'http', status: 500 });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  );
  await expect(requestJson('/api/items')).rejects.toMatchObject({ kind: 'network' });
});

test("aborting the caller's signal rejects with kind abort", async () => {
  vi.stubGlobal('fetch', hung());
  const controller = new AbortController();
  const pending = requestJson('/api/items', { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ kind: 'abort' });
  await expect(requestJson('/api/items', { signal: controller.signal })).rejects.toMatchObject({
    kind: 'abort',
  });
});

test('a hung request rejects with kind timeout after the timeout', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', hung());
  const pending = requestJson('/api/items', { timeoutMs: 1000 });
  const result = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
  await vi.advanceTimersByTimeAsync(1000);
  await result;
});

test('extra headers are sent, and requestForm sends the form without a content type', async () => {
  const fetch = reply(200, { ok: true });
  vi.stubGlobal('fetch', fetch);
  await requestJson('/api/items', { headers: { 'x-trace': '1' } });
  expect(fetch).toHaveBeenLastCalledWith(
    '/api/items',
    expect.objectContaining({ headers: { 'x-trace': '1' } }),
  );
  const form = new FormData();
  form.append('file', new Blob(['a']), 'a.txt');
  await expect(requestForm('/api/upload', form)).resolves.toEqual({ ok: true });
  expect(fetch).toHaveBeenLastCalledWith(
    '/api/upload',
    expect.objectContaining({ method: 'POST', body: form, headers: undefined }),
  );
});
