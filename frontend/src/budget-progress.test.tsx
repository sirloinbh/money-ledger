import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { BudgetProgress } from './budget-progress';

const base = { hidden: false, remaining: null, over: null, percent: null };
const november = {
  month: '2026-11',
  budgets: [
    {
      ...base,
      categoryId: 1,
      name: 'Food',
      spent: 337500,
      budget: 300000,
      budgetMonth: '2026-11',
      remaining: 0,
      over: 37500,
      percent: '112.5',
    },
    {
      ...base,
      categoryId: 3,
      name: 'Housing',
      spent: 1000,
      budget: 80000,
      budgetMonth: '2026-08',
      remaining: 79000,
      over: 0,
      percent: '1.3',
    },
    { ...base, categoryId: 4, name: 'Phone', spent: 12000, budget: null, budgetMonth: null },
    {
      ...base,
      categoryId: 7,
      name: 'Leisure',
      hidden: true,
      spent: 7000,
      budget: null,
      budgetMonth: null,
    },
  ],
};

type Call = { url: string; method: string; body?: unknown };
let calls: Call[];
let answer: (call: Call) => Promise<Response>;
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T15:30:00Z')); // 2026-11-03 in Seoul
  calls = [];
  answer = (call) =>
    call.method === 'PUT'
      ? json({ budget: call.body })
      : json(call.url.endsWith('2026-11') ? november : { month: '2026-10', budgets: [] });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const call = {
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      return answer(call);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

/** A link-like button that moves the summary month, as the monthly summary does. */
function GoMonth({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(`/ledger?month=${to}`)}>
      Go to {to}
    </button>
  );
}

const show = (path = '/ledger', version = 0) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <BudgetProgress version={version} />
      <GoMonth to="2026-10" />
    </MemoryRouter>,
  );
const row = (name: string) =>
  screen.getByRole('button', { name: `Edit ${name} budget` }).closest('li') as HTMLElement;
const gets = () => calls.filter((call) => call.method === 'GET').map((call) => call.url);

test('the summary month: over, under and unset budgets, each said in words', async () => {
  show();
  await screen.findByText('Budget by category');
  await screen.findByRole('button', { name: 'Edit Food budget' });
  expect(gets()).toEqual(['/api/ledger/budgets?month=2026-11']);
  expect(screen.getByText('As of November 2026')).toBeInTheDocument();

  // Over: the excess in words next to an icon, in the error color, and a full red bar.
  const food = row('Food');
  expect(food).toHaveTextContent('₩337,500 / ₩300,000');
  const excess = within(food).getByText('₩37,500 over (112.5%)');
  expect(excess).toHaveClass('text-destructive');
  expect(excess.querySelector('svg')).not.toBeNull();
  const foodBar = food.querySelector('[aria-hidden="true"] > div') as HTMLElement;
  expect(foodBar).toHaveClass('bg-destructive');
  expect(foodBar.style.width).toBe('100%');

  // Under: what is left, and the month the budget carries on from.
  const housing = row('Housing');
  expect(housing).toHaveTextContent('₩1,000 / ₩80,000');
  expect(within(housing).getByText('₩79,000 left (1.3%)')).toBeInTheDocument();
  expect(within(housing).getByText('Budget set in August 2026')).toBeInTheDocument();
  const housingBar = housing.querySelector('[aria-hidden="true"] > div') as HTMLElement;
  expect(housingBar.style.width).toBe('1.3%');
  expect(housingBar).not.toHaveClass('bg-destructive');

  // No budget: Not set instead of a progress bar.
  const phone = row('Phone');
  expect(within(phone).getByText('Not set')).toBeInTheDocument();
  expect(phone).toHaveTextContent('Spent ₩12,000 · set a budget to see progress');
  expect(phone.querySelector('[aria-hidden="true"] > div')).toBeNull();
  expect(row('Leisure')).toHaveTextContent('Leisure (hidden)');
});

test('the month in the address, and another month reloads and closes an open form', async () => {
  show('/ledger?month=2026-11');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Food budget' }));
  expect(screen.getByLabelText('Food budget (KRW)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Go to 2026-10' }));
  expect(await screen.findByText('There are no expense categories.')).toBeInTheDocument();
  expect(gets()).toEqual([
    '/api/ledger/budgets?month=2026-11',
    '/api/ledger/budgets?month=2026-10',
  ]);
  expect(screen.getByText('As of October 2026')).toBeInTheDocument();
  expect(screen.queryByLabelText('Food budget (KRW)')).not.toBeInTheDocument();
});

