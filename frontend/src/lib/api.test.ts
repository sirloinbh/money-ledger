// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/lib/에서
import { afterEach, expect, test, vi } from 'vitest';

import { RequestError, requestJson } from './api';

const reply = (status: number, body?: unknown) =>
  vi.fn(() =>
    Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

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
