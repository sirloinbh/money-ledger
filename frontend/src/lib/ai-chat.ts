// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/lib/
// Client for the AI shell (#612, ADR-0017): talks to shared-ai at https://ai.<root domain> with the shared
// session cookie. The answer is a server-sent event stream; every event is one JSON object.

/** The AI service origin for this address: workout-memo.daysofme.com → https://ai.daysofme.com. Null on local, IP, apex and foreign hosts, where the shell is hidden. */
export function aiOrigin(
  { protocol, hostname }: { protocol: string; hostname: string },
  rootDomain: string,
): string | null {
  const host = hostname.toLowerCase();
  const root = rootDomain.toLowerCase();
  if (!root || !host.endsWith(`.${root}`)) return null;
  const prefix = host.slice(0, -(root.length + 1));
  if (!prefix || prefix.startsWith('.') || prefix.endsWith('.')) return null;
  return `${protocol}//ai.${root}`;
}

// Every POST carries this header; shared-ai refuses a POST without it (CSRF guard, with the CORS allow list).
const GUARD = { 'x-requested-with': 'ai-shell' };

export type ChatContext = { app: string; page: string };

export type ToolCallInfo = {
  id: string;
  app: string;
  tool: string;
  input: unknown;
  /** False for a tool that changes data: the owner must confirm it first. */
  readOnly: boolean;
  needsConfirmation?: boolean;
};

export type ChatEvent =
  // The first event of a turn: the id is needed to answer a confirmation while the stream is still open.
  | { type: 'start'; conversationId: string }
  | { type: 'text'; delta: string }
  | ({ type: 'tool_call' } & ToolCallInfo)
  | { type: 'tool_result'; id: string; ok: boolean; summary?: string }
  | { type: 'limit'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; conversationId: string };

export class ChatError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ChatError';
    this.status = status;
  }
}

/** Splits an event stream into JSON events. Lines starting with `data:` carry the payload; others are ignored. */
export function parseEventBlock(block: string): ChatEvent | null {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!data) return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  const event = value as { type?: unknown };
  if (typeof event?.type !== 'string') return null;
  return ['start', 'text', 'tool_call', 'tool_result', 'limit', 'error', 'done'].includes(event.type)
    ? (value as ChatEvent)
    : null;
}

async function errorFrom(response: Response): Promise<ChatError> {
  let message = 'Could not reach the AI service';
  try {
    const data = (await response.json()) as { error?: unknown };
    if (typeof data?.error === 'string' && data.error) message = data.error;
  } catch {
    // keep the default message
  }
  return new ChatError(message, response.status);
}

/** Streams one chat turn. Calls `onEvent` for each event; rejects with a ChatError when the request fails. */
export async function streamChat(options: {
  origin: string;
  conversationId?: string;
  message: string;
  context: ChatContext;
  signal?: AbortSignal;
  onEvent: (event: ChatEvent) => void;
}): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${options.origin}/api/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: { ...GUARD, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({
        conversationId: options.conversationId,
        messages: [{ role: 'user', content: options.message }],
        context: options.context,
      }),
      signal: options.signal,
    });
  } catch {
    if (options.signal?.aborted) throw new ChatError('The request was cancelled');
    throw new ChatError('Cannot reach the AI service');
  }
  if (!response.ok) throw await errorFrom(response);
  if (!response.body) throw new ChatError('The AI service sent no answer');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // A turn ends with `done`, or with `error` or `limit` (no `done` follows those). A stream that closes cleanly
  // without one was cut off (a proxy timeout, a restart during a deploy): it must not look like a finished answer (#1022).
  let ended = false;
  const deliver = (event: ChatEvent) => {
    if (event.type === 'done' || event.type === 'error' || event.type === 'limit') ended = true;
    options.onEvent(event);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let end = buffer.indexOf('\n\n');
      while (end !== -1) {
        const event = parseEventBlock(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (event) deliver(event);
        end = buffer.indexOf('\n\n');
      }
    }
    const last = parseEventBlock(buffer);
    if (last) deliver(last);
  } catch {
    if (options.signal?.aborted) throw new ChatError('The request was cancelled');
    throw new ChatError('The connection to the AI service was lost');
  }
  if (!ended) throw new ChatError('The answer was cut off. Try again.');
}

/** Answers the confirmation of a tool call that changes data. */
export async function confirmToolCall(options: {
  origin: string;
  conversationId: string;
  callId: string;
  approve: boolean;
  signal?: AbortSignal;
}): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${options.origin}/api/chat/confirm`, {
      method: 'POST',
      credentials: 'include',
      headers: { ...GUARD, 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId: options.conversationId,
        callId: options.callId,
        approve: options.approve,
      }),
      signal: options.signal,
    });
  } catch {
    throw new ChatError('Cannot reach the AI service');
  }
  if (!response.ok) throw await errorFrom(response);
}
