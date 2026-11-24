import { fakeSources } from './fake.js';
import type { PriceLog } from './fetch.js';
import { kisFromEnv, type KisSource } from './kis.js';
import { fakeKis } from './kis-fake.js';
import { koreaEximSource } from './koreaexim.js';
import { krxSource } from './krx.js';
import type { PriceSources } from './sources.js';
import { tiingoSource } from './tiingo.js';

export { type PriceLog } from './fetch.js';
export { PRICE_QUEUE, priceQueue } from './jobs.js';
export { pricesRouter } from './router.js';
export type { PriceSources } from './sources.js';

/** Writes one JSON line per price event, like the request error log. Never holds keys or URLs. */
export const logPriceEvent: PriceLog = (event) => console.log(JSON.stringify(event));

const key = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);

/**
 * Sources from the environment: PRICE_SOURCE=fake uses the deterministic fake for every source; otherwise
 * each source is used only when its key is set (KRX_API_KEY, TIINGO_API_KEY, KOREAEXIM_API_KEY).
 * #193 The fake is refused in production, where its closes would be stored as real ones, and any other
 * PRICE_SOURCE value is logged and ignored.
 */
export function sourcesFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  log: PriceLog = logPriceEvent,
): PriceSources {
  const choice = env.PRICE_SOURCE?.trim() ?? '';
  if (choice === 'fake') {
    if (env.NODE_ENV === 'production') {
      throw new Error('PRICE_SOURCE=fake cannot be used in production');
    }
    return fakeSources();
  }
  if (choice !== '') {
    log({
      event: 'price_source_unknown',
      message: 'Unknown PRICE_SOURCE value; using the real sources',
    });
  }
  const krx = key(env.KRX_API_KEY);
  const tiingo = key(env.TIINGO_API_KEY);
  const fx = key(env.KOREAEXIM_API_KEY);
  return {
    krx: krx ? krxSource(krx) : undefined,
    tiingo: tiingo ? tiingoSource(tiingo) : undefined,
    fx: fx ? koreaEximSource(fx) : undefined,
  };
}

/** #305 The live price source: the fake with PRICE_SOURCE=fake (not in production), else KIS when its keys are set. */
export function liveSourceFromEnv(env: NodeJS.ProcessEnv = process.env): KisSource | undefined {
  if (env.PRICE_SOURCE?.trim() === 'fake' && env.NODE_ENV !== 'production') return fakeKis();
  return kisFromEnv(env);
}
