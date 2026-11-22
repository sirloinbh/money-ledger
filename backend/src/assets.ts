import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import type { z } from 'zod/v4';

import { readAllocation } from './allocation.js';
import {
  assetBody,
  listQuery,
  requireQuantityOrValue,
  tradeableTypes,
  usageBody,
} from './asset-schema.js';
import {
  assetQuery,
  listedParams,
  listedRows,
  type Row,
  sumTotals,
  toAsset,
  total,
  won,
} from './asset-valuation.js';
import { inTransaction } from './db.js';
import { fetchUsCloses, type PriceLog, tiingoHourlyLimit } from './prices/fetch.js';
import type { PriceSources } from './prices/sources.js';
import { HttpError, parseId, sendError } from './standard/http.js';
import { tradesRouter } from './trades.js';

// #45 Held assets and debts. Formats follow AGENTS.project.md "Quantity, foreign currency, and exchange rate" (#35):
// won amounts are JSON numbers (bigint in the DB), quantities and USD amounts are decimal strings.
// Trades and average prices come with #46, prices and FX conversion with #47.
// #63 A depreciating asset stores its purchase price, date, useful life and salvage value instead of a value;
// the server works out its current value for a reference date (straight-line by month, migration 007).
// #64 A prepaid asset (hair salon, gym) is a stored-value 'amount' with uses, or a 'period' pass; its value
// comes from what was paid (migration 010). Paying is a ledger expense, so using it is not one again.
// #47 A stock asset can be linked to a security and is valued at the newest stored close; an unlinked stock or
// other asset can carry a price entered by hand. USD values are converted with the newest stored USD rate, and
// assets with trades show their gain against the won cost (migration 016, decisions 2026-11-10).

type UsageRow = { id: number; used_on: string; amount_krw: string; memo: string };

const wonText = new Intl.NumberFormat('en-US');

/**
 * #192 A refused use that names the request field it is about. The answer carries it in `fields`, so the screen
 * marks that field from the path, not from words in the message.
 */
