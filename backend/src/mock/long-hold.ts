import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import { won } from '../money.js';
import { isWeekend } from '../prices/dates.js';
import type { KisSource } from '../prices/kis.js';
import { HttpError, parseId } from '../standard/http.js';
import type { JobQueue } from '../standard/jobs.js';
import { sellPosition } from './positions.js';

// #310 Each trading morning the app asks, for every long hold bought before today, "keep or sell?".
// - 08:30 KST on a KRX business day (a weekday not in krx_holidays): one question per long hold position.
// - Answer `keep` closes the question until tomorrow. Answer `sell` sells at the best bid once the market is
//   open (09:00); asked earlier, the sale waits (`sell_queued`) and the next tick sells it.
// - No answer by 15:00 keeps the position and closes the question (answer_source 'auto'); it is asked again the
//   next business day.
// All the times come from the `now` passed in, so tests use a fake clock.

const askMinute = 8 * 60 + 30;
const openMinute = 9 * 60;
const closeQuestionMinute = 15 * 60;
const closeMarketMinute = 15 * 60 + 30;

export const nextDayBody = z.object(
  {
    answer: z.enum(['keep', 'sell'], { error: 'Choose keep or sell' }),
    source: z.enum(['web', 'kakao']).default('web').describe('Where the answer was given.'),
  },
  { error: 'The request body must be a JSON object' },
);

