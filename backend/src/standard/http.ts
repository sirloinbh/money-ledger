// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/backend/src/standard/에서
// Shared HTTP helpers for the API (#309): one error shape, JSON 404 for unknown /api paths, id parsing and the
// service date. It imports only types, so it runs in every app whatever zod or Express version it uses.
//
//   app.use('/api', notFound);   // after every feature route
//   app.use(appErrors);          // optional: the app's own errors first, calling next(err) for the rest
//   app.use(errorHandler);       // last
import type { NextFunction, Request, Response } from 'express';

export type ApiError = { error: string };

/** An error with the status and Korean message to answer with, e.g. `throw new HttpError(404, '교재를 찾을 수 없습니다')`. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function sendError(res: Response, status: number, error: string) {
  res.status(status).json({ error } satisfies ApiError);
}

// Up to 15 digits: every such id is exact as a JS number, even for BIGINT columns.
export const ID_PATTERN = /^[1-9]\d{0,14}$/;

/** A path id as a number, or a 400 HttpError naming what the id is for: `parseId(req.params.id, '교재')`. */
export function parseId(value: unknown, label: string): number {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new HttpError(400, `${label} ID가 올바르지 않습니다`);
  }
  return Number(value);
}

export const serviceTimeZone = 'Asia/Seoul';

/** "Today" as YYYY-MM-DD in the service time zone, not the server clock's zone. */
export function serviceDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: serviceTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Registered after every feature route: an unknown /api path is a JSON 404, not Express's HTML page. */
export function notFound(_req: Request, res: Response) {
  sendError(res, 404, '요청한 API를 찾을 수 없습니다');
}

type ErrorFields = {
  name?: unknown;
  issues?: unknown;
  code?: unknown;
  type?: unknown;
  status?: unknown;
  message?: unknown;
};

// Matched by shape so that both zod 3 and zod 4 errors are recognized without importing zod.
// At most MAX_ISSUES messages reach the response: a large invalid array can raise one issue per element
// (GHSA-mrhx-c7xc-m3w5, #326), and the client only needs the first few to fix its input.
export const MAX_ISSUES = 10;

function zodMessages(error: ErrorFields) {
  if (error.name !== 'ZodError' || !Array.isArray(error.issues)) return null;
  const issues = error.issues as { message?: unknown }[];
  const shown = issues.slice(0, MAX_ISSUES).map((issue) => String(issue.message));
  if (issues.length > MAX_ISSUES) shown.push(`외 ${issues.length - MAX_ISSUES}개`);
  return shown.join(', ');
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    sendError(res, err.status, err.message);
    return;
  }
  const error = typeof err === 'object' && err !== null ? (err as ErrorFields) : {};
  const invalid = zodMessages(error);
  if (invalid !== null) {
    sendError(res, 400, invalid);
    return;
  }
  // express.json() rejects malformed or oversized bodies before any route runs.
  if (error.type === 'entity.parse.failed') {
    sendError(res, 400, '요청 본문의 JSON 형식이 올바르지 않습니다');
    return;
  }
  if (error.type === 'entity.too.large') {
    sendError(res, 413, '요청 본문이 너무 큽니다');
    return;
  }
  // Other client errors raised before routing (unsupported charset or encoding, aborted request)
  // keep their 4xx status instead of turning into a logged 500.
  if (typeof error.status === 'number' && error.status >= 400 && error.status < 500) {
    sendError(res, error.status, '요청을 처리할 수 없습니다');
    return;
  }
  // PostgreSQL text cannot hold a NUL character. That is the client's input, not a server fault.
  if (error.code === '22021') {
    sendError(res, 400, '입력에 사용할 수 없는 문자(NUL)가 있습니다');
    return;
  }
  if (error.code === '23505') {
    sendError(res, 409, '이미 등록된 항목입니다');
    return;
  }
  // The internal message goes to the log only; the response never exposes it.
  console.error(
    JSON.stringify({
      event: 'request_error',
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  sendError(res, 500, '서버 오류가 발생했습니다');
}
