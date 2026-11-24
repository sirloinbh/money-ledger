import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { MockOrderBook } from './mock-order-book';
import { renderWithQuery } from './test/query';

const level = (price: number, quantity: number) => ({
  price: String(price),
  quantity: String(quantity),
});
const book = {
  securityId: 1,
  price: '70000',
  asks: [level(70100, 500), level(70200, 300)],
  bids: [level(70000, 400), level(69900, 250)],
  readAt: '2026-11-24T01:02:03.000Z',
};

let answer: { status: number; body: unknown };
let reads: number;

beforeEach(() => {
  answer = { status: 200, body: book };
  reads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      reads += 1;
      return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
    }),
  );
});

test('shows asks above bids with the best ask next to the best bid', async () => {
  renderWithQuery(<MockOrderBook securityId={1} title="Samsung Electronics" />);
  const asks = within(await screen.findByRole('rowgroup', { name: 'Asks' }));
  const bids = within(screen.getByRole('rowgroup', { name: 'Bids' }));
  // Highest ask first, so the lowest ask (70,100) is the last row above the bids.
  expect(asks.getAllByRole('row').map((row) => row.textContent)).toEqual([
    '70,200300',
    '70,100500',
  ]);
  expect(bids.getAllByRole('row')[0]).toHaveTextContent('70,000400');
  expect(screen.getByText(/Last ₩70,000 · read at 10:02:03 KST/)).toBeInTheDocument();
});

test('shows the reason when the market is closed and reads again on refresh', async () => {
  answer = { status: 409, body: { error: 'The market is closed, so there is no order book' } };
  renderWithQuery(<MockOrderBook securityId={1} title="Samsung Electronics" />);
  expect(
    await screen.findByText('The market is closed, so there is no order book'),
  ).toBeInTheDocument();
  answer = { status: 200, body: book };
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByRole('rowgroup', { name: 'Asks' })).toBeInTheDocument();
  expect(reads).toBe(2);
});
