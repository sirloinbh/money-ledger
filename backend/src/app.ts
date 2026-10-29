import express from 'express';
import type { Pool } from 'pg';
import { types } from 'pg';
import { ZodError } from 'zod';

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

export function createApp(pool: Pool, options: { today?: () => string } = {}) {
  const today = options.today ?? (() => serviceDate());
  const app = express();
  app.disable('x-powered-by');
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
