import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { App } from './app';
import { findLive } from './test/live';
import { testQueryClient } from './test/query';
import { unexpectedRequest } from './test/unexpected';

// Every list (categories, entries, assets, trend months, budgets, fixed costs, reports) is empty and there is no
// mock account. One body serves every listed request; each screen reads only its own keys.
const empty = {
  categories: [],
  entries: [],
  months: [],
  snapshots: [],
  budgets: [],
  suggestions: [],
  rules: [],
  fixedCosts: [],
  added: 0,
  assets: [],
  totals: { assetsKrw: 0, debtsKrw: 0, netKrw: 0, uncounted: 0, fixed: 0, other: 0 },
  account: null,
  closedAccounts: [],
  reports: [],
  created: [],
};

// The requests the pages make, by method and path (the query depends on today's date).
const answered = new Set([
  'GET /api/ledger/budgets',
  'GET /api/ledger/categories',
  'GET /api/ledger/entries',
  'GET /api/ledger/entries/suggestions',
  'GET /api/ledger/fixed-costs',
  'POST /api/ledger/fixed-costs/generate',
  'GET /api/ledger/rules',
  'GET /api/ledger/summary',
  'GET /api/ledger/trend',
  'GET /api/mock/accounts',
  'GET /api/portfolio/assets',
  'GET /api/portfolio/net-worth',
  'POST /api/portfolio/net-worth',
  'GET /api/reports',
  'POST /api/reports/generate',
]);

// /api/health answers with `body`; any request not listed above fails the test (#183).
const health = (body: object, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      if (url === '/api/health') {
        return Promise.resolve(new Response(JSON.stringify(body), { status }));
      }
      return answered.has(`${method} ${url.split('?')[0]}`)
        ? Promise.resolve(new Response(JSON.stringify(empty)))
        : unexpectedRequest(method, url);
    }),
  );

test('shows the server date from /api/health on the overview', async () => {
  health({ today: '2026-10-26' });
  render(<App queryClient={testQueryClient()} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  expect(await screen.findByText('Server connected · 2026-10-26')).toBeInTheDocument();
});

test('reports a server error as an alert', async () => {
  health({ error: 'Cannot connect to the database' }, 503);
  render(<App queryClient={testQueryClient()} />);
  expect(await findLive('alert')).toHaveTextContent('Cannot connect to the database');
});

test('each page has its own address and is marked in the main menu', async () => {
  health({ today: '2026-10-26' });
  render(<App queryClient={testQueryClient()} />);
  const menu = screen.getByRole('navigation', { name: 'Main menu' });
  fireEvent.click(within(menu).getByRole('link', { name: 'Settings' }));
  expect(window.location.pathname).toBe('/settings');
  expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  expect(within(menu).getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

const areas = [
  { label: 'Ledger', path: '/ledger', content: 'Categories' },
  { label: 'Asset portfolio', path: '/portfolio', content: 'Assets and liabilities' },
  { label: 'Mock trading', path: '/mock-trading', content: 'Create a mock trading account' },
];

test.each(areas)('the main menu opens the $label page', async ({ label, path, content }) => {
  health({ today: '2026-10-26' });
  window.history.replaceState(null, '', '/');
  render(<App queryClient={testQueryClient()} />);
  const menu = screen.getByRole('navigation', { name: 'Main menu' });
  fireEvent.click(within(menu).getByRole('link', { name: label }));
  expect(window.location.pathname).toBe(path);
  expect(await screen.findByRole('heading', { level: 1, name: label })).toBeInTheDocument();
  expect(within(menu).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  expect(await screen.findByRole('heading', { level: 2, name: content })).toBeInTheDocument();
});

test.each(areas)('opening $path directly shows the $label page', async ({ label, path }) => {
  health({ today: '2026-10-26' });
  window.history.replaceState(null, '', path);
  render(<App queryClient={testQueryClient()} />);
  expect(await screen.findByRole('heading', { level: 1, name: label })).toBeInTheDocument();
  expect(window.location.pathname).toBe(path);
});

test('an area page reports a server error as an alert', async () => {
  health({ error: 'Cannot connect to the database' }, 503);
  window.history.replaceState(null, '', '/ledger');
  render(<App queryClient={testQueryClient()} />);
  expect(await findLive('alert')).toHaveTextContent('Cannot connect to the database');
});

test('an unknown address falls back to the overview', async () => {
  health({ today: '2026-10-26' });
  window.history.replaceState(null, '', '/no-such-page');
  render(<App queryClient={testQueryClient()} />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/');
});

test("opening the app saves today's net worth once, whichever page opens (#49)", async () => {
  // A fresh module, so this page load has not saved yet.
  vi.resetModules();
  const { App: FreshApp } = await import('./app');
  health({ today: '2026-11-10' });
  window.history.replaceState(null, '', '/ledger');
  const { unmount } = render(<FreshApp />);
  await screen.findByText('Server connected · 2026-11-10');
  const saves = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(
        ([url, init]) => url === '/api/portfolio/net-worth' && init?.method === 'POST',
      );
  await vi.waitFor(() => expect(saves()).toHaveLength(1));
  unmount();
  render(<FreshApp />);
  await screen.findByText('Server connected · 2026-11-10');
  expect(saves()).toHaveLength(1);
});

test('opening the app adds the due fixed-cost entries once (#43)', async () => {
  vi.resetModules();
  const { App: FreshApp } = await import('./app');
  health({ today: '2026-11-10' });
  window.history.replaceState(null, '', '/');
  const { unmount } = render(<FreshApp />);
  await screen.findByText('Server connected · 2026-11-10');
  const adds = () =>
    vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/ledger/fixed-costs/generate');
  await vi.waitFor(() => expect(adds()).toHaveLength(1));
  unmount();
  // The ledger page waits for the same request instead of sending another.
  window.history.replaceState(null, '', '/ledger');
  render(<FreshApp />);
  await screen.findByRole('heading', { level: 2, name: 'Fixed costs' });
  expect(adds()).toHaveLength(1);
});

test('the main menu opens the Reports page (#62)', async () => {
  health({ today: '2026-10-26' });
  window.history.replaceState(null, '', '/');
  render(<App queryClient={testQueryClient()} />);
  const menu = screen.getByRole('navigation', { name: 'Main menu' });
  fireEvent.click(within(menu).getByRole('link', { name: 'Reports' }));
  expect(window.location.pathname).toBe('/reports');
  expect(await screen.findByRole('heading', { level: 1, name: 'Reports' })).toBeInTheDocument();
  expect(
    await screen.findByText(
      'No reports yet. A report is saved once a week (Sunday to Saturday) or month with entries has ended.',
    ),
  ).toBeInTheDocument();
});
