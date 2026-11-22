import { keepPreviousData, type QueryKey, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { type RequestError, requestJson } from './lib/api';
import { apiKey, useApiQuery } from './lib/query';

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

/**
 * A section's own list. A failed load shows in the section's notice (`showError` with `fallback`). After a write the
 * section calls `reload()`: every ledger read is refetched (`ledgerKey`), and it resolves with this list as loaded
 * again, or `ok: false` when it did not load. The change is saved then, so the section says so in a note (#262) and the failure is not also
 * shown as a load error.
 */
export function useLedgerList<T>(
  key: QueryKey,
  path: string,
  showError: (cause: unknown, fallback?: string) => void,
  fallback: string,
) {
  const client = useQueryClient();
  const query = useApiQuery<T>(key, path);
  // The last load error already on the screen or explained by the section itself.
  const shownError = useRef<unknown>(null);
  useEffect(() => {
    if (!query.error || query.error === shownError.current) return;
    shownError.current = query.error;
    showError(query.error, fallback);
  }, [query.error, showError, fallback]);

  const reload = async (): Promise<{ ok: true; data: T | undefined } | { ok: false }> => {
    const before = client.getQueryState(key)?.errorUpdateCount ?? 0;
    await client.invalidateQueries({ queryKey: ledgerKey });
    const state = client.getQueryState<T, RequestError>(key);
    if (state?.status === 'error' && state.errorUpdateCount > before) {
      shownError.current = state.error;
      return { ok: false };
    }
    return { ok: true, data: state?.data };
  };

  return { query, data: query.data, reload };
}
