// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/period-nav/
// Date arithmetic for the Day, Week and 12-week views (#1175). Dates are `YYYY-MM-DD` strings and all arithmetic runs
// in UTC, so no time zone or daylight saving shifts a day. One default week start for every app: Sunday.
import { isDate } from '../ui/date-fields';

export type PeriodKind = 'day' | 'week' | '12weeks';
/** 0 = Sunday (the default), 1 = Monday. */
export type WeekStart = 0 | 1;

export const defaultWeekStart: WeekStart = 0;
export const twelveWeeks = 12;

const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const text = (day: Date) => day.toISOString().slice(0, 10);

/** The date `step` days after `date` ("2026-11-27", -1 gives "2026-11-26"). */
export function addDays(date: string, step: number) {
  const day = utc(date);
  day.setUTCDate(day.getUTCDate() + step);
  return text(day);
}

/** First day of the week that holds `date`. */
export function weekStart(date: string, weekStartsOn: WeekStart = defaultWeekStart) {
  return addDays(date, -((utc(date).getUTCDay() - weekStartsOn + 7) % 7));
}

/** The seven dates of the week that starts on `start`. */
export const weekDays = (start: string) => Array.from({ length: 7 }, (_, n) => addDays(start, n));

/** The starts of the `count` weeks that end with the week of `date`, oldest first. */
export function lastWeeks(date: string, count: number, weekStartsOn: WeekStart = defaultWeekStart) {
  const last = weekStart(date, weekStartsOn);
  return Array.from({ length: count }, (_, n) => addDays(last, (n - count + 1) * 7));
}

/** First and last day of the period around `date`: the day, its week, or the 12 weeks that end with its week. */
export function periodRange(
  period: PeriodKind,
  date: string,
  weekStartsOn: WeekStart = defaultWeekStart,
) {
  if (period === 'day') return { from: date, to: date };
  const last = weekStart(date, weekStartsOn);
  if (period === 'week') return { from: last, to: addDays(last, 6) };
  return { from: addDays(last, -7 * (twelveWeeks - 1)), to: addDays(last, 6) };
}

/** How many days one previous or next step moves the date. */
export const stepDays = (period: PeriodKind) => (period === 'day' ? 1 : period === 'week' ? 7 : 84);

/** The date in `?date=` when it is a real date between 1900 and 2100, otherwise `fallback`. */
export function readDateParam(params: URLSearchParams, fallback: string, key = 'date') {
  const value = params.get(key) ?? '';
  const year = Number(value.slice(0, 4));
  return isDate(value) && year >= 1900 && year <= 2100 ? value : fallback;
}

/** `params` with `?date=` set, or removed when the date is today (so the address stays short). */
export function writeDateParam(params: URLSearchParams, date: string, today: string, key = 'date') {
  const next = new URLSearchParams(params);
  if (date === today) next.delete(key);
  else next.set(key, date);
  return next;
}

const dayFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const shortFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** "Fri, Nov 27, 2026" */
export const dayLabel = (date: string) => dayFormat.format(utc(date));

/** "Fri, Nov 27, 2026" for one day, "Nov 22 – Nov 28" for a longer range. */
export function rangeLabel(from: string, to: string) {
  return from === to
    ? dayLabel(from)
    : `${shortFormat.format(utc(from))} – ${shortFormat.format(utc(to))}`;
}
