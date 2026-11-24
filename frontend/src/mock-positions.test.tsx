import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { MockPositions } from './mock-positions';
import { renderWithQuery } from './test/query';

const position = (over: Record<string, unknown> = {}) => ({
  id: 7,
  security: { id: 1, symbol: '005930', name: 'Samsung Electronics' },
  quantity: '14.00000000',
  strategy: 'undecided',
  strategyChosenAt: null,
  strategySource: null,
  openedAt: '2026-11-24T01:00:00.000Z',
  closedAt: null,
  buy: { price: '70100.0000', amountKrw: 981_400, feeKrw: 147 },
  sell: null,
  ...over,
});

let positions: unknown[];
let posts: { url: string; body: unknown }[];
let failStrategy: boolean;

beforeEach(() => {
  positions = [position()];
  posts = [];
  failStrategy = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        if (failStrategy)
          return json({ error: 'The strategy of this position was already chosen' }, 409);
        positions = [
          position({
            strategy: 'long_hold',
            strategyChosenAt: '2026-11-24T01:05:00.000Z',
            strategySource: 'web',
          }),
        ];
        return json({ position: positions[0] });
      }
      if (url.endsWith('/api/mock/accounts'))
        return json({ account: { id: 3 }, closedAccounts: [] });
      return json({ positions });
    }),
  );
});

test('shows an undecided position with both strategy buttons and sends the choice', async () => {
  renderWithQuery(<MockPositions />);
  const row = within(await screen.findByRole('listitem', { name: 'Samsung Electronics' }));
  expect(row.getByText('Undecided')).toBeInTheDocument();
  expect(row.getByText(/14 shares bought at ₩70,100/)).toBeInTheDocument();
  fireEvent.click(row.getByRole('button', { name: 'Long hold' }));
  await waitFor(() =>
    expect(posts).toEqual([
      { url: '/api/mock/positions/7/strategy', body: { strategy: 'long_hold', source: 'web' } },
    ]),
  );
  const decided = within(await screen.findByRole('listitem', { name: 'Samsung Electronics' }));
  expect(await decided.findByText('Long hold')).toBeInTheDocument();
  expect(decided.queryByRole('button', { name: 'Day trade' })).not.toBeInTheDocument();
  expect(screen.getByText('Samsung Electronics: long hold chosen')).toBeInTheDocument();
});

test('shows the server reason when the choice is refused', async () => {
  failStrategy = true;
  renderWithQuery(<MockPositions />);
  fireEvent.click(await screen.findByRole('button', { name: 'Day trade' }));
  expect(
    await screen.findByText('The strategy of this position was already chosen'),
  ).toBeInTheDocument();
});

test('lists a sold position with its fee and tax and no strategy buttons', async () => {
  positions = [
    position({
      strategy: 'day_trade',
      strategyChosenAt: '2026-11-24T01:05:00.000Z',
      strategySource: 'auto',
      closedAt: '2026-11-24T02:00:00.000Z',
      sell: { price: '70000.0000', amountKrw: 980_000, feeKrw: 147, taxKrw: 1_960 },
    }),
  ];
  renderWithQuery(<MockPositions />);
  const sold = within(await screen.findByRole('list', { name: 'Sold positions' }));
  expect(sold.getByText(/Sold at ₩70,000/)).toHaveTextContent('fee ₩147 − tax ₩1,960');
  expect(sold.queryByRole('button')).not.toBeInTheDocument();
});

test('says there are no positions yet', async () => {
  positions = [];
  renderWithQuery(<MockPositions />);
  expect(await screen.findByText(/No positions yet/)).toBeInTheDocument();
});
