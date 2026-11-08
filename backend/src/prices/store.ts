import type { Pool, PoolClient } from 'pg';

import { inTransaction } from '../db.js';
import type { KrxMarket, KrxRow, UsClose, UsTicker } from './sources.js';

// Reads and writes of the shared price tables (database/migrations/009_prices.sql). Times are passed in
// instead of using now(), so the schedule can be tested with a fixed clock.

type Db = Pool | PoolClient;

/** Names the fetch bookkeeping uses, independent of which implementation (real or fake) ran. */
export const stateSources = {
  krx: 'KRX',
  tiingo: 'TIINGO',
  fx: 'KOREAEXIM',
  job: 'DAILY_JOB',
} as const;

export type FetchState = { checkedThrough: string | null; lastAttemptAt: Date | null };

export async function getState(db: Db, source: string, scope: string): Promise<FetchState> {
  const { rows } = await db.query<{ checked_through: string | null; last_attempt_at: Date | null }>(
    'SELECT checked_through, last_attempt_at FROM price_fetch_state WHERE source = $1 AND scope = $2',
    [source, scope],
  );
  return {
    checkedThrough: rows[0]?.checked_through ?? null,
    lastAttemptAt: rows[0]?.last_attempt_at ?? null,
  };
}

export async function markAttempt(db: Db, source: string, scope: string, now: Date) {
  await db.query(
    `INSERT INTO price_fetch_state (source, scope, last_attempt_at) VALUES ($1, $2, $3)
     ON CONFLICT (source, scope) DO UPDATE SET last_attempt_at = EXCLUDED.last_attempt_at`,
    [source, scope, now],
  );
}

/** `date` is covered (values saved or "no new values"). Never moves the checked date backwards. */
export async function markChecked(
  db: Db,
  source: string,
  scope: string,
  date: string,
  now: Date,
  note: string | null = null,
) {
  await db.query(
    `INSERT INTO price_fetch_state (source, scope, checked_through, last_attempt_at, last_success_at, last_error)
     VALUES ($1, $2, $3, $4, $4, $5)
     ON CONFLICT (source, scope) DO UPDATE SET
       checked_through = GREATEST(price_fetch_state.checked_through, EXCLUDED.checked_through),
       last_attempt_at = EXCLUDED.last_attempt_at,
       last_success_at = EXCLUDED.last_success_at,
       last_error = EXCLUDED.last_error`,
    [source, scope, date, now, note],
  );
}

export async function markFailed(
  db: Db,
  source: string,
  scope: string,
  message: string,
  now: Date,
) {
  await db.query(
    `INSERT INTO price_fetch_state (source, scope, last_attempt_at, last_error) VALUES ($1, $2, $3, $4)
     ON CONFLICT (source, scope) DO UPDATE SET
       last_attempt_at = EXCLUDED.last_attempt_at, last_error = EXCLUDED.last_error`,
    [source, scope, now, message.slice(0, 500)],
  );
}

/** One KRX market day: every security and its close, then the checked date, in one transaction. */
export async function saveKrxDay(
  pool: Pool,
  market: KrxMarket,
  date: string,
  rows: KrxRow[],
  sourceName: string,
  now: Date,
) {
  // A symbol twice in one statement would make ON CONFLICT touch a row twice; the last one wins.
  const unique = [...new Map(rows.map((row) => [row.symbol, row])).values()];
  await inTransaction(pool, async (client) => {
    if (unique.length > 0) {
      await client.query(
        `WITH input AS (
           SELECT * FROM unnest($1::text[], $2::text[], $3::numeric[]) AS t(symbol, name, close)
         ), saved AS (
           INSERT INTO securities (market, symbol, name, kind, currency, updated_at)
           SELECT $4, symbol, name, $5, 'KRW', $6 FROM input
           ON CONFLICT (currency, symbol) DO UPDATE SET
             market = EXCLUDED.market, name = EXCLUDED.name, kind = EXCLUDED.kind, active = true,
             updated_at = EXCLUDED.updated_at
           RETURNING id, symbol
         )
         INSERT INTO security_prices (security_id, trade_date, close, currency, source, fetched_at)
         SELECT saved.id, $7, input.close, 'KRW', $8, $6 FROM saved JOIN input USING (symbol)
         ON CONFLICT (security_id, trade_date) DO UPDATE SET
           close = EXCLUDED.close, source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at`,
        [
          unique.map((row) => row.symbol),
          unique.map((row) => row.name),
          unique.map((row) => row.close),
          market,
          market === 'KRX_ETF' ? 'etf' : 'stock',
          now,
          date,
          sourceName,
        ],
      );
    }
    await markChecked(client, stateSources.krx, market, date, now);
  });
}

/**
 * The weekly US list: adds new tickers and marks the ones no longer in the file inactive (kept, because
 * prices and holdings may point at them). An empty list changes nothing.
 */
