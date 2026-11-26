import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { CardDeductionEstimate } from './card-deduction';
import { renderWithQuery } from './test/query';

// #296 The year-end card deduction estimate: spending by payment method, the salary, the threshold.
const spending = { creditCard: 6_000_000, debitCard: 3_000_000, cash: 2_000_000, unknown: 1_500 };
const rules = { thresholdPercent: 25, creditPercent: 15, debitCashPercent: 30 };
let salary: number | null;
let calls: { method: string; url: string; body: unknown }[];

const answer = () => ({
  year: new Date().getFullYear(),
  totalSalary: salary,
  spending,
  estimate:
    salary === null
      ? null
      : {
          threshold: 5_000_000,
          counted: 11_000_000,
          overThreshold: 6_000_000,
          toThreshold: 0,
          deduction: 1_650_000,
          beforeLimit: 1_650_000,
          limit: 3_000_000,
        },
  rules,
});

beforeEach(() => {
  salary = null;
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === 'PUT' && url === '/api/ledger/tax/salary') {
        salary = (JSON.parse(String(init?.body)) as { totalSalary: number }).totalSalary;
      }
      return Promise.resolve(new Response(JSON.stringify(answer())));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

test('shows the spending, leaves out entries without a method, and waits for the salary', async () => {
  renderWithQuery(<CardDeductionEstimate />);
  expect(await screen.findByText('₩6,000,000')).toBeTruthy();
  expect(screen.getByText(/₩1,500 of expenses have no payment method/)).toBeTruthy();
  expect(
    screen.getByText('Enter the total salary to see the threshold and the estimate.'),
  ).toBeTruthy();
});

test('saving the salary shows the threshold and the estimated deduction', async () => {
  renderWithQuery(<CardDeductionEstimate />);
  await screen.findByText('₩6,000,000');
  fireEvent.change(screen.getByLabelText(/Total salary for/), { target: { value: '20,000,000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save salary' }));
  expect(await screen.findByText('₩1,650,000')).toBeTruthy();
  expect(screen.getByText('₩5,000,000')).toBeTruthy();
  const put = calls.find((call) => call.method === 'PUT');
  expect(put?.body).toEqual({ year: new Date().getFullYear(), totalSalary: 20_000_000 });
});

test('a salary that is not a whole number of won is refused before it is sent', async () => {
  renderWithQuery(<CardDeductionEstimate />);
  await screen.findByText('₩6,000,000');
  fireEvent.change(screen.getByLabelText(/Total salary for/), { target: { value: '12.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save salary' }));
  await waitFor(() => expect(screen.getByText(/whole number of won/)).toBeTruthy());
  expect(calls.some((call) => call.method === 'PUT')).toBe(false);
});
