// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/
import { useEffect, useState } from 'react';

import { requestJson } from './lib/api';

export type Health =
  | { state: 'loading' }
  | { state: 'ok'; today: string }
  | { state: 'error'; message: string };

export function healthText(health: Health) {
  if (health.state === 'loading') return 'Checking server…';
  if (health.state === 'ok') return health.today ? `Server connected · ${health.today}` : 'Server connected';
  return health.message;
}

/** Milliseconds between checks while the server is down. */
const HEALTH_RETRY_MS = 10_000;

/**
 * Checks GET /api/health once on mount, then again every `retryMs` while it fails (and when the browser
 * comes back online), so a page opened during an outage recovers on its own. It reads the answer through
 * requestJson, so a proxy's HTML error page shows the request's message instead of a JSON parse error,
 * and the check is aborted on unmount.
 */
export function useHealth(retryMs = HEALTH_RETRY_MS): Health {
  const [health, setHealth] = useState<Health>({ state: 'loading' });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let stopped = false;
    const check = () => {
      clearTimeout(timer);
      controller?.abort();
      const own = new AbortController();
      controller = own;
      requestJson<{ today?: unknown }>('/api/health', { signal: own.signal }).then(
        (data) => {
          if (stopped || own.signal.aborted) return;
          setHealth({ state: 'ok', today: typeof data?.today === 'string' ? data.today : '' });
        },
        (error: unknown) => {
          if (stopped || own.signal.aborted) return;
          setHealth({ state: 'error', message: error instanceof Error ? error.message : 'Cannot reach the server' });
          timer = setTimeout(check, retryMs);
        },
      );
    };
    check();
    window.addEventListener('online', check);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      window.removeEventListener('online', check);
    };
  }, [retryMs]);
  return health;
}
