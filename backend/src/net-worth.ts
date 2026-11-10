import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { readTotals, total } from './assets.js';
import { inTransaction } from './db.js';
import { date } from './entries.js';
import { HttpError } from './standard/http.js';

// #49 Net worth by day (decisions 2026-11-10, database/migrations/019_net_worth_snapshots.sql).
// POST saves today's (Seoul) asset screen totals as the day's row; saving again the same day replaces it. The app
// saves once when it opens and on "지금 값으로 저장". GET lists the saved days, oldest first: days without a save
// are not filled in (the chart joins the saved days), and past days are never computed again.

type Row = {
  snapshot_date: string;
  assets_krw: string;
  debts_krw: string;
  net_krw: string;
  uncounted: number;
};

const listQuery = z.object({ from: date.optional() });

const columns = 'snapshot_date, assets_krw::text, debts_krw::text, net_krw::text, uncounted';

const toSnapshot = (row: Row) => ({
  date: row.snapshot_date,
  assetsKrw: Number(row.assets_krw),
  debtsKrw: Number(row.debts_krw),
  netKrw: Number(row.net_krw),
  uncounted: row.uncounted,
});

export function netWorthRouter(pool: Pool, { today }: { today: () => string }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { from } = listQuery.parse(req.query);
    const { rows } = await pool.query<Row>(
      `SELECT ${columns} FROM net_worth_snapshots
       WHERE $1::date IS NULL OR snapshot_date >= $1::date
       ORDER BY snapshot_date`,
      [from ?? null],
    );
    res.json({ today: today(), snapshots: rows.map(toSnapshot) });
  });

  router.post('/', async (_req, res) => {
    const day = today();
    const row = await inTransaction(pool, async (client) => {
      // One snapshot of the assets, so the three totals agree with each other.
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const sums = await readTotals(client, day);
      // Only exact won numbers are saved (and sent back): a total past 2^53 is refused, not rounded.
      if ([sums.assets, sums.debts, sums.net].some((value) => total(value) === null)) {
        throw new HttpError(422, '합계가 너무 커서 순자산을 저장하지 못했습니다');
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
    res.json({ snapshot: toSnapshot(row) });
  });

  return router;
}
