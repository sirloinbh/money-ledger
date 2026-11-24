import { Router } from 'express';
import type { Pool } from 'pg';

import { KisError, type KisSource } from '../prices/kis.js';
import { HttpError, parseId } from '../standard/http.js';

// #305 GET /api/mock/quotes/:securityId: the live price and 10-level order book of an active Korean security.
// Prices are won decimal strings. The quote is never stored here: #307 reads it again at order time.

const statusOf = { bad_key: 502, rate_limit: 429, market_closed: 409, unavailable: 502 } as const;

/**
 * Reads a live quote for a symbol, mapping a KIS failure to the HTTP error the screen shows. Shared with the
 * position code of #307 and #309, so it stays exported.
 *
 * @public
 */
export async function liveQuote(kis: KisSource | undefined, symbol: string) {
  if (!kis) throw new HttpError(503, 'Live prices are not set up yet');
  try {
    return await kis.quote(symbol);
  } catch (error) {
    if (error instanceof KisError) {
      const message =
        error.code === 'bad_key' ? 'The live price service key is not valid' : error.message;
      throw new HttpError(statusOf[error.code], message);
    }
    throw error;
  }
}

export function mockQuotesRouter(pool: Pool, kis: KisSource | undefined) {
  const router = Router();

  router.get('/:securityId', async (req, res) => {
    const id = parseId(req.params.securityId, 'security');
    const { rows } = await pool.query<{ symbol: string; active: boolean; currency: string }>(
      'SELECT symbol, active, currency FROM securities WHERE id = $1',
      [id],
    );
    const found = rows[0];
    if (!found) throw new HttpError(404, 'Security not found');
    if (found.currency !== 'KRW') {
      throw new HttpError(409, 'Live prices are only available for Korean securities');
    }
    if (!found.active) throw new HttpError(409, 'Trading is halted for this security');
    const quote = await liveQuote(kis, found.symbol);
    res.json({ securityId: id, ...quote });
  });

  return router;
}
