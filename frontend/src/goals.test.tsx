import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { GoalsPage } from './goals';
import { findLive } from './test/live';
import { renderWithQuery } from './test/query';

type Goal = Parameters<typeof makeGoal>[0] & ReturnType<typeof makeGoal>;

const makeGoal = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Emergency fund',
  targetAmount: 6_000_000,
  targetDate: '2027-02-15' as string | null,
  source: 'surplus' as 'surplus' | 'asset',
  assetId: null as number | null,
  assetName: null as string | null,
  startMonth: '2026-11',
  finished: false,
  saved: 1_800_000 as number | null,
  remaining: 4_200_000 as number | null,
  percent: 30 as number | null,
  reached: false,
  overdue: false,
  monthsLeft: 3 as number | null,
  monthlyNeeded: 1_400_000 as number | null,
  issue: null as string | null,
  ...over,
});

let goals: Goal[];
let requests: { method: string; url: string; body: unknown }[];
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  goals = [makeGoal()];
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : undefined;
      requests.push({ method, url, body });
      if (url === '/api/portfolio/assets') {
        return json({
          assets: [
            { id: 5, name: 'Savings account', type: 'cash' },
            { id: 6, name: 'Loan', type: 'debt' },
          ],
        });
      }
      if (url === '/api/goals' && method === 'GET') return json({ goals });
      if (url === '/api/goals' && method === 'POST') {
        const created = makeGoal({
          id: 2,
          ...body,
          saved: 0,
          remaining: body!.targetAmount,
          percent: 0,
        }) as Goal;
        goals = [...goals, created];
        return json({ goal: created }, 201);
      }
      const id = Number(url.split('/')[3]);
      if (method === 'DELETE') {
        goals = goals.filter((goal) => goal.id !== id);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      goals = goals.map((goal) => (goal.id === id ? { ...goal, ...body } : goal));
      return json({ goal: goals.find((goal) => goal.id === id) });
    }),
  );
});

const notice = () => document.getElementById('goals-notice')!;
const show = () => renderWithQuery(<GoalsPage health={{ state: 'ok', today: '2026-11-26' }} />);

test('a goal shows its progress, the amount left and the monthly amount needed', async () => {
  show();
  const list = await screen.findByRole('list', { name: 'Goals' });
  expect(within(list).getByText('Emergency fund')).toBeInTheDocument();
  expect(list).toHaveTextContent('₩1,800,000 saved (30%) · ₩4,200,000 left');
  expect(list).toHaveTextContent('Save ₩1,400,000 a month for 3 months');
  expect(
    within(list).getByRole('progressbar', { name: 'Emergency fund progress' }),
  ).toHaveAttribute('aria-valuenow', '30');
});

test('an account goal without progress says why', async () => {
  goals = [
    makeGoal({
      source: 'asset',
      assetId: null,
      saved: null,
      remaining: null,
      percent: null,
      monthlyNeeded: null,
      issue: 'no_asset',
    }),
  ];
  show();
  expect(await screen.findByText(/The account was deleted/)).toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).toBeNull();
});

test('adds a goal that follows an asset account, debts are not offered', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Add goal' }));
  const form = screen.getByRole('form', { name: 'New goal' });
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Travel fund' } });
  fireEvent.change(within(form).getByLabelText('Target amount (KRW)'), {
    target: { value: '5,000,000' },
  });
  fireEvent.change(within(form).getByLabelText('Progress comes from'), {
    target: { value: 'asset' },
  });
  const options = within(within(form).getByLabelText('Asset account')).getAllByRole('option');
  expect(options.map((option) => option.textContent)).toEqual(['Choose', 'Savings account']);
  // An account must be chosen first.
  fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
  expect(await findLive('alert', notice())).toHaveTextContent('Choose an asset account');
  fireEvent.change(within(form).getByLabelText('Asset account'), { target: { value: '5' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
  expect(await findLive('status', notice())).toHaveTextContent('Travel fund added');
  const post = requests.find((request) => request.method === 'POST')!;
  expect(post.body).toEqual({
    name: 'Travel fund',
    targetAmount: 5_000_000,
    targetDate: null,
    source: 'asset',
    assetId: 5,
  });
});

test('refuses a bad target amount and a bad date before sending', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Add goal' }));
  const form = screen.getByRole('form', { name: 'New goal' });
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Trip' } });
  fireEvent.change(within(form).getByLabelText('Target amount (KRW)'), {
    target: { value: '12.5' },
  });
  fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
  expect(await findLive('alert', notice())).toHaveTextContent(
    'Enter the target as a whole number of won',
  );
  fireEvent.change(within(form).getByLabelText('Target amount (KRW)'), {
    target: { value: '1000' },
  });
  fireEvent.change(within(form).getByLabelText('Target date (optional)'), {
    target: { value: '2027/02/01' },
  });
  fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(within(notice()).getByRole('alert')).toHaveTextContent('YYYY-MM-DD'));
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
});

test('edits a goal and clears its target date', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Emergency fund' }));
  const form = screen.getByRole('form', { name: 'Edit Emergency fund' });
  fireEvent.change(within(form).getByLabelText('Target date (optional)'), {
    target: { value: '' },
  });
  fireEvent.change(within(form).getByLabelText('Target amount (KRW)'), {
    target: { value: '7000000' },
  });
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
  expect(await findLive('status', notice())).toHaveTextContent('Emergency fund updated');
  const patch = requests.find((request) => request.method === 'PATCH')!;
  expect(patch.url).toBe('/api/goals/1');
  expect(patch.body).toMatchObject({
    targetAmount: 7_000_000,
    targetDate: null,
    source: 'surplus',
    assetId: null,
  });
});

test('finishes, reopens and deletes a goal (delete asks first)', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Finish Emergency fund' }));
  expect(await findLive('status', notice())).toHaveTextContent('Emergency fund finished');
  expect(requests.find((request) => request.method === 'PATCH')!.body).toEqual({ finished: true });
  expect(await screen.findByText('Finished')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reopen Emergency fund' }));
  await waitFor(() => expect(screen.queryByText('Finished')).toBeNull());

  fireEvent.click(screen.getByRole('button', { name: 'Delete Emergency fund' }));
  expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Emergency fund' }));
  expect(await screen.findByText('There are no goals yet.')).toBeInTheDocument();
});

test('a failed load offers Try again', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => json({ error: 'down' }, 500)),
  );
  show();
  expect(await screen.findByText('Could not load the goals.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});
