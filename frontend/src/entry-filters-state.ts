import { monthLabel } from './trend-series';

// #39 Filters for the entry list. They live in the address (`?from=…&to=…&kind=…&category=…&q=…&page=…`)
// so a reload or a shared link shows the same list. Without `from` and `to` the list is this month in Seoul;
// `from=&to=` (both empty) is every date.

export type Kind = 'income' | 'expense';
export type FilterCategory = { id: number; kind: Kind; name: string; hidden: boolean };
export type Filters = {
  from: string;
  to: string;
  kind: '' | Kind;
  /** '' all, 'none' uncategorized, or a category id. */
  category: string;
  q: string;
  page: number;
};

export const kindLabel: Record<Kind, string> = { expense: 'Expense', income: 'Income' };
export const selectClass =
  'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none pointer-coarse:min-h-11 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-body-sm dark:bg-input/30';

/** "2026-11" → the first and last day of that month. */
export function monthRange(month: string) {
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** "2026-01", -1 → "2025-12" */
export function shiftMonth(month: string, delta: number) {
  const [year, number] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, number - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** A real date between 1900 and 2100 (what the server accepts), or ''. */
function validDate(text: string | null) {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const year = Number(text.slice(0, 4));
  if (year < 1900 || year > 2100) return '';
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : '';
}

/**
 * The filters in the address; `today` (YYYY-MM-DD in Seoul) picks the default month. Values the server
 * would refuse (a hand-edited or old link) are dropped instead, so the list never gets stuck on an error;
 * a start after the end falls back to this month.
 */
export function readFilters(params: URLSearchParams, today: string): Filters {
  const thisMonth = monthRange(today.slice(0, 7));
  let period = thisMonth;
  if (params.has('from') || params.has('to')) {
    const from = validDate(params.get('from'));
    const to = validDate(params.get('to'));
    period = from && to && from > to ? thisMonth : { from, to };
  }
  const kind = params.get('kind');
  const category = params.get('category') ?? '';
  const page = params.get('page') ?? '';
  return {
    ...period,
    kind: kind === 'income' || kind === 'expense' ? kind : '',
    category: /^(none|[1-9]\d{0,8})$/.test(category) ? category : '',
    q: (params.get('q') ?? '').trim().slice(0, 50),
    page: /^[1-9]\d{0,8}$/.test(page) ? Number(page) : 1,
  };
}

const filterKeys = ['from', 'to', 'kind', 'category', 'q', 'page'];

/**
 * The address for `filters`: the period is always written, so an empty one stays "every date". Other keys of
 * `base` (e.g. the summary's `month`, #40) are kept.
 */
export function writeFilters(filters: Filters, base?: URLSearchParams) {
  const params = new URLSearchParams(base);
  for (const key of filterKeys) params.delete(key);
  params.set('from', filters.from);
  params.set('to', filters.to);
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.category) params.set('category', filters.category);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.page > 1) params.set('page', String(filters.page));
  return params;
}

/** The API query for `filters`: only the conditions that narrow the list. */
export function apiQuery(filters: Filters, pageSize: number) {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.category) params.set('category', filters.category);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  params.set('page', String(filters.page));
  params.set('size', String(pageSize));
  return params.toString();
}

/** "November 2026" for a whole month, otherwise the dates as given. */
export function periodLabel({ from, to }: { from: string; to: string }) {
  if (from && to) {
    const month = from.slice(0, 7);
    if (from === `${month}-01` && to === monthRange(month).to) {
      return monthLabel(month);
    }
    return `${from} ~ ${to}`;
  }
  if (from) return `From ${from}`;
  if (to) return `Through ${to}`;
  return 'All time';
}
