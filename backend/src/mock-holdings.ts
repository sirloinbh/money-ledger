import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';

import { HttpError, parseId } from './standard/http.js';

// #53 What a mock account holds and how it has done.
// - A holding is valued at the latest stored close, and a US holding at the latest stored USD deal base rate:
//   value_krw = round(quantity × close × fx_rate), the same rule as an order (#52), in SQL numeric.
// - Profit of a holding = value − the cost still held (mock_holdings.cost_krw, fees included, average cost).
// - Account total = cash + the value of every holding. Account return = (total − initial cash) / initial
//   cash, so it counts realized and unrealized gains and fees together.
// - Rates are percentages rounded to 2 places (half away from zero), sent as decimal strings.
// - Inactive securities (#97) keep their last stored close, and the screen marks them.

type Row = {
  security_id: string | null;
  symbol: string;
  name: string | null;
  currency: 'KRW' | 'USD';
  active: boolean;
  quantity: string;
  cost_krw: string;
  close: string | null;
  trade_date: string | null;
  stale: boolean | null;
  fx_rate: string | null;
  rate_date: string | null;
  value_krw: string | null;
  profit_krw: string | null;
  return_pct: string | null;
};

/** The account columns, the same on every row (one row per holding, or one row when nothing is held). */
type AccountRow = {
  initial_cash_krw: string;
  cash_krw: string;
  summary_cost_krw: string;
  summary_value_krw: string | null;
  total_krw: string | null;
  summary_profit_krw: string | null;
  summary_return_pct: string | null;
};

/** A won amount from SQL as a JSON number; refuses one past the exact integer range instead of rounding it. */
export function won(text: string): number;
export function won(text: string | null): number | null;
export function won(text: string | null) {
  if (text === null) return null;
  const amount = Number(text);
  if (!Number.isSafeInteger(amount)) throw new Error(`won amount out of range: ${text}`);
  return amount;
}

/**
 * What an account holds and is worth now (rules at the top), or undefined if there is no such account. The
 * daily snapshots (#54) save its summary. One statement, so the holdings and the account cash come from the
 * same moment even while an order commits in between.
 */
export async function accountValue(db: Pool | PoolClient, accountId: number, today: string) {
  const { rows } = await db.query<Row & AccountRow>(
    `WITH account AS (
         SELECT id, initial_cash_krw, cash_krw FROM mock_accounts WHERE id = $1
       ), held AS (
         SELECT h.security_id, s.symbol, s.name, s.currency, s.active, h.quantity, h.cost_krw,
                p.close, p.trade_date, ($2::date - p.trade_date) > 5 AS stale, fx.fx_rate, fx.rate_date,
                value.krw AS value_krw, value.krw - h.cost_krw AS profit_krw,
                round((value.krw - h.cost_krw) * 100 / nullif(h.cost_krw, 0), 2) AS return_pct
         FROM mock_holdings h
         JOIN account a ON a.id = h.account_id
         JOIN securities s ON s.id = h.security_id
         LEFT JOIN LATERAL (
           SELECT close, trade_date FROM security_prices WHERE security_id = s.id
           ORDER BY trade_date DESC LIMIT 1
         ) p ON true
         LEFT JOIN LATERAL (
           SELECT fx_rate, rate_date FROM fx_rates WHERE currency = 'USD' AND s.currency = 'USD'
           ORDER BY rate_date DESC LIMIT 1
         ) fx ON true
         CROSS JOIN LATERAL (
           SELECT CASE WHEN p.close IS NULL OR (s.currency = 'USD' AND fx.fx_rate IS NULL) THEN NULL
                       ELSE round(h.quantity * p.close * coalesce(fx.fx_rate, 1)) END AS krw
         ) value
       ), totals AS (
         -- A holding without a close or rate makes the totals unknown rather than wrong.
         SELECT coalesce(sum(cost_krw), 0) AS cost_krw,
                CASE WHEN bool_and(value_krw IS NOT NULL) IS FALSE THEN NULL
                     ELSE coalesce(sum(value_krw), 0) END AS value_krw
         FROM held
       )
       SELECT a.initial_cash_krw, a.cash_krw,
              t.cost_krw AS summary_cost_krw, t.value_krw AS summary_value_krw,
              a.cash_krw + t.value_krw AS total_krw,
              a.cash_krw + t.value_krw - a.initial_cash_krw AS summary_profit_krw,
              round((a.cash_krw + t.value_krw - a.initial_cash_krw) * 100 / a.initial_cash_krw, 2)
                AS summary_return_pct,
              h.*
       FROM account a CROSS JOIN totals t LEFT JOIN held h ON true
       ORDER BY h.value_krw DESC NULLS LAST, h.symbol`,
    [accountId, today],
  );
  const first = rows[0];
  if (!first) return undefined;
  return {
    summary: {
      initialCashKrw: won(first.initial_cash_krw),
      cashKrw: won(first.cash_krw),
      costKrw: won(first.summary_cost_krw),
      valueKrw: won(first.summary_value_krw),
      totalKrw: won(first.total_krw),
      profitKrw: won(first.summary_profit_krw),
      returnPct: first.summary_return_pct,
    },
    holdings: rows
      .filter((row) => row.security_id !== null)
      .map((row) => ({
        security: {
          id: Number(row.security_id),
          symbol: row.symbol,
          name: row.name,
          currency: row.currency,
          active: row.active,
        },
        quantity: row.quantity,
        price: row.close,
        priceDate: row.trade_date,
        priceStale: row.stale === true,
        fxRate: row.fx_rate,
        fxDate: row.rate_date,
        costKrw: won(row.cost_krw),
        valueKrw: won(row.value_krw),
        profitKrw: won(row.profit_krw),
        returnPct: row.return_pct,
      })),
  };
}

export function mockHoldingsRouter(pool: Pool, today: () => string) {
  const router = Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    const accountId = parseId((req.params as { accountId?: string }).accountId, 'mock account');
    const value = await accountValue(pool, accountId, today());
    if (!value) throw new HttpError(404, 'Mock trading account not found');
    res.json(value);
  });

  return router;
}