class UsageRefusal extends Error {
  constructor(
    readonly path: 'usedOn' | 'amountKrw',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Locks an asset row and returns its prepaid fields with the total used so far, or a 404.
 * The sum is a separate statement: under READ COMMITTED a subquery in the locking statement reads the
 * snapshot from before the lock wait and would miss a use committed meanwhile.
 */
async function lockForUses(client: PoolClient, id: number) {
  const found = await client.query<{
    prepaid_kind: string | null;
    prepaid_amount_krw: string | null;
    prepaid_expires_on: string | null;
  }>(
    'SELECT prepaid_kind, prepaid_amount_krw, prepaid_expires_on FROM portfolio_assets WHERE id = $1 FOR UPDATE',
    [id],
  );
  if (!found.rows[0]) throw new HttpError(404, 'Asset not found');
  const sum = await client.query<{ used: string; last_used_on: string | null }>(
    `SELECT coalesce(sum(amount_krw), 0) AS used, max(used_on) AS last_used_on
     FROM portfolio_prepaid_usages WHERE asset_id = $1`,
    [id],
  );
  return {
    ...found.rows[0],
    used: Number(sum.rows[0].used),
    lastUsedOn: sum.rows[0].last_used_on,
  };
}

type Options = {
  today: () => string;
  now: () => Date;
  prices: PriceSources;
  log: PriceLog;
  // #187 Takes work that runs after the answer was sent (the fetch on link). It never rejects.
  background: (task: Promise<void>) => void;
};

export function assetsRouter(pool: Pool, { today, now, prices, log, background }: Options) {
  const router = Router();

  const readAsset = async (db: Pool | PoolClient, id: number) =>
    (await db.query<Row>(assetQuery('a.id = $2'), [today(), id])).rows[0];

  // Totals add up current won values (see assetQuery) on `asOf`, by default today in the service time zone.
  // `uncounted` says how many were left out: no price, no USD rate, or too large. Debts are kept apart.
  // #48 `allocation` spreads the asset total by type and by asset (allocation.ts).
  // #187 The valuation runs once: the totals and the allocation are computed from the listed rows, so the
  // list, the totals and the allocation always agree.
  router.get('/', async (req, res) => {
    const asOf = listQuery.parse(req.query).asOf ?? today();
    const { rows: assets } = await pool.query<Row>(
      `${assetQuery('true')} ORDER BY asset_type, id`,
      [asOf],
    );
    const params = listedParams(assets);
    const [sums, allocation] = await Promise.all([
      sumTotals(pool, listedRows, params),
      readAllocation(pool, listedRows, params),
    ]);
    res.json({
      asOf,
      assets: assets.map(toAsset),
      totals: {
        assetsKrw: total(sums.assets),
        debtsKrw: total(sums.debts),
        netKrw: total(sums.net),
        uncounted: sums.uncounted,
      },
      allocation: {
        excluded: allocation.excluded,
        byType: allocation.byType.map((row) => ({
          type: row.type,
          amountKrw: total(row.amount_krw),
          share: row.share,
          count: row.count,
        })),
        byAsset: allocation.byAsset.map((row) => ({
          id: Number(row.key),
          name: row.label,
          type: row.type,
          amountKrw: total(row.amount_krw),
          share: row.share,
        })),
        // The 8 largest assets, then key 'rest' for the others together (count says how many).
        chart: allocation.chart.map((row) => ({
          key: row.key,
          name: row.key === 'rest' ? null : row.label,
          amountKrw: total(row.amount_krw),
          share: row.share,
          count: row.count,
        })),
      },
    });
  });

  const values = (body: z.infer<typeof assetBody>) => [
    body.name,
    body.type,
    body.currency,
    body.quantity,
    body.valueKrw,
    body.valueForeign,
    body.memo,
    body.depreciation?.purchasePriceKrw ?? null,
    body.depreciation?.purchasedOn ?? null,
    body.depreciation?.usefulLifeMonths ?? null,
    body.depreciation?.salvageValueKrw ?? null,
    body.prepaid?.kind ?? null,
    body.prepaid?.amountKrw ?? null,
    body.prepaid?.startsOn ?? null,
    body.prepaid?.expiresOn ?? null,
    body.securityId,
    body.manualPrice?.price ?? null,
    body.manualPrice?.pricedOn ?? null,
  ];

  /**
   * A linked security must exist and be in the asset's currency (decision 2026-11-10: the currency follows the
   * security; the form sets it). Returns the security, for the fetch below.
   */
  const checkSecurity = async (db: Pool | PoolClient, body: z.infer<typeof assetBody>) => {
    if (body.securityId === null) return null;
    const { rows } = await db.query<{
      id: number;
      symbol: string;
      name: string | null;
      currency: string;
    }>('SELECT id, symbol, name, currency FROM securities WHERE id = $1', [body.securityId]);
    const security = rows[0];
    if (!security) throw new HttpError(400, 'The security to link was not found');
    if (security.currency !== body.currency) {
      throw new HttpError(
        400,
        `The security's currency (${security.currency}) must match the asset's currency`,
      );
    }
    return {
      id: security.id,
      symbol: security.symbol,
      name: security.name,
      currency: security.currency,
    };
  };

  /**
   * A US security linked without any stored close is fetched once right away (decision 2026-11-10), within the
   * same hourly limit as opening its detail. From then on the daily fetch covers it while the asset holds it.
   * #187 It runs after the save is answered, so a slow Tiingo never holds up a save that already committed;
   * the next list load shows the price. Best effort: a failure leaves the asset without a price ("No quote")
   * and is logged, never thrown.
   */
  const fetchIfMissing = async (security: Awaited<ReturnType<typeof checkSecurity>>) => {
    if (!security || security.currency !== 'USD' || !prices.tiingo) return;
    try {
      const { rowCount } = await pool.query(
        'SELECT 1 FROM security_prices WHERE security_id = $1 LIMIT 1',
        [security.id],
      );
      if (rowCount) return;
      const result = await fetchUsCloses(pool, prices.tiingo, security, now(), tiingoHourlyLimit);
      if (result !== 'saved' && result !== 'up_to_date') {
        log({ event: 'price_fetch_now', symbol: security.symbol, result });
      }
    } catch {
      // The asset is already saved: a failed fetch must not become a 500 that invites saving it twice.
      log({ event: 'price_fetch_now', symbol: security.symbol, result: 'error' });
    }
  };

  router.post('/', async (req, res) => {
    const body = assetBody.parse(req.body);
    requireQuantityOrValue(body);
    const security = await checkSecurity(pool, body);
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO portfolio_assets (name, asset_type, currency, quantity, value_krw, value_foreign, memo,
         purchase_price_krw, purchased_on, useful_life_months, salvage_value_krw,
         prepaid_kind, prepaid_amount_krw, prepaid_starts_on, prepaid_expires_on,
         security_id, manual_price, manual_price_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
      values(body),
    );
    const id = rows[0].id;
    res.status(201).json({ asset: toAsset(await readAsset(pool, id)) });
    background(fetchIfMissing(security));
  });

  router.put('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'asset');
    const body = assetBody.parse(req.body);
    const security = await inTransaction(pool, async (client) => {
      // Locked so a use cannot be added between the check and the update.
      const { used, lastUsedOn } = await lockForUses(client, id);
      if (used > 0) {
        if (body.prepaid?.kind !== 'amount') {
          throw new HttpError(
            400,
            'A voucher with usage records can only be changed to a voucher. Delete the usage records first',
          );
        }
        if (body.prepaid.amountKrw < used) {
          throw new HttpError(
            400,
            `The amount paid cannot be less than the amount already used (₩${wonText.format(used)})`,
          );
        }
        // Keeps the rule a new use follows: no use after the expiry date.
        const { expiresOn } = body.prepaid;
        if (expiresOn !== null && lastUsedOn !== null && expiresOn < lastUsedOn) {
          throw new HttpError(
            400,
            `The expiry date cannot be before the last usage date (${lastUsedOn})`,
          );
        }
      }
      // #46 An asset with trades keeps a tradeable type and its currency, and its quantity is the trades'
      // total (the row is already locked, as trade writes lock it too). Without trades it is entered by hand.
      const traded = await client.query<{
        currency: string;
        trades: number;
        same_quantity: boolean;
      }>(
        `SELECT currency, (SELECT count(*) FROM portfolio_trades WHERE asset_id = $1)::int AS trades,
                $2::numeric IS NOT DISTINCT FROM quantity AS same_quantity
         FROM portfolio_assets WHERE id = $1`,
        [id, body.quantity],
      );
      const { currency, trades, same_quantity } = traded.rows[0];
      if (trades > 0) {
        if (!tradeableTypes.includes(body.type) || body.currency !== currency) {
          throw new HttpError(
            400,
            'An asset with trades can only be changed to stock or other (crypto, etc.), in the same currency',
          );
        }
        if (!same_quantity) {
          throw new HttpError(
            400,
            'The quantity of an asset with trades changes only through trades',
          );
        }
      } else {
        requireQuantityOrValue(body);
      }
      const linked = await checkSecurity(client, body);
      await client.query(
        `UPDATE portfolio_assets
         SET name = $1, asset_type = $2, currency = $3, quantity = $4, value_krw = $5, value_foreign = $6,
             memo = $7, purchase_price_krw = $8, purchased_on = $9, useful_life_months = $10,
             salvage_value_krw = $11, prepaid_kind = $12, prepaid_amount_krw = $13, prepaid_starts_on = $14,
             prepaid_expires_on = $15, security_id = $16, manual_price = $17, manual_price_on = $18,
             quantity_from_trades = $20, updated_at = now()
         WHERE id = $19`,
        [...values(body), id, trades > 0],
      );
      return linked;
    });
    res.json({ asset: toAsset(await readAsset(pool, id)) });
    background(fetchIfMissing(security));
  });

  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id, 'asset');
    const { rowCount } = await pool.query('DELETE FROM portfolio_assets WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, 'Asset not found');
    res.status(204).end();
  });

  // #64 Uses of a stored-value prepaid asset: listed, added and deleted (no editing, decision 2026-11-08).
  const toUsage = (row: UsageRow) => ({
    id: row.id,
    usedOn: row.used_on,
    amountKrw: won(row.amount_krw),
    memo: row.memo,
  });

  router.get('/:id/usages', async (req, res) => {
    const id = parseId(req.params.id, 'asset');
    const asset = await pool.query('SELECT 1 FROM portfolio_assets WHERE id = $1', [id]);
    if (!asset.rowCount) throw new HttpError(404, 'Asset not found');
    const { rows } = await pool.query<UsageRow>(
      `SELECT id, used_on, amount_krw, memo FROM portfolio_prepaid_usages
       WHERE asset_id = $1 ORDER BY used_on DESC, id DESC`,
      [id],
    );
    res.json({ usages: rows.map(toUsage) });
  });

  router.post('/:id/usages', async (req, res) => {
    const id = parseId(req.params.id, 'asset');
    const body = usageBody.parse(req.body);
    let usage: UsageRow;
    try {
      usage = await inTransaction(pool, async (client) => {
        // Locked so two uses at once cannot both pass the balance check.
        const asset = await lockForUses(client, id);
        if (asset.prepaid_kind !== 'amount') {
          throw new HttpError(400, 'Usage records can only be added to a prepaid voucher');
        }
        // A use is something that happened: a later date would count in the balance but not yet in the value.
        if (body.usedOn > today()) {
          throw new UsageRefusal('usedOn', 'Usage dated after today cannot be recorded');
        }
        if (asset.prepaid_expires_on !== null && body.usedOn > asset.prepaid_expires_on) {
          throw new UsageRefusal(
            'usedOn',
            `The expiry date (${asset.prepaid_expires_on}) has passed, so it cannot be used on that date`,
          );
        }
        const left = Number(asset.prepaid_amount_krw) - asset.used;
        if (body.amountKrw > left) {
          throw new UsageRefusal(
            'amountKrw',
            `Cannot use more than the balance (remaining ₩${wonText.format(left)})`,
          );
        }
        const { rows } = await client.query<UsageRow>(
          `INSERT INTO portfolio_prepaid_usages (asset_id, used_on, amount_krw, memo)
           VALUES ($1, $2, $3, $4) RETURNING id, used_on, amount_krw, memo`,
          [id, body.usedOn, body.amountKrw, body.memo],
        );
        return rows[0];
      });
    } catch (error) {
      if (!(error instanceof UsageRefusal)) throw error;
      sendError(res, 400, error.message, [{ path: error.path, message: error.message }]);
      return;
    }
    res.status(201).json({ usage: toUsage(usage) });
  });

  router.delete('/:id/usages/:usageId', async (req, res) => {
    const id = parseId(req.params.id, 'asset');
    const usageId = parseId(req.params.usageId, 'usage record');
    const { rowCount } = await pool.query(
      'DELETE FROM portfolio_prepaid_usages WHERE id = $1 AND asset_id = $2',
      [usageId, id],
    );
    if (!rowCount) throw new HttpError(404, 'Usage record not found');
    res.status(204).end();
  });

  // #46 Buy and sell records: /api/portfolio/assets/:id/trades.
  router.use('/:id/trades', tradesRouter(pool, today));

  return router;
}
