import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { MockKeepOrSell } from './mock-keep-or-sell';
import { renderWithQuery } from './test/query';

const question = (over: Record<string, unknown> = {}) => ({
  id: 5,
  positionId: 7,
  questionDate: '2026-11-25',
  status: 'open',
  security: { id: 1, symbol: '005930', name: 'Samsung Electronics' },
  quantity: '20.00000000',
  buy: { price: '70100.0000', amountKrw: 1_402_000 },
  ...over,
});

let questions: unknown[];
let posts: { url: string; body: unknown }[];
let postAnswer: { status: number; body: unknown };

beforeEach(() => {
  questions = [question()];
  posts = [];
  postAnswer = { status: 200, body: { question: question({ status: 'sold' }) } };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        if (postAnswer.status === 200)
          questions = [(postAnswer.body as { question: unknown }).question];
        return json(postAnswer.body, postAnswer.status);
      }
      if (url.endsWith('/api/mock/accounts'))
        return json({ account: { id: 3 }, closedAccounts: [] });
      return json({ questions });
    }),
  );
});

test('shows an open question with Keep and Sell and sends the answer', async () => {
  renderWithQuery(<MockKeepOrSell />);
  const row = within(await screen.findByRole('listitem', { name: 'Samsung Electronics' }));
  expect(row.getByText(/20 shares bought at ₩70,100/)).toBeInTheDocument();
  fireEvent.click(row.getByRole('button', { name: 'Sell' }));
  await waitFor(() =>
    expect(posts).toEqual([
      { url: '/api/mock/positions/7/next-day', body: { answer: 'sell', source: 'web' } },
    ]),
  );
  expect(await screen.findByText('Samsung Electronics: sold')).toBeInTheDocument();
  const done = within(await screen.findByRole('listitem', { name: 'Samsung Electronics' }));
  expect(await done.findByText('Sold')).toBeInTheDocument();
  expect(done.queryByRole('button')).not.toBeInTheDocument();
});

test('keep says so', async () => {
  postAnswer = { status: 200, body: { question: question({ status: 'kept' }) } };
  renderWithQuery(<MockKeepOrSell />);
  fireEvent.click(await screen.findByRole('button', { name: 'Keep' }));
  expect(await screen.findByText('Samsung Electronics: kept')).toBeInTheDocument();
});

test('shows the server reason when the question already closed', async () => {
  postAnswer = { status: 409, body: { error: 'The question closed at 15:00' } };
  renderWithQuery(<MockKeepOrSell />);
  fireEvent.click(await screen.findByRole('button', { name: 'Keep' }));
  expect(await screen.findByText('The question closed at 15:00')).toBeInTheDocument();
});

test('shows nothing when there is no question today', async () => {
  questions = [];
  const { container } = renderWithQuery(<MockKeepOrSell />);
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
  expect(container).toBeEmptyDOMElement();
});
