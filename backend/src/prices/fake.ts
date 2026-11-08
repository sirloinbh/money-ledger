import { addDays, isWeekend } from './dates.js';
import type { KrxMarket, KrxRow, PriceSources, UsTicker } from './sources.js';

// A deterministic stand-in for KRX, Tiingo and Korea Eximbank, for tests and for running the app without API
// keys (PRICE_SOURCE=fake). Weekends have no data, like real market holidays. Prices move with the day of
// the month so a newer close is visibly different.

const day = (date: string) => Number(date.slice(8, 10));

const krx: Record<KrxMarket, { symbol: string; name: string; base: number }[]> = {
  KOSPI: [
    { symbol: '005930', name: '삼성전자', base: 70_000 },
    { symbol: '000660', name: 'SK하이닉스', base: 180_000 },
    { symbol: '035420', name: 'NAVER', base: 200_000 },
  ],
  KOSDAQ: [{ symbol: '247540', name: '에코프로비엠', base: 150_000 }],
  KRX_ETF: [{ symbol: '069500', name: 'KODEX 200', base: 35_000 }],
};

const us: (UsTicker & { name: string; base: number })[] = [
  { symbol: 'AAPL', market: 'NASDAQ', kind: 'stock', name: 'Apple Inc', base: 230 },
  { symbol: 'MSFT', market: 'NASDAQ', kind: 'stock', name: 'Microsoft Corp', base: 420 },
  { symbol: 'BRK-B', market: 'NYSE', kind: 'stock', name: 'Berkshire Hathaway Inc', base: 460 },
  { symbol: 'SPY', market: 'NYSE_ARCA', kind: 'etf', name: 'SPDR S&P 500 ETF Trust', base: 580 },
];

export function fakeSources(): Required<PriceSources> {
  return {
    krx: {
      name: 'FAKE',
      daily(market, date) {
        if (isWeekend(date)) return Promise.resolve([]);
        return Promise.resolve(
          krx[market].map(({ symbol, name, base }): KrxRow => ({
            symbol,
            name,
            close: String(base + day(date) * 100),
          })),
        );
      },
    },
    tiingo: {
      name: 'FAKE',
      tickers: () =>
        Promise.resolve(us.map(({ symbol, market, kind }) => ({ symbol, market, kind }))),
      closes(symbol, start, end) {
        const ticker = us.find((item) => item.symbol === symbol);
        if (!ticker) return Promise.resolve(null);
        const closes = [];
        for (let date = start; date <= end; date = addDays(date, 1)) {
          if (!isWeekend(date)) {
            closes.push({ date, close: (ticker.base + day(date) * 0.25).toFixed(2) });
          }
        }
        return Promise.resolve(closes);
      },
      companyName: (symbol) =>
        Promise.resolve(us.find((item) => item.symbol === symbol)?.name ?? null),
    },
    fx: {
      name: 'FAKE',
      usd: (date) => Promise.resolve(isWeekend(date) ? null : (1380 + day(date) * 0.5).toFixed(2)),
    },
  };
}
