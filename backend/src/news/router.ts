import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { HttpError } from '../standard/http.js';
import type { NewsSource } from './source.js';
import { fetchNews, listNews, type NewsLog } from './store.js';

export const listQuery = z.object({
  date: z.iso.date({ error: 'Enter the date as YYYY-MM-DD' }).optional(),
});

type Options = { source?: NewsSource; today: () => string; now: () => Date; log: NewsLog };

export function newsRouter(pool: Pool, { source, today, now, log }: Options) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { date } = listQuery.parse(req.query);
    const day = date ?? today();
    res.json({ date: day, items: await listNews(pool, day) });
  });

  router.post('/fetch', async (_req, res) => {
    if (!source) throw new HttpError(503, 'No news source is configured');
    const result = await fetchNews(pool, source, now(), log);
    res.json(result);
  });

  return router;
}
