import { type QueryClient, type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import type { RequestError } from './lib/api';

// #213 Helpers for a page whose reads share a root key (the Ledger page's `ledgerKey`, Mock trading's `mockKey`):
// a write refreshes every read under the root, and a section checks its own list after that.

/**
 * After a write: every read under `queryKey` loads again. A read already on its way started before the write and
 * may answer without it, so it is cancelled first: `invalidateQueries` alone would wait for that read when its list
 * has no data yet (a page or month opened during the save) and show the list as it was before the write
 * (sirloinbh/project-standards#1008).
 */
export async function refreshReads(client: QueryClient, queryKey: QueryKey) {
  await client.cancelQueries({ queryKey });
  await client.invalidateQueries({ queryKey });
}

/**
 * Shows a failed load of a section's list in the section's notice (`showError` with `fallback`), once per failure.
 * Returns `explained`: a failure the section already put in words itself (see `useReadsReload`) is not shown again.
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

type Reloaded<T> = { ok: true; data: T | undefined } | { ok: false };

/**
 * After a write: every read under `root` is refetched and waited for. Resolves with the section's own list as
 * loaded again, or `ok: false` when it did not load. The change is saved then, so the section says so in a note
 * (#262) and passes the failure to `explained`, so it is not shown again as a load error. `key` is read after the
 * reload, so a list whose filters changed meanwhile is checked as it is shown now.
 */
export function useReadsReload(root: QueryKey) {
  const client = useQueryClient();
  return async <T>(
    key: () => QueryKey,
    explained: (error: unknown) => void,
  ): Promise<Reloaded<T>> => {
    const asked = key();
    const before = client.getQueryState(asked)?.errorUpdateCount ?? 0;
    await refreshReads(client, root);
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
