import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { KakaoSettings } from './kakao-settings';
import { renderWithQuery } from './test/query';

type Call = { url: string; method: string };
let calls: Call[];
let status: { configured: boolean; state: string; connectedAt: string | null };
let answers: Record<string, { status: number; body?: unknown }>;
const assign = vi.fn();

beforeEach(() => {
  calls = [];
  answers = {};
  status = { configured: true, state: 'disconnected', connectedAt: null };
  assign.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      const key = `${method} ${url}`;
      const answer =
        answers[key] ??
        (key === 'GET /api/kakao/status' ? { status: 200, body: status } : undefined);
      if (!answer) return Promise.reject(new Error(`unexpected ${key}`));
      return Promise.resolve(
        new Response(answer.status === 204 ? null : JSON.stringify(answer.body ?? {}), {
          status: answer.status,
        }),
      );
    }),
  );
  vi.stubGlobal('location', { ...window.location, assign, search: '', pathname: '/settings' });
});

afterEach(() => vi.unstubAllGlobals());

const card = () => screen.findByRole('heading', { level: 2, name: 'KakaoTalk' });

test('not connected: Connect starts the Kakao login at the URL the server gave', async () => {
  answers['POST /api/kakao/connect'] = { status: 200, body: { url: 'https://kauth.kakao.com/x' } };
  renderWithQuery(<KakaoSettings />);
  await card();
  expect(await screen.findByText('Not connected.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send test message' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('https://kauth.kakao.com/x'));
});

test('connected: shows since when, sends a test message and reports it', async () => {
  status = { configured: true, state: 'connected', connectedAt: '2026-11-24T01:00:00Z' };
  answers['POST /api/kakao/test'] = { status: 200, body: { sent: true } };
  renderWithQuery(<KakaoSettings />);
  expect(await screen.findByText(/Connected\. Since/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Send test message' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Test message sent'));
  expect(calls).toContainEqual({ url: '/api/kakao/test', method: 'POST' });
});

test('a revoked token shows Reconnect, and a failed test shows the server’s message', async () => {
  status = { configured: true, state: 'revoked', connectedAt: null };
  renderWithQuery(<KakaoSettings />);
  expect(await screen.findByText(/access was revoked or expired/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Send test message' })).toBeNull();
});

test('a test that Kakao refuses shows the error', async () => {
  status = { configured: true, state: 'connected', connectedAt: '2026-11-24T01:00:00Z' };
  answers['POST /api/kakao/test'] = {
    status: 409,
    body: { error: 'KakaoTalk access was revoked. Reconnect KakaoTalk' },
  };
  renderWithQuery(<KakaoSettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send test message' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Reconnect KakaoTalk'));
});

test('Disconnect asks first, then deletes the connection', async () => {
  status = { configured: true, state: 'connected', connectedAt: '2026-11-24T01:00:00Z' };
  answers['DELETE /api/kakao/connection'] = { status: 204 };
  renderWithQuery(<KakaoSettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
  const dialog = await screen.findByRole('dialog');
  expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  status = { configured: true, state: 'disconnected', connectedAt: null };
  fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('KakaoTalk disconnected'),
  );
  expect(await screen.findByText('Not connected.')).toBeInTheDocument();
});

test('without server settings it says so and offers no button', async () => {
  status = { configured: false, state: 'not-configured', connectedAt: null };
  renderWithQuery(<KakaoSettings />);
  expect(await screen.findByText(/Not set up on the server yet/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});

test('coming back from the login says it connected and cleans the address', async () => {
  vi.stubGlobal('location', {
    ...window.location,
    assign,
    search: '?kakao=connected',
    pathname: '/settings',
  });
  const replace = vi.spyOn(window.history, 'replaceState');
  renderWithQuery(<KakaoSettings />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('KakaoTalk connected'));
  expect(replace).toHaveBeenCalledWith(null, '', '/settings');
});

test('coming back after a refused login shows an error', async () => {
  vi.stubGlobal('location', {
    ...window.location,
    assign,
    search: '?kakao=failed',
    pathname: '/settings',
  });
  renderWithQuery(<KakaoSettings />);
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('could not be connected'),
  );
});
