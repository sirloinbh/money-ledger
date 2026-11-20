// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/layout/
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';

import { AiShell } from './ai-shell';

afterEach(() => {
  vi.unstubAllGlobals();
});

function sseResponse(...events: unknown[]) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function openPanel() {
  render(
    <MemoryRouter initialEntries={['/workouts']}>
      <AiShell origin="https://ai.daysofme.com" />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'AI assistant' }));
}

function ask(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

const addWorkout = {
  type: 'tool_call',
  id: 't1',
  app: 'workout-memo',
  tool: 'add_workout',
  input: { name: 'Run' },
  readOnly: false,
  needsConfirmation: true,
};

test('there is no button where no AI service exists', () => {
  render(
    <MemoryRouter>
      <AiShell origin={null} />
    </MemoryRouter>,
  );
  expect(screen.queryByRole('button', { name: 'AI assistant' })).toBeNull();
});

test('a read tool runs without a question and the answer streams in', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    sseResponse(
      { type: 'tool_call', id: 't1', app: 'workout-memo', tool: 'list_workouts', input: {}, readOnly: true },
      { type: 'tool_result', id: 't1', ok: true, summary: '2 workouts' },
      { type: 'text', delta: 'You did 2 workouts.' },
      { type: 'done', conversationId: 'c1' },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  openPanel();
  ask('What did I do?');
  expect(await screen.findByText('You did 2 workouts.')).toBeInTheDocument();
  expect(screen.getByText('workout-memo: list_workouts')).toBeInTheDocument();
  expect(screen.getByText('2 workouts')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
  expect(body.context.page).toBe('/workouts');
});

test('a tool that changes data waits for Allow, then confirms with the server', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(sseResponse(addWorkout, { type: 'done', conversationId: 'c1' }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  openPanel();
  ask('Add a run');
  fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
  expect(url).toBe('https://ai.daysofme.com/api/chat/confirm');
  expect(JSON.parse(init.body as string)).toEqual({ conversationId: 'c1', callId: 't1', approve: true });
  expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
});

test('Refuse sends approve false and marks the call refused', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(sseResponse(addWorkout, { type: 'done', conversationId: 'c1' }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  openPanel();
  ask('Add a run');
  fireEvent.click(await screen.findByRole('button', { name: 'Refuse' }));
  await waitFor(() => expect(screen.getByText(/Refused/)).toBeInTheDocument());
  const init = (fetchMock.mock.calls[1] as [string, RequestInit])[1];
  expect(JSON.parse(init.body as string).approve).toBe(false);
});

test('the monthly limit is shown as a status message', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(sseResponse({ type: 'limit', message: 'The monthly AI limit is reached.' })),
  );
  openPanel();
  ask('Hello');
  expect(await screen.findByRole('status')).toHaveTextContent('The monthly AI limit is reached.');
});

test('a failed request shows an alert', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
  openPanel();
  ask('Hello');
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the AI service');
});

// A streamed answer that stays open until the request is aborted, like a real fetch.
function openStream(signal: AbortSignal | undefined) {
  return new Response(
    new ReadableStream({
      start(controller) {
        signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

test('a turn cancelled by New conversation does not end the busy state of the next turn', async () => {
  const fetchMock = vi
    .fn()
    .mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(openStream(init.signal as AbortSignal)),
    );
  vi.stubGlobal('fetch', fetchMock);
  openPanel();
  ask('first');
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
  ask('second');
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  // Let the cancelled first request settle.
  await new Promise((resolve) => setTimeout(resolve, 20));
  ask('third');
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('closing the panel keeps the conversation and the draft', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(sseResponse({ type: 'text', delta: 'Hello there.' }, { type: 'done', conversationId: 'c1' })),
  );
  openPanel();
  ask('Hi');
  expect(await screen.findByText('Hello there.')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'half a sentence' } });
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'AI assistant' }));
  expect(await screen.findByText('Hello there.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('half a sentence');
});

// jsdom does no layout: give the log element a size and remember where it is scrolled to.
function sizeLog(log: HTMLElement, { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  let top = 0;
  Object.defineProperty(log, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(log, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(log, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => (top = value) });
}

test('the conversation scrolls to the newest message', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse({ type: 'text', delta: 'Done.' }, { type: 'done', conversationId: 'c1' })));
  openPanel();
  const log = screen.getByRole('log');
  sizeLog(log, { scrollHeight: 900, clientHeight: 300 });
  ask('Hi');
  expect(await screen.findByText('Done.')).toBeInTheDocument();
  expect(log.scrollTop).toBe(900);
});

test('the conversation stays where the user scrolled to', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse({ type: 'text', delta: 'Done.' }, { type: 'done', conversationId: 'c1' })));
  openPanel();
  const log = screen.getByRole('log');
  sizeLog(log, { scrollHeight: 900, clientHeight: 300 });
  fireEvent.scroll(log); // scrollTop is 0: the user is far from the bottom
  ask('Hi');
  expect(await screen.findByText('Done.')).toBeInTheDocument();
  expect(log.scrollTop).toBe(0);
});

// The real server holds the stream open while it waits for Allow and sends `done` only afterwards, so the
// conversation id has to arrive before `done` (a `start` event) for the first message of a conversation.
function heldStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c;
    },
  });
  const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  const response = new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  return { response, send, close: () => controller.close() };
}

test('Allow works while the stream is still open: the conversation id comes with the start event', async () => {
  const stream = heldStream();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(stream.response)
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  openPanel();
  ask('Add a run');
  stream.send({ type: 'start', conversationId: 'c1' });
  stream.send(addWorkout);
  fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
  expect(url).toBe('https://ai.daysofme.com/api/chat/confirm');
  expect(JSON.parse(init.body as string)).toEqual({ conversationId: 'c1', callId: 't1', approve: true });
  stream.send({ type: 'tool_result', id: 't1', ok: true, summary: 'Added' });
  stream.send({ type: 'done', conversationId: 'c1' });
  stream.close();
  expect(await screen.findByText('Added')).toBeInTheDocument();
});

test('Allow without a conversation id shows an error instead of doing nothing', async () => {
  const stream = heldStream();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(stream.response));
  openPanel();
  ask('Add a run');
  stream.send(addWorkout);
  fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/start a new conversation/i);
  stream.close();
});

test('a failed confirm shows the error and marks the call failed', async () => {
  const stream = heldStream();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(stream.response)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'No change is waiting for an answer' }), { status: 404 })),
  );
  openPanel();
  ask('Add a run');
  stream.send({ type: 'start', conversationId: 'c1' });
  stream.send(addWorkout);
  fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No change is waiting for an answer');
  stream.close();
});
