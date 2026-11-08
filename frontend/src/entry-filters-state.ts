// #39 Filters for the entry list. They live in the address (`?from=…&to=…&kind=…&category=…&q=…&page=…`)
// so a reload or a shared link shows the same list. Without `from` and `to` the list is this month in Seoul;
// `from=&to=` (both empty) is every date.

export type Kind = 'income' | 'expense';
export type FilterCategory = { id: number; kind: Kind; name: string; hidden: boolean };
export type Filters = {
  from: string;
  to: string;
  kind: '' | Kind;
  /** '' all, 'none' 미분류, or a category id. */
  category: string;
  q: string;
  page: number;
};

export const kindLabel: Record<Kind, string> = { expense: '지출', income: '수입' };
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

/** The filters in the address; `today` (YYYY-MM-DD in Seoul) picks the default month. */
export function readFilters(params: URLSearchParams, today: string): Filters {
  const period =
    params.has('from') || params.has('to')
      ? { from: params.get('from') ?? '', to: params.get('to') ?? '' }
      : monthRange(today.slice(0, 7));
  const kind = params.get('kind');
  const page = params.get('page') ?? '';
  return {
    ...period,
    kind: kind === 'income' || kind === 'expense' ? kind : '',
    category: params.get('category') ?? '',
    q: params.get('q') ?? '',
    page: /^[1-9]\d{0,8}$/.test(page) ? Number(page) : 1,
  };
}

/** The address for `filters`: the period is always written, so an empty one stays "every date". */
export function writeFilters(filters: Filters) {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
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

/** "2026년 11월" for a whole month, otherwise the dates as given. */
export function periodLabel({ from, to }: { from: string; to: string }) {
  if (from && to) {
    const month = from.slice(0, 7);
    if (from === `${month}-01` && to === monthRange(month).to) {
      return `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;
    }
    return `${from} ~ ${to}`;
  }
  if (from) return `${from}부터`;
  if (to) return `${to}까지`;
  return '전체 기간';
}