test('Edit saves the budget from this month on, with thousands commas, then reloads', async () => {
  show();
  const edit = await screen.findByRole('button', { name: 'Edit Food budget' });
  fireEvent.click(edit);
  const input = screen.getByLabelText('Food budget (KRW)');
  expect(input).toHaveValue('300000');
  await vi.waitFor(() => expect(input).toHaveFocus());
  expect(
    screen.getByText('Applies from November 2026. Leave empty or 0 for not set.'),
  ).toBeInTheDocument();

  fireEvent.change(input, { target: { value: '350,000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(
    await screen.findByText('Food budget set to ₩350,000 from November 2026'),
  ).toBeInTheDocument();
  expect(calls.find((call) => call.method === 'PUT')).toEqual({
    url: '/api/ledger/budgets/1',
    method: 'PUT',
    body: { month: '2026-11', amount: 350000 },
  });
  await vi.waitFor(() => expect(gets()).toHaveLength(2));
  expect(screen.queryByLabelText('Food budget (KRW)')).not.toBeInTheDocument();
  await vi.waitFor(() =>
    expect(screen.getByRole('button', { name: 'Edit Food budget' })).toHaveFocus(),
  );
});

test('an empty field saves 0: no budget from this month on', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Housing budget' }));
  fireEvent.change(screen.getByLabelText('Housing budget (KRW)'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(
    await screen.findByText('Housing budget changed to not set from November 2026'),
  ).toBeInTheDocument();
  expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
    month: '2026-11',
    amount: 0,
  });
});

test('a budget that is not a whole number is refused before any request', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Phone budget' }));
  const input = screen.getByLabelText('Phone budget (KRW)');
  expect(input).toHaveValue('');
  for (const value of ['12.5', '-100', '1k', '1,00']) {
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter the budget as a whole number of won, 0 or more',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
  }
  expect(calls.some((call) => call.method === 'PUT')).toBe(false);
});

test('a failed save says why and keeps the form with what was typed', async () => {
  answer = (call) =>
    call.method === 'PUT' ? json({ error: 'Expense category not found' }, 404) : json(november);
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Food budget' }));
  fireEvent.change(screen.getByLabelText('Food budget (KRW)'), { target: { value: '1000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Expense category not found');
  expect(screen.getByLabelText('Food budget (KRW)')).toHaveValue('1000');
});

test('Cancel closes the form without saving and returns the focus', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Food budget' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('Food budget (KRW)')).not.toBeInTheDocument();
  await vi.waitFor(() =>
    expect(screen.getByRole('button', { name: 'Edit Food budget' })).toHaveFocus(),
  );
  expect(calls.some((call) => call.method === 'PUT')).toBe(false);
});

test('a failed load says so, and Try again loads it again', async () => {
  answer = () => json({ error: 'Server error' }, 500);
  show();
  expect(await screen.findByText('Could not load the budgets.')).toBeInTheDocument();
  answer = () => json(november);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading budgets' }));
  expect(screen.getByRole('heading', { name: 'Budget by category' })).toHaveFocus();
  expect(await screen.findByRole('button', { name: 'Edit Food budget' })).toBeInTheDocument();
});

test('a change elsewhere (version) reloads the same month', async () => {
  const { rerender } = show();
  await screen.findByRole('button', { name: 'Edit Food budget' });
  rerender(
    <MemoryRouter initialEntries={['/ledger']}>
      <BudgetProgress version={1} />
      <GoMonth to="2026-10" />
    </MemoryRouter>,
  );
  await vi.waitFor(() => expect(gets()).toHaveLength(2));
  expect(gets()[1]).toBe(gets()[0]);
});

test('a save that ends after the summary moved to another month reloads that month', async () => {
  let finish: (value: Response) => void = () => undefined;
  answer = (call) =>
    call.method === 'PUT'
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : json(call.url.endsWith('2026-11') ? november : { month: '2026-10', budgets: [] });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Food budget' }));
  fireEvent.change(screen.getByLabelText('Food budget (KRW)'), { target: { value: '1000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  fireEvent.click(screen.getByRole('button', { name: 'Go to 2026-10' }));
  expect(await screen.findByText('There are no expense categories.')).toBeInTheDocument();

  finish(new Response(JSON.stringify({ budget: {} })));
  await vi.waitFor(() => expect(gets()).toHaveLength(3));
  expect(gets()[2]).toBe('/api/ledger/budgets?month=2026-10');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByText('As of October 2026')).toBeInTheDocument();
  expect(screen.getByText('There are no expense categories.')).toBeInTheDocument();
  expect(
    screen
      .getByRole('heading', { name: 'Budget by category' })
      .closest('section')!
      .querySelector('[aria-busy]'),
  ).toBeNull();
});

test('a row that is no longer listed after the save gives the focus to the title', async () => {
  let saved = false;
  answer = (call) => {
    if (call.method === 'PUT') {
      saved = true;
      return json({ budget: call.body });
    }
    // A hidden category listed only for its budget: unset, it is left out.
    return json(
      saved
        ? { ...november, budgets: november.budgets.filter((budget) => budget.name !== 'Phone') }
        : november,
    );
  };
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Phone budget' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await vi.waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Edit Phone budget' })).not.toBeInTheDocument(),
  );
  await vi.waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Budget by category' })).toHaveFocus(),
  );
});

