// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/lib/
// JSON requests to the app's own API (#310). The server answers errors as `{ error: '<message>' }`
// (backend/src/standard/http.ts), so a failed request rejects with that message.

/** A failed request. `status` is the HTTP status, or undefined when the server could not be reached. */
export class RequestError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
  }
}

/**
 * Resolves with the JSON body (undefined for 204 No Content) or rejects with a RequestError carrying the
 * server's Korean message, so callers can tell "already gone" (404) from other failures.
 */
export async function requestJson<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new RequestError('Cannot reach the server');
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: unknown }).error;
    throw new RequestError(
      typeof message === 'string' && message ? message : 'Could not process the request',
      response.status,
    );
  }
  return data as T;
}
