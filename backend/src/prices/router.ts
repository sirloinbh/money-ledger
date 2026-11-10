import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { HttpError, parseId } from '../standard/http.js';
import {
  fetchUsCloses,
  fetchUsName,
  type PriceLog,
  screenRetryMs,
  tiingoHourlyLimit,
} from './fetch.js';
import type { PriceSources } from './sources.js';
import { trackedDays } from './store.js';

// #51 Security search and quote API, shared by mock trading and the portfolio (#47).
// Search reads the DB only. US securities are found by ticker; a US name is saved when the detail is first
// opened and is searchable from then on (2026-11-08 decision). Opening a US security that is not on the
// daily fetch fetches its recent closes right away (docs/price-source.md).

/** "Delayed" means more than 5 calendar days since the close or rate date (docs/price-source.md). */
const staleAfterDays = 5;
const searchLimit = 20;

const searchQuery = z.object({
  q: z
    .string({ error: '검색어를 입력하세요' })
    .trim()
    .min(1, '검색어를 입력하세요')
    .max(40, '검색어는 40자 이하로 입력하세요'),
});

type SecurityRow = {
  id: string;
  market: string;
  symbol: string;
  name: string | null;
  kind: string;
  currency: 'KRW' | 'USD';
  active: boolean;
  close: string | null;
  trade_date: string | null;
  fetched_at: Date | null;
  stale: boolean | null;
};

const toSecurity = (row: SecurityRow) => ({
  id: Number(row.id),
  market: row.market,
  symbol: row.symbol,
  name: row.name,
  kind: row.kind,
  currency: row.currency,
  // false: a Korean security missing from the KRX data for 10 market days (#97), or a US ticker that left the
  // Tiingo list. Not buyable, still sellable.
  active: row.active,
});

const toQuote = (row: SecurityRow) =>
  row.close === null || row.trade_date === null
    ? null
    : {
        close: row.close,
        currency: row.currency,
        tradeDate: row.trade_date,
        fetchedAt: row.fetched_at?.toISOString() ?? null,
        stale: row.stale === true,
      };

// The newest stored close of each security, with "delayed" decided against the service date ($1).
const withLatestClose = `
  SELECT s.id, s.market, s.symbol, s.name, s.kind, s.currency, s.active, s.viewed_at,
         p.close, p.trade_date, p.fetched_at, ($1::date - p.trade_date) > ${staleAfterDays} AS stale
  FROM securities s
  LEFT JOIN LATERAL (
    SELECT close, trade_date, fetched_at FROM security_prices
    WHERE security_id = s.id ORDER BY trade_date DESC LIMIT 1
  ) p ON true`;

/** `%`, `_` and `\` typed by the user match themselves in LIKE. */
const likeLiteral = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

type QuoteIssue = 'not_configured' | 'rate_limited' | 'fetch_failed' | 'not_found';

type Options = { sources: PriceSources; today: () => string; now: () => Date; log: PriceLog };

export function pricesRouter(pool: Pool, { sources, today, now, log }: Options) {
  const router = Router();

  router.get('/securities', async (req, res) => {
    const { q } = searchQuery.parse(req.query);
    const literal = likeLiteral(q);
    const { rows } = await pool.query<SecurityRow>(
      `SELECT * FROM (${withLatestClose} WHERE s.active AND (s.symbol LIKE $2 || '%' OR s.name ILIKE '%' || $3 || '%')) found
       ORDER BY (symbol = $4) DESC, (symbol LIKE $2 || '%') DESC, currency, name NULLS LAST, symbol
       LIMIT ${searchLimit}`,
      [today(), likeLiteral(q.toUpperCase()), literal, q.toUpperCase()],
    );
    res.json({
      securities: rows.map((row) => ({ ...toSecurity(row), quote: toQuote(row) })),
    });
  });

  router.get('/securities/:id', async (req, res) => {
    const id = parseId(req.params.id, '종목');
    const at = now();
    const read = async () =>
      (
        await pool.query<SecurityRow & { viewed_at: Date | null }>(
          `${withLatestClose} WHERE s.id = $2`,
          [today(), id],
        )
      ).rows[0];
    let row = await read();
    if (!row) throw new HttpError(404, '종목을 찾을 수 없습니다');

    let issue: QuoteIssue | null = null;
    const tracked =
      row.viewed_at !== null && at.getTime() - row.viewed_at.getTime() < trackedDays * 86_400_000;
    const tiingo = sources.tiingo;
    const security = { id, symbol: row.symbol, name: row.name };
    let hasCloses = row.close !== null;
    // A US security off the daily fetch, or one still without any close, is fetched right away.
    if (row.currency === 'USD' && (!tracked || !hasCloses)) {
      if (!tiingo) issue = 'not_configured';
      else {
        const result = await fetchUsCloses(
          pool,
          tiingo,
          security,
          at,
          tiingoHourlyLimit,
          screenRetryMs,
        );
        if (result === 'saved') hasCloses = true;
        if (result === 'rate_limited' || result === 'fetch_failed' || result === 'not_found') {
          issue = result;
          log({ event: 'price_fetch_now', symbol: row.symbol, result });
        }
        // No call this time: the last answer stands.
        if (result === 'known_missing') issue = 'not_found';
        if (result === 'failed_recently') issue = 'fetch_failed';
      }
    }
    // The name is fetched on any open while it is missing, but only for a ticker Tiingo has closes for,
    // so an unknown ticker does not spend a call on a sure 404.
    if (row.currency === 'USD' && tiingo && hasCloses && issue === null) {
      await fetchUsName(pool, tiingo, security, at);
    }
    // Opening the detail puts a US security on the daily fetch for the next 30 days.
    await pool.query('UPDATE securities SET viewed_at = $2 WHERE id = $1', [id, at]);
    row = (await read()) ?? row;

    let fx = null;
    if (row.currency === 'USD') {
      const rate = await pool.query<{ fx_rate: string; rate_date: string; stale: boolean }>(
        `SELECT fx_rate, rate_date, ($1::date - rate_date) > ${staleAfterDays} AS stale
         FROM fx_rates WHERE currency = 'USD' ORDER BY rate_date DESC LIMIT 1`,
        [today()],
      );
      const latest = rate.rows[0];
      fx = latest
        ? { fxRate: latest.fx_rate, rateDate: latest.rate_date, stale: latest.stale }
        : null;
    }
    const quote = toQuote(row);
    res.json({
      security: toSecurity(row),
      quote,
      // Why there is no close, when a fetch was tried and failed. A stored close is still shown if one exists.
      quoteIssue: quote === null ? issue : null,
      fx,
    });
  });

  return router;
}
