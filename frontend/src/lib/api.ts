// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/lib/
// JSON requests to the app's own API (#310). The server answers errors as `{ error: '<message>' }`
// (backend/src/standard/http.ts), so a failed request rejects with that message.

export type RequestErrorKind = 'network' | 'timeout' | 'abort' | 'http' | 'body';

/**
 * A failed request. `status` is the HTTP status (undefined when the server could not be reached).
 * `kind` tells the failure apart: `network` (unreachable), `timeout`, `abort` (the caller's signal),
 * `http` (non-2xx answer) and `body` (a 2xx answer whose body is not JSON).
 */
export class RequestError extends Error {
  readonly status: number | undefined;
  readonly kind: RequestErrorKind;

  constructor(message: string, status?: number, kind: RequestErrorKind = 'http') {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.kind = kind;
  }
}

export const DEFAULT_TIMEOUT_MS = 30_000;

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Aborting rejects with a RequestError of kind `abort`. */
  signal?: AbortSignal;
  /** Milliseconds before the request is cancelled (kind `timeout`). Default 30 s; 0 disables it. */
  timeoutMs?: number;
}

export interface JsonRequestOptions extends RequestOptions {
  body?: unknown;
}

async function send<T>(path: string, init: RequestInit, options: RequestOptions): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;
  const onAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    let response: Response;
    try {
      response = await fetch(path, { ...init, signal: controller.signal });
    } catch {
      if (timedOut) throw new RequestError('The request timed out', undefined, 'timeout');
      if (controller.signal.aborted) {
        throw new RequestError('The request was cancelled', undefined, 'abort');
      }
      throw new RequestError('Cannot reach the server', undefined, 'network');
    }
    if (response.status === 204) return undefined as T;
    let data: unknown;
    let readable = true;
    try {
      data = await response.json();
    } catch {
      if (timedOut) throw new RequestError('The request timed out', undefined, 'timeout');
      if (controller.signal.aborted) {
        throw new RequestError('The request was cancelled', undefined, 'abort');
      }
      readable = false;
    }
    if (!response.ok) {
      const message = readable ? (data as { error?: unknown } | null)?.error : undefined;
      throw new RequestError(
        typeof message === 'string' && message ? message : 'Could not process the request',
        response.status,
        'http',
      );
    }
    if (!readable) {
      throw new RequestError('The server sent an unreadable answer', response.status, 'body');
    }
    return data as T;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Resolves with the JSON body (undefined for 204 No Content) or rejects with a RequestError carrying the
 * server's message, so callers can tell "already gone" (404) from other failures. A 2xx answer whose
 * body is empty or not JSON rejects too (kind `body`) instead of resolving with a value of the wrong shape.
 */
export function requestJson<T>(path: string, init: JsonRequestOptions = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  return send<T>(
    path,
    {
      method: init.method ?? 'GET',
      headers: hasBody ? { 'content-type': 'application/json', ...init.headers } : init.headers,
      body: hasBody ? JSON.stringify(init.body) : undefined,
    },
    init,
  );
}

/** Multipart upload. The browser sets the content type (with the boundary), so none is set here. */
export function requestForm<T>(
  path: string,
  form: FormData,
  init: RequestOptions = {},
): Promise<T> {
  return send<T>(path, { method: init.method ?? 'POST', headers: init.headers, body: form }, init);
}
