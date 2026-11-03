import express from 'express';
import type { Pool } from 'pg';
import { types } from 'pg';

import { categoriesRouter } from './categories.js';
import { errorHandler, notFound, serviceDate } from './standard/http.js';

// DATE columns stay YYYY-MM-DD strings so the service time zone never shifts them.
types.setTypeParser(1082, (value) => value);

export { serviceDate };

export function createApp(pool: Pool, options: { today?: () => string } = {}) {
  const today = options.today ?? (() => serviceDate());
  const app = express();
  app.disable('x-powered-by');
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
