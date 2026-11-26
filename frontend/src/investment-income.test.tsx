import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { InvestmentIncome } from './investment-income';
import { renderWithQuery } from './test/query';

const makeSummary = (over: Record<string, unknown> = {}) => ({
  year: 2026,
  years: [2026, 2025],
  income: [
    {
      id: 1,
      assetId: 5,
      assetName: 'Apple',
      kind: 'dividend',
      receivedOn: '2026-05-15',
      currency: 'USD',
      amountForeign: '12.3456',
      fxRate: '1385.2500',
      amountKrw: 17_102,
      taxWithheldKrw: 2_000,
      memo: 'Q1',
    },
  ],
  incomeTotals: {
    dividendKrw: 17_102,
    interestKrw: 0,
    financialIncomeKrw: 17_102,
    taxWithheldKrw: 2_000,
    overLine: false,
  },
  gains: {
    overseasKrw: 3_500_000,
    domesticKrw: -2_500,
    sales: [
      {
        tradeId: 9,
        assetName: 'Apple',
        tradedOn: '2026-06-01',
        currency: 'USD',
        realizedKrw: 3_500_000,
      },
    ],
  },
  overseasTax: {
    gainKrw: 3_500_000,
    deductionKrw: 2_500_000,
    taxableKrw: 1_000_000,
    percent: 22,
    estimateKrw: 220_000,
  },
  ...over,
});

let summary: ReturnType<typeof makeSummary>;
let requests: { method: string; url: string; body: unknown }[];
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  summary = makeSummary();
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      requests.push({ method, url, body });
      if (url === '/api/portfolio/assets') {
        return json({
          assets: [
            { id: 5, name: 'Apple', type: 'stock', currency: 'USD' },
            { id: 6, name: 'Bond fund', type: 'stock', currency: 'KRW' },
            { id: 7, name: 'Loan', type: 'debt', currency: 'KRW' },
          ],
        });
      }
      if (url.startsWith('/api/portfolio/income') && method === 'GET') return json(summary);
      if (method === 'POST') return json({ income: {} }, 201);
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
});

const show = () => renderWithQuery(<InvestmentIncome />);

test('shows the tax estimate, the realized gains and the recorded income', async () => {
  show();
  expect(await screen.findByText('Estimated tax at 22%:', { exact: false })).toHaveTextContent(
    '₩220,000',
  );
  expect(screen.getByText(/Realized gain on overseas stocks/)).toHaveTextContent('+₩3,500,000');
  expect(screen.getByText(/Taxable amount/)).toHaveTextContent('₩1,000,000');
  expect(screen.getByText(/Domestic/)).toHaveTextContent('-₩2,500');
  const sales = screen.getByRole('list', { name: 'Sales' });
  expect(sales).toHaveTextContent('2026-06-01 Apple+₩3,500,000');
  const income = screen.getByRole('list', { name: 'Dividends and interest' });
  expect(income).toHaveTextContent('Dividend ($12.3456 at ₩1385.2500) · Q1₩17,102');
});

test('a year change loads that year', async () => {
  show();
  await screen.findByLabelText('Year');
  fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } });
  await waitFor(() =>
    expect(requests.some((request) => request.url === '/api/portfolio/income?year=2025')).toBe(
      true,
    ),
  );
});

test('says when nothing was sold or received, and warns above the 20 million line', async () => {
  summary = makeSummary({
    income: [],
    gains: { overseasKrw: 0, domesticKrw: 0, sales: [] },
    incomeTotals: {
      dividendKrw: 0,
      interestKrw: 20_000_001,
      financialIncomeKrw: 20_000_001,
      taxWithheldKrw: 0,
      overLine: true,
    },
  });
  show();
  expect(await screen.findByText('No sales this year.')).toBeInTheDocument();
  expect(screen.getByText('Nothing recorded this year.')).toBeInTheDocument();
  expect(screen.getByText(/more than ₩20,000,000/)).toBeInTheDocument();
});

test('records a dollar dividend with its rate and a won one without', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Add dividend or interest' }));
  const form = screen.getByRole('form', { name: 'New dividend or interest' });
  const options = within(form)
    .getAllByRole('option')
    .map((option) => option.textContent);
  expect(options).not.toContain('Loan');
  fireEvent.change(within(form).getByLabelText('Holding'), { target: { value: '5' } });
  fireEvent.change(within(form).getByLabelText('Date received'), {
    target: { value: '2026-05-15' },
  });
  fireEvent.change(within(form).getByLabelText('Amount before tax (USD)'), {
    target: { value: '12.3456' },
  });
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(/exchange rate/)).toBeInTheDocument();
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
  fireEvent.change(within(form).getByLabelText('Exchange rate (KRW per USD)'), {
    target: { value: '1,385.25' },
  });
  fireEvent.change(within(form).getByLabelText('Tax withheld (KRW)'), {
    target: { value: '2000' },
  });
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(requests.some((request) => request.method === 'POST')).toBe(true));
  expect(requests.find((request) => request.method === 'POST')!.body).toEqual({
    assetId: 5,
    kind: 'dividend',
    receivedOn: '2026-05-15',
    taxWithheldKrw: 2000,
    memo: '',
    amountForeign: '12.3456',
    fxRate: '1385.25',
  });
});

test('a won holding sends the amount in won and a future date is refused', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Add dividend or interest' }));
  const form = screen.getByRole('form', { name: 'New dividend or interest' });
  fireEvent.change(within(form).getByLabelText('Holding'), { target: { value: '6' } });
  fireEvent.change(within(form).getByLabelText('Type'), { target: { value: 'interest' } });
  fireEvent.change(within(form).getByLabelText('Date received'), {
    target: { value: '2099-01-01' },
  });
  fireEvent.change(within(form).getByLabelText('Amount before tax (KRW)'), {
    target: { value: '150,000' },
  });
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
  expect(
    await screen.findByText('Income dated after today cannot be recorded'),
  ).toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText('Date received'), {
    target: { value: '2026-01-02' },
  });
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(requests.some((request) => request.method === 'POST')).toBe(true));
  expect(requests.find((request) => request.method === 'POST')!.body).toMatchObject({
    assetId: 6,
    kind: 'interest',
    amountKrw: 150_000,
  });
});

test('deleting a record sends a DELETE', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: /Delete Dividend Apple 2026-05-15/ }));
  await waitFor(() =>
    expect(requests).toContainEqual({
      method: 'DELETE',
      url: '/api/portfolio/income/1',
      body: undefined,
    }),
  );
});
