import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type SetURLSearchParams, useSearchParams } from 'react-router';

import { type Filters, readFilters, writeFilters } from './entry-filters-state';
import { type Category, entriesPath, type Entry, type Listing, pageSize } from './entry-model';
import { requestJson } from './lib/api';

// #190 State and effects of EntryManager that do not touch the form: the filters in the address, the list,
// the categories, and keeping the address valid.

/** The list filters kept in the address, and the setter that changes it. */
export function useAddressFilters(today: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Memoized by the filter keys of the address only: the filter form compares by identity to notice a change,
  // and another key changing (the summary's `month`, #40) must not reset what is being typed.
  const filterSearch = writeFilters(readFilters(searchParams, today)).toString();
  const filters = useMemo(
    () => readFilters(new URLSearchParams(filterSearch), today),
    [filterSearch, today],
  );
  return { filters, setSearchParams };
}

/**
 * The loaded page for `query`. `loadEntries` always loads the filters current when it is called: a save or
 * delete that ends after the filters changed reloads the new list, not the one it started on.
 */
export function useEntryListing(query: string) {
  const [listing, setListing] = useState<Listing | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  // The filters the next load asks for.
  const latestQuery = useRef(query);
  useEffect(() => {
    latestQuery.current = query;
  }, [query]);
  // Only the latest request may fill the list. Numbered, not compared by filters: two loads of the same
  // filters (one started before a save, one after) may answer in either order.
  const latestRequest = useRef(0);

  const loadEntries = useCallback(async () => {
    const asked = latestQuery.current;
    const request = ++latestRequest.current;
    setLoadFailed(false);
    try {
      const data = await requestJson<{ entries: Entry[]; total: number }>(
        `${entriesPath}?${asked}`,
      );
      if (latestRequest.current === request) setListing({ query: asked, ...data });
    } catch (cause) {
      if (latestRequest.current === request) setLoadFailed(true);
      throw cause;
    }
  }, []);

  return { listing, loadFailed, loadEntries };
}

/** The categories, loaded again when `version` changes (edited elsewhere on the page). */
export function useEntryCategories(
  version: number,
  showError: (cause: unknown, fallback: string) => void,
) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    requestJson<{ categories: Category[] }>('/api/ledger/categories')
      .then((data) => {
        setCategories(data.categories);
        setLoaded(true);
      })
      .catch((cause: unknown) => showError(cause, 'Could not load the categories'));
  }, [version, showError]);
  return { categories, loaded };
}

/** Fixes an address the list cannot show: a page past the end, or a category the filter cannot offer. */
export function useFilterCleanup({
  listing,
  query,
  filters,
  categories,
  categoriesLoaded,
  setSearchParams,
}: {
  listing: Listing | undefined;
  query: string;
  filters: Filters;
  categories: Category[];
  categoriesLoaded: boolean;
  setSearchParams: SetURLSearchParams;
}) {
  // A page past the end (the last entry of the last page was deleted, or an old link): go to the last page.
  useEffect(() => {
    if (!listing || listing.query !== query || listing.entries.length > 0) return;
    const last = Math.max(1, Math.ceil(listing.total / pageSize));
    if (filters.page > last) {
      setSearchParams((prev) => writeFilters({ ...filters, page: last }, prev), { replace: true });
    }
  }, [listing, query, filters, setSearchParams]);

  // A category in the address that the filter cannot offer (unknown, or of the other kind) is dropped, so the
  // form and the list always show the same conditions.
  useEffect(() => {
    if (!categoriesLoaded || !/^\d+$/.test(filters.category)) return;
    const category = categories.find((c) => String(c.id) === filters.category);
    if (!category || (filters.kind && category.kind !== filters.kind)) {
      setSearchParams((prev) => writeFilters({ ...filters, category: '', page: 1 }, prev), {
        replace: true,
      });
    }
  }, [categoriesLoaded, categories, filters, setSearchParams]);
}