export async function saveUsTickers(pool: Pool, tickers: UsTicker[], today: string, now: Date) {
  await inTransaction(pool, async (client) => {
    if (tickers.length > 0) {
      const symbols = tickers.map((ticker) => ticker.symbol);
      await client.query(
        `INSERT INTO securities (market, symbol, kind, currency, updated_at)
         SELECT market, symbol, kind, 'USD', $4
         FROM unnest($1::text[], $2::text[], $3::text[]) AS t(symbol, market, kind)
         ON CONFLICT (currency, symbol) DO UPDATE SET
           market = EXCLUDED.market, kind = EXCLUDED.kind, active = true, updated_at = EXCLUDED.updated_at`,
        [
          symbols,
          tickers.map((ticker) => ticker.market),
          tickers.map((ticker) => ticker.kind),
          now,
        ],
      );
      await client.query(
        `UPDATE securities SET active = false, updated_at = $2
         WHERE currency = 'USD' AND active AND symbol <> ALL($1::text[])`,
        [symbols, now],
      );
    }
    await markChecked(client, stateSources.tiingo, 'tickers', today, now);
  });
}

/** US closes of one security, then its checked date (`latest`, even when no close came back). */
export async function saveUsCloses(
  pool: Pool,
  securityId: number,
  symbol: string,
  closes: UsClose[],
  latest: string,
  sourceName: string,
  now: Date,
  note: string | null = null,
) {
  await inTransaction(pool, async (client) => {
    if (closes.length > 0) {
      await client.query(
        `INSERT INTO security_prices (security_id, trade_date, close, currency, source, fetched_at)
         SELECT $1, trade_date, close, 'USD', $4, $5
         FROM unnest($2::date[], $3::numeric[]) AS t(trade_date, close)
         ON CONFLICT (security_id, trade_date) DO UPDATE SET
           close = EXCLUDED.close, source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at`,
        [securityId, closes.map((c) => c.date), closes.map((c) => c.close), sourceName, now],
      );
    }
    await markChecked(client, stateSources.tiingo, symbol, latest, now, note);
  });
}

export async function saveUsName(db: Db, securityId: number, name: string, now: Date) {
  await db.query('UPDATE securities SET name = $2, updated_at = $3 WHERE id = $1', [
    securityId,
    name,
    now,
  ]);
}

export async function saveFx(
  pool: Pool,
  date: string,
  rate: string | null,
  sourceName: string,
  now: Date,
) {
  await inTransaction(pool, async (client) => {
    if (rate !== null) {
      await client.query(
        `INSERT INTO fx_rates (currency, rate_date, fx_rate, source, fetched_at) VALUES ('USD', $1, $2, $3, $4)
         ON CONFLICT (currency, rate_date) DO UPDATE SET
           fx_rate = EXCLUDED.fx_rate, source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at`,
        [date, rate, sourceName, now],
      );
    }
    await markChecked(client, stateSources.fx, 'USD', date, now);
  });
}

/** Days a US security stays on the daily fetch after its detail screen was opened. */
export const trackedDays = 30;

export type UsSecurity = { id: number; symbol: string; name: string | null };

/**
 * US securities the daily fetch covers. Today that is the ones opened in the last 30 days (#51); portfolio
 * holdings (#47) and mock trading holdings (#53) are to be added to this query.
 */
export async function trackedUsSecurities(db: Db, now: Date): Promise<UsSecurity[]> {
  const { rows } = await db.query<{ id: string; symbol: string; name: string | null }>(
    `SELECT id, symbol, name FROM securities
     WHERE currency = 'USD' AND viewed_at > $1::timestamptz - make_interval(days => $2)
     ORDER BY symbol`,
    [now, trackedDays],
  );
  return rows.map((row) => ({ id: Number(row.id), symbol: row.symbol, name: row.name }));
}

/**
 * Takes one call from a rate-limited source if fewer than `limit` were made in the last hour, counting every
 * caller. The daily fetch asks with a lower limit than screens do, which keeps calls free for them.
 */
export async function reserveCall(pool: Pool, source: string, limit: number, now: Date) {
  return inTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`price_api_calls:${source}`]);
    await client.query(
      `DELETE FROM price_api_calls WHERE source = $1 AND called_at < $2::timestamptz - interval '1 day'`,
      [source, now],
    );
    const { rows } = await client.query<{ calls: number }>(
      `SELECT count(*)::int AS calls FROM price_api_calls
       WHERE source = $1 AND called_at > $2::timestamptz - interval '1 hour'`,
      [source, now],
    );
    if ((rows[0]?.calls ?? 0) >= limit) return false;
    await client.query('INSERT INTO price_api_calls (source, called_at) VALUES ($1, $2)', [
      source,
      now,
    ]);
    return true;
  });
}
