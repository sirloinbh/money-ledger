import { requestJson } from './lib/api';

// #49 Net worth by day (decisions 2026-11-10). The app saves today's values once when it opens; the card on the
// asset screen lists the saved days for a period and can save again by hand. A day keeps its latest save.

export const netWorthPath = '/api/portfolio/net-worth';

export type Snapshot = {
  date: string;
  assetsKrw: number;
  debtsKrw: number;
  netKrw: number;
  uncounted: number;
};

let todaySave: Promise<void> | undefined;

/**
 * Today's save when the app opens, at most once per page load. The card waits for it before reading the list,
 * so today is in the chart. A failure is quiet: the card's own button saves by hand and shows any error.
 */
export function saveTodayOnce() {
  todaySave ??= requestJson(netWorthPath, { method: 'POST' }).then(
    () => undefined,
    () => undefined,
  );
  return todaySave;
}

export type Period = '1m' | '3m' | '1y' | 'all';

export const periods: { id: Period; label: string; months: number | null }[] = [
  { id: '1m', label: '1개월', months: 1 },
  { id: '3m', label: '3개월', months: 3 },
  { id: '1y', label: '1년', months: 12 },
  { id: 'all', label: '전체', months: null },
];

/**
 * The first day of a period ending `today` (YYYY-MM-DD): the same day `months` earlier, or that month's last day
 * when it is shorter (2026-05-31 three months back is 2026-02-28). Undefined for the whole history.
 */
export function periodStart(today: string, period: Period) {
  const months = periods.find((item) => item.id === period)!.months;
  if (months === null) return undefined;
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1 - months;
  const target = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(Number(today.slice(8, 10)), lastDay));
  return target.toISOString().slice(0, 10);
}

/** A date as a number for the time axis: days are evenly spaced whatever is saved. */
export const dayValue = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** "2026-11-10" → "2026년 11월 10일" */
export const dayLabel = (date: string) =>
  `${date.slice(0, 4)}년 ${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;

const oneDay = 86_400_000;

/**
 * Evenly spaced axis ticks between `start` and `end` (UTC day values), not the saved days: every 7 days up to
 * about a month and a half ("10.10"), each month's first day up to about a year ("26.9"), and January and July
 * beyond ("26.7"). Recharts still drops ticks that would overlap on a narrow screen.
 */
export function timeTicks(start: number, end: number) {
  const span = end - start;
  if (span <= 45 * oneDay) {
    const ticks: number[] = [];
    for (let day = start; day <= end; day += 7 * oneDay) ticks.push(day);
    return { ticks, label: (value: number) => monthDay(value) };
  }
  const step = span <= 400 * oneDay ? 1 : 6;
  const first = new Date(start);
  const ticks: number[] = [];
  let year = first.getUTCFullYear();
  // The first month start on or after `start` that is on the step (every month, or January and July).
  let month = first.getUTCDate() === 1 ? first.getUTCMonth() : first.getUTCMonth() + 1;
  month = Math.ceil(month / step) * step;
  for (let day = Date.UTC(year, month, 1); day <= end; day = Date.UTC(year, month, 1)) {
    ticks.push(day);
    month += step;
    if (month >= 12) {
      year += Math.floor(month / 12);
      month %= 12;
    }
  }
  return { ticks, label: (value: number) => yearMonth(value) };
}

const monthDay = (value: number) => {
  const date = new Date(value).toISOString();
  return `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`;
};
const yearMonth = (value: number) => {
  const date = new Date(value).toISOString();
  return `${date.slice(2, 4)}.${Number(date.slice(5, 7))}`;
};

/**
 * Won axis ticks for these values: in 억 from 100,000,000 and 만 from 10,000, with as many decimals as it takes
 * for ticks over a narrow spread to differ (2.76억, 2.78억 rather than 2.8억 five times).
 */
export function wonAxisLabel(values: number[]) {
  const largest = Math.max(...values.map(Math.abs));
  const spread = Math.max(...values) - Math.min(...values);
  const [unit, suffix] =
    largest >= 100_000_000 ? [100_000_000, '억'] : largest >= 10_000 ? [10_000, '만'] : [1, ''];
  let decimals = 0;
  while (unit > 1 && spread > 0 && (spread / unit) * 10 ** decimals < 10 && decimals < 4)
    decimals++;
  const format = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: Math.max(decimals, 1) });
  return (value: number) => (value === 0 ? '0' : `${format.format(value / unit)}${suffix}`);
}
