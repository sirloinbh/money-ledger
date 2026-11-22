import { keepPreviousData, type QueryClient, type QueryKey, useQuery } from '@tanstack/react-query';

import { type RequestError, requestJson } from './lib/api';
import { apiKey, useApiQuery } from './lib/query';
import { refreshReads, useLoadError, useReadsReload } from './query-reads';

// #213 Query keys of the ledger page. Every ledger read starts with `ledgerKey`, so one invalidation after a change
// to entries, categories, rules or fixed costs refreshes every section built on them (it replaced the version
// counters the page passed down). A change that touches one list only invalidates that list's key.

const ledgerPath = '/api/ledger';

export const ledgerKey = apiKey(ledgerPath);

export const ledgerKeys = {
  summary: (month: string) => apiKey(ledgerPath, 'summary', month),
  /** Without a month: every month's budgets. */
  budgets: (month?: string) =>
    month === undefined ? apiKey(ledgerPath, 'budgets') : apiKey(ledgerPath, 'budgets', month),
  trend: (from: string, to: string) => apiKey(ledgerPath, 'trend', from, to),
  /** All categories, hidden ones too; with `'visible'` only the ones in use. */
  categories: (visible?: 'visible') =>
    visible ? apiKey(ledgerPath, 'categories', visible) : apiKey(ledgerPath, 'categories'),
  uncategorized: () => apiKey(ledgerPath, 'entries', 'uncategorized'),
  suggestions: () => apiKey(ledgerPath, 'entries', 'suggestions'),
  rules: () => apiKey(ledgerPath, 'rules'),
  /** One page of the entry list; `query` is the list's query string (filters and page). */
  entries: (query: string) => apiKey(ledgerPath, 'entries', 'list', query),
  fixedCosts: (month: string) => apiKey(ledgerPath, 'fixed-costs', month),
};

/**
 * A card that moves between months or periods: while the next one loads, the one before stays on the screen (the
 * card dims it), so the buttons and focus hold. If that load fails, there is no data: the one before is not shown
 * under the new name. `failed` is a load that failed and is not being tried again.
 */
export function usePagedRead<T>(key: QueryKey, path: string) {
  const query = useQuery<T, RequestError>({
    queryKey: key,
    queryFn: ({ signal }) => requestJson<T>(path, { signal }),
    placeholderData: keepPreviousData,
  });
  return { query, data: query.data, failed: query.isError && !query.isFetching };
}

/** After a write to the ledger: every ledger read (or every read under `queryKey`) loads again (see `refreshReads`). */
export const refreshLedger = (client: QueryClient, queryKey: QueryKey = ledgerKey) =>
  refreshReads(client, queryKey);

/** After a write: every ledger read loads again and the section's own list is checked (see `useReadsReload`). */
export const useLedgerReload = () => useReadsReload(ledgerKey);

/** A section's own list on the shared `useApiQuery`, with its load errors and its reload after a write. */
export function useLedgerList<T>(
  key: QueryKey,
  path: string,
  showError: (cause: unknown, fallback?: string) => void,
  fallback: string,
) {
  const query = useApiQuery<T>(key, path);
  const explained = useLoadError(query.error, showError, fallback);
  const reloadLedger = useLedgerReload();
  const reload = () => reloadLedger<T>(() => key, explained);
  return { query, data: query.data, reload };
}
