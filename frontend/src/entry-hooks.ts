import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { type SetURLSearchParams, useSearchParams } from 'react-router';

import { type Filters, readFilters, writeFilters } from './entry-filters-state';
import { type Category, entriesPath, type Entry, type Listing, pageSize } from './entry-model';
import { ledgerKeys, useLedgerList } from './ledger-query';
import { type RequestError, requestJson } from './lib/api';

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
 * The loaded page for `query` (#213: a query under `ledgerKey`, so a change anywhere on the page reloads it). While
 * the page for new filters loads, the one before stays (`listing.query` tells which), and after that load failed it
 * still stays with its page buttons, so the focus holds; `loadFailed` is that failure while it is not being retried.
 */
export function useEntryListing(query: string) {
  const read = useQuery<Listing, RequestError>({
    queryKey: ledgerKeys.entries(query),
    queryFn: async ({ signal }) => ({
      query,
      ...(await requestJson<{ entries: Entry[]; total: number }>(`${entriesPath}?${query}`, {
        signal,
      })),
    }),
    placeholderData: keepPreviousData,
  });
  const [lastShown, setLastShown] = useState(read.data);
  if (read.data !== undefined && read.data !== lastShown) setLastShown(read.data);
  return {
    listing: read.data ?? lastShown,
    loadFailed: read.isError && !read.isFetching,
    error: read.error,
    retry: () => void read.refetch(),
  };
}

/** The categories, hidden ones too; they reload with every ledger change (`ledgerKey`, #213). */
export function useEntryCategories(showError: (cause: unknown, fallback?: string) => void) {
  const { data } = useLedgerList<{ categories: Category[] }>(
    ledgerKeys.categories(),
    '/api/ledger/categories',
    showError,
    'Could not load the categories',
  );
  return { categories: data?.categories ?? noCategories, loaded: data !== undefined };
}

const noCategories: Category[] = [];

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
