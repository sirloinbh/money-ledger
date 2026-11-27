// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
// Date and time helpers for DateField and TimeField (#1138). Dates are `YYYY-MM-DD` strings and all
// arithmetic is in UTC, so no local time zone shifts a day. Names are written out in English
// instead of coming from Intl, because Intl follows the browser language.

export const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const weekdayNames = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

// A UTC date for any year, including 0 to 99 (which `Date.UTC` would read as 1900 to 1999).
function utc(year: number, month: number, day: number) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

const toIso = (date: Date) =>
  `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

// The day as parts when `text` is a real calendar date written `YYYY-MM-DD`, otherwise null.
export function parseDate(text: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = utc(year, month, day);
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

export const isDate = (text: string) => parseDate(text) !== null;

export function addDays(day: string, days: number) {
  const parts = parseDate(day);
  if (!parts) return day;
  const date = utc(parts.year, parts.month, parts.day);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

// A day in the month `months` away; a day the month does not have becomes its last day.
export function addMonths(day: string, months: number) {
  const parts = parseDate(day);
  if (!parts) return day;
  const first = utc(parts.year, parts.month + months, 1);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  first.setUTCDate(Math.min(parts.day, last.getUTCDate()));
  return toIso(first);
}

export const clampDate = (day: string, min?: string, max?: string) =>
  min && day < min ? min : max && day > max ? max : day;

// The weeks shown for a month: whole weeks (first day `weekStartsOn`, 0 = Sunday) that cover the month.
export function monthWeeks(day: string, weekStartsOn: 0 | 1 = 0) {
  const parts = parseDate(day);
  if (!parts) return [];
  const first = utc(parts.year, parts.month, 1);
  const lead = (first.getUTCDay() - weekStartsOn + 7) % 7;
  const start = addDays(toIso(first), -lead);
  const monthEnd = utc(parts.year, parts.month + 1, 0);
  const count = Math.ceil((lead + monthEnd.getUTCDate()) / 7);
  return Array.from({ length: count }, (_, week) =>
    Array.from({ length: 7 }, (_, index) => addDays(start, week * 7 + index)),
  );
}

export const monthTitle = (day: string) => {
  const parts = parseDate(day);
  return parts ? `${monthNames[parts.month - 1]} ${parts.year}` : '';
};

export const longDate = (day: string) => {
  const parts = parseDate(day);
  return parts ? `${monthNames[parts.month - 1]} ${parts.day}, ${parts.year}` : day;
};

export const weekdayOf = (day: string) => {
  const parts = parseDate(day);
  return parts ? utc(parts.year, parts.month, parts.day).getUTCDay() : 0;
};

// Today in Asia/Seoul, the service time zone of every app. `en-CA` writes YYYY-MM-DD.
export const seoulToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);

// `HH:MM` on a 24-hour clock as parts, or null.
export function parseTime(text: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

export const formatTime = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`;
