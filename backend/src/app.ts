import express from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import { types } from 'pg';

import { categoriesRouter } from './categories.js';
import { errorHandler, notFound, serviceDate } from './standard/http.js';

// DATE columns stay YYYY-MM-DD strings so the service time zone never shifts them.
types.setTypeParser(1082, (value) => value);

export { serviceDate };

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
  app.use('/api/ledger/categories', categoriesRouter(pool));
  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
