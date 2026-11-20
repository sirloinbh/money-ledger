import { meHandler } from '@sirloinbh/auth-client';
import express from 'express';
import type { Pool } from 'pg';
import { types } from 'pg';

import { tools } from './ai-tools.js';
import { assetsRouter } from './assets.js';
import { budgetsRouter } from './budgets.js';
import { categoriesRouter } from './categories.js';
import { entriesRouter } from './entries.js';
import { entryCsvRouter } from './entry-csv.js';
import { fixedCostsRouter } from './fixed-costs.js';
import { mockAccountsRouter } from './mock-accounts.js';
import { mockHoldingsRouter } from './mock-holdings.js';
import { mockOrdersRouter } from './mock-orders.js';
import { mockSnapshotsRouter } from './mock-snapshots.js';
import { netWorthRouter } from './net-worth.js';
import { type PriceLog, type PriceSources, pricesRouter } from './prices/index.js';
import { reportsRouter } from './reports.js';
import { rulesRouter } from './rules.js';
import { setInt8Parser } from './standard/db.js';
import { errorHandler, notFound, requestLog, serviceDate } from './standard/http.js';
import { apiRateLimit } from './standard/rate-limit.js';
import { registerToolRoutes } from './standard/tools.js';
import { summaryRouter } from './summary.js';
import { trendRouter } from './trend.js';

// DATE columns stay YYYY-MM-DD strings so the service time zone never shifts them.
types.setTypeParser(1082, (value) => value);
setInt8Parser(types);

export { serviceDate };

type AppOptions = {
  today?: () => string;
  now?: () => Date;
  requestsPerMinute?: number;
  // Price sources for immediate fetches (#51). None by default: tests and a server without keys fetch nothing.
  prices?: PriceSources;
  priceLog?: PriceLog;
  // The shared sign-in session check (#149). None by default: tests and local development run open.
  auth?: express.RequestHandler;
  // Read-only background job status (ADR-0018). Mounted after `auth`, so it needs the shared sign-in.
  jobsStatus?: express.RequestHandler;
  // shared-ai's public key (project-standards#711). None by default: /internal/tools is then a JSON 404.
  toolsPublicKey?: string;
};

export function createApp(pool: Pool, options: AppOptions = {}) {
  const today = options.today ?? (() => serviceDate());
  const now = options.now ?? (() => new Date());
  const app = express();
  app.disable('x-powered-by');
  // project-standards#658: a request ID and one JSON log line for every request, first so a 429 has them too.
  app.use(requestLog);
  // Same level as the /api/ limit in frontend/nginx.conf (10 r/s), for requests that skip nginx.
  // Per client IP. CodeQL js/missing-rate-limiting recognizes this middleware (#70).
  apiRateLimit(app, { limitPerMinute: options.requestsPerMinute });
  // #149: the shared sign-in guards every /api route except /api/health, before any route registers.
  // After the rate limit, so a flood of unsigned requests does not reach the auth service.
  if (options.auth) app.use('/api', options.auth);
  app.get('/api/me', meHandler);
  if (options.jobsStatus) app.get('/api/jobs/status', options.jobsStatus);
  // Mounted before the app-wide JSON parser: an import of up to 2,000 rows has its own, larger limit (#44).
  app.use('/api/ledger/entries/csv', entryCsvRouter(pool, { today }));
  app.use(express.json({ limit: '256kb' }));
  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'money-ledger', today: today() });
  });
  app.use('/api/ledger/budgets', budgetsRouter(pool));
  app.use('/api/ledger/categories', categoriesRouter(pool));
  app.use('/api/ledger/entries', entriesRouter(pool));
  app.use('/api/ledger/fixed-costs', fixedCostsRouter(pool, { today }));
  app.use('/api/ledger/rules', rulesRouter(pool));
  app.use('/api/ledger/summary', summaryRouter(pool));
  app.use('/api/reports', reportsRouter(pool, { today }));
  app.use('/api/ledger/trend', trendRouter(pool));
  app.use(
    '/api/portfolio/assets',
    assetsRouter(pool, {
      today,
      now,
      prices: options.prices ?? {},
      log: options.priceLog ?? (() => undefined),
    }),
  );
  app.use('/api/portfolio/net-worth', netWorthRouter(pool, { today }));
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
  // AI tools for shared-ai on /internal/tools: outside /api, so nginx never forwards them and the signed call
  // token, not the session, is the check. shared-ai signs the tool and jti claims, so the app requires them.
  registerToolRoutes(app, {
    app: 'money-ledger',
    tools,
    pool,
    publicKey: options.toolsPublicKey,
    requireBinding: true,
  });
  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
