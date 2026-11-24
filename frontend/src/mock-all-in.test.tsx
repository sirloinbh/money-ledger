import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { MockAllIn } from './mock-all-in';
import { renderWithQuery } from './test/query';

const preview = {
  security: { id: 1, symbol: '005930', name: 'Samsung Electronics' },
  ask: '70100',
  readAt: '2026-11-24T01:00:00.000Z',
  quantity: '14',
  amountKrw: 981_400,
  feeKrw: 147,
  cashKrw: 1_000_000,
  cashAfterKrw: 18_453,
  problem: null,
};

let previewAnswer: { status: number; body: unknown };
let posts: unknown[];

beforeEach(() => {
  previewAnswer = { status: 200, body: preview };
  posts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return json({ position: { quantity: '14.00000000' } }, 201);
      }
      if (url.includes('/positions/preview')) return json(previewAnswer.body, previewAnswer.status);
      return json({ account: { id: 3 }, closedAccounts: [] });
    }),
  );
});

test('reviews the server preview and buys with the ask it showed', async () => {
  renderWithQuery(<MockAllIn securityId={1} title="Samsung Electronics" />);
  fireEvent.click(screen.getByRole('button', { name: 'Review all-in buy' }));
  expect(await screen.findByText('Buy 14 shares of Samsung Electronics')).toBeInTheDocument();
  expect(screen.getByText('Fills at the best ask of ₩70,100.')).toBeInTheDocument();
  expect(screen.getByText('Cash after order ₩18,453')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Buy all-in' }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({ securityId: 1, expectedAsk: '70100' });
  expect(
    await screen.findByText(/Bought 14 shares of Samsung Electronics at ₩70,100/),
  ).toBeInTheDocument();
});

test('shows why it cannot buy, such as a closed market', async () => {
  previewAnswer = {
    status: 409,
    body: { error: 'The market is closed, so there is no order book' },
  };
  renderWithQuery(<MockAllIn securityId={1} title="Samsung Electronics" />);
  fireEvent.click(screen.getByRole('button', { name: 'Review all-in buy' }));
  expect(
    await screen.findByText('The market is closed, so there is no order book'),
  ).toBeInTheDocument();
  expect(posts).toHaveLength(0);
});

test('shows the problem of a preview that cannot fill', async () => {
  previewAnswer = {
    status: 200,
    body: {
      ...preview,
      quantity: null,
      amountKrw: null,
      feeKrw: null,
      cashAfterKrw: null,
      problem: 'Not enough cash for one share at the best ask',
    },
  };
  renderWithQuery(<MockAllIn securityId={1} title="Samsung Electronics" />);
  fireEvent.click(screen.getByRole('button', { name: 'Review all-in buy' }));
  expect(
    await screen.findByText('Not enough cash for one share at the best ask'),
  ).toBeInTheDocument();
});
