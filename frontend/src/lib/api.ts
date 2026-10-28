// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/lib/에서
// JSON requests to the app's own API (#310). The server answers errors as `{ error: '<한국어 메시지>' }`
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
    throw new RequestError('서버에 연결할 수 없습니다');
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: unknown }).error;
    throw new RequestError(
      typeof message === 'string' && message ? message : '요청을 처리하지 못했습니다',
      response.status,
    );
  }
  return data as T;
}
