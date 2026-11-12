import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { formatMonthDay } from './quote-format';
import { SecuritySearch } from './security-search';

const samsung = {
  id: 1,
  market: 'KOSPI',
  symbol: '005930',
  name: 'Samsung Electronics',
  kind: 'stock',
  active: true,
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
  active: true,
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
        body: { error: 'The requested API was not found' },
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
  fireEvent.change(screen.getByLabelText('Security name, code, or ticker'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
};

test('results show the latest close with its date; a US ticker says the close comes on opening', async () => {
  answers['/api/prices/securities?q=Samsung'] = {
    status: 200,
    body: { securities: [samsung, apple] },
  };
  render(<SecuritySearch />);
  expect(screen.getByText(/Search US securities by ticker/)).toBeInTheDocument();
  searchFor(' Samsung ');

  const list = await screen.findByRole('list', { name: 'Search results' });
  const [first, second] = within(list).getAllByRole('button');
  expect(first).toHaveTextContent('Samsung Electronics');
  expect(first).toHaveTextContent('005930');
  expect(first).toHaveTextContent('KOSPI');
  expect(first).toHaveTextContent('₩70,600');
  expect(first).toHaveTextContent('Nov 6 close');
  // No name yet: the ticker is the title.
  expect(second).toHaveTextContent('AAPL');
  expect(second).toHaveTextContent('Open to get a quote');
  expect(screen.getByRole('status')).toHaveTextContent('2 results for "Samsung"');
});

test('no results, a blank query and an API error read differently', async () => {
  answers['/api/prices/securities?q=zzz'] = { status: 200, body: { securities: [] } };
  answers['/api/prices/securities?q=err'] = {
    status: 500,
    body: { error: 'A server error occurred' },
  };
  render(<SecuritySearch />);

  searchFor('zzz');
  expect(await screen.findByText('No results for "zzz"')).toHaveAttribute('role', 'status');
  expect(screen.queryByRole('list', { name: 'Search results' })).toBeNull();

  searchFor('   ');
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a search term');
  expect(screen.getByLabelText('Security name, code, or ticker')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(urls).toHaveLength(1);

  searchFor('err');
  expect(await screen.findByRole('alert')).toHaveTextContent('A server error occurred');
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
  fireEvent.click(await screen.findByRole('button', { name: /Samsung Electronics/ }));

  const heading = await screen.findByRole('heading', { level: 2, name: 'Samsung Electronics' });
  await vi.waitFor(() => expect(heading).toHaveFocus());
  expect(detailCard().getByText('Delayed · Nov 6 close')).toBeInTheDocument();
  expect(screen.queryByText(/exchange rate/i)).toBeNull();
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
  expect(detailCard().getByText('$231.5')).toBeInTheDocument();
  expect(detailCard().getByText('₩1,384.5')).toBeInTheDocument();
  expect(detailCard().getByText('Rate delayed · as of Nov 9')).toBeInTheDocument();
  // The result row picks up the name and close fetched on opening, without a new search.
  const row = within(screen.getByRole('list', { name: 'Search results' })).getByRole('button');
  expect(row).toHaveTextContent('Apple Inc');
  expect(row).toHaveTextContent('$231.5');
  expect(row).not.toHaveTextContent('Open to get a quote');
});

test.each([
  ['rate_limited', 'Try again in a moment'],
  ['not_configured', 'No quote source is configured'],
  ['fetch_failed', 'Could not get the quote. Try again in a moment'],
  [null, 'No close received yet'],
])('a missing close with issue %s says "No quote" and why', async (issue, text) => {
  answers['/api/prices/securities?q=AAPL'] = { status: 200, body: { securities: [apple] } };
  answers['/api/prices/securities/2'] = {
    status: 200,
    body: { security: apple, quote: null, quoteIssue: issue, fx: null },
  };
  render(<SecuritySearch />);
  searchFor('AAPL');
  fireEvent.click(await screen.findByRole('button', { name: /AAPL/ }));
  expect(await screen.findByText('No quote')).toBeInTheDocument();
  expect(screen.getByText(text)).toBeInTheDocument();
  expect(screen.getByText('No exchange rate')).toBeInTheDocument();
});

test('a delisted or suspended security says Trading halted next to its last close', async () => {
  answers['/api/prices/securities?q=005930'] = { status: 200, body: { securities: [samsung] } };
  answers['/api/prices/securities/1'] = {
    status: 200,
    body: {
      security: { ...samsung, active: false },
      quote: samsung.quote,
      quoteIssue: null,
      fx: null,
    },
  };
  render(<SecuritySearch />);
  searchFor('005930');
  fireEvent.click(await screen.findByRole('button', { name: /Samsung Electronics/ }));
  await screen.findByRole('heading', { level: 2, name: 'Samsung Electronics' });
  expect(detailCard().getByText('Trading halted')).toBeInTheDocument();
  expect(detailCard().getByText('₩70,600')).toBeInTheDocument();
});

test('an active security has no Trading halted mark', async () => {
  answers['/api/prices/securities?q=005930'] = { status: 200, body: { securities: [samsung] } };
  answers['/api/prices/securities/1'] = {
    status: 200,
    body: { security: samsung, quote: samsung.quote, quoteIssue: null, fx: null },
  };
  render(<SecuritySearch />);
  searchFor('005930');
  fireEvent.click(await screen.findByRole('button', { name: /Samsung Electronics/ }));
  await screen.findByRole('heading', { level: 2, name: 'Samsung Electronics' });
  expect(screen.queryByText('Trading halted')).toBeNull();
});

test('a detail that fails to load shows the server message', async () => {
  answers['/api/prices/securities?q=005930'] = { status: 200, body: { securities: [samsung] } };
  answers['/api/prices/securities/1'] = { status: 404, body: { error: 'Security not found' } };
  render(<SecuritySearch />);
  searchFor('005930');
  fireEvent.click(await screen.findByRole('button', { name: /Samsung Electronics/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Security not found');
});

test('dates read as month and day', () => {
  expect(formatMonthDay('2026-01-05')).toBe('Jan 5');
  expect(formatMonthDay('2026-11-16')).toBe('Nov 16');
});
