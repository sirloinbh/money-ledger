import { fakeSources } from './fake.js';
import type { PriceLog } from './fetch.js';
import { koreaEximSource } from './koreaexim.js';
import { krxSource } from './krx.js';
import type { PriceSources } from './sources.js';
import { tiingoSource } from './tiingo.js';

export { type PriceLog } from './fetch.js';
export { pricesRouter } from './router.js';
export { startPriceJobs } from './scheduler.js';
export type { PriceSources } from './sources.js';

/** Writes one JSON line per price event, like the request error log. Never holds keys or URLs. */
export const logPriceEvent: PriceLog = (event) => console.log(JSON.stringify(event));

const key = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);

/**
 * Sources from the environment: PRICE_SOURCE=fake uses the deterministic fake for every source; otherwise
 * each source is used only when its key is set (KRX_API_KEY, TIINGO_API_KEY, KOREAEXIM_API_KEY).
 */
export function sourcesFromEnv(env: NodeJS.ProcessEnv = process.env): PriceSources {
  if (env.PRICE_SOURCE === 'fake') return fakeSources();
  const krx = key(env.KRX_API_KEY);
  const tiingo = key(env.TIINGO_API_KEY);
  const fx = key(env.KOREAEXIM_API_KEY);
  return {
    krx: krx ? krxSource(krx) : undefined,
    tiingo: tiingo ? tiingoSource(tiingo) : undefined,
    fx: fx ? koreaEximSource(fx) : undefined,
  };
}
