// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/list-toolbar/
// URL state for a list page (#17): the search text, one value per filter and the sort live in the query string, so a
// reload, the back button and a shared link keep the list as it was. Values equal to their default are left out of the
// URL, so an untouched list has a clean address. The helpers are plain functions on `URLSearchParams`; the page decides
// how to read and write the URL (router, `history.replaceState`).

/** The defaults. `search` defaults to ''; each filter maps its query key to its default ('' means all); `sort` has the default sort value. */
export type ListQueryShape = {
  search?: string;
  filters?: Record<string, string>;
  sort?: { key?: string; default: string };
};

export type ListQuery = { search: string; filters: Record<string, string>; sort: string };

const searchKey = 'q';
const sortKey = 'sort';

/** Reads a list's state from a query string; missing keys give the default. */
export function parseListQuery(
  input: string | URLSearchParams,
  shape: ListQueryShape = {},
): ListQuery {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input;
  const filters: Record<string, string> = {};
  for (const [name, fallback] of Object.entries(shape.filters ?? {})) {
    filters[name] = params.get(name) ?? fallback;
  }
  return {
    search: params.get(searchKey) ?? shape.search ?? '',
    filters,
    sort: params.get(shape.sort?.key ?? sortKey) ?? shape.sort?.default ?? '',
  };
}

/**
 * Writes a list's state onto a copy of `base` (other parameters such as `page` or `tab` are kept) and returns the
 * query string without the leading "?". Values equal to their default, and empty search text, are removed.
 */
export function formatListQuery(
  query: ListQuery,
  shape: ListQueryShape = {},
  base: string | URLSearchParams = '',
): string {
  const params = new URLSearchParams(typeof base === 'string' ? base : base.toString());
  const set = (key: string, value: string, fallback: string) => {
    if (value === fallback) params.delete(key);
    else params.set(key, value);
  };
  set(searchKey, query.search.trim(), shape.search ?? '');
  for (const [name, fallback] of Object.entries(shape.filters ?? {})) {
    set(name, query.filters[name] ?? fallback, fallback);
  }
  if (shape.sort) set(shape.sort.key ?? sortKey, query.sort, shape.sort.default);
  return params.toString();
}

/** True when the state differs from the defaults (the toolbar uses it to show the Reset button). */
export function isListQueryChanged(query: ListQuery, shape: ListQueryShape = {}): boolean {
  if (query.search.trim() !== (shape.search ?? '')) return true;
  const filterChanged = Object.entries(shape.filters ?? {}).some(
    ([name, fallback]) => (query.filters[name] ?? fallback) !== fallback,
  );
  if (filterChanged) return true;
  return shape.sort ? query.sort !== shape.sort.default : false;
}
