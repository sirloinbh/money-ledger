import type { PoolClient } from 'pg';

// #48 How the asset total is spread: by asset type and by asset (decisions 2026-11-10).
// - Assets only: debts are left out, so the shares add up to the "자산 합계" amount. Assets without a won value
//   (no price, no USD rate, too large) are left out of both and counted in `excluded`.
// - Shares are percentages with one decimal, computed in SQL numeric. Each is rounded down to tenths and the
//   tenths still missing to 100.0 go to the largest remainders (largest remainder method), so they always add
//   up to exactly 100.0%. Ties go to the larger amount, then the earlier asset.
// - By asset: one line per asset, named after its linked security when it has one. The chart shows the 8
//   largest and puts the rest in one "그 밖의 N개" line; the table lists every asset.

/** Assets the chart shows one by one before the rest are put together. */
export const chartAssets = 8;

export type ShareRow = {
  key: string;
  label: string;
  type: string;
  amount_krw: string;
  share: string;
  count: number;
};

/**
 * Shares of `items` (columns key text, label text, type text, amount numeric ≥ 0, ord bigint for ties,
 * count int), largest amount first, with `position` 1, 2, … in that order. All 0.0 when the amounts add up to 0.
 */
const withShares = (items: string) => `
  WITH items AS (${items}),
  total AS (SELECT coalesce(sum(amount), 0) AS total FROM items),
  raw AS (
    SELECT items.*, CASE WHEN total.total > 0 THEN items.amount * 1000 / total.total ELSE 0 END AS tenths
    FROM items, total
  ),
  floored AS (SELECT raw.*, floor(tenths) AS base FROM raw),
  missing AS (
    SELECT CASE WHEN (SELECT total FROM total) > 0 THEN 1000 - coalesce(sum(base), 0) ELSE 0 END AS tenths
    FROM floored
  ),
  ranked AS (
    SELECT floored.*,
      row_number() OVER (ORDER BY tenths - base DESC, amount DESC, ord) AS by_rest,
      row_number() OVER (ORDER BY amount DESC, ord) AS position
    FROM floored
  )
  SELECT key, label, type, amount, count, position,
    (base + CASE WHEN by_rest <= (SELECT tenths FROM missing) THEN 1 ELSE 0 END) / 10 AS share
  FROM ranked`;

/**
 * The allocation on the reference date ($1), from `valued`: a query of assets with id, name, asset_type,
 * security_name, security_symbol and current_value_krw (assets.ts assetQuery). Run inside the snapshot of the
 * asset list so the two always agree.
 */
export async function readAllocation(client: PoolClient, valued: string, asOf: string) {
  const counted = `SELECT * FROM (${valued}) v WHERE asset_type <> 'debt' AND current_value_krw IS NOT NULL`;
  const perAsset = withShares(
    `SELECT id::text AS key, coalesce(security_name, security_symbol, name) AS label, asset_type AS type,
            current_value_krw::numeric AS amount, id AS ord, 1 AS count
     FROM (${counted}) c`,
  );
  const byType = await client.query<ShareRow>(
    `SELECT key, label, type, amount::text AS amount_krw, count, share::numeric(4, 1)::text AS share
     FROM (${withShares(
       `SELECT asset_type AS key, asset_type AS label, asset_type AS type,
               sum(current_value_krw)::numeric AS amount, min(id) AS ord, count(*)::int AS count
        FROM (${counted}) c GROUP BY asset_type`,
     )}) shared
     ORDER BY position`,
    [asOf],
  );
  const byAsset = await client.query<ShareRow>(
    `SELECT key, label, type, amount::text AS amount_krw, count, share::numeric(4, 1)::text AS share
     FROM (${perAsset}) shared
     ORDER BY position`,
    [asOf],
  );
  // The chart: the 8 largest assets, then the rest as one line with the sum of their (already balanced)
  // shares, so the chart adds up to 100.0% too.
  const chart = await client.query<ShareRow>(
    `SELECT CASE WHEN position <= ${chartAssets} THEN key ELSE 'rest' END AS key,
            min(label) AS label, min(type) AS type, sum(amount)::text AS amount_krw, count(*)::int AS count,
            sum(share)::numeric(4, 1)::text AS share
     FROM (${perAsset}) shared
     GROUP BY CASE WHEN position <= ${chartAssets} THEN key ELSE 'rest' END
     ORDER BY min(position)`,
    [asOf],
  );
  const excluded = await client.query<{ excluded: number }>(
    `SELECT count(*)::int AS excluded FROM (${valued}) v
     WHERE asset_type <> 'debt' AND current_value_krw IS NULL`,
    [asOf],
  );
  return {
    byType: byType.rows,
    byAsset: byAsset.rows,
    chart: chart.rows,
    excluded: excluded.rows[0].excluded,
  };
}
