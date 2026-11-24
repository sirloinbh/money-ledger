import { decimalText } from './sources.js';

// #305 Live price and 10-level order book of a Korean stock from the Korea Investment & Securities (KIS) Open
// API (docs/price-source.md, "Live prices (KIS)"). Called with `fetch`, no package. The app secret and the
// access token live only in memory: they are never stored, logged or put in an error message.

export type Level = { price: string; quantity: string };

/** One reading of a stock: the current price and up to 10 ask levels (lowest first) and bid levels (highest first). */
export type LiveQuote = {
  symbol: string;
  price: string;
  asks: Level[];
  bids: Level[];
  /** When the quote was read, an ISO timestamp. */
  readAt: string;
};

export type KisSource = {
  readonly name: string;
  quote(symbol: string): Promise<LiveQuote>;
};

export type KisErrorCode = 'bad_key' | 'rate_limit' | 'market_closed' | 'unavailable';

/** A failed KIS call. The message is plain text and never holds a key, a token or the request URL. */
export class KisError extends Error {
  readonly code: KisErrorCode;

  constructor(code: KisErrorCode, message: string) {
    super(message);
    this.name = 'KisError';
    this.code = code;
  }
}

const baseUrl = 'https://openapi.koreainvestment.com:9443';
const levels = 10;
// The token is renewed this long before it expires, so a call never carries a token about to run out.
const renewBeforeMs = 5 * 60_000;
const timeoutMs = 10_000;

type Body = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** A whole-won price level, or null for the 0 KIS sends for an empty level. */
function whole(value: unknown) {
  const plain = decimalText(value);
  return plain !== null && /^\d{1,12}$/.test(plain) ? plain : null;
}

function readLevels(output: Body, priceKey: string, quantityKey: string): Level[] {
  const result: Level[] = [];
  for (let i = 1; i <= levels; i += 1) {
    const price = whole(output[`${priceKey}${i}`]);
    if (price === null) continue;
    const quantity = /^\d{1,12}$/.test(text(output[`${quantityKey}${i}`]).trim())
      ? text(output[`${quantityKey}${i}`]).trim()
      : '0';
    result.push({ price, quantity });
  }
  return result;
}

/**
 * Builds a quote from a recorded inquire-price answer and an order book answer. Both sides empty means the market
 * is closed (KIS answers 0 for every level outside trading hours).
 */
export function parseQuote(
  symbol: string,
  priceBody: unknown,
  bookBody: unknown,
  readAt: Date,
): LiveQuote {
  const price = whole(((priceBody as Body | null)?.output as Body | undefined)?.stck_prpr);
  const output = (bookBody as Body | null)?.output1 as Body | undefined;
  if (price === null || !output || typeof output !== 'object') {
    throw new KisError('unavailable', 'The KIS answer is not in the expected format');
  }
  const asks = readLevels(output, 'askp', 'askp_rsqn');
  const bids = readLevels(output, 'bidp', 'bidp_rsqn');
  if (asks.length === 0 && bids.length === 0) {
    throw new KisError('market_closed', 'The market is closed, so there is no order book');
  }
  return { symbol, price, asks, bids, readAt: readAt.toISOString() };
}

/** Maps an error answer (rt_cd other than "0") or an HTTP failure to a KisError. */
function errorOf(status: number, body: unknown): KisError {
  const code = text((body as Body | null)?.msg_cd);
  // EGW00201: calls per second exceeded. EGW00103/00105: app key or secret not valid. EGW00121/00122: bad
  // token request. Anything else is a failure worth retrying later.
  if (status === 429 || code === 'EGW00201') {
    return new KisError('rate_limit', 'KIS says too many requests, try again in a moment');
  }
  if (['EGW00103', 'EGW00105', 'EGW00121', 'EGW00122'].includes(code) || status === 401) {
    return new KisError('bad_key', 'KIS rejected the app key or secret');
  }
  return new KisError('unavailable', `KIS request failed (HTTP ${status})`);
}

type Options = {
  appKey: string;
  appSecret: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  now?: () => Date;
};

type Token = { value: string; expiresAt: number };

export function kisSource(options: Options): KisSource {
  const root = options.baseUrl ?? baseUrl;
  const send = options.fetchFn ?? fetch;
  const now = options.now ?? (() => new Date());
  let token: Token | undefined;
  let issuing: Promise<Token> | undefined;

  async function call(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await send(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new KisError('unavailable', 'Could not connect to KIS');
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // An unreadable body is handled by the caller through the status.
    }
    return { status: response.status, body };
  }

  async function issue(): Promise<Token> {
    const { status, body } = await call(`${root}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: options.appKey,
        appsecret: options.appSecret,
      }),
    });
    const data = (body ?? {}) as Body;
    const value = text(data.access_token);
    const seconds = Number(data.expires_in);
    if (status !== 200 || !value || !Number.isFinite(seconds)) throw errorOf(status, body);
    return { value, expiresAt: now().getTime() + seconds * 1000 };
  }

  /** The cached token, or one new token: callers arriving together wait for the same request. */
  async function accessToken(): Promise<string> {
    if (token && token.expiresAt - renewBeforeMs > now().getTime()) return token.value;
    issuing ??= issue()
      .then((fresh) => {
        token = fresh;
        return fresh;
      })
      .finally(() => {
        issuing = undefined;
      });
    return (await issuing).value;
  }

  async function get(path: string, trId: string, symbol: string, retry = true): Promise<Body> {
    const query = new URLSearchParams({ FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: symbol });
    const { status, body } = await call(`${root}${path}?${query.toString()}`, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${await accessToken()}`,
        appkey: options.appKey,
        appsecret: options.appSecret,
        tr_id: trId,
        custtype: 'P',
      },
    });
    const data = (body ?? {}) as Body;
    // EGW00123: the token expired early. Drop it and ask once more with a new one.
    if (text(data.msg_cd) === 'EGW00123' && retry) {
      token = undefined;
      return get(path, trId, symbol, false);
    }
    if (status !== 200 || text(data.rt_cd) !== '0') throw errorOf(status, body);
    return data;
  }

  return {
    name: 'KIS',
    async quote(symbol) {
      const price = await get(
        '/uapi/domestic-stock/v1/quotations/inquire-price',
        'FHKST01010100',
        symbol,
      );
      const book = await get(
        '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn',
        'FHKST01010200',
        symbol,
      );
      return parseQuote(symbol, price, book, now());
    },
  };
}

/** The real source when KIS_APP_KEY and KIS_APP_SECRET are both set, otherwise undefined (no live prices). */
export function kisFromEnv(env: NodeJS.ProcessEnv = process.env): KisSource | undefined {
  const appKey = env.KIS_APP_KEY?.trim();
  const appSecret = env.KIS_APP_SECRET?.trim();
  return appKey && appSecret ? kisSource({ appKey, appSecret }) : undefined;
}
