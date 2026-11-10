import express from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import { types } from 'pg';

import { assetsRouter } from './assets.js';
import { categoriesRouter } from './categories.js';
import { entriesRouter } from './entries.js';
import { mockAccountsRouter } from './mock-accounts.js';
import { mockHoldingsRouter } from './mock-holdings.js';
import { mockOrdersRouter } from './mock-orders.js';
import { mockSnapshotsRouter } from './mock-snapshots.js';
import { type PriceLog, type PriceSources, pricesRouter } from './prices/index.js';
import { rulesRouter } from './rules.js';
import { errorHandler, notFound, serviceDate } from './standard/http.js';
import { summaryRouter } from './summary.js';

// DATE columns stay YYYY-MM-DD strings so the service time zone never shifts them.
types.setTypeParser(1082, (value) => value);

export { serviceDate };

type AppOptions = {
  today?: () => string;
  now?: () => Date;
  requestsPerMinute?: number;
  // Price sources for immediate fetches (#51). None by default: tests and a server without keys fetch nothing.
  prices?: PriceSources;
  priceLog?: PriceLog;
};

export function createApp(pool: Pool, options: AppOptions = {}) {
  const today = options.today ?? (() => serviceDate());
  const now = options.now ?? (() => new Date());
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
  app.use('/api/ledger/entries', entriesRouter(pool));
  app.use('/api/ledger/rules', rulesRouter(pool));
  app.use('/api/ledger/summary', summaryRouter(pool));
  app.use(
    '/api/portfolio/assets',
    assetsRouter(pool, {
      today,
      now,
      prices: options.prices ?? {},
      log: options.priceLog ?? (() => undefined),
    }),
  );
  app.use('/api/mock/accounts/:accountId/orders', mockOrdersRouter(pool, today));
  app.use('/api/mock/accounts/:accountId/holdings', mockHoldingsRouter(pool, today));
  app.use('/api/mock/accounts/:accountId/snapshots', mockSnapshotsRouter(pool));
  app.use('/api/mock/accounts', mockAccountsRouter(pool));
  app.use(
    '/api/prices',
    pricesRouter(pool, {
      sources: options.prices ?? {},
      today,
      now,
      log: options.priceLog ?? (() => undefined),
    }),
  );
  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
