import { ledgerKeys, usePagedRead } from './ledger-query';

// #359 Income, expense and balance of each day or week of a range (GET /api/ledger/periods). They reload with
// every ledger change (`ledgerKey`, #213).

export type PeriodRow = {
  start: string;
  end: string;
  income: number;
  expense: number;
  balance: number;
};
type Periods = { unit: 'day' | 'week'; periods: PeriodRow[] };

export function usePeriods(from: string, unit: 'day' | 'week', count: number) {
  const { query, data, failed } = usePagedRead<Periods>(
    ledgerKeys.periods(from, unit, count),
    `/api/ledger/periods?from=${from}&unit=${unit}&count=${count}`,
  );
  return { query, rows: data?.periods, failed };
}

export const sumRows = (rows: PeriodRow[]) =>
  rows.reduce(
    (total, row) => ({
      income: total.income + row.income,
      expense: total.expense + row.expense,
      balance: total.balance + row.balance,
    }),
    { income: 0, expense: 0, balance: 0 },
  );
