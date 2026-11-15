// #51 Shared price sources (docs/price-source.md, #36). Each source is optional: a source without an API key
// is left out and the fetch skips it. Real sources live in krx.ts, tiingo.ts and koreaexim.ts; fake.ts is a
// deterministic stand-in for tests and local checks without keys.

export const krxMarkets = ['KOSPI', 'KOSDAQ', 'KRX_ETF'] as const;
export type KrxMarket = (typeof krxMarkets)[number];
export type UsMarket = 'NYSE' | 'NASDAQ' | 'NYSE_ARCA';

/** One row of a KRX market's daily trading data. `close` is a whole-won decimal string. */
export type KrxRow = { symbol: string; name: string; close: string };

/** A US ticker from the Tiingo supported-tickers file (no names in that file). */
export type UsTicker = { symbol: string; market: UsMarket; kind: 'stock' | 'etf' };

/** A US daily close: `date` is the US trading day, `close` an unadjusted decimal string. */
export type UsClose = { date: string; close: string };

export type KrxSource = {
  readonly name: string;
  /** Every security of the market on `date`, or [] when the market was closed or has no data yet. */
  daily(market: KrxMarket, date: string): Promise<KrxRow[]>;
};

export type TiingoSource = {
  readonly name: string;
  /** Active NYSE, NASDAQ and NYSE ARCA stocks and ETFs. Not an API call: the limit does not count it. */
  tickers(): Promise<UsTicker[]>;
  /** Closes from `start` to `end`, or null when Tiingo does not know the ticker. One API call. */
  closes(symbol: string, start: string, end: string): Promise<UsClose[] | null>;
  /** The company or fund name, or null when Tiingo does not know the ticker. One API call. */
  companyName(symbol: string): Promise<string | null>;
};

export type FxSource = {
  readonly name: string;
  /** Won per 1 USD published for `date`, or null on a non-business day or before it is published. */
  usd(date: string): Promise<string | null>;
};

export type PriceSources = { krx?: KrxSource; tiingo?: TiingoSource; fx?: FxSource };

/**
 * A failed request worth retrying: HTTP error, timeout or unreadable response. The message is plain text and
 * never contains the request URL or a key, so it can be logged and stored as is.
 */
export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceError';
  }
}

/**
 * GET with a timeout. Every failure becomes a SourceError naming only `label` and the HTTP status: fetch's
 * own errors can carry the URL, and some sources need the key in the URL.
 */
export async function getOrNotFound(
  label: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<Response | null> {
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new SourceError(`Could not connect to ${label}`);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new SourceError(`${label} response error (HTTP ${response.status})`);
  return response;
}

/** Like getOrNotFound, but a 404 is an error too. */
export async function getOk(label: string, url: string, headers: Record<string, string> = {}) {
  const response = await getOrNotFound(label, url, headers);
  if (!response) throw new SourceError(`${label} response error (HTTP 404)`);
  return response;
}

export async function readJson(label: string, response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SourceError(`Could not read the ${label} response`);
  }
}

/** "71,000" or "1,385.25" → "71000" / "1385.25"; null for anything that is not a positive decimal. */
export function decimalText(value: unknown) {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  const plain = text.trim().replaceAll(',', '');
  return /^\d{1,16}(\.\d{1,8})?$/.test(plain) && Number(plain) > 0 ? plain : null;
}

/** YYYY-MM-DD → YYYYMMDD, the date format KRX and Korea Eximbank take. */
export const compactDate = (date: string) => date.replaceAll('-', '');