test('a save that ends late leaves another row being edited alone, and the focus where it is', async () => {
  let finish: (value: Response) => void = () => undefined;
  answer = (call) =>
    call.method === 'PUT'
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : json(november);
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Food budget' }));
  fireEvent.change(screen.getByLabelText('Food budget (KRW)'), { target: { value: '1000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  // While the save is on its way, another row is opened and typed in.
  fireEvent.click(screen.getByRole('button', { name: 'Edit Housing budget' }));
  const other = screen.getByLabelText('Housing budget (KRW)');
  fireEvent.change(other, { target: { value: '90000' } });
  await vi.waitFor(() => expect(other).toHaveFocus());

  finish(new Response(JSON.stringify({ budget: {} })));
  expect(
    await screen.findByText('Food budget set to ₩1,000 from November 2026'),
  ).toBeInTheDocument();
  await vi.waitFor(() => expect(gets()).toHaveLength(2));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.getByLabelText('Housing budget (KRW)')).toHaveValue('90000');
  expect(screen.getByLabelText('Housing budget (KRW)')).toHaveFocus();
});

test('a save that ends after a month change leaves the focus on what was pressed', async () => {
  let finish: (value: Response) => void = () => undefined;
  answer = (call) =>
    call.method === 'PUT'
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : json(call.url.endsWith('2026-11') ? november : { month: '2026-10', budgets: [] });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Food budget' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  const monthButton = screen.getByRole('button', { name: 'Go to 2026-10' });
  monthButton.focus();
  fireEvent.click(monthButton);
  await screen.findByText('There are no expense categories.');
  finish(new Response(JSON.stringify({ budget: {} })));
  await vi.waitFor(() => expect(gets()).toHaveLength(3));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(monthButton).toHaveFocus();
});

test('while another month loads, the dimmed rows of the last one cannot be edited', async () => {
  let october: (value: Response) => void = () => undefined;
  answer = (call) =>
    call.url.endsWith('2026-11')
      ? json(november)
      : new Promise<Response>((resolve) => {
          october = resolve;
        });
  show();
  await screen.findByRole('button', { name: 'Edit Food budget' });
  fireEvent.click(screen.getByRole('button', { name: 'Go to 2026-10' }));
  await vi.waitFor(() => expect(screen.getByText('As of October 2026')).toBeInTheDocument());
  // November's rows stay dimmed until October arrives: no Edit, and their own month in the labels.
  expect(screen.getByRole('button', { name: 'Edit Food budget' })).toBeDisabled();
  expect(screen.getByText('Budget set in August 2026')).toBeInTheDocument();
  expect(screen.queryByText('Budget set in November 2026')).not.toBeInTheDocument();
  october(new Response(JSON.stringify({ month: '2026-10', budgets: [] })));
  expect(await screen.findByText('There are no expense categories.')).toBeInTheDocument();
});

test('an error about a form goes away with the form when the month changes', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Food budget' }));
  fireEvent.change(screen.getByLabelText('Food budget (KRW)'), { target: { value: 'abc' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Enter the budget as a whole number of won, 0 or more',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Go to 2026-10' }));
  await screen.findByText('There are no expense categories.');
  expect(
    screen.queryByText('Enter the budget as a whole number of won, 0 or more'),
  ).not.toBeInTheDocument();
});
