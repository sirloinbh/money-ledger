// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/
import { renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { healthText, useHealth } from './health';

const answer = (status: number, body: string) => () => Promise.resolve(new Response(body, { status }));

afterEach(() => {
  vi.unstubAllGlobals();
});

test('healthText covers every state', () => {
  expect(healthText({ state: 'loading' })).toBe('Checking server…');
  expect(healthText({ state: 'ok', today: '2026-11-19' })).toBe('Server connected · 2026-11-19');
  expect(healthText({ state: 'ok', today: '' })).toBe('Server connected');
  expect(healthText({ state: 'error', message: 'down' })).toBe('down');
});

test('ok: a JSON answer reports the server as connected', async () => {
  vi.stubGlobal('fetch', vi.fn(answer(200, '{"status":"ok"}')));
  const { result } = renderHook(() => useHealth());
  expect(result.current).toEqual({ state: 'loading' });
  await vi.waitFor(() => expect(result.current).toEqual({ state: 'ok', today: '' }));
});

test('non-JSON error: a proxy error page shows the request message, not a parse error', async () => {
  vi.stubGlobal('fetch', vi.fn(answer(502, '<html>Bad Gateway</html>')));
  const { result } = renderHook(() => useHealth());
  await vi.waitFor(() =>
    expect(result.current).toEqual({ state: 'error', message: 'Could not process the request' }),
  );
});

test('network error: an unreachable server shows the fixed message', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
  const { result } = renderHook(() => useHealth());
  await vi.waitFor(() =>
    expect(result.current).toEqual({ state: 'error', message: 'Cannot reach the server' }),
  );
});

test('recovery: it checks again after an outage and turns ok', async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockImplementation(answer(200, '{"status":"ok"}'));
  vi.stubGlobal('fetch', fetch);
  const { result } = renderHook(() => useHealth(300));
  await vi.waitFor(() => expect(result.current.state).toBe('error'));
  await vi.waitFor(() => expect(result.current.state).toBe('ok'));
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('unmount aborts the pending check and stops retrying', async () => {
  let signal: AbortSignal | undefined;
  const fetch = vi.fn((_path: string, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>(() => undefined);
  });
  vi.stubGlobal('fetch', fetch);
  const { unmount } = renderHook(() => useHealth(20));
  expect(fetch).toHaveBeenCalledTimes(1);
  unmount();
  expect(signal?.aborted).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(fetch).toHaveBeenCalledTimes(1);
});
