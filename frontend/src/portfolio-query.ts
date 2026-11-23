import { apiKey } from './lib/query';
import { useReadsReload } from './query-reads';

// #278 Query keys of the portfolio page. Every portfolio read starts with `portfolioKey`, so a save to an asset, a
// trade, a use or the net worth refreshes the asset list, its totals, the trade and use lists and the net worth
// trend at once (the same shape as `ledgerKey` and `mockKey`).

const portfolioPath = '/api/portfolio';

const portfolioKey = apiKey(portfolioPath);

export const portfolioKeys = {
  assets: () => apiKey(portfolioPath, 'assets'),
  trades: (assetId: number) => apiKey(portfolioPath, 'assets', assetId, 'trades'),
  usages: (assetId: number) => apiKey(portfolioPath, 'assets', assetId, 'usages'),
  /** Every net worth read: the trend and the dashboard card. */
  netWorthAll: () => apiKey(portfolioPath, 'net-worth'),
  /** The saved days of a period; `from` is its first day, or none for the whole history. */
  netWorth: (from?: string) => apiKey(portfolioPath, 'net-worth', from ?? 'all'),
  /** The latest saved day only (the dashboard card). */
  netWorthLatest: () => apiKey(portfolioPath, 'net-worth', 'latest'),
};

/** After a write: every portfolio read loads again and the section's own list is checked (see `useReadsReload`). */
export const usePortfolioReload = () => useReadsReload(portfolioKey);
