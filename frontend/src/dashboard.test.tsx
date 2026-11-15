import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { DashboardPage } from './dashboard';

type Answer = () => Promise<Response>;
let answers: Record<string, Answer>;

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const fail = () => json({ error: 'boom' }, 500);

const summary = { month: '2026-11', income: 3_000_000, expense: 1_250_000, balance: 1_750_000 };
const snapshots = [
  { date: '2026-11-15', assetsKrw: 50_000_000, debtsKrw: 0, netKrw: 50_000_000, uncounted: 0 },
  {
    date: '2026-11-16',
    assetsKrw: 52_000_000,
    debtsKrw: 2_000_000,
    netKrw: 50_000_000,
    uncounted: 1,
  },
];
const holdings = {
  summary: { cashKrw: 4_000_000, totalKrw: 10_500_000, profitKrw: 500_000, returnPct: '5.00' },
  holdings: [],
};

const normal = (): Record<string, Answer> => ({
  'GET /api/ledger/summary?month=2026-11': () => json({ ...summary, categories: [] }),
  'POST /api/portfolio/net-worth': () => json({ snapshot: snapshots[1] }),
  'GET /api/portfolio/net-worth': () => json({ today: '2026-11-16', snapshots }),
  'GET /api/mock/accounts': () => json({ account: { id: 7 }, closedAccounts: [] }),
  'GET /api/mock/accounts/7/holdings': () => json(holdings),
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T03:00:00Z'));
  answers = normal();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => answers[`${init.method ?? 'GET'} ${url}`]()),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

const show = () =>
  render(
    <MemoryRouter>
      <DashboardPage health={{ state: 'ok', today: '2026-11-16' }} />
    </MemoryRouter>,
  );

const card = (name: string) => screen.getByRole('region', { name });
const value = (region: HTMLElement, label: string) =>
  within(region).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;

test('each card shows its area, the same values as its page, and a link to it', async () => {
  show();
  const ledger = card('This month');
  expect(await within(ledger).findByText('₩3,000,000')).toBeInTheDocument();
  expect(value(ledger, 'Expense')).toBe('₩1,250,000');
  expect(value(ledger, 'Balance')).toBe('₩1,750,000');
  expect(within(ledger).getByRole('link', { name: 'Open the ledger' })).toHaveAttribute(
    'href',
    '/ledger?month=2026-11',
  );

  const netWorth = card('Net worth');
  expect(await within(netWorth).findByText('Saved on 2026-11-16')).toBeInTheDocument();
  expect(value(netWorth, 'Net worth')).toBe('₩50,000,000');
  expect(value(netWorth, 'Liabilities')).toBe('₩2,000,000');
  expect(
    within(netWorth).getByText(
      '1 item without a value (no price, exchange rate, or valuation) is left out.',
    ),
  ).toBeInTheDocument();
  expect(within(netWorth).getByRole('link')).toHaveAttribute('href', '/portfolio');

  // Mock money stays in its own card and says it is not part of the net worth.
  const mock = card('Mock trading');
  expect(within(mock).getByText('Practice money, not part of your net worth')).toBeInTheDocument();
  expect(await within(mock).findByText('₩10,500,000')).toBeInTheDocument();
  expect(value(mock, 'Gain/loss')).toBe('+₩500,000');
  expect(value(mock, 'Return')).toBe('+5%');
  expect(within(mock).getByRole('link')).toHaveAttribute('href', '/mock-trading');
});

test('a card that fails leaves the others shown, and its retry loads it', async () => {
  answers['GET /api/portfolio/net-worth'] = fail;
  show();
  const netWorth = card('Net worth');
  expect(await within(netWorth).findByText('Could not load this card.')).toBeInTheDocument();
  expect(await within(card('This month')).findByText('₩3,000,000')).toBeInTheDocument();
  expect(await within(card('Mock trading')).findByText('₩10,500,000')).toBeInTheDocument();

  answers['GET /api/portfolio/net-worth'] = normal()['GET /api/portfolio/net-worth'];
  fireEvent.click(within(netWorth).getByRole('button', { name: 'Retry loading Net worth' }));
  expect(await within(netWorth).findByText('Saved on 2026-11-16')).toBeInTheDocument();
});

test('areas without data say so', async () => {
  answers['GET /api/ledger/summary?month=2026-11'] = () =>
    json({ month: '2026-11', income: 0, expense: 0, balance: 0, categories: [] });
  answers['GET /api/portfolio/net-worth'] = () => json({ today: '2026-11-16', snapshots: [] });
  answers['GET /api/mock/accounts'] = () => json({ account: null, closedAccounts: [] });
  show();
  expect(
    await screen.findByText('No income or spending recorded this month yet.'),
  ).toBeInTheDocument();
  expect(await screen.findByText(/No net worth saved yet/)).toBeInTheDocument();
  expect(await screen.findByText(/No mock account yet/)).toBeInTheDocument();
});
