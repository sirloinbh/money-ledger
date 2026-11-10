// #41 The trend's rows and its three series, shared by the chart, its tooltip and the table.

export type TrendMonth = { month: string; income: number; expense: number; balance: number };

/** In this order everywhere: legend, tooltip, table columns. Colors are dataviz palette slots 1-3 (index.css). */
export const trendSeries = [
  { key: 'income', label: '수입', color: 'var(--chart-series-1)' },
  { key: 'expense', label: '지출', color: 'var(--chart-series-2)' },
  { key: 'balance', label: '잔액', color: 'var(--chart-series-3)' },
] as const;

/** The periods to choose from, in months up to this month; 12 is the default. */
export const trendPeriods = [6, 12, 24] as const;
export const defaultTrendPeriod = 12;

/** "2026-11" → "2026년 11월" */
export const monthLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;
