// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/lib/
// Text and number helpers every app used to copy (#20). All output is English. Dates are `YYYY-MM-DD` strings and are
// formatted in UTC, so no time zone moves a day. "Today" is the service day in Asia/Seoul.
import { parseDate, seoulToday } from '../components/ui/date-fields';

/**
 * `count` with its noun: plural(1, 'set') is "1 set", plural(3, 'set') is "3 sets". Pass the plural for a noun that
 * does not just add "s": plural(2, 'person', 'people') is "2 people". The count is grouped: "1,200 sets".
 */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatNumber(count)} ${Math.abs(count) === 1 ? one : many}`;
}

/** A number with thousands separators ("1,234.5"). A value that is not a finite number gives an empty string. */
export function formatNumber(value: number, maximumFractionDigits = 2): string {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value);
}

/**
 * Minutes as hours and minutes: 45 is "45m", 60 is "1h", 135 is "2h 15m". Fractions round to the nearest minute;
 * a negative or unreadable value gives "0m".
 */
export function formatDuration(totalMinutes: number): string {
  const total = Number.isFinite(totalMinutes) ? Math.max(0, Math.round(totalMinutes)) : 0;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export type DateStyle = 'short' | 'medium' | 'long';

const dateOptions: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { month: 'short', day: 'numeric' },
  medium: { year: 'numeric', month: 'short', day: 'numeric' },
  long: { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' },
};

/**
 * A `YYYY-MM-DD` day for people: short "Nov 28", medium (default) "Nov 28, 2026", long "Sat, Nov 28, 2026".
 * Text that is not a real day is returned unchanged, so a bad value is visible instead of becoming "Invalid Date".
 */
export function formatDate(day: string, style: DateStyle = 'medium'): string {
  const parts = parseDate(day);
  if (!parts) return day;
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return new Intl.DateTimeFormat('en-US', { ...dateOptions[style], timeZone: 'UTC' }).format(date);
}

/** Today as `YYYY-MM-DD` in Asia/Seoul, the service time zone of every app. Pass `now` in tests. */
export const serviceToday = (now?: Date): string => seoulToday(now);
