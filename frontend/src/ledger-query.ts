import {
  keepPreviousData,
  type QueryClient,
  type QueryKey,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
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

/**
 * Shows a failed load of a section's list in the section's notice (`showError` with `fallback`), once per failure.
 * Returns `explained`: a failure the section already put in words itself (see `useLedgerReload`) is not shown again.
 */
export function useLoadError(
  error: unknown,
  showError: (cause: unknown, fallback?: string) => void,
  fallback: string,
) {
  const shown = useRef<unknown>(null);
  useEffect(() => {
    if (!error || error === shown.current) return;
    shown.current = error;
    showError(error, fallback);
  }, [error, showError, fallback]);
  return (explained: unknown) => {
    shown.current = explained;
  };
}

/**
 * After a write: every ledger read (or every read under `queryKey`) loads again. A read already on its way started before the write and may answer
 * without it, so it is cancelled first: `invalidateQueries` alone would wait for that read when its list has no data
 * yet (a page or month opened during the save) and show the list as it was before the write.
 */
export async function refreshLedger(client: QueryClient, queryKey: QueryKey = ledgerKey) {
  await client.cancelQueries({ queryKey });
  await client.invalidateQueries({ queryKey });
}

type Reloaded<T> = { ok: true; data: T | undefined } | { ok: false };

/**
 * After a write: every ledger read is refetched (`ledgerKey`) and waited for. Resolves with the section's own list
 * as loaded again, or `ok: false` when it did not load. The change is saved then, so the section says so in a note
 * (#262) and passes the failure to `explained`, so it is not shown again as a load error. `key` is read after the
 * reload, so a list whose filters changed meanwhile is checked as it is shown now.
 */
export function useLedgerReload() {
  const client = useQueryClient();
  return async <T>(
    key: () => QueryKey,
    explained: (error: unknown) => void,
  ): Promise<Reloaded<T>> => {
    const asked = key();
    const before = client.getQueryState(asked)?.errorUpdateCount ?? 0;
    await refreshLedger(client);
    const now = key();
    const state = client.getQueryState<T, RequestError>(now);
    const sameKey = JSON.stringify(now) === JSON.stringify(asked);
    if (state?.status === 'error' && state.errorUpdateCount > (sameKey ? before : 0)) {
      explained(state.error);
      return { ok: false };
    }
    return { ok: true, data: state?.data };
  };
}

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
