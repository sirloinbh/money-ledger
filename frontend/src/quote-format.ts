import { formatDecimal, formatUsd } from './format';
const monthAbbreviations = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// How a stored daily close from /api/prices reads on screen (#51). Shared by the mock trading screens.

export type Quote = {
  close: string;
  currency: 'KRW' | 'USD';
  tradeDate: string;
  fetchedAt: string | null;
  stale: boolean;
};

/** "2026-11-06" → "Nov 6" */
export function formatMonthDay(date: string) {
  return `${monthAbbreviations[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
}

/** A price in its own currency, from the decimal string as is (no floating point). */
export const formatPrice = (price: string, currency: 'KRW' | 'USD') =>
  currency === 'KRW' ? `₩${formatDecimal(price)}` : formatUsd(price);

/** The close in its own currency. */
export const formatClose = (quote: Quote) => formatPrice(quote.close, quote.currency);

/** "Nov 6 close", or "Delayed · Nov 6 close" for a close more than 5 days old. */
export const quoteBasis = (quote: Quote) =>
  `${quote.stale ? 'Delayed · ' : ''}${formatMonthDay(quote.tradeDate)} close`;

export const marketNames: Record<string, string> = {
  KOSPI: 'KOSPI',
  KOSDAQ: 'KOSDAQ',
  KRX_ETF: 'Korea ETF',
  NYSE: 'NYSE',
  NASDAQ: 'NASDAQ',
  NYSE_ARCA: 'NYSE Arca',
};

/** "Samsung Electronics · 005930 · KOSPI" (#47). A US security without a saved name shows its ticker only. */
export const securityText = (security: { name: string | null; symbol: string; market: string }) =>
  [security.name, security.symbol, marketNames[security.market] ?? security.market]
    .filter(Boolean)
    .join(' · ');
