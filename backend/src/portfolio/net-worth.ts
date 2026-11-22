import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { inTransaction } from '../db.js';
import { date } from '../ledger/entries.js';
import { HttpError } from '../standard/http.js';
import { readTotals, total } from './asset-valuation.js';

// #49 Net worth by day (decisions 2026-11-10, database/migrations/019_net_worth_snapshots.sql).
// POST saves today's (Seoul) asset screen totals as the day's row; saving again the same day replaces it. The app
// saves once when it opens and on "Save current values". GET lists the saved days, oldest first: days without a save
// are not filled in (the chart joins the saved days), and past days are never computed again. `?latest=true` gives
// only the latest saved day.

type Row = {
  snapshot_date: string;
  assets_krw: string;
  debts_krw: string;
  net_krw: string;
  uncounted: number;
};

export const listQuery = z.object({
  from: date.optional(),
  // Only the latest saved day (the dashboard card), instead of the whole list.
  latest: z.enum(['true'], { error: 'latest must be true when it is sent' }).optional(),
});

const columns = 'snapshot_date, assets_krw::text, debts_krw::text, net_krw::text, uncounted';

const toSnapshot = (row: Row) => ({
  date: row.snapshot_date,
  assetsKrw: Number(row.assets_krw),
  debtsKrw: Number(row.debts_krw),
  netKrw: Number(row.net_krw),
  uncounted: row.uncounted,
});

/** How many times a save runs when two saves of the same day collide (#195). */
const attempts = 3;

/**
 * Saves the asset totals as the net worth of `day`, replacing that day's row. The totals are read in one
 * REPEATABLE READ snapshot so they agree with each other; two saves of the same day at once make the later upsert
 * fail with a serialization error (40001), so the save runs again with a fresh snapshot.
 */
export async function saveNetWorth(pool: Pool, day: string) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await inTransaction(pool, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        const sums = await readTotals(client, day);
        // Only exact won numbers are saved (and sent back): a total past 2^53 is refused, not rounded.
        if ([sums.assets, sums.debts, sums.net].some((value) => total(value) === null)) {
          throw new HttpError(422, 'The totals are too large to save the net worth');
        }
        const saved = await client.query<Row>(
          `INSERT INTO net_worth_snapshots (snapshot_date, assets_krw, debts_krw, net_krw, uncounted)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (snapshot_date) DO UPDATE SET
             assets_krw = excluded.assets_krw, debts_krw = excluded.debts_krw, net_krw = excluded.net_krw,
             uncounted = excluded.uncounted, saved_at = now()
           RETURNING ${columns}`,
          [day, sums.assets, sums.debts, sums.net, sums.uncounted],
        );
        return saved.rows[0];
      });
    } catch (error) {
      if ((error as { code?: unknown }).code !== '40001' || attempt >= attempts) throw error;
    }
  }
}

export function netWorthRouter(pool: Pool, { today }: { today: () => string }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { from, latest } = listQuery.parse(req.query);
    const { rows } = await pool.query<Row>(
      latest
        ? `SELECT ${columns} FROM net_worth_snapshots ORDER BY snapshot_date DESC LIMIT 1`
        : `SELECT ${columns} FROM net_worth_snapshots
           WHERE $1::date IS NULL OR snapshot_date >= $1::date
           ORDER BY snapshot_date`,
      latest ? [] : [from ?? null],
    );
    res.json({ today: today(), snapshots: rows.map(toSnapshot) });
  });

  router.post('/', async (_req, res) => {
    res.json({ snapshot: toSnapshot(await saveNetWorth(pool, today())) });
  });

  return router;
}
