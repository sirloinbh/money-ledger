import { addDays } from './dates.js';
import {
  decimalText,
  getOk,
  getOrNotFound,
  readJson,
  SourceError,
  type TiingoSource,
  type UsClose,
  type UsMarket,
  type UsTicker,
} from './sources.js';
import { firstZipEntry } from './zip.js';

// Tiingo End-of-Day API (docs/price-source.md). The key goes in the Authorization header, never the URL.
const api = 'https://api.tiingo.com/tiingo/daily';
const tickersUrl = 'https://apimedia.tiingo.com/docs/tiingo/daily/supported_tickers.zip';
const label = 'Tiingo quote';

const exchanges: Record<string, UsMarket> = {
  NYSE: 'NYSE',
  NASDAQ: 'NASDAQ',
  'NYSE ARCA': 'NYSE_ARCA',
};
const kinds: Record<string, UsTicker['kind']> = { Stock: 'stock', ETF: 'etf' };

/**
 * supported_tickers.csv (ticker,exchange,assetType,priceCurrency,startDate,endDate) → the NYSE, NASDAQ and
 * NYSE ARCA stocks and ETFs still trading. "Still trading" means an endDate within 14 days of the newest
 * endDate in the file, so delisted tickers that stay in the file are left out.
 */
export function parseSupportedTickers(csv: string): UsTicker[] {
  const lines = csv.split(/\r?\n/);
  if (lines[0]?.trim() !== 'ticker,exchange,assetType,priceCurrency,startDate,endDate') {
    throw new SourceError('The Tiingo security list format changed');
  }
  const rows = lines.slice(1).map((line) => line.split(','));
  const newest = rows.reduce((max, row) => (row[5] && row[5] > max ? row[5] : max), '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newest)) return [];
  const since = addDays(newest, -14);
  const tickers = new Map<string, UsTicker>();
  for (const [ticker = '', exchange = '', assetType = '', currency, , endDate = ''] of rows) {
    const market = exchanges[exchange];
    const kind = kinds[assetType];
    const symbol = ticker.trim().toUpperCase();
    if (!market || !kind || currency !== 'USD' || endDate < since) continue;
    if (!/^[0-9A-Z][0-9A-Z.-]{0,15}$/.test(symbol)) continue;
    tickers.set(symbol, { symbol, market, kind });
  }
  return [...tickers.values()];
}

export function parseTiingoCloses(body: unknown): UsClose[] {
  if (!Array.isArray(body)) throw new SourceError(`${label} response format is not valid`);
  const closes: UsClose[] = [];
  for (const item of body as { date?: unknown; close?: unknown }[]) {
    const date = typeof item.date === 'string' ? item.date.slice(0, 10) : '';
    // The unadjusted close, not adjClose (docs/price-source.md).
    const close = decimalText(item.close);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && close !== null) closes.push({ date, close });
  }
  return closes;
}

export function tiingoSource(apiKey: string): TiingoSource {
  const headers = { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' };
  const path = (symbol: string) => `${api}/${encodeURIComponent(symbol.toLowerCase())}`;
  return {
    name: 'Tiingo',
    async tickers() {
      const response = await getOk('Tiingo security list', tickersUrl);
      let csv: string;
      try {
        csv = firstZipEntry(Buffer.from(await response.arrayBuffer())).toString('utf8');
      } catch {
        throw new SourceError('Could not read the Tiingo security list file');
      }
      return parseSupportedTickers(csv);
    },
    async closes(symbol, start, end) {
      const response = await getOrNotFound(
        label,
        `${path(symbol)}/prices?startDate=${start}&endDate=${end}`,
        headers,
      );
      return response ? parseTiingoCloses(await readJson(label, response)) : null;
    },
    async companyName(symbol) {
      const response = await getOrNotFound('Tiingo security info', path(symbol), headers);
      if (!response) return null;
      const body = (await readJson('Tiingo security info', response)) as { name?: unknown } | null;
      const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 200) : '';
      return name || null;
    },
  };
}
