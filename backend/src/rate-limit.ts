import { rateLimit } from 'express-rate-limit';

import type { ApiError } from './standard/http.js';

export type RateLimitOptions = { limit?: number; windowMs?: number };

// One user behind nginx: every request shares the proxy address, so this caps the whole API.
// Forwarding headers are ignored on purpose; trusting them would let a client pick its own key.
export function apiRateLimit({ limit = 1200, windowMs = 60_000 }: RateLimitOptions = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요' } satisfies ApiError,
    validate: { xForwardedForHeader: false, forwardedHeader: false },
  });
}
