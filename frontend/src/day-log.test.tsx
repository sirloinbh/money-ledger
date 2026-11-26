import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { DayLogPage } from './day-log';
import { renderWithQuery } from './test/query';
import { unexpectedRequest } from './test/unexpected';

const Where = () => <p data-testid="where">{useLocation().search}</p>;
const ok = { state: 'ok', today: '2026-11-27' } as const;

let requests: string[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-27T03:00:00Z'));
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      requests.push(url);
      const path = url.split('?')[0];
      const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
      if (path === '/api/ledger/categories') return json({ categories: [] });
      if (path === '/api/ledger/entries') return json({ entries: [], total: 0 });
      if (path === '/api/ledger/periods') {
        const from = new URL(url, 'http://x').searchParams.get('from');
        return json({
          unit: 'day',
          periods: [{ start: from, end: from, income: 100000, expense: 25000, balance: 75000 }],
        });
      }
      return unexpectedRequest('GET', url);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

const show = (search = '') =>
  renderWithQuery(
    <MemoryRouter initialEntries={[`/${search}`]}>
      <DayLogPage health={ok} />
      <Where />
    </MemoryRouter>,
  );

test("opens on today with that day's totals and entries", async () => {
  show();
  expect(screen.getByRole('heading', { level: 1, name: 'Day log' })).toBeInTheDocument();
  expect(screen.getByLabelText('Day')).toHaveValue('2026-11-27');
  expect(
    await screen.findByText(/Income ₩100,000 · Expense ₩25,000 · Balance ₩75,000/),
  ).toBeInTheDocument();
  expect(requests.some((url) => url.includes('from=2026-11-27') && url.includes('/entries?'))).toBe(
    true,
  );
  expect(screen.getByRole('button', { name: 'Add entry' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();
});

test('the stepper moves one day and Today comes back', async () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
  expect(screen.getByLabelText('Day')).toHaveValue('2026-11-26');
  expect(screen.getByTestId('where')).toHaveTextContent('?date=2026-11-26');
  fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
  expect(screen.getByLabelText('Day')).toHaveValue('2026-11-28');
  fireEvent.click(await screen.findByRole('button', { name: 'Today' }));
  expect(screen.getByLabelText('Day')).toHaveValue('2026-11-27');
  expect(screen.getByTestId('where')).toBeEmptyDOMElement();
});

test('a date in the address is shown, and a bad one falls back to today', () => {
  show('?date=2026-10-01');
  expect(screen.getByLabelText('Day')).toHaveValue('2026-10-01');
});

test('a bad date in the address shows today', () => {
  show('?date=2026-02-30');
  expect(screen.getByLabelText('Day')).toHaveValue('2026-11-27');
});
