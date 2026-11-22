import type { Pool, PoolClient } from 'pg';

import { MAX_WON } from '../contract.js';
import { won } from '../money.js';
import type { assetTypes } from './asset-schema.js';

// The value of held assets on a reference date (#45, #47, #63, #64, migration 016), their totals, and the asset
// as the API answers it. Shared by the asset routes (assets.ts) and the #49 net worth save (net-worth.ts).

export type Row = {
  id: number;
  name: string;
  asset_type: (typeof assetTypes)[number];
  currency: 'KRW' | 'USD';
  quantity: string | null;
  value_krw: string | null;
  value_foreign: string | null;
  memo: string;
  purchase_price_krw: string | null;
  purchased_on: string | null;
  useful_life_months: number | null;
  salvage_value_krw: string | null;
  prepaid_kind: 'amount' | 'period' | null;
  prepaid_amount_krw: string | null;
  prepaid_starts_on: string | null;
  prepaid_expires_on: string | null;
  prepaid_used_krw: string;
  has_trades: boolean;
  security_id: number | null;
  security_market: string | null;
  security_symbol: string | null;
  security_name: string | null;
  security_active: boolean | null;
  manual_price: string | null;
  manual_price_on: string | null;
  unit_price: string | null;
  price_date: string | null;
  price_stale: boolean | null;
  fx_rate: string | null;
  fx_date: string | null;
  fx_stale: boolean | null;
  current_value_foreign: string | null;
  value_issue: 'no_price' | 'no_fx' | 'too_large' | null;
  cost_krw: string | null;
  profit_krw: string | null;
  return_percent: string | null;
  current_value_krw: string | null;
};

/** "Delayed" means more than 5 calendar days since the close or rate date (docs/price-source.md). */
const staleAfterDays = 5;

/**
 * Assets with their value on the reference date ($1: every caller passes it FIRST), filtered by `where` on
 * `a` (portfolio_assets). All in SQL numeric, rounded once at the end (AGENTS.project.md).
 *
 * - Depreciating and prepaid assets: their computed value (migrations 007, 010).
 * - A quantity with a unit price: quantity × price in the asset's currency. The price is the newest close on or
 *   before $1 for a linked security, else the price entered by hand if dated on or before $1. A linked
 *   security without a close has no value at all: no hand price or hand value is mixed in (decision
 *   2026-11-10, #47 review).
 * - An asset whose quantity comes from trades and that holds nothing: 0.
 * - Otherwise the value entered by hand.
 * - USD: converted with the newest USD rate on or before $1, so round(quantity × price × rate) once.
 * - A value over the one won cap, MAX_WON (won or dollars), is not counted, like the values entered by hand (#186).
 *
 * $1 picks the close, rate, hand price and depreciated or prepaid value of that date; the quantity and the
 * trade cost are the current ones (a past quantity comes with the net worth history, #49).
 */
