import type { Pool } from 'pg';

import { serviceDate } from '../standard/http.js';
import { type NewsItem, newsQueries, type NewsSource } from './source.js';

// #306 Fetching and storing the day's headlines. An article found by several queries is stored once (the link is
// unique) and keeps the first query that found it.

export type NewsLog = (event: Record<string, unknown>) => void;

export type NewsFetchResult = { fetched: number; inserted: number; failedQueries: string[] };

async function saveNews(pool: Pool, query: string, items: NewsItem[], day: string) {
  let inserted = 0;
  for (const item of items) {
    const result = await pool.query(
      `INSERT INTO news_items (link, original_link, title, summary, publisher, published_at, query, fetched_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (link) DO NOTHING`,
      [
        item.link,
        item.originalLink,
        item.title,
        item.summary,
        item.publisher,
        item.publishedAt,
        query,
        day,
      ],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

/**
 * Fetches every query and stores the new items. A query that fails is logged and skipped so the others still run;
 * the caller decides what a partial run means (the job throws so pg-boss tries again, the route reports it).
 */
export async function fetchNews(
  pool: Pool,
  source: NewsSource,
  now: Date,
  log: NewsLog,
  queries: readonly string[] = newsQueries,
): Promise<NewsFetchResult> {
  const day = serviceDate(now);
  const result: NewsFetchResult = { fetched: 0, inserted: 0, failedQueries: [] };
  for (const query of queries) {
    try {
      const items = await source.search(query);
      result.fetched += items.length;
      result.inserted += await saveNews(pool, query, items, day);
    } catch (error) {
      result.failedQueries.push(query);
      log({
        event: 'news_fetch_failed',
        query,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  log({ event: 'news_fetch_run', day, source: source.name, ...result });
  return result;
}

export type NewsRow = {
  id: number;
  title: string;
  summary: string;
  link: string;
  original_link: string | null;
  publisher: string | null;
  published_at: Date;
  query: string;
  fetched_date: string;
};

/** The items stored on a service date, newest first. */
export async function listNews(pool: Pool, day: string) {
  const { rows } = await pool.query<NewsRow>(
    `SELECT id, title, summary, link, original_link, publisher, published_at, query, fetched_date
     FROM news_items WHERE fetched_date = $1 ORDER BY published_at DESC, id DESC`,
    [day],
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    link: row.link,
    originalLink: row.original_link,
    publisher: row.publisher,
    publishedAt: row.published_at.toISOString(),
    query: row.query,
    fetchedDate: row.fetched_date,
  }));
}
