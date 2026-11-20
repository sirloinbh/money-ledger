// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/src/standard/
// Shared HTTP helpers for the API (#309): one error shape, JSON 404 for unknown /api paths, id parsing and the
// service date, and a request ID with one JSON log line per request (#552). Besides node:crypto it imports only types,
// so it runs in every app whatever zod or Express version it uses.
//
//   app.use(requestLog);         // first, so every later log line and error carries the request ID
//   app.use('/api', notFound);   // after every feature route
//   app.use(appErrors);          // optional: the app's own errors first, calling next(err) for the rest
//   app.use(errorHandler);       // last
import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

/** One invalid field of a 400 validation answer: its path in the input (`items.0.name`) and the message. */
export type FieldError = { path: string; message: string };
export type ApiError = { error: string; fields?: FieldError[] };

/** An error with the status and message to answer with, e.g. `throw new HttpError(404, 'Textbook not found')`. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function sendError(res: Response, status: number, error: string, fields?: FieldError[]) {
  res.status(status).json((fields ? { error, fields } : { error }) satisfies ApiError);
}

// Up to 15 digits: every such id is exact as a JS number, even for BIGINT columns.
export const ID_PATTERN = /^[1-9]\d{0,14}$/;

/**
 * A path id as a number, or a 400 HttpError naming what the id is for: `parseId(req.params.id, 'textbook')`. Ids are
 * numbers on the wire; setInt8Parser in db.ts makes pg return BIGINT ids as numbers too (ADR-0025,
 * docs/conventions/pg-ids-and-rows.md).
 */
export function parseId(value: unknown, label: string): number {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new HttpError(400, `Invalid ${label} ID`);
  }
  return Number(value);
}

// An incoming X-Request-Id (nginx sets one, docs/logging.md) is kept only if it looks like an ID, so a client
// cannot write arbitrary text into the logs.
export const REQUEST_ID_PATTERN = /^[\w.-]{1,128}$/;

/** The request's ID, set by requestLog; undefined before it runs. */
export function requestIdOf(res: Response): string | undefined {
  const id: unknown = res.locals.requestId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Keeps a valid incoming X-Request-Id or creates one, returns it in the X-Request-Id response header, and
 * logs one JSON line when the response ends: time, level, requestId, method, path (no query), status, ms.
 * A request whose connection closed before the response was written is logged as `status: 499, aborted: true` at
 * level warn, not with the 200 that `res.statusCode` still holds (#869).
 */
export function requestLog(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get('x-request-id');
  const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  const started = performance.now();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  // 'close' also fires when the client aborts, where 'finish' would not.
  res.on('close', () => {
    const aborted = !res.writableFinished;
    const status = aborted ? 499 : res.statusCode;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status,
      ...(aborted ? { aborted: true } : {}),
      ms: Math.round(performance.now() - started),
    });
    if (status >= 500) console.error(line);
    else console.log(line);
  });
  next();
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
  sendError(res, 404, 'API not found');
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

function zodIssues(error: ErrorFields) {
  if (error.name !== 'ZodError' || !Array.isArray(error.issues)) return null;
  const issues = error.issues as { message?: unknown; path?: unknown }[];
  const shown = issues.slice(0, MAX_ISSUES);
  const messages = shown.map((issue) => String(issue.message));
  if (issues.length > MAX_ISSUES) messages.push(`and ${issues.length - MAX_ISSUES} more`);
  // `fields` lets a form place each message by path (#674); `error` stays the one sentence older clients read.
  const fields = shown.map((issue) => ({
    path: Array.isArray(issue.path) ? issue.path.map(String).join('.') : '',
    message: String(issue.message),
  }));
  return { text: messages.join(', '), fields };
}

// PostgreSQL errors (SQLSTATE) caused by what the client sent: a 400 with a short message that never repeats the
// database's own text (#673). 23505 (duplicate) is a 409 and 22021 (NUL) has its own message below.
const PG_INPUT_ERRORS: Record<string, string> = {
  '23503': 'A related item does not exist or is still in use',
  '23514': 'Input is not allowed',
  '22P02': 'Input has an invalid format',
  '22007': 'Input has an invalid date or time',
  '22008': 'Input has an invalid date or time',
};

function handleError(err: unknown, res: Response, next: NextFunction, withFields: boolean) {
  // The response has started (a stream, or an error after res.json): Express closes the connection. Writing a second
  // response here would throw ERR_HTTP_HEADERS_SENT inside the handler.
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof HttpError) {
    sendError(res, err.status, err.message);
    return;
  }
  const error = typeof err === 'object' && err !== null ? (err as ErrorFields) : {};
  const invalid = zodIssues(error);
  if (invalid !== null) {
    sendError(res, 400, invalid.text, withFields ? invalid.fields : undefined);
    return;
  }
  // express.json() rejects malformed or oversized bodies before any route runs.
  if (error.type === 'entity.parse.failed') {
    sendError(res, 400, 'Request body is not valid JSON');
    return;
  }
  if (error.type === 'entity.too.large') {
    sendError(res, 413, 'Request body is too large');
    return;
  }
  // Other client errors raised before routing (unsupported charset or encoding, aborted request)
  // keep their 4xx status instead of turning into a logged 500.
  if (typeof error.status === 'number' && error.status >= 400 && error.status < 500) {
    sendError(res, error.status, 'Cannot process the request');
    return;
  }
  // PostgreSQL text cannot hold a NUL character. That is the client's input, not a server fault.
  if (error.code === '22021') {
    sendError(res, 400, 'Input contains a character that is not allowed (NUL)');
    return;
  }
  if (error.code === '23505') {
    sendError(res, 409, 'This item already exists');
    return;
  }
  const inputError = typeof error.code === 'string' ? PG_INPUT_ERRORS[error.code] : undefined;
  if (inputError) {
    sendError(res, 400, inputError);
    return;
  }
  // The internal message goes to the log only; the response never exposes it.
  console.error(
    JSON.stringify({
      time: new Date().toISOString(),
      level: 'error',
      event: 'request_error',
      requestId: requestIdOf(res),
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  sendError(res, 500, 'Server error');
}

/**
 * The error handler to register last. With `{ fields: true }` a validation 400 also lists the invalid fields by path
 * (`fields: [{ path, message }]`, #674); without it the body stays `{ error }`, so an app's existing assertions on the
 * body keep passing until it switches fields on (#799).
 */
export function createErrorHandler(options: { fields?: boolean } = {}) {
  const withFields = options.fields === true;
  return (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    handleError(err, res, next, withFields);
  };
}

/** The handler without `fields`: `app.use(errorHandler)`. */
export const errorHandler = createErrorHandler();