export const assetQuery = (where: string) => `
  WITH base AS (
    SELECT a.*,
      (SELECT coalesce(sum(u.amount_krw), 0)::bigint FROM portfolio_prepaid_usages u
        WHERE u.asset_id = a.id AND u.used_on <= $1::date) AS prepaid_used_krw,
      EXISTS (SELECT 1 FROM portfolio_trades tr WHERE tr.asset_id = a.id) AS has_trades,
      s.market AS security_market, s.symbol AS security_symbol, s.name AS security_name,
      s.active AS security_active,
      p.trade_date AS close_date, fx.fx_rate, fx.rate_date AS fx_date, pos.cost_krw_after AS position_cost,
      CASE
        WHEN a.security_id IS NOT NULL THEN p.close
        WHEN a.manual_price_on <= $1::date THEN a.manual_price
      END AS unit_price
    FROM portfolio_assets a
    LEFT JOIN securities s ON s.id = a.security_id
    LEFT JOIN LATERAL (
      SELECT close, trade_date FROM security_prices
      WHERE security_id = a.security_id AND trade_date <= $1::date ORDER BY trade_date DESC LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT fx_rate, rate_date FROM fx_rates
      WHERE currency = 'USD' AND a.currency = 'USD' AND rate_date <= $1::date
      ORDER BY rate_date DESC LIMIT 1
    ) fx ON true
    LEFT JOIN LATERAL (
      SELECT t.cost_krw_after FROM portfolio_trade_positions(a.id) WITH ORDINALITY t
      WHERE a.quantity_from_trades ORDER BY t.ordinality DESC LIMIT 1
    ) pos ON true
    WHERE ${where}
  ), priced AS (
    SELECT base.*,
      CASE
        WHEN quantity IS NOT NULL AND unit_price IS NOT NULL THEN quantity * unit_price
        WHEN quantity IS NULL AND quantity_from_trades THEN 0
        WHEN security_id IS NOT NULL THEN NULL
        WHEN currency = 'KRW' THEN value_krw
        ELSE value_foreign
      END AS local_value
    FROM base
  ), converted AS (
    SELECT priced.*,
      coalesce(
        portfolio_depreciated_value(purchase_price_krw, salvage_value_krw, purchased_on, useful_life_months,
          $1::date),
        portfolio_prepaid_value(prepaid_kind, prepaid_amount_krw, prepaid_starts_on, prepaid_expires_on,
          prepaid_used_krw, $1::date),
        CASE WHEN currency = 'KRW' THEN local_value ELSE local_value * fx_rate END
      ) AS krw_raw
    FROM priced
  ), valued AS (
    SELECT converted.*,
      CASE WHEN krw_raw <= ${MAX_WON} AND coalesce(local_value, 0) <= ${MAX_WON} THEN round(krw_raw)::bigint END
        AS value_now
    FROM converted
  )
  SELECT id, name, asset_type, currency, quantity, value_krw, value_foreign, memo,
    purchase_price_krw, purchased_on, useful_life_months, salvage_value_krw,
    prepaid_kind, prepaid_amount_krw, prepaid_starts_on, prepaid_expires_on, prepaid_used_krw, has_trades,
    security_id, security_market, security_symbol, security_name, security_active,
    manual_price, manual_price_on, unit_price,
    CASE WHEN security_id IS NOT NULL THEN close_date ELSE manual_price_on END AS price_date,
    CASE WHEN security_id IS NOT NULL THEN ($1::date - close_date) > ${staleAfterDays} END AS price_stale,
    fx_rate, fx_date, ($1::date - fx_date) > ${staleAfterDays} AS fx_stale,
    CASE WHEN currency = 'USD' AND local_value <= ${MAX_WON} THEN round(local_value, 4) END AS current_value_foreign,
    CASE
      WHEN value_now IS NOT NULL THEN NULL
      WHEN krw_raw > ${MAX_WON} OR local_value > ${MAX_WON} THEN 'too_large'
      WHEN local_value IS NULL THEN 'no_price'
      ELSE 'no_fx'
    END AS value_issue,
    CASE WHEN has_trades THEN position_cost END AS cost_krw,
    CASE WHEN has_trades AND value_now IS NOT NULL THEN value_now - position_cost END AS profit_krw,
    CASE WHEN has_trades AND value_now IS NOT NULL AND position_cost > 0
      THEN round((value_now - position_cost) * 100.0 / position_cost, 2) END AS return_percent,
    value_now AS current_value_krw
  FROM valued`;

// pg returns bigint as a string; won amounts stay exact as long as they are safe integers.
/**
 * The asset screen's totals on `asOf` as exact decimal strings: assets, debts, net (assets − debts) and how many
 * were left out (no price, no USD rate, too large). #49 saves the same values as the day's net worth.
 */
export async function readTotals(client: PoolClient, asOf: string) {
  return sumTotals(client, assetQuery('true'), [asOf]);
}

