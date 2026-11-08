import { formatDecimal, formatUsd } from './format';

// How a stored daily close from /api/prices reads on screen (#51). Shared by the mock trading screens.

export type Quote = {
  close: string;
  currency: 'KRW' | 'USD';
  tradeDate: string;
  fetchedAt: string | null;
  stale: boolean;
};

/** "2026-11-06" → "11월 6일" */
export function formatMonthDay(date: string) {
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
}

/** The close in its own currency, from the decimal string as is (no floating point). */
export const formatClose = (quote: Quote) =>
  quote.currency === 'KRW' ? `${formatDecimal(quote.close)}원` : formatUsd(quote.close);

/** "11월 6일 종가 기준", or "시세 지연 · 11월 6일 종가 기준" for a close more than 5 days old. */
export const quoteBasis = (quote: Quote) =>
  `${quote.stale ? '시세 지연 · ' : ''}${formatMonthDay(quote.tradeDate)} 종가 기준`;
