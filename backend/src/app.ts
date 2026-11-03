import express from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import { types } from 'pg';
import { ZodError } from 'zod/v4';

// DATE columns stay YYYY-MM-DD strings so the service time zone never shifts them.
types.setTypeParser(1082, (value) => value);

const serviceTimeZone = 'Asia/Seoul';

// "Today" follows the service time zone, not the server clock's zone.
export function serviceDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: serviceTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

type AppOptions = { today?: () => string; requestsPerMinute?: number };

export function createApp(pool: Pool, options: AppOptions = {}) {
  const today = options.today ?? (() => serviceDate());
  const app = express();
  app.disable('x-powered-by');
  // Same level as the /api/ limit in frontend/nginx.conf (10 r/s), for requests that skip nginx.
  // Per client IP. CodeQL js/missing-rate-limiting recognizes this middleware (#70).
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: options.requestsPerMinute ?? 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요' },
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'money-ledger', today: today() });
  });
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: '요청한 API를 찾을 수 없습니다' });
  });
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (err instanceof ZodError) {
        res.status(400).json({ error: err.issues.map((issue) => issue.message).join(', ') });
        return;
      }
      const error = typeof err === 'object' && err !== null ? (err as { code?: unknown }) : {};
      if (error.code === '23505') {
        res.status(409).json({ error: '이미 등록된 항목입니다' });
        return;
      }
      console.error(
        JSON.stringify({
          event: 'request_error',
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      res.status(500).json({ error: '서버 오류가 발생했습니다' });
    },
  );
  return app;
}