/** The totals of `valued`: a query (run with `params`) of assets with asset_type and current_value_krw. */
export async function sumTotals(db: Pool | PoolClient, valued: string, params: unknown[]) {
  const { rows } = await db.query<{
    assets: string;
    debts: string;
    net: string;
    uncounted: number;
  }>(
    `SELECT coalesce(sum(current_value_krw) FILTER (WHERE asset_type <> 'debt'), 0) AS assets,
            coalesce(sum(current_value_krw) FILTER (WHERE asset_type = 'debt'), 0) AS debts,
            coalesce(sum(CASE WHEN asset_type = 'debt' THEN -current_value_krw ELSE current_value_krw END), 0)
              AS net,
            count(*) FILTER (WHERE current_value_krw IS NULL)::int AS uncounted
     FROM (${valued}) valued`,
    params,
  );
  return rows[0];
}

/**
 * #187 The listed rows as a query again, so the totals and the allocation reuse the list's values instead of
 * running the valuation (every trade replayed) once more each. Won values go back as exact numeric text.
 */
export const listedRows = `SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[])
  AS listed(id, name, asset_type, security_name, security_symbol, current_value_krw)`;
export const listedParams = (rows: Row[]) => [
  rows.map((row) => row.id),
  rows.map((row) => row.name),
  rows.map((row) => row.asset_type),
  rows.map((row) => row.security_name),
  rows.map((row) => row.security_symbol),
  rows.map((row) => row.current_value_krw),
];

/** A won total as a JS number, or null when it is too large to be exact. */
export function total(value: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export const toAsset = (row: Row) => ({
  id: row.id,
  name: row.name,
  type: row.asset_type,
  currency: row.currency,
  quantity: row.quantity,
  valueKrw: row.value_krw === null ? null : won(row.value_krw),
  valueForeign: row.value_foreign,
  memo: row.memo,
  // The DB sets the four together (portfolio_assets_depreciation_check).
  depreciation:
    row.purchase_price_krw === null
      ? null
      : {
          purchasePriceKrw: won(row.purchase_price_krw),
          purchasedOn: row.purchased_on,
          usefulLifeMonths: row.useful_life_months,
          salvageValueKrw: won(row.salvage_value_krw ?? '0'),
        },
  // The DB keeps these consistent (portfolio_assets_prepaid_check). usedKrw counts uses up to the reference date.
  prepaid:
    row.prepaid_kind === null
      ? null
      : {
          kind: row.prepaid_kind,
          amountKrw: won(row.prepaid_amount_krw ?? '0'),
          startsOn: row.prepaid_starts_on,
          expiresOn: row.prepaid_expires_on,
          usedKrw: won(row.prepaid_used_krw),
        },
  // #46 Whether the asset has trades; its quantity is then their total and cannot be entered by hand.
  hasTrades: row.has_trades,
  // #47 The linked security (stocks only), and the price entered by hand for an unlinked asset.
  security:
    row.security_id === null
      ? null
      : {
          id: row.security_id,
          market: row.security_market,
          symbol: row.security_symbol,
          name: row.security_name,
          // false: no longer traded (#97). Valued at its last close.
          active: row.security_active,
        },
  manualPrice:
    row.manual_price === null ? null : { price: row.manual_price, pricedOn: row.manual_price_on },
  // The unit price the value uses: the newest stored close of the linked security, or the hand price.
  price:
    row.unit_price === null
      ? null
      : {
          price: row.unit_price,
          currency: row.currency,
          source: row.security_id === null ? 'manual' : 'close',
          date: row.price_date,
          stale: row.price_stale === true,
        },
  // USD assets: the newest stored USD rate on the reference date, used for the won value.
  fx:
    row.fx_rate === null
      ? null
      : { fxRate: row.fx_rate, rateDate: row.fx_date, stale: row.fx_stale === true },
  // The won value counted in the totals, null when it cannot be counted (valueIssue says why).
  currentValueKrw: row.current_value_krw === null ? null : won(row.current_value_krw),
  // USD assets: the dollar value, shown even without a rate.
  currentValueForeign: row.current_value_foreign,
  valueIssue: row.value_issue,
  // Assets with trades: the won cost still held (buy fees included, #46), the gain against it and its rate (%).
  costKrw: row.cost_krw === null ? null : won(row.cost_krw),
  profitKrw: row.profit_krw === null ? null : won(row.profit_krw),
  returnPercent: row.return_percent,
});
