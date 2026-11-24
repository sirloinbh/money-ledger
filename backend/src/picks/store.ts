import type { Pool } from 'pg';

import type { PickNews } from './prompt.js';

// #308 Reading the day's headlines and storing and listing the day's pick.

/** The day's headlines for the prompt, newest first, at most 100. */
export async function newsForPick(pool: Pool, day: string): Promise<PickNews[]> {
  const { rows } = await pool.query<PickNews & { publisher: string | null }>(
    `SELECT id, title, summary, publisher FROM news_items
     WHERE fetched_date = $1 ORDER BY published_at DESC, id DESC LIMIT 100`,
    [day],
  );
  return rows;
}

export type KnownSecurity = { id: number; symbol: string; name: string | null };

/** An active Korean security by its KRX code, or undefined when the code is unknown or inactive. */
export async function activeKoreanSecurity(pool: Pool, symbol: string) {
  const { rows } = await pool.query<KnownSecurity>(
    `SELECT id, symbol, name FROM securities WHERE currency = 'KRW' AND symbol = $1 AND active`,
    [symbol],
  );
  return rows.at(0);
}

export type NewPick = {
  day: string;
  newsItemIds: number[];
  storyTitle: string;
  storySummary: string;
  economicEffect: string;
  reasoning: string;
  securityId: number;
  model: string;
  raw: unknown;
};

/** Stores the pick; returns its id, or null when the day already has one (the first stays). */
export async function savePick(pool: Pool, pick: NewPick) {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO daily_picks (pick_date, news_item_ids, story_title, story_summary, economic_effect, reasoning,
                              security_id, model, raw_response)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (pick_date) DO NOTHING RETURNING id`,
    [
      pick.day,
      pick.newsItemIds,
      pick.storyTitle,
      pick.storySummary,
      pick.economicEffect,
      pick.reasoning,
      pick.securityId,
      pick.model,
      JSON.stringify(pick.raw),
    ],
  );
  return rows.at(0)?.id ?? null;
}

export type PickRow = {
  id: number;
  pick_date: string;
  news_item_ids: number[];
  story_title: string;
  story_summary: string;
  economic_effect: string;
  reasoning: string;
  model: string;
  order_id: number | null;
  created_at: Date;
  security_id: number;
  symbol: string;
  name: string | null;
  market: string;
};

const selectPick = `
  SELECT p.id, p.pick_date, p.news_item_ids, p.story_title, p.story_summary, p.economic_effect, p.reasoning,
         p.model, p.order_id, p.created_at, s.id AS security_id, s.symbol, s.name, s.market
  FROM daily_picks p JOIN securities s ON s.id = p.security_id`;

export async function pickOfDay(pool: Pool, day: string) {
  return (await pool.query<PickRow>(`${selectPick} WHERE p.pick_date = $1`, [day])).rows.at(0);
}

export async function setPickOrder(pool: Pool, pickId: number, orderId: number) {
  await pool.query('UPDATE daily_picks SET order_id = $2 WHERE id = $1 AND order_id IS NULL', [
    pickId,
    orderId,
  ]);
}

/** The pick with the headlines behind it, as the API sends it. */
export async function pickView(pool: Pool, row: PickRow) {
  const news = await pool.query<{
    id: number;
    title: string;
    link: string;
    publisher: string | null;
  }>(
    `SELECT id, title, link, publisher FROM news_items WHERE id = ANY($1) ORDER BY published_at DESC, id DESC`,
    [row.news_item_ids],
  );
  return {
    id: row.id,
    date: row.pick_date,
    storyTitle: row.story_title,
    storySummary: row.story_summary,
    economicEffect: row.economic_effect,
    reasoning: row.reasoning,
    model: row.model,
    orderId: row.order_id,
    createdAt: row.created_at.toISOString(),
    security: { id: row.security_id, symbol: row.symbol, name: row.name, market: row.market },
    news: news.rows,
  };
}
