// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/lib/
import { afterEach, expect, test, vi } from 'vitest';

import { aiOrigin, ChatError, type ChatEvent, confirmToolCall, parseEventBlock, streamChat } from './ai-chat';

afterEach(() => {
  vi.unstubAllGlobals();
});

function sse(...events: unknown[]) {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  // Split in the middle of an event to prove the parser buffers across chunks.
  const cut = Math.floor(text.length / 2);
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text.slice(0, cut)));
        controller.enqueue(encoder.encode(text.slice(cut)));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

const base = { origin: 'https://ai.daysofme.com', message: 'hi', context: { app: 'a', page: '/' } };

test('aiOrigin gives the AI service of a subdomain and nothing elsewhere', () => {
  expect(aiOrigin({ protocol: 'https:', hostname: 'workout-memo.daysofme.com' }, 'daysofme.com')).toBe(
    'https://ai.daysofme.com',
  );
  expect(aiOrigin({ protocol: 'https:', hostname: 'daysofme.com' }, 'daysofme.com')).toBeNull();
  expect(aiOrigin({ protocol: 'http:', hostname: 'localhost' }, 'daysofme.com')).toBeNull();
  expect(aiOrigin({ protocol: 'https:', hostname: 'app.example.com' }, 'daysofme.com')).toBeNull();
  expect(aiOrigin({ protocol: 'https:', hostname: 'x.daysofme.com' }, '')).toBeNull();
});

test('parseEventBlock reads known events and skips the rest', () => {
  expect(parseEventBlock('data: {"type":"text","delta":"Hi"}')).toEqual({ type: 'text', delta: 'Hi' });
  expect(parseEventBlock(': keep-alive')).toBeNull();
  expect(parseEventBlock('data: not json')).toBeNull();
  expect(parseEventBlock('data: {"type":"other"}')).toBeNull();
});

test('streamChat posts with the cookie and the guard header and delivers events in order', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(sse({ type: 'text', delta: 'Hel' }, { type: 'text', delta: 'lo' }, { type: 'done', conversationId: 'c1' }));
  vi.stubGlobal('fetch', fetchMock);
  const events: ChatEvent[] = [];
  await streamChat({ ...base, context: { app: 'workout-memo', page: '/' }, onEvent: (event) => events.push(event) });
  expect(events.map((event) => event.type)).toEqual(['text', 'text', 'done']);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://ai.daysofme.com/api/chat');
  expect(init.credentials).toBe('include');
  expect((init.headers as Record<string, string>)['x-requested-with']).toBe('ai-shell');
  expect(JSON.parse(init.body as string)).toEqual({
    messages: [{ role: 'user', content: 'hi' }],
    context: { app: 'workout-memo', page: '/' },
  });
});

test('streamChat rejects with the server message on a failed answer', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Sign in first' }), { status: 401 })));
  await expect(streamChat({ ...base, onEvent: () => {} })).rejects.toMatchObject({
    name: 'ChatError',
    message: 'Sign in first',
    status: 401,
  });
});

test('streamChat says when the service cannot be reached', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
  await expect(streamChat({ ...base, onEvent: () => {} })).rejects.toThrow('Cannot reach the AI service');
});

test('confirmToolCall sends the answer and reports an error from the server', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  await confirmToolCall({ origin: base.origin, conversationId: 'c1', callId: 't1', approve: false });
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://ai.daysofme.com/api/chat/confirm');
  expect(JSON.parse(init.body as string)).toEqual({ conversationId: 'c1', callId: 't1', approve: false });

  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Unknown call' }), { status: 404 }));
  await expect(
    confirmToolCall({ origin: base.origin, conversationId: 'c1', callId: 'x', approve: true }),
  ).rejects.toBeInstanceOf(ChatError);
});