/** The date (YYYY-MM-DD) and minute of the day in Asia/Seoul. */
export function seoulClock(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minute: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

/** A KRX business day: not a weekend and not in krx_holidays. */
async function isBusinessDay(pool: Pool, date: string) {
  if (isWeekend(date)) return false;
  const { rowCount } = await pool.query('SELECT 1 FROM krx_holidays WHERE holiday_date = $1', [
    date,
  ]);
  return !rowCount;
}

type QuestionRow = {
  id: number;
  position_id: number;
  question_date: string;
  status: 'open' | 'kept' | 'sell_queued' | 'sold' | 'expired';
  opened_at: Date;
  answered_at: Date | null;
  answer_source: string | null;
  account_id: number;
  security_id: number;
  symbol: string;
  name: string | null;
  quantity: string;
  buy_price: string;
  buy_amount: string;
};

const questionSelect = `
  SELECT q.id, q.position_id, q.question_date::text AS question_date, q.status, q.opened_at, q.answered_at,
         q.answer_source, p.account_id, p.security_id, s.symbol, s.name, p.quantity,
         b.price AS buy_price, b.amount_krw AS buy_amount
  FROM mock_position_questions q
  JOIN mock_positions p ON p.id = q.position_id
  JOIN securities s ON s.id = p.security_id
  JOIN mock_orders b ON b.id = p.buy_order_id`;

const toQuestion = (row: QuestionRow) => ({
  id: row.id,
  positionId: row.position_id,
  questionDate: row.question_date,
  status: row.status,
  openedAt: row.opened_at.toISOString(),
  answeredAt: row.answered_at === null ? null : row.answered_at.toISOString(),
  answerSource: row.answer_source,
  security: { id: row.security_id, symbol: row.symbol, name: row.name },
  quantity: row.quantity,
  buy: { price: row.buy_price, amountKrw: won(row.buy_amount) },
});

/** Sells the position of a queued question; the question becomes `sold`. Returns whether it sold. */
async function sellQueued(
  pool: Pool,
  kis: KisSource | undefined,
  now: Date,
  question: { id: number; position_id: number },
) {
  try {
    await sellPosition(pool, kis, () => seoulClock(now).date, question.position_id);
  } catch (error) {
    // Market not open yet or no quote: the question stays queued for the next tick. A position that was
    // already sold (another path) also ends the question.
    if (!(
      error instanceof HttpError &&
      error.status === 409 &&
      /already sold/.test(error.message)
    )) {
      return false;
    }
  }
  await pool.query("UPDATE mock_position_questions SET status = 'sold' WHERE id = $1", [
    question.id,
  ]);
  return true;
}

/**
 * One pass of the morning job, run every minute from 08:00 to 15:59 on weekdays. Idempotent: it opens a question
 * once per position and day, sells each queued answer once, and closes what is past its time.
 */
export async function runLongHoldTick(pool: Pool, kis: KisSource | undefined, now: Date) {
  const { date, minute } = seoulClock(now);
  const result = { opened: 0, sold: 0, closed: 0, openedPositionIds: [] as number[] };
  // Questions of earlier days that are still waiting end, whatever the clock says today.
  const stale = await pool.query(
    `UPDATE mock_position_questions SET
       status = CASE WHEN status = 'open' THEN 'kept' ELSE 'expired' END,
       answered_at = CASE WHEN status = 'open' THEN now() ELSE answered_at END,
       answer_source = CASE WHEN status = 'open' THEN 'auto' ELSE answer_source END
     WHERE question_date < $1 AND status IN ('open', 'sell_queued')`,
    [date],
  );
  result.closed += stale.rowCount ?? 0;
  if (!(await isBusinessDay(pool, date))) return result;

  if (minute >= askMinute && minute < closeQuestionMinute) {
    const opened = await pool.query<{ position_id: number }>(
      `INSERT INTO mock_position_questions (position_id, question_date)
       SELECT p.id, $1::date FROM mock_positions p
       WHERE p.strategy = 'long_hold' AND p.closed_at IS NULL
         AND (p.opened_at AT TIME ZONE 'Asia/Seoul')::date < $1::date
       ON CONFLICT DO NOTHING
       RETURNING position_id`,
      [date],
    );
    result.opened = opened.rowCount ?? 0;
    // The positions asked just now (not the ones asked by an earlier tick), for the KakaoTalk message (#313).
    result.openedPositionIds = opened.rows.map((row) => row.position_id);
  }
  if (minute >= openMinute && minute < closeMarketMinute) {
    const queued = await pool.query<{ id: number; position_id: number }>(
      "SELECT id, position_id FROM mock_position_questions WHERE question_date = $1 AND status = 'sell_queued' ORDER BY id",
      [date],
    );
    for (const question of queued.rows) {
      if (await sellQueued(pool, kis, now, question)) result.sold += 1;
    }
  }
  if (minute >= closeQuestionMinute) {
    const closed = await pool.query(
      `UPDATE mock_position_questions SET status = 'kept', answered_at = now(), answer_source = 'auto'
       WHERE question_date = $1 AND status = 'open'`,
      [date],
    );
    result.closed += closed.rowCount ?? 0;
  }
  if (minute >= closeMarketMinute) {
    const expired = await pool.query(
      "UPDATE mock_position_questions SET status = 'expired' WHERE question_date = $1 AND status = 'sell_queued'",
      [date],
    );
    result.closed += expired.rowCount ?? 0;
  }
  return result;
}

/**
 * Answers today's question of a position. Answering twice, or after 15:00, is a 409.
 * @public Called by the chatbot (#312) as well as the route.
 */
export async function answerQuestion(
  pool: Pool,
  kis: KisSource | undefined,
  now: Date,
  positionId: number,
  answer: 'keep' | 'sell',
  source: 'web' | 'kakao',
) {
  const { date, minute } = seoulClock(now);
  const found = await pool.query<{ id: number; position_id: number; status: string }>(
    'SELECT id, position_id, status FROM mock_position_questions WHERE position_id = $1 AND question_date = $2',
    [positionId, date],
  );
  const question = found.rows[0];
  if (!question)
    throw new HttpError(404, 'There is no keep-or-sell question for this position today');
  if (question.status !== 'open') {
    throw new HttpError(409, 'This question was already answered or has closed');
  }
  if (minute >= closeQuestionMinute) throw new HttpError(409, 'The question closed at 15:00');
  // The status change is the claim: of two answers sent at once, only one updates the row.
  const claimed = await pool.query(
    `UPDATE mock_position_questions SET status = $2, answered_at = now(), answer_source = $3
     WHERE id = $1 AND status = 'open'`,
    [question.id, answer === 'keep' ? 'kept' : 'sell_queued', source],
  );
  if (!claimed.rowCount)
    throw new HttpError(409, 'This question was already answered or has closed');
  // Asked after the open, the sale is tried now; before it, or when the market cannot fill it yet, the next tick sells it.
  if (answer === 'sell' && minute >= openMinute) await sellQueued(pool, kis, now, question);
  const { rows } = await pool.query<QuestionRow>(`${questionSelect} WHERE q.id = $1`, [
    question.id,
  ]);
  return toQuestion(rows[0]);
}

export function mockQuestionsRouter(pool: Pool, now: () => Date) {
  const router = Router({ mergeParams: true });

  // Today's questions of the account's positions: the open ones first.
  router.get('/', async (req, res) => {
    const accountId = parseId((req.params as { accountId?: string }).accountId, 'mock account');
    const exists = await pool.query('SELECT 1 FROM mock_accounts WHERE id = $1', [accountId]);
    if (!exists.rowCount) throw new HttpError(404, 'Mock trading account not found');
    const { rows } = await pool.query<QuestionRow>(
      `${questionSelect} WHERE p.account_id = $1 AND q.question_date = $2
       ORDER BY (q.status = 'open') DESC, q.id`,
      [accountId, seoulClock(now()).date],
    );
    res.json({ questions: rows.map(toQuestion) });
  });

  return router;
}

/** Adds `POST /:id/next-day` (the answer to a morning question) to the positions router (#310). */
export function addNextDayRoute(
  router: Router,
  pool: Pool,
  kis: KisSource | undefined,
  now: () => Date,
) {
  router.post('/:id/next-day', async (req, res) => {
    const id = parseId(req.params.id, 'position');
    const body = nextDayBody.parse(req.body);
    res.json({ question: await answerQuestion(pool, kis, now(), id, body.answer, body.source) });
  });
}

const LONG_HOLD_QUEUE = 'long-hold-morning';

/**
 * The morning question as a pg-boss queue (#310): every minute from 08:00 to 15:59 Asia/Seoul on weekdays. The tick
 * is idempotent, so a duplicate or late job does nothing twice. `retryLimit: 0`: the next minute is the retry.
 */
export function longHoldQueue(
  pool: Pool,
  kis: KisSource | undefined,
  now: () => Date = () => new Date(),
  /** Called with the positions whose question this tick opened (#313: the KakaoTalk message). It must not throw. */
  onOpened?: (positionIds: number[]) => Promise<void>,
): JobQueue {
  return {
    name: LONG_HOLD_QUEUE,
    policy: 'singleton',
    retryLimit: 0,
    schedule: '* 8-15 * * 1-5',
    handler: async () => {
      const result = await runLongHoldTick(pool, kis, now());
      if (result.openedPositionIds.length > 0) await onOpened?.(result.openedPositionIds);
    },
  };
}
