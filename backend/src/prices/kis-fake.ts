import { KisError, type KisSource, type Level } from './kis.js';

// #305 A deterministic stand-in for KIS, for tests and for running without keys (PRICE_SOURCE=fake). The base
// prices match prices/fake.ts. The spread is one tick, so the best ask is always above the best bid, and the
// symbol 999999 is always "market closed" so that error path can be checked in a browser.

const base: Record<string, number> = {
  '005930': 70_000,
  '000660': 180_000,
  '035420': 200_000,
  '247540': 150_000,
  '069500': 35_000,
};

/** The Korean tick size for stocks (2023 rules), enough for the fake's prices. */
function tick(price: number) {
  if (price < 2_000) return 1;
  if (price < 5_000) return 5;
  if (price < 20_000) return 10;
  if (price < 50_000) return 50;
  if (price < 200_000) return 100;
  if (price < 500_000) return 500;
  return 1_000;
}

export function fakeKis(now: () => Date = () => new Date()): KisSource {
  return {
    name: 'FAKE',
    // Works for every symbol, also the always-closed 999999: a last price needs no order book.
    lastPrice: (symbol) =>
      Promise.resolve({
        symbol,
        price: String(base[symbol] ?? 10_000),
        readAt: now().toISOString(),
      }),
    quote(symbol) {
      if (symbol === '999999') {
        return Promise.reject(
          new KisError('market_closed', 'The market is closed, so there is no order book'),
        );
      }
      const price = base[symbol] ?? 10_000;
      const step = tick(price);
      const asks: Level[] = [];
      const bids: Level[] = [];
      for (let i = 0; i < 10; i += 1) {
        asks.push({ price: String(price + step * (i + 1)), quantity: String(100 + i * 50) });
        bids.push({ price: String(price - step * i), quantity: String(120 + i * 40) });
      }
      return Promise.resolve({
        symbol,
        price: String(price),
        asks,
        bids,
        readAt: now().toISOString(),
      });
    },
  };
}
