// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/src/standard/
// The API rate limit every app shares (#678): one limit and one message, keyed by the real client IP. nginx in the
// frontend container appends the client address to X-Forwarded-For (templates/app/frontend/nginx.conf.tmpl), and
// `trust proxy` of 1 makes Express read the last entry, the address nginx saw. Without both, every request comes
// from the nginx container and all clients share one bucket.
//
//   app.use(requestLog);          // 1. request ID and log line first, so a 429 is logged too
//   apiRateLimit(app);            // 2. rate limit
//   app.use(express.json(...));   // 3. body parser
//   app.use('/api', auth);        // 4. sign-in
//   ...routes                     // 5. routes, then notFound and errorHandler
import type { Express } from 'express';
import { rateLimit } from 'express-rate-limit';

/** Requests per client IP per minute on /api. The health check is not counted. */
export const API_LIMIT_PER_MINUTE = 600;

export function apiRateLimit(app: Express, options: { limitPerMinute?: number } = {}) {
  // One hop: the nginx container directly in front of the API. More would let a client choose its own address.
  app.set('trust proxy', 1);
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: options.limitPerMinute ?? API_LIMIT_PER_MINUTE,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => req.path === '/health',
      message: { error: 'Too many requests. Try again in a minute.' },
    }),
  );
}
