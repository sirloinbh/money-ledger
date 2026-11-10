import type { PoolClient } from 'pg';

// #48 How the asset total is spread: by asset type and by asset (decisions 2026-11-10).
// - Assets only: debts are left out, so the shares add up to the "자산 합계" amount. Assets without a won value
//   (no price, no USD rate, too large) are left out of both and counted in `excluded`.
// - Shares are percentages with one decimal, computed exactly in SQL numeric: each share in tenths of a percent
//   is the integer quotient of amount × 1000 by the total, and the tenths still missing to 1000 go to the
//   largest remainders (largest remainder method), so they always add up to exactly 100.0%. Ties go to the
//   larger amount, then the earlier asset.
// - By asset: one line per asset, named after its linked security when it has one. The chart shows the 8
//   largest and puts the rest in one "그 밖의 N개" line (only when that is 2 or more assets: a 9th asset is
//   shown by name); the table lists every asset.

/** Assets the chart shows one by one before the rest are put together. */
export const chartAssets = 8;

export type ShareRow = {
  kind: 'type' | 'asset' | 'chart';
  key: string;
  label: string;
  type: string;
  amount_krw: string;
  share: string;
  count: number;
};

/**
 * Shares of `items` (columns key text, label text, type text, amount numeric ≥ 0 and whole, ord bigint for
 * ties, count int), with `position` 1, 2, … from the largest amount. All 0.0 when the amounts add up to 0.
 * div/mod keep the quotient and remainder exact at any size (a plain division rounds at about 20 digits).
 */
const withShares = (items: string) => `
  WITH items AS (${items}),
  total AS (SELECT coalesce(sum(amount), 0) AS total FROM items),
  split AS (
    SELECT items.*,
      CASE WHEN total.total > 0 THEN div(items.amount * 1000, total.total) ELSE 0 END AS base,
      CASE WHEN total.total > 0 THEN mod(items.amount * 1000, total.total) ELSE 0 END AS rest
    FROM items, total
  ),
  missing AS (
    SELECT CASE WHEN (SELECT total FROM total) > 0 THEN 1000 - coalesce(sum(base), 0) ELSE 0 END AS tenths
    FROM split
  ),
  ranked AS (
    SELECT split.*,
      row_number() OVER (ORDER BY rest DESC, amount DESC, ord) AS by_rest,
      row_number() OVER (ORDER BY amount DESC, ord) AS position,
      count(*) OVER () AS item_count
    FROM split
  )
  SELECT key, label, type, amount, count, position, item_count,
    (base + CASE WHEN by_rest <= (SELECT tenths FROM missing) THEN 1 ELSE 0 END) / 10.0 AS share
  FROM ranked`;

/**
 * The allocation on the reference date ($1), from `valued`: a query of assets with id, name, asset_type,
 * security_name, security_symbol and current_value_krw (assets.ts assetQuery). One statement, so it reads the
 * same rows as the list and totals in the caller's snapshot, and the valuation runs once.
 */
export async function readAllocation(client: PoolClient, valued: string, asOf: string) {
  // A position past the 8th goes into the rest, unless it would be the only one there.
  const grouped = `CASE WHEN position <= ${chartAssets} OR item_count = ${chartAssets + 1} THEN key ELSE 'rest' END`;
  const { rows } = await client.query<ShareRow | (Omit<ShareRow, 'kind'> & { kind: 'excluded' })>(
    `WITH valued AS MATERIALIZED (${valued}),
     counted AS (SELECT * FROM valued WHERE asset_type <> 'debt' AND current_value_krw IS NOT NULL),
     per_asset AS MATERIALIZED (${withShares(
       `SELECT id::text AS key, coalesce(security_name, security_symbol, name) AS label, asset_type AS type,
               current_value_krw::numeric AS amount, id AS ord, 1 AS count
        FROM counted`,
     )}),
     per_type AS (${withShares(
       `SELECT asset_type AS key, asset_type AS label, asset_type AS type,
               sum(current_value_krw)::numeric AS amount, min(id) AS ord, count(*)::int AS count
        FROM counted GROUP BY asset_type`,
     )}),
     chart AS (
       SELECT ${grouped} AS key, min(label) AS label, min(type) AS type, sum(amount) AS amount,
              count(*)::int AS count, sum(share) AS share, min(position) AS position
       FROM per_asset GROUP BY ${grouped}
     ),
     listed AS (
       SELECT 'type' AS kind, key, label, type, amount, count, share, position FROM per_type
       UNION ALL
       SELECT 'asset', key, label, type, amount, count, share, position FROM per_asset
       UNION ALL
       SELECT 'chart', key, label, type, amount, count, share, position FROM chart
     )
     SELECT kind, key, label, type, amount::text AS amount_krw, count,
            share::numeric(4, 1)::text AS share, position
     FROM listed
     UNION ALL
     SELECT 'excluded', NULL, NULL, NULL, NULL,
            (SELECT count(*)::int FROM valued WHERE asset_type <> 'debt' AND current_value_krw IS NULL),
            NULL, 0
     ORDER BY kind, position`,
    [asOf],
  );
  const of = (kind: ShareRow['kind']) => rows.filter((row): row is ShareRow => row.kind === kind);
  return {
    byType: of('type'),
    byAsset: of('asset'),
    chart: of('chart'),
    excluded: rows.find((row) => row.kind === 'excluded')!.count,
  };
}
