// Calendar helpers for the price fetch. Dates are YYYY-MM-DD strings; arithmetic runs in UTC so no time zone
// or daylight saving change can shift a day.

/** `date` moved by `days` calendar days. */
export function addDays(date: string, days: number) {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** Saturday or Sunday, for a YYYY-MM-DD date. */
export const isWeekend = (date: string) =>
  [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

function zoned(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
}

/** The hour (0-23) in Asia/Seoul. */
export const seoulHour = (now: Date) => zoned(now, 'Asia/Seoul').hour;

/**
 * The latest US trading day whose close should be out: the US Eastern date once it is 18:00 there (the
 * market closes at 16:00), otherwise the day before. At 12:00 in Seoul it is 22:00 or 23:00 of the
 * previous day in New York, so the daily fetch asks for that day.
 */
export function latestUsDate(now: Date) {
  const eastern = zoned(now, 'America/New_York');
  return eastern.hour >= 18 ? eastern.date : addDays(eastern.date, -1);
}

/** Fetches never go back further than this many days from the latest date (docs/price-source.md). */
const fetchWindowDays = 10;

/**
 * The dates to ask for: from the day after `checkedThrough` (or the first day of the window when nothing is
 * checked yet) to `latest`, never more than the last 10 days.
 */
export function datesToFetch(checkedThrough: string | null, latest: string) {
  const windowStart = addDays(latest, -(fetchWindowDays - 1));
  let date =
    checkedThrough === null || checkedThrough < windowStart
      ? windowStart
      : addDays(checkedThrough, 1);
  const dates: string[] = [];
  while (date <= latest) {
    dates.push(date);
    date = addDays(date, 1);
  }
  return dates;
}
