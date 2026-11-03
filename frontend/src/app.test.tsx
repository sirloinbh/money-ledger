import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { App } from './app';

// /api/health answers with `body`; the ledger's categories and entries are empty.
const health = (body: object, status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/health'
          ? new Response(JSON.stringify(body), { status })
          : new Response(JSON.stringify({ categories: [], entries: [] })),
      ),
    ),
  );

test('shows the server date from /api/health on the overview', async () => {
  health({ today: '2026-10-26' });
  render(<App />);
  expect(screen.getByRole('heading', { level: 1, name: '대시보드' })).toBeInTheDocument();
  expect(await screen.findByText('서버 연결됨 · 2026-10-26')).toBeInTheDocument();
});

test('reports a server error as an alert', async () => {
  health({ error: '데이터베이스에 연결할 수 없습니다' }, 503);
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('데이터베이스에 연결할 수 없습니다');
});

test('each page has its own address and is marked in the main menu', async () => {
  health({ today: '2026-10-26' });
  render(<App />);
  const menu = screen.getByRole('navigation', { name: '주 메뉴' });
  fireEvent.click(within(menu).getByRole('link', { name: '설정' }));
  expect(window.location.pathname).toBe('/settings');
  expect(await screen.findByRole('heading', { level: 1, name: '설정' })).toBeInTheDocument();
  expect(within(menu).getByRole('link', { name: '설정' })).toHaveAttribute('aria-current', 'page');
});

const areas = [
  { label: '가계부', path: '/ledger', content: '카테고리' },
  { label: '자산 포트폴리오', path: '/portfolio', content: '아직 기능이 없습니다' },
  { label: '모의투자', path: '/mock-trading', content: '아직 기능이 없습니다' },
];

test.each(areas)('the main menu opens the $label page', async ({ label, path, content }) => {
  health({ today: '2026-10-26' });
  window.history.replaceState(null, '', '/');
  render(<App />);
  const menu = screen.getByRole('navigation', { name: '주 메뉴' });
  fireEvent.click(within(menu).getByRole('link', { name: label }));
  expect(window.location.pathname).toBe(path);
  expect(await screen.findByRole('heading', { level: 1, name: label })).toBeInTheDocument();
  expect(within(menu).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('heading', { level: 2, name: content })).toBeInTheDocument();
});

test.each(areas)('opening $path directly shows the $label page', async ({ label, path }) => {
  health({ today: '2026-10-26' });
  window.history.replaceState(null, '', path);
  render(<App />);
  expect(await screen.findByRole('heading', { level: 1, name: label })).toBeInTheDocument();
  expect(window.location.pathname).toBe(path);
});

test('an area page reports a server error as an alert', async () => {
  health({ error: '데이터베이스에 연결할 수 없습니다' }, 503);
  window.history.replaceState(null, '', '/ledger');
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('데이터베이스에 연결할 수 없습니다');
});

test('an unknown address falls back to the overview', async () => {
  health({ today: '2026-10-26' });
  window.history.replaceState(null, '', '/no-such-page');
  render(<App />);
  expect(await screen.findByRole('heading', { level: 1, name: '대시보드' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/');
});
