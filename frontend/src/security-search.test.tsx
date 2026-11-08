import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { formatMonthDay } from './quote-format';
import { SecuritySearch } from './security-search';

const samsung = {
  id: 1,
  market: 'KOSPI',
  symbol: '005930',
  name: '삼성전자',
  kind: 'stock',
  currency: 'KRW',
  quote: {
    close: '70600.0000',
    currency: 'KRW',
    tradeDate: '2026-11-06',
    fetchedAt: '2026-11-09T03:00:00.000Z',
    stale: false,
  },
};
const apple = {
  id: 2,
  market: 'NASDAQ',
  symbol: 'AAPL',
  name: null,
  kind: 'stock',
  currency: 'USD',
  quote: null,
};

type Answer = { status: number; body: unknown };
let answers: Record<string, Answer>;
let urls: string[];

beforeEach(() => {
  urls = [];
  answers = {};
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(url);
      const answer = answers[url] ?? {
        status: 404,
        body: { error: '요청한 API를 찾을 수 없습니다' },
      };
      return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
    }),
  );
});

/** The opened detail card, so a value shown in both the result row and the detail is found once. */
const detailCard = () =>
  within(
    document.getElementById('security-detail-title')!.closest<HTMLElement>('[data-slot="card"]')!,
  );

const searchFor = (text: string) => {
  fireEvent.change(screen.getByLabelText('종목 이름, 코드 또는 티커'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '검색' }));
};

test('results show the latest close with its date; a US ticker says the close comes on opening', async () => {
  answers['/api/prices/securities?q=%EC%82%BC%EC%84%B1'] = {
    status: 200,
    body: { securities: [samsung, apple] },
  };
  render(<SecuritySearch />);
  expect(screen.getByText(/미국 종목은 티커로 검색하세요/)).toBeInTheDocument();
  searchFor(' 삼성 ');

  const list = await screen.findByRole('list', { name: '검색 결과' });
  const [first, second] = within(list).getAllByRole('button');
  expect(first).toHaveTextContent('삼성전자');
  expect(first).toHaveTextContent('005930');
  expect(first).toHaveTextContent('유가증권');
  expect(first).toHaveTextContent('70,600원');
  expect(first).toHaveTextContent('11월 6일 종가 기준');
  // No name yet: the ticker is the title.
  expect(second).toHaveTextContent('AAPL');
  expect(second).toHaveTextContent('열면 시세를 받습니다');
  expect(screen.getByRole('status')).toHaveTextContent('"삼성" 검색 결과 2개');
});

test('no results, a blank query and an API error read differently', async () => {
  answers['/api/prices/securities?q=zzz'] = { status: 200, body: { securities: [] } };
  answers['/api/prices/securities?q=err'] = {
    status: 500,
    body: { error: '서버 오류가 발생했습니다' },
  };
  render(<SecuritySearch />);

  searchFor('zzz');
  expect(await screen.findByText('"zzz" 검색 결과가 없습니다')).toHaveAttribute('role', 'status');
  expect(screen.queryByRole('list', { name: '검색 결과' })).toBeNull();

  searchFor('   ');
  expect(await screen.findByRole('alert')).toHaveTextContent('검색어를 입력하세요');
  expect(screen.getByLabelText('종목 이름, 코드 또는 티커')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(urls).toHaveLength(1);

  searchFor('err');
  expect(await screen.findByRole('alert')).toHaveTextContent('서버 오류가 발생했습니다');
});

test('a Korean detail shows the close and marks a delayed one', async () => {
  answers['/api/prices/securities?q=005930'] = { status: 200, body: { securities: [samsung] } };
  answers['/api/prices/securities/1'] = {
    status: 200,
    body: {
      security: samsung,
      quote: { ...samsung.quote, stale: true },
      quoteIssue: null,
      fx: null,
    },
  };
  render(<SecuritySearch />);
  searchFor('005930');
  fireEvent.click(await screen.findByRole('button', { name: /삼성전자/ }));

  const heading = await screen.findByRole('heading', { level: 2, name: '삼성전자' });
  await vi.waitFor(() => expect(heading).toHaveFocus());
  expect(detailCard().getByText('시세 지연 · 11월 6일 종가 기준')).toBeInTheDocument();
  expect(screen.queryByText(/환율/)).toBeNull();
});

test('a US detail shows the close in dollars, the rate, and why a close is missing', async () => {
  answers['/api/prices/securities?q=AAPL'] = { status: 200, body: { securities: [apple] } };
  answers['/api/prices/securities/2'] = {
    status: 200,
    body: {
      security: { ...apple, name: 'Apple Inc' },
      quote: {
        close: '231.5000',
        currency: 'USD',
        tradeDate: '2026-11-06',
        fetchedAt: null,
        stale: false,
      },
      quoteIssue: null,
      fx: { fxRate: '1384.5000', rateDate: '2026-11-09', stale: true },
    },
  };
  render(<SecuritySearch />);
  searchFor('AAPL');
  fireEvent.click(await screen.findByRole('button', { name: /AAPL/ }));
  expect(await screen.findByRole('heading', { level: 2, name: 'Apple Inc' })).toBeInTheDocument();
  expect(detailCard().getByText('231.5달러')).toBeInTheDocument();
  expect(detailCard().getByText('1,384.5원')).toBeInTheDocument();
  expect(detailCard().getByText('환율 지연 · 11월 9일 기준')).toBeInTheDocument();
  // The result row picks up the name and close fetched on opening, without a new search.
  const row = within(screen.getByRole('list', { name: '검색 결과' })).getByRole('button');
  expect(row).toHaveTextContent('Apple Inc');
  expect(row).toHaveTextContent('231.5달러');
  expect(row).not.toHaveTextContent('열면 시세를 받습니다');
});

test.each([
  ['rate_limited', '잠시 후 다시 시도하세요'],
  ['not_configured', '시세 출처가 설정되지 않았습니다'],
  ['fetch_failed', '시세를 받지 못했습니다. 잠시 후 다시 시도하세요'],
  [null, '아직 받은 종가가 없습니다'],
])('a missing close with issue %s says "시세 없음" and why', async (issue, text) => {
  answers['/api/prices/securities?q=AAPL'] = { status: 200, body: { securities: [apple] } };
  answers['/api/prices/securities/2'] = {
    status: 200,
    body: { security: apple, quote: null, quoteIssue: issue, fx: null },
  };
  render(<SecuritySearch />);
  searchFor('AAPL');
  fireEvent.click(await screen.findByRole('button', { name: /AAPL/ }));
  expect(await screen.findByText('시세 없음')).toBeInTheDocument();
  expect(screen.getByText(text)).toBeInTheDocument();
  expect(screen.getByText('환율 없음')).toBeInTheDocument();
});

test('a detail that fails to load shows the server message', async () => {
  answers['/api/prices/securities?q=005930'] = { status: 200, body: { securities: [samsung] } };
  answers['/api/prices/securities/1'] = { status: 404, body: { error: '종목을 찾을 수 없습니다' } };
  render(<SecuritySearch />);
  searchFor('005930');
  fireEvent.click(await screen.findByRole('button', { name: /삼성전자/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('종목을 찾을 수 없습니다');
});

test('dates read as month and day', () => {
  expect(formatMonthDay('2026-01-05')).toBe('1월 5일');
  expect(formatMonthDay('2026-11-16')).toBe('11월 16일');
});
