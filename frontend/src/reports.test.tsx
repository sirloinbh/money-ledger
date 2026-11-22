import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';

import { ReportPage, ReportsPage } from './reports';

type Answer = () => Promise<Response>;
let answers: Record<string, Answer>;
let calls: string[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const weekItem = {
  id: 3,
  period: 'week',
  startDate: '2026-11-08',
  endDate: '2026-11-14',
  madeOn: '2026-11-16',
  seen: false,
  total: 56500,
};
const monthItem = {
  id: 2,
  period: 'month',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  madeOn: '2026-11-16',
  seen: true,
  total: 110000,
};
const week = {
  ...weekItem,
  previousTotal: 60000,
  change: -3500,
  topCategories: [
    { categoryId: 1, name: 'Food', hidden: false, amount: 30000, share: '53.1' },
    { categoryId: 2, name: 'Transport', hidden: true, amount: 20000, share: '35.4' },
    { categoryId: null, name: 'Uncategorized', hidden: false, amount: 5000, share: '8.8' },
  ],
  overspending: null,
};
const month = {
  ...monthItem,
  previousTotal: 0,
  change: 110000,
  topCategories: [
    { categoryId: 2, name: 'Transport', hidden: false, amount: 70000, share: '63.6' },
  ],
  overspending: [
    {
      categoryId: 1,
      name: 'Food',
      hidden: false,
      spent: 40000,
      budget: 40000,
      over: 0,
      percent: '100.0',
      status: 'reached',
    },
    {
      categoryId: 2,
      name: 'Transport',
      hidden: false,
      spent: 70000,
      budget: 50000,
      over: 20000,
      percent: '140.0',
      status: 'over',
    },
  ],
};

beforeEach(() => {
  calls = [];
  answers = {
    'POST /api/ledger/fixed-costs/generate': () => json({ added: 0 }),
    'POST /api/reports/generate': () => json({ created: [] }),
    'GET /api/reports': () => json({ reports: [weekItem, monthItem] }),
    'GET /api/reports/3': () => json({ report: week }),
    'GET /api/reports/2': () => json({ report: month }),
    'PUT /api/reports/3/seen': () => json({ report: { id: 3, seen: true } }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const key = `${init.method ?? 'GET'} ${url}`;
      calls.push(key);
      return (answers[key] ?? (() => json({ error: 'not found' }, 404)))();
    }),
  );
});

const health = { state: 'ok', today: '2026-11-16' } as const;
const show = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reports" element={<ReportsPage health={health} />} />
        <Route path="/reports/:id" element={<ReportPage health={health} />} />
      </Routes>
    </MemoryRouter>,
  );

test('the list shows each report with its period, kind, spending and whether it is new', async () => {
  show('/reports');
  const list = await screen.findByRole('list', { name: 'Reports' });
  // The finished periods are saved before the list is read.
  expect(calls.indexOf('POST /api/reports/generate')).toBeLessThan(
    calls.indexOf('GET /api/reports'),
  );
  const links = within(list).getAllByRole('link');
  expect(links.map((link) => link.textContent)).toEqual([
    'Week of Nov 8 – Nov 14, 2026WeeklyNewSpent ₩56,500',
    'October 2026MonthlySpent ₩110,000',
  ]);
  expect(links[0]).toHaveAttribute('href', '/reports/3');
});

test('with no reports yet, the list says when the first one comes', async () => {
  answers['GET /api/reports'] = () => json({ reports: [] });
  show('/reports');
  expect(
    await screen.findByText(
      'No reports yet. A report is saved once a week (Sunday to Saturday) or month with entries has ended.',
    ),
  ).toBeInTheDocument();
});

test('a weekly report: totals, the change, the top 3 and no overspending; opening it marks it seen', async () => {
  show('/reports/3');
  expect(await screen.findByText('Week of Nov 8 – Nov 14, 2026')).toBeInTheDocument();
  expect(screen.getByText('₩56,500')).toBeInTheDocument();
  expect(screen.getByText('Previous week').nextElementSibling).toHaveTextContent('₩60,000');
  expect(screen.getByText('₩3,500 less than the week before')).toBeInTheDocument();
  const top = screen.getByRole('list');
  expect(
    within(top)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual([
    '1. Food₩30,000 (53.1%)',
    '2. Transport (hidden)₩20,000 (35.4%)',
    '3. Uncategorized₩5,000 (8.8%)',
  ]);
  expect(screen.queryByRole('heading', { name: 'Overspending' })).toBeNull();
  expect(screen.getByText(/Saved on 2026-11-16\. Entries changed after that/)).toBeInTheDocument();
  await vi.waitFor(() => expect(calls).toContain('PUT /api/reports/3/seen'));
});

test('a monthly report lists the categories that reached or passed their budget; a seen one is not marked again', async () => {
  show('/reports/2');
  const overspending = await screen.findByRole('list', { name: 'Overspending' });
  expect(
    within(overspending)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual([
    'Food: spent ₩40,000, all of the ₩40,000 budget (100.0%)',
    'Transport: spent ₩70,000 of a ₩50,000 budget, ₩20,000 more (140.0%)',
  ]);
  expect(screen.getByText('₩110,000 more than the month before')).toBeInTheDocument();
  expect(calls).not.toContain('PUT /api/reports/2/seen');
});

test('a report that fails to load says so, and Try again loads it', async () => {
  answers['GET /api/reports/3'] = () => json({ error: 'boom' }, 500);
  show('/reports/3');
  expect(await screen.findByText('Could not load this report.')).toBeInTheDocument();
  answers['GET /api/reports/3'] = () => json({ report: { ...week, change: 0 } });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('The same as the week before')).toBeInTheDocument();
});

test('an unknown report id says the report was not found, without Try again', async () => {
  show('/reports/999');
  expect(
    await screen.findByText('Report not found. It may have been removed, or the address is wrong.'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  expect(calls).toContain('GET /api/reports/999');
});

test.each(['abc', '0', '1234567890123456'])(
  'an id the server would refuse (%s) is not found, and is not sent',
  async (id) => {
    show(`/reports/${id}`);
    expect(
      await screen.findByText(
        'Report not found. It may have been removed, or the address is wrong.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(calls.filter((call) => call.startsWith('GET /api/reports/'))).toEqual([]);
  },
);
