import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { HttpError } from '../standard/http.js';
import { type PickDeps, runDailyPick } from './run.js';
import { pickOfDay, pickView } from './store.js';

export const dateQuery = z.object({
  date: z.iso.date({ error: 'Enter the date as YYYY-MM-DD' }).optional(),
});

type Options = { deps?: PickDeps; today: () => string; now: () => Date };

export function picksRouter(pool: Pool, { deps, today, now }: Options) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { date } = dateQuery.parse(req.query);
    const day = date ?? today();
    const row = await pickOfDay(pool, day);
    res.json({ date: day, pick: row ? await pickView(pool, row) : null });
  });

  router.post('/run', async (_req, res) => {
    if (!deps) throw new HttpError(503, 'No Claude client is configured');
    res.json(await runDailyPick(pool, deps, now()));
  });

  return router;
}
