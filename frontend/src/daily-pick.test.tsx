import { screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { DailyPick } from './daily-pick';
import { findLive } from './test/live';
import { renderWithQuery } from './test/query';

const pick = {
  id: 1,
  date: '2026-11-24',
  storyTitle: '반도체 수출 급증',
  storySummary: '수출이 크게 늘었습니다.',
  economicEffect: '경상수지 개선이 예상됩니다.',
  reasoning: '메모리 업황 회복의 직접 수혜입니다.',
  model: 'claude-opus-5-5',
  orderId: null as number | null,
  security: { id: 1, symbol: '005930', name: '삼성전자', market: 'KOSPI' },
  news: [
    {
      id: 5,
      title: '반도체 수출 사상 최대',
      link: 'https://news.example.test/5',
      publisher: 'example.test',
    },
  ],
};

let answer: { status: number; body: unknown };

beforeEach(() => {
  answer = { status: 200, body: { date: '2026-11-24', pick } };
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status })),
    ),
  );
});

test('shows the story, effect, reasoning, stock and the news behind it', async () => {
  renderWithQuery(<DailyPick />);
  const region = await screen.findByRole('region', { name: "Today's Claude pick" });
  expect(await within(region).findByText(/삼성전자/)).toBeInTheDocument();
  expect(region).toHaveTextContent('005930');
  expect(region).toHaveTextContent('반도체 수출 급증. 수출이 크게 늘었습니다.');
  expect(region).toHaveTextContent('경상수지 개선이 예상됩니다.');
  expect(region).toHaveTextContent('메모리 업황 회복의 직접 수혜입니다.');
  expect(region).toHaveTextContent('Not bought yet');
  const link = within(region).getByRole('link', { name: '반도체 수출 사상 최대' });
  expect(link).toHaveAttribute('href', 'https://news.example.test/5');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('says Bought once the order is linked', async () => {
  answer = { status: 200, body: { date: '2026-11-24', pick: { ...pick, orderId: 9 } } };
  renderWithQuery(<DailyPick />);
  expect(await screen.findByText('Bought')).toBeInTheDocument();
});

test('without a pick it says when Claude picks', async () => {
  answer = { status: 200, body: { date: '2026-11-24', pick: null } };
  renderWithQuery(<DailyPick />);
  expect(await screen.findByText(/No pick yet today/)).toBeInTheDocument();
});

test('a failed load shows the reason', async () => {
  answer = { status: 500, body: { error: 'A server error occurred' } };
  renderWithQuery(<DailyPick />);
  expect(await findLive('alert')).toHaveTextContent('A server error occurred');
});
