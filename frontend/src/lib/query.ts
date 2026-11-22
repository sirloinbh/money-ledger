// Managed file. Edit it in sirloinbh/project-standards templates/query/frontend/src/lib/
// The shared data-loading layer on @tanstack/react-query (ADR-0027, #788): one QueryClient setup for all apps and two
// hooks on top of requestJson, so a screen loads and saves with a few lines instead of its own useEffect loop.
//
//   const queryClient = createQueryClient();                  // once, in app.tsx: <QueryClientProvider client={queryClient}>
//   const goals = useApiQuery<Goal[]>(apiKey('/api/goals'), '/api/goals');
//   const save = useApiMutation<Goal, Goal>(
//     (goal) => ({ path: `/api/goals/${goal.id}`, method: 'PUT', body: goal }),
//     { invalidate: [apiKey('/api/goals')] },
//   );
//
// Errors are RequestError (lib/api), so `error.message` is the server's text and `error.fields` the per-field messages.
import { QueryClient, type QueryClientConfig, type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { RequestError, requestJson } from './api';

/** Retry a failed load once, and only when a second try can help: the server was unreachable, timed out or answered 5xx. */
export function shouldRetry(failureCount: number, error: unknown) {
  if (failureCount >= 1) return false;
  if (!(error instanceof RequestError)) return false;
  if (error.kind === 'network' || error.kind === 'timeout') return true;
  return error.kind === 'http' && error.status !== undefined && error.status >= 500;
}

/**
 * The QueryClient every app uses. Data counts as fresh for 30 s (a screen revisited within that time shows its cached
 * rows without a request, and shows them at once and refreshes in the background after that), a window that gets
 * focus again refetches stale data, and writes are never retried on their own (a second POST could create a duplicate).
 */
export function createQueryClient(config: QueryClientConfig = {}) {
  return new QueryClient({
    ...config,
    defaultOptions: {
      ...config.defaultOptions,
      queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: true, ...config.defaultOptions?.queries },
      mutations: { retry: false, ...config.defaultOptions?.mutations },
    },
  });
}

/**
 * The query key of an API path: `apiKey('/api/goals')` is `['/api/goals']`, `apiKey('/api/goals', 7)` is
 * `['/api/goals', 7]`. Invalidating `apiKey('/api/goals')` also refreshes every key that starts with it, so one list key
 * covers the list and each record under it.
 */
export function apiKey(path: string, ...parts: readonly (string | number | boolean | null | undefined)[]): QueryKey {
  return [path, ...parts];
}

/** GET a JSON path. The query's abort signal goes to requestJson, so a screen that unmounts cancels its request. */
export function useApiQuery<T>(key: QueryKey, path: string, options: { enabled?: boolean; staleTime?: number } = {}) {
  return useQuery<T, RequestError>({
    queryKey: key,
    queryFn: ({ signal }) => requestJson<T>(path, { signal }),
    ...options,
  });
}

/** One write: `method` defaults to POST, `body` is sent as JSON, and `headers` go with the request (an `Idempotency-Key`, say). */
export type ApiRequest = { path: string; method?: string; body?: unknown; headers?: Record<string, string> };

/**
 * A write. `request` turns the variables into the call. After it succeeds the `invalidate` keys are refetched, and the
 * mutation stays pending until they are, so a screen that waits for it shows the fresh data when it ends.
 */
export function useApiMutation<TData = unknown, TVariables = void>(
  request: (variables: TVariables) => ApiRequest,
  options: { invalidate?: readonly QueryKey[]; onSuccess?: (data: TData, variables: TVariables) => void; onError?: (error: RequestError) => void } = {},
) {
  const client = useQueryClient();
  return useMutation<TData, RequestError, TVariables>({
    mutationFn: (variables) => {
      const { path, method = 'POST', body, headers } = request(variables);
      return requestJson<TData>(path, { method, body, headers });
    },
    onSuccess: async (data, variables) => {
      await Promise.all((options.invalidate ?? []).map((queryKey) => client.invalidateQueries({ queryKey })));
      options.onSuccess?.(data, variables);
    },
    onError: (error) => options.onError?.(error),
  });
}
