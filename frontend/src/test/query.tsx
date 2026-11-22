import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { createQueryClient } from '../lib/query';

// Screen tests and the shared query layer (#213). The app has one query client; so does each test, so a screen
// unmounted and shown again in the same test finds the same cache, as moving between pages does.

let current: QueryClient | undefined;

/** The test's query client: the app's defaults without retries, so a failure a test serves shows at once. */
export function testQueryClient() {
  current ??= createQueryClient({ defaultOptions: { queries: { retry: false } } });
  return current;
}

/** `render` inside the test's query client; `rerender` keeps it. */
export function renderWithQuery(ui: ReactElement, options: Omit<RenderOptions, 'wrapper'> = {}) {
  const client = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(ui, { ...options, wrapper });
}

/** For the test setup: the next test starts with an empty cache. */
export function forgetQueryClient() {
  current?.clear();
  current = undefined;
}
