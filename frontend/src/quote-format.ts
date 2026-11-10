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

/** A price in its own currency, from the decimal string as is (no floating point). */
export const formatPrice = (price: string, currency: 'KRW' | 'USD') =>
  currency === 'KRW' ? `${formatDecimal(price)}원` : formatUsd(price);

/** The close in its own currency. */
export const formatClose = (quote: Quote) => formatPrice(quote.close, quote.currency);

/** "11월 6일 종가 기준", or "시세 지연 · 11월 6일 종가 기준" for a close more than 5 days old. */
export const quoteBasis = (quote: Quote) =>
  `${quote.stale ? '시세 지연 · ' : ''}${formatMonthDay(quote.tradeDate)} 종가 기준`;

export const marketNames: Record<string, string> = {
  KOSPI: '유가증권',
  KOSDAQ: '코스닥',
  KRX_ETF: '국내 ETF',
  NYSE: 'NYSE',
  NASDAQ: 'NASDAQ',
  NYSE_ARCA: 'NYSE Arca',
};

/** "삼성전자 · 005930 · 유가증권" (#47). A US security without a saved name shows its ticker only. */
export const securityText = (security: { name: string | null; symbol: string; market: string }) =>
  [security.name, security.symbol, marketNames[security.market] ?? security.market]
    .filter(Boolean)
    .join(' · ');
