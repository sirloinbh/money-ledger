import { apiKey } from './lib/query';

// #213 Query keys of the Mock trading page. Every mock read starts with `mockKey`, so an order, a new account or a
// reset refreshes the account, its holdings, its return trend and its trade history at once (it replaced the
// order counter the page passed down).

const mockPath = '/api/mock';

export const mockKey = apiKey(mockPath);

export const mockKeys = {
  accounts: () => apiKey(mockPath, 'accounts'),
  holdings: (accountId: number) => apiKey(mockPath, 'accounts', accountId, 'holdings'),
  snapshots: (accountId: number) => apiKey(mockPath, 'accounts', accountId, 'snapshots'),
  /** The first page of the trade history; `path` is its request path with the filters. */
  orders: (accountId: number, path: string) =>
    apiKey(mockPath, 'accounts', accountId, 'orders', path),
};
