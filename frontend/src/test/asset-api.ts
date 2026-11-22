import { vi } from 'vitest';

import type { Trade, TradesAnswer } from '../asset-trades';
import type { Asset, AssetsAnswer } from '../assets';
import { unexpectedRequest } from './unexpected';

// #183 One fake asset server for the asset screen tests (assets, trades). Its answers are typed against the
// screens' own response types, so a field the screen reads cannot go missing from the fake unnoticed, and any
// request it does not serve fails the test.

/** What a test stores: the fields a person enters. The fake works out the rest of `Asset`. */
export type StoredAsset = Pick<
  Asset,
  'id' | 'name' | 'type' | 'currency' | 'quantity' | 'valueKrw' | 'valueForeign' | 'memo'
> & { depreciation?: Asset['depreciation']; hasTrades?: boolean };

type Sent = { method: string; url: string; body: unknown };

export type AssetFake = {
  stored: StoredAsset[];
  trades: Record<number, Trade[]>;
  requests: Sent[];
};

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status }),
  );

/**
 * The asset as the server sends it: no link, no price, and no rate (#47). The server works out a depreciated
 * value from the date; the fake says it is half the purchase price.
 */
export const assetView = (asset: StoredAsset): Asset => ({
  ...asset,
  depreciation: asset.depreciation ?? null,
  prepaid: null,
  hasTrades: asset.hasTrades ?? false,
  security: null,
  manualPrice: null,
  price: null,
  fx: null,
  currentValueKrw: asset.depreciation ? asset.depreciation.purchasePriceKrw / 2 : asset.valueKrw,
  currentValueForeign: asset.valueForeign,
  valueIssue: null,
  costKrw: null,
  profitKrw: null,
  returnPercent: null,
});

/** The list answer: totals the way the server adds them (current won values only, debts apart). */
export function assetsAnswer(stored: StoredAsset[]): AssetsAnswer {
  const assets = stored.map(assetView);
  const sum = (debt: boolean) =>
    assets
      .filter((asset) => (asset.type === 'debt') === debt)
      .reduce((total, asset) => total + (asset.currentValueKrw ?? 0), 0);
  return {
    assets,
    totals: {
      assetsKrw: sum(false),
      debtsKrw: sum(true),
      netKrw: sum(false) - sum(true),
      uncounted: assets.filter((asset) => asset.currentValueKrw === null).length,
    },
    // The allocation card has its own tests (asset-allocation.test.tsx); here it has nothing to spread.
    allocation: { excluded: 0, byType: [], byAsset: [], chart: [] },
  };
}

// The position numbers come from the server; the fake returns fixed ones.
const position: TradesAnswer['position'] = {
  quantity: '15.00000000',
  averagePrice: '1161.4667',
  costKrw: 17422,
  realizedKrw: 1602,
};

function tradeApi(fake: AssetFake, method: string, assetId: number, tradeId: number | undefined) {
  const list = (fake.trades[assetId] ??= []);
  if (method === 'GET' && tradeId === undefined) {
    return json({ trades: list, position } satisfies TradesAnswer);
  }
  if (method === 'DELETE' && tradeId !== undefined) {
    fake.trades[assetId] = list.filter((trade) => trade.id !== tradeId);
    return json(undefined, 204);
  }
  const saving =
    (method === 'POST' && tradeId === undefined) || (method === 'PUT' && tradeId !== undefined);
  if (!saving) return undefined;
  const body = fake.requests.at(-1)!.body as Omit<Trade, 'id' | 'currency' | 'amountKrw'>;
  if (body.side === 'sell' && body.quantity === '100') {
    return json(
      { error: '2026-01-10 sell quantity is more than the quantity held then (15)' },
      400,
    );
  }
  const saved: Trade = {
    ...body,
    id: tradeId ?? 100 + list.length,
    currency: fake.stored.find((asset) => asset.id === assetId)!.currency,
    amountKrw: 7500,
    quantityAfter: '15.00000000',
    realizedKrw: body.side === 'sell' ? 1602 : null,
  };
  fake.trades[assetId] =
    tradeId !== undefined
      ? list.map((trade) => (trade.id === saved.id ? saved : trade))
      : [saved, ...list];
  // The first trade replaces a hand-entered quantity (the fake says the total is 2).
  fake.stored = fake.stored.map((asset) =>
    asset.id === assetId
      ? { ...asset, hasTrades: true, quantity: asset.hasTrades ? asset.quantity : '2.00000000' }
      : asset,
  );
  return json({ trade: saved }, tradeId !== undefined ? 200 : 201);
}

function assetApi(fake: AssetFake, method: string, id: number | undefined) {
  const body = fake.requests.at(-1)!.body as Omit<StoredAsset, 'id'>;
  if (id === undefined) {
    if (method === 'GET') return json(assetsAnswer(fake.stored));
    if (method !== 'POST') return undefined;
    const saved = { ...body, id: fake.stored.length + 10 };
    fake.stored = [...fake.stored, saved];
    return json({ asset: assetView(saved) }, 201);
  }
  if (method === 'DELETE') {
    fake.stored = fake.stored.filter((asset) => asset.id !== id);
    return json(undefined, 204);
  }
  if (method !== 'PUT') return undefined;
  const before = fake.stored.find((asset) => asset.id === id);
  const saved = { ...body, id, hasTrades: before?.hasTrades };
  fake.stored = fake.stored.map((asset) => (asset.id === id ? saved : asset));
  return json({ asset: assetView(saved) });
}

/** Stubs `fetch` with the fake asset server, starting from `start`. Tests read and change the returned state. */
export function fakeAssetApi(start: Partial<Omit<AssetFake, 'requests'>>): AssetFake {
  const fake: AssetFake = { stored: [], trades: {}, ...start, requests: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      fake.requests.push({ method, url, body });
      const match = /^\/api\/portfolio\/assets(?:\/(\d+)(\/trades(?:\/(\d+))?)?)?$/.exec(url);
      const [, assetId, trades, tradeId] = match ?? [];
      const answer = !match
        ? undefined
        : trades
          ? tradeApi(fake, method, Number(assetId), tradeId ? Number(tradeId) : undefined)
          : assetApi(fake, method, assetId ? Number(assetId) : undefined);
      return answer ?? unexpectedRequest(method, url);
    }),
  );
  return fake;
}
