import { keepPreviousData, type QueryKey, useQuery } from '@tanstack/react-query';

import { type RequestError, requestJson } from './lib/api';
import { apiKey } from './lib/query';

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
