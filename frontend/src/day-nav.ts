// #359 Dates of the day log, Week and 12 weeks pages. Dates are plain YYYY-MM-DD text (Seoul); the arithmetic runs
// in UTC so no time zone or daylight saving moves a day. A week is Sunday to Saturday, as in the reports (#62).

const dayMs = 86_400_000;

const toDate = (date: string) => new Date(`${date}T00:00:00Z`);
const fromDate = (value: Date) => value.toISOString().slice(0, 10);

/** The date in `?date=` if it is a real date the server accepts (1900 to 2100), else `today`. */
export function readDay(params: URLSearchParams, today: string) {
  const text = params.get('date') ?? '';
  const year = Number(text.slice(0, 4));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || year < 1900 || year > 2100) return today;
  return fromDate(toDate(text)) === text ? text : today;
}

/** "2026-11-27", -1 → "2026-11-26" */
export const shiftDays = (date: string, delta: number) =>
  fromDate(new Date(toDate(date).getTime() + delta * dayMs));

/** The Sunday that starts the week of `date`. */
export const weekStart = (date: string) => shiftDays(date, -toDate(date).getUTCDay());

/** "Fri" for a date. */
export const weekdayName = (date: string) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(toDate(date));

/** "Fri, Nov 27, 2026" */
export const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(toDate(date));
