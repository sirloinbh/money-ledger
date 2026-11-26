import { meHandler } from '@sirloinbh/auth-client';
import express from 'express';
import type { Pool } from 'pg';
import { types } from 'pg';

import { tools } from './ai-tools.js';
import { benchmarkRouter } from './benchmark.js';
import { kakaoRouter } from './kakao/router.js';
import type { KakaoService } from './kakao/service.js';
import { skillHandlers, type SkillOptions } from './kakao/skill.js';
import { budgetsRouter } from './ledger/budgets.js';
import { cardDeductionRouter } from './ledger/card-deduction.js';
import { categoriesRouter } from './ledger/categories.js';
import { entriesRouter } from './ledger/entries.js';
import { entryCsvRouter } from './ledger/entry-csv.js';
import { fixedCostsRouter } from './ledger/fixed-costs.js';
import { recurringRouter } from './ledger/recurring.js';
import { reportsRouter } from './ledger/reports.js';
import { rulesRouter } from './ledger/rules.js';
import { summaryRouter } from './ledger/summary.js';
import { trendRouter } from './ledger/trend.js';
import { mockAccountsRouter } from './mock/accounts.js';
import { mockHoldingsRouter } from './mock/holdings.js';
import { addNextDayRoute, mockQuestionsRouter } from './mock/long-hold.js';
import { mockOrdersRouter } from './mock/orders.js';
import { mockAccountPositionsRouter, mockPositionsRouter } from './mock/positions.js';
import { mockQuotesRouter } from './mock/quotes.js';
import { mockSnapshotsRouter } from './mock/snapshots.js';
import { type NewsLog, newsRouter, type NewsSource } from './news/index.js';
import { type PickDeps, picksRouter } from './picks/index.js';
import { assetsRouter } from './portfolio/assets.js';
import { netWorthRouter } from './portfolio/net-worth.js';
import { type PriceLog, type PriceSources, pricesRouter } from './prices/index.js';
import type { KisSource } from './prices/kis.js';
import { setInt8Parser } from './standard/db.js';
import { errorHandler, notFound, requestLog, serviceDate } from './standard/http.js';
import { apiRateLimit } from './standard/rate-limit.js';
import { registerToolRoutes } from './standard/tools.js';

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
  // #305 Live prices and the order book (KIS). None by default: /api/mock/quotes then answers 503.
  kis?: KisSource;
  // #187 Receives work that runs after an answer was sent (the fetch on linking an asset). By default it just
  // runs; tests collect and await it so none outlives its test.
  background?: (task: Promise<void>) => void;
  // #306 Economy news source. None by default: the manual fetch then answers 503.
  news?: NewsSource;
  // #308 The daily pick's Claude client and buy. None by default: the manual run then answers 503.
  pick?: PickDeps;
  newsLog?: NewsLog;
  // The shared sign-in session check (#149). None by default: tests and local development run open.
  auth?: express.RequestHandler;
  // Read-only background job status (ADR-0018). Mounted after `auth`, so it needs the shared sign-in.
  jobsStatus?: express.RequestHandler;
  // shared-ai's public key (project-standards#711). None by default: /internal/tools is then a JSON 404.
  toolsPublicKey?: string;
  // #311 The KakaoTalk connection and the URL of the web app (for the login return and message links). None: no /api/kakao.
  kakao?: { service: KakaoService; appUrl?: string };
  // #312 The public chatbot webhook at /kakao/skill (not under /api, so not behind the sign-in). With no config every
  // request is refused.
  kakaoSkill?: SkillOptions;
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
  // Public on purpose and registered before the sign-in, so the health check never depends on it (#178).
  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'money-ledger', today: today() });
  });
  // #149: the shared sign-in guards every other /api route; it is mounted before any of them registers.
  // After the rate limit, so a flood of unsigned requests does not reach the auth service.
  if (options.auth) app.use('/api', options.auth);
  app.get('/api/me', meHandler);
  if (options.jobsStatus) app.get('/api/jobs/status', options.jobsStatus);
  // Mounted before the app-wide JSON parser: an import of up to 2,000 rows has its own, larger limit (#44).
  app.use('/api/ledger/entries/csv', entryCsvRouter(pool, { today }));
  // #312 Public webhook: before the app-wide JSON parser, so nothing is parsed before the secret is checked.
  if (options.kakaoSkill)
    app.use(
      '/kakao/skill',
      ...skillHandlers(pool, {
        ...options.kakaoSkill,
        today,
        kis: options.kakaoSkill.kis ?? options.kis,
        now: options.kakaoSkill.now ?? now,
      }),
    );
  app.use(express.json({ limit: '256kb' }));
  app.use('/api/ledger/budgets', budgetsRouter(pool));
  app.use('/api/ledger/categories', categoriesRouter(pool));
  app.use('/api/ledger/entries', entriesRouter(pool));
  app.use('/api/ledger/fixed-costs', fixedCostsRouter(pool, { today }));
  app.use('/api/ledger/recurring', recurringRouter(pool, today));
  app.use('/api/ledger/tax', cardDeductionRouter(pool, { today }));
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
      background: options.background ?? (() => undefined),
    }),
  );
  app.use('/api/portfolio/net-worth', netWorthRouter(pool, { today }));
  if (options.kakao)
    app.use('/api/kakao', kakaoRouter(options.kakao.service, { appUrl: options.kakao.appUrl }));
  app.use('/api/mock/accounts/:accountId/orders', mockOrdersRouter(pool, today));
  app.use('/api/mock/accounts/:accountId/holdings', mockHoldingsRouter(pool, today));
  app.use('/api/mock/accounts/:accountId/snapshots', mockSnapshotsRouter(pool));
  app.use('/api/mock/accounts/:accountId/return', benchmarkRouter(pool, today));
  app.use('/api/mock/accounts', mockAccountsRouter(pool));
  app.use('/api/mock/quotes', mockQuotesRouter(pool, options.kis));
  app.use(
    '/api/mock/accounts/:accountId/positions',
    mockAccountPositionsRouter(pool, today, options.kis),
  );
  app.use(
    '/api/mock/positions',
    mockPositionsRouter(pool, (router) => addNextDayRoute(router, pool, options.kis, now)),
  );
  app.use('/api/mock/accounts/:accountId/next-day-questions', mockQuestionsRouter(pool, now));
  app.use(
    '/api/prices',
    pricesRouter(pool, {
      sources: options.prices ?? {},
      today,
      now,
      log: options.priceLog ?? (() => undefined),
    }),
  );
  app.use(
    '/api/news',
    newsRouter(pool, {
      source: options.news,
      today,
      now,
      log: options.newsLog ?? (() => undefined),
    }),
  );
  app.use('/api/picks', picksRouter(pool, { deps: options.pick, today, now }));
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
