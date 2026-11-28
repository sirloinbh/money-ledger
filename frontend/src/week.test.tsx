import { fireEvent, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { renderWithQuery } from './test/query';
import { unexpectedRequest } from './test/unexpected';
import { TwelveWeeksView } from './twelve-weeks';
import { WeekView } from './week';

let requests: string[];

const plus = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const rows = (from: string, count: number, step: number) =>
  Array.from({ length: count }, (_, index) => ({
    start: plus(from, index * step),
    end: plus(from, index * step + step - 1),
    income: index * 1000,
    expense: 500,
    balance: index * 1000 - 500,
  }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-27T03:00:00Z')); // a Friday
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      requests.push(url);
      if (url.split('?')[0] !== '/api/ledger/periods') return unexpectedRequest('GET', url);
      const params = new URL(url, 'http://x').searchParams;
      const unit = params.get('unit');
      const body = {
        unit,
        periods: rows(params.get('from')!, Number(params.get('count')), unit === 'week' ? 7 : 1),
      };
      return Promise.resolve(new Response(JSON.stringify(body)));
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

test('the Week view shows the 7 days of this week (Sunday to Saturday) with a total', async () => {
  renderWithQuery(
    <MemoryRouter initialEntries={['/week']}>
      <WeekView />
    </MemoryRouter>,
  );
  const table = await screen.findByRole('table');
  expect(requests[0]).toBe('/api/ledger/periods?from=2026-11-22&unit=day&count=7');
  expect(within(table).getByRole('link', { name: 'Sun 2026-11-22' })).toHaveAttribute(
    'href',
    '/?date=2026-11-22',
  );
  expect(within(table).getByRole('link', { name: 'Sat 2026-11-28' })).toBeInTheDocument();
  // income 0+1000+...+6000 = 21,000; expense 7 x 500 = 3,500
  const total = within(table).getByRole('row', { name: /Total/ });
  expect(total).toHaveTextContent('₩21,000');
  expect(total).toHaveTextContent('₩3,500');
});

test('the Week stepper moves a whole week', async () => {
  renderWithQuery(
    <MemoryRouter initialEntries={['/week']}>
      <WeekView />
    </MemoryRouter>,
  );
  await screen.findByRole('table');
  fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
  await screen.findByRole('link', { name: 'Sun 2026-11-15' });
  expect(requests).toContain('/api/ledger/periods?from=2026-11-15&unit=day&count=7');
});

test('the 12 weeks view shows 12 weekly rows ending this week, each linking to the Week view', async () => {
  renderWithQuery(
    <MemoryRouter initialEntries={['/12-weeks']}>
      <TwelveWeeksView />
    </MemoryRouter>,
  );
  const table = await screen.findByRole('table');
  expect(requests[0]).toBe('/api/ledger/periods?from=2026-09-06&unit=week&count=12');
  const links = within(table).getAllByRole('link');
  expect(links).toHaveLength(12);
  expect(links[11]).toHaveTextContent('2026-11-22 – 2026-11-28');
  expect(links[0]).toHaveAttribute('href', '/dashboard?view=week&date=2026-09-06');
});
