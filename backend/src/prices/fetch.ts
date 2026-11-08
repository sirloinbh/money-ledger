import type { Pool } from 'pg';

import { serviceDate } from '../standard/http.js';
import { addDays, datesToFetch, latestUsDate } from './dates.js';
import { krxMarkets, type PriceSources, SourceError, type TiingoSource } from './sources.js';
import {
  getState,
  markFailed,
  reserveCall,
  saveFx,
  saveKrxDay,
  saveUsCloses,
  saveUsName,
  saveUsTickers,
  stateSources,
  trackedUsSecurities,
  type UsSecurity,
} from './store.js';

// The daily fetch (docs/price-source.md): Korean closes, the USD rate, the weekly US list and the closes of
// tracked US securities. Each source asks from the day after its last checked date to its latest date, at
// most 10 days back. An empty answer is "no new values" and still counts as checked.

export type PriceLog = (event: Record<string, unknown>) => void;

/** Tiingo allows 50 calls an hour. The daily fetch stops at 40 so screens keep 10 for immediate fetches. */
export const tiingoHourlyLimit = 50;
export const dailyTiingoLimit = 40;

const notConfigured = '시세 출처가 설정되지 않았습니다';
const tickersEveryDays = 7;

const messageOf = (error: unknown) =>
  error instanceof SourceError ? error.message : '시세를 받거나 저장하지 못했습니다';

/** Runs every source once. `complete` is false when something should be retried in an hour. */
export async function runDailyFetch(pool: Pool, sources: PriceSources, now: Date, log: PriceLog) {
  const today = serviceDate(now);
  let complete = true;
  const failed = async (source: string, scope: string, error: unknown) => {
    const message = messageOf(error);
    await markFailed(pool, source, scope, message, now);
    log({ event: 'price_fetch_failed', source, scope, message });
    complete = false;
  };

  // Korean closes of day D come out around 08:00 of D+1, so the latest date is yesterday.
  const krx = sources.krx;
  if (!krx)
    log({ event: 'price_source_missing', source: stateSources.krx, message: notConfigured });
  else {
    for (const market of krxMarkets) {
      const state = await getState(pool, stateSources.krx, market);
      for (const date of datesToFetch(state.checkedThrough, addDays(today, -1))) {
        try {
          await saveKrxDay(pool, market, date, await krx.daily(market, date), krx.name, now);
        } catch (error) {
          await failed(stateSources.krx, market, error);
          break; // the next run starts again from this date
        }
      }
    }
  }

  // The rate is published around 11:00 on business days, so the latest date is today.
  const fx = sources.fx;
  if (!fx) log({ event: 'price_source_missing', source: stateSources.fx, message: notConfigured });
  else {
    const state = await getState(pool, stateSources.fx, 'USD');
    for (const date of datesToFetch(state.checkedThrough, today)) {
      try {
        await saveFx(pool, date, await fx.usd(date), fx.name, now);
      } catch (error) {
        await failed(stateSources.fx, 'USD', error);
        break;
      }
    }
  }

  const tiingo = sources.tiingo;
  if (!tiingo) {
    log({ event: 'price_source_missing', source: stateSources.tiingo, message: notConfigured });
    return { complete };
  }
  const list = await getState(pool, stateSources.tiingo, 'tickers');
  if (list.checkedThrough === null || list.checkedThrough <= addDays(today, -tickersEveryDays)) {
    try {
      await saveUsTickers(pool, await tiingo.tickers(), today, now);
    } catch (error) {
      await failed(stateSources.tiingo, 'tickers', error);
    }
  }
  for (const security of await trackedUsSecurities(pool, now)) {
    const result = await fetchUsCloses(pool, tiingo, security, now, dailyTiingoLimit);
    if (result === 'rate_limited') {
      log({ event: 'price_fetch_limited', source: stateSources.tiingo, scope: security.symbol });
      complete = false;
      break; // the rest waits for the next hourly retry
    }
    if (result === 'fetch_failed') complete = false;
    if (result === 'fetch_failed' || result === 'not_found') {
      log({
        event: 'price_fetch_failed',
        source: stateSources.tiingo,
        scope: security.symbol,
        result,
      });
    }
  }
  return { complete };
}

export type UsFetchResult = 'saved' | 'up_to_date' | 'rate_limited' | 'fetch_failed' | 'not_found';

/** Closes of one US security for the dates it is missing, within the hourly call `limit`. */
export async function fetchUsCloses(
  pool: Pool,
  tiingo: TiingoSource,
  security: UsSecurity,
  now: Date,
  limit: number,
): Promise<UsFetchResult> {
  const latest = latestUsDate(now);
  const state = await getState(pool, stateSources.tiingo, security.symbol);
  const dates = datesToFetch(state.checkedThrough, latest);
  if (dates.length === 0) return 'up_to_date';
  if (!(await reserveCall(pool, stateSources.tiingo, limit, now))) return 'rate_limited';
  try {
    const closes = await tiingo.closes(security.symbol, dates[0], latest);
    if (closes === null) {
      // Not retried: Tiingo does not know the ticker. The date is still checked so the next run moves on.
      await saveUsCloses(
        pool,
        security.id,
        security.symbol,
        [],
        latest,
        tiingo.name,
        now,
        'Tiingo에 없는 종목입니다',
      );
      return 'not_found';
    }
    const inRange = closes.filter((close) => close.date >= dates[0] && close.date <= latest);
    await saveUsCloses(pool, security.id, security.symbol, inRange, latest, tiingo.name, now);
  } catch (error) {
    await markFailed(pool, stateSources.tiingo, security.symbol, messageOf(error), now);
    return 'fetch_failed';
  }
  return 'saved';
}

/** The name of a US security, which the Tiingo list does not have. Best effort: failures leave it empty. */
export async function fetchUsName(
  pool: Pool,
  tiingo: TiingoSource,
  security: UsSecurity,
  now: Date,
) {
  if (security.name !== null) return;
  if (!(await reserveCall(pool, stateSources.tiingo, tiingoHourlyLimit, now))) return;
  try {
    const name = await tiingo.companyName(security.symbol);
    if (name !== null) await saveUsName(pool, security.id, name, now);
  } catch {
    // The symbol is shown instead; the next first-time open tries again.
  }
}
