import type { Pool, PoolClient } from 'pg';

import { inTransaction } from '../db.js';
import { serviceDate } from '../standard/http.js';
import type { JobQueue } from '../standard/jobs.js';
import { addDays, isWeekend } from './dates.js';
import type { PriceLog } from './fetch.js';
import type { CalendarDay, KisSource } from './kis.js';

// #321 The KRX trading calendar. `isBusinessDay` is the one function every v2 job asks (morning keep-or-sell,
// day trade checks, news, pick). A business day is a weekday that is not in `krx_holidays`. The table is filled from
// three places (docs/price-source.md, "KRX holidays"): KIS 국내휴장일조회 (source 'kis'), two KRX-only closures the
// app computes itself so they hold even without a key (source 'rule'), and rows added by hand (source 'manual'),
// which the sync never changes or removes.

type Db = Pool | PoolClient;

/** A KRX business day: not a weekend and not in krx_holidays. */
export async function isBusinessDay(db: Db, date: string) {
  if (isWeekend(date)) return false;
  const { rowCount } = await db.query('SELECT 1 FROM krx_holidays WHERE holiday_date = $1', [date]);
  return !rowCount;
}

/**
 * The KRX closures that follow a fixed rule: Labour Day (May 1, when it is a weekday) and the year-end closing day
 * (the last weekday of December). Neither is a public holiday, so a public-holiday list would miss them.
 */
export function ruleClosures(year: number): { date: string; name: string }[] {
  const closures: { date: string; name: string }[] = [];
  const labour = `${year}-05-01`;
  if (!isWeekend(labour)) closures.push({ date: labour, name: 'Labour Day' });
  let last = `${year}-12-31`;
  while (isWeekend(last)) last = addDays(last, -1);
  closures.push({ date: last, name: 'Year-end market closure' });
  return closures;
}

/** KIS answers about a month per call, so a two-year range is about 25 calls; this stops a loop that makes no progress. */
const maxPages = 40;
/** The calendar is read again when the last read is older than this many days. */
const freshDays = 25;

type SyncResult = { rules: number; kisDays: number; closed: number; skipped: boolean };

/**
 * Fills krx_holidays for this year and the next. The rule closures are always added. KIS is read when a source is
 * given and the last read is older than 25 days; a failed or empty read changes nothing (the next daily run tries
 * again). The 'kis' rows of the range read are replaced as a whole, so a day KIS later reports as open goes away;
 * 'rule' and 'manual' rows stay.
 */
export async function syncHolidays(
  pool: Pool,
  kis: KisSource | undefined,
  now: Date,
  log: PriceLog = () => undefined,
): Promise<SyncResult> {
  const today = serviceDate(now);
  const year = Number(today.slice(0, 4));
  const horizon = `${year + 1}-12-31`;
  const result: SyncResult = { rules: 0, kisDays: 0, closed: 0, skipped: false };

  for (const closure of [...ruleClosures(year), ...ruleClosures(year + 1)]) {
    const added = await pool.query(
      "INSERT INTO krx_holidays (holiday_date, name, source) VALUES ($1, $2, 'rule') ON CONFLICT DO NOTHING",
      [closure.date, closure.name],
    );
    result.rules += added.rowCount ?? 0;
  }
  if (!kis?.calendar) return result;

  const state = await pool.query<{ fresh: boolean }>(
    'SELECT synced_at > $1::timestamptz - make_interval(days => $2) AS fresh FROM krx_holiday_sync',
    [now, freshDays],
  );
  if (state.rows[0]?.fresh) {
    result.skipped = true;
    return result;
  }

  const days = new Map<string, boolean>();
  let cursor = today;
  for (let page = 0; page < maxPages && cursor <= horizon; page += 1) {
    const rows: CalendarDay[] = await kis.calendar(cursor);
    const fresh = rows.filter((day) => day.date >= cursor && day.date <= horizon);
    if (fresh.length === 0) break;
    for (const day of fresh) days.set(day.date, day.open);
    const last = fresh.reduce((latest, day) => (day.date > latest ? day.date : latest), cursor);
    cursor = addDays(last, 1);
  }
  if (days.size === 0) throw new Error('KIS returned no calendar days');

  const first = [...days.keys()].sort()[0];
  const through = [...days.keys()].sort().at(-1)!;
  const closed = [...days]
    .filter(([date, open]) => !open && !isWeekend(date))
    .map(([date]) => date);
  await inTransaction(pool, async (client) => {
    await client.query(
      "DELETE FROM krx_holidays WHERE source = 'kis' AND holiday_date BETWEEN $1 AND $2",
      [first, through],
    );
    if (closed.length > 0) {
      await client.query(
        `INSERT INTO krx_holidays (holiday_date, name, source)
         SELECT d, 'KRX closed day (KIS)', 'kis' FROM unnest($1::date[]) AS d ON CONFLICT DO NOTHING`,
        [closed],
      );
    }
    await client.query(
      `INSERT INTO krx_holiday_sync (id, synced_at, covered_through) VALUES (true, $1, $2)
       ON CONFLICT (id) DO UPDATE SET synced_at = EXCLUDED.synced_at, covered_through = EXCLUDED.covered_through`,
      [now, through],
    );
  });
  result.kisDays = days.size;
  result.closed = closed.length;
  log({ event: 'krx_holidays_synced', days: days.size, closed: closed.length, through });
  return result;
}

export const HOLIDAY_QUEUE = 'krx-holidays';

/**
 * The calendar sync as a pg-boss queue: daily at 06:00 Asia/Seoul. The handler skips KIS while the last read is under
 * 25 days old, so it reads about monthly, and a failed read is tried again the next day.
 */
export function holidayQueue(
  pool: Pool,
  kis: KisSource | undefined,
  log: PriceLog,
  now: () => Date = () => new Date(),
): JobQueue {
  return {
    name: HOLIDAY_QUEUE,
    policy: 'singleton',
    retryLimit: 0,
    schedule: '0 6 * * *',
    handler: async () => {
      await syncHolidays(pool, kis, now(), log);
    },
  };
}
