import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { KisError, kisSource, parseQuote } from '../src/prices/kis.js';
import { fakeKis } from '../src/prices/kis-fake.js';
import { withApi } from './helpers.js';

const book = (ask: string, bid: string) => ({
  rt_cd: '0',
  output1: {
    askp1: ask,
    askp2: '71200',
    askp_rsqn1: '500',
    bidp1: bid,
    bidp2: '70900',
    bidp_rsqn1: '300',
  },
});
const price = { rt_cd: '0', output: { stck_prpr: '71,000' } };

type Call = { url: string; headers: Record<string, string> };

/** A scripted KIS: answers by path and counts token requests. */
function script(
  overrides: { token?: () => unknown; quote?: () => { status: number; body: unknown } } = {},
) {
  const calls: Call[] = [];
  let tokens = 0;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url.endsWith('/oauth2/tokenP')) {
      tokens += 1;
      await Promise.resolve();
      return reply(200, overrides.token?.() ?? { access_token: `t${tokens}`, expires_in: 86400 });
    }
    if (overrides.quote) {
      const { status, body } = overrides.quote();
      return reply(status, body);
    }
    return reply(200, url.includes('inquire-price') ? price : book('71100', '71000'));
  }) as typeof fetch;
  return { fetchFn, calls, tokens: () => tokens };
}

test('parses the price and both sides of the book with whole-won strings', () => {
  const quote = parseQuote(
    '005930',
    price,
    book('71100', '71000'),
    new Date('2026-11-24T01:00:00Z'),
  );
  assert.equal(quote.price, '71000');
  assert.deepEqual(quote.asks, [
    { price: '71100', quantity: '500' },
    { price: '71200', quantity: '0' },
  ]);
  assert.deepEqual(quote.bids[0], { price: '71000', quantity: '300' });
  assert.equal(quote.readAt, '2026-11-24T01:00:00.000Z');
});

test('an empty book is market closed and a broken answer is unavailable', () => {
  assert.throws(
    () =>
      parseQuote('005930', price, { rt_cd: '0', output1: { askp1: '0', bidp1: '0' } }, new Date()),
    (error: unknown) => error instanceof KisError && error.code === 'market_closed',
  );
  assert.throws(
    () => parseQuote('005930', {}, {}, new Date()),
    (error: unknown) => error instanceof KisError && error.code === 'unavailable',
  );
});

test('caches the token, renews it before it expires, and shares one request', async () => {
  const kis = script();
  let clock = new Date('2026-11-24T00:00:00Z').getTime();
  const source = kisSource({
    appKey: 'k',
    appSecret: 's',
    fetchFn: kis.fetchFn,
    now: () => new Date(clock),
  });
  // Two quotes started together ask for one token.
  await Promise.all([source.quote('005930'), source.quote('005930')]);
  assert.equal(kis.tokens(), 1);
  await source.quote('005930');
  assert.equal(kis.tokens(), 1);
  // 4 minutes before expiry the token is renewed.
  clock += (86400 - 240) * 1000;
  await source.quote('005930');
  assert.equal(kis.tokens(), 2);
  const last = kis.calls.at(-1)!;
  assert.equal(last.headers.authorization, 'Bearer t2');
  assert.equal(last.headers.tr_id, 'FHKST01010200');
});

test('an expired token is replaced once', async () => {
  let first = true;
  const kis = script({
    quote: () => {
      if (first) {
        first = false;
        return { status: 500, body: { rt_cd: '1', msg_cd: 'EGW00123' } };
      }
      return { status: 200, body: { ...price, ...book('71100', '71000') } };
    },
  });
  const source = kisSource({ appKey: 'k', appSecret: 's', fetchFn: kis.fetchFn });
  const quote = await source.quote('005930');
  assert.equal(quote.price, '71000');
  assert.equal(kis.tokens(), 2);
});

test('maps a bad key, a rate limit and a server failure without leaking the secret', async () => {
  for (const [status, msg, code] of [
    [200, 'EGW00201', 'rate_limit'],
    [429, '', 'rate_limit'],
    [403, 'EGW00103', 'bad_key'],
    [500, '', 'unavailable'],
  ] as const) {
    const kis = script({ quote: () => ({ status, body: { rt_cd: '1', msg_cd: msg } }) });
    const source = kisSource({ appKey: 'k', appSecret: 'TOPSECRET', fetchFn: kis.fetchFn });
    await assert.rejects(source.quote('005930'), (error: unknown) => {
      assert.ok(error instanceof KisError);
      assert.equal(error.code, code);
      assert.ok(!error.message.includes('TOPSECRET'));
      return true;
    });
  }
  // A bad key at the token request is reported as a bad key.
  const badToken = script({ token: () => ({ msg_cd: 'EGW00105' }) });
  const stub = (async (input: string | URL | Request, init?: RequestInit) => {
    const response = await badToken.fetchFn(input, init);
    return new Response(await response.text(), { status: 403 });
  }) as typeof fetch;
  await assert.rejects(
    kisSource({ appKey: 'k', appSecret: 's', fetchFn: stub }).quote('005930'),
    (error: unknown) => error instanceof KisError && error.code === 'bad_key',
  );
});

test('the fake has a spread of one tick and a closed symbol', async () => {
  const quote = await fakeKis().quote('005930');
  assert.equal(quote.asks.length, 10);
  assert.ok(Number(quote.asks[0].price) > Number(quote.bids[0].price));
  await assert.rejects(
    fakeKis().quote('999999'),
    (error: unknown) => error instanceof KisError && error.code === 'market_closed',
  );
});

const pool = (rows: unknown[]) => ({ query: () => Promise.resolve({ rows }) }) as unknown as Pool;
const security = (currency: string, active: boolean, symbol = '005930') =>
  pool([{ symbol, active, currency }]);

test('the quote route answers 503 without a source and maps KIS errors', async () => {
  await withApi(security('KRW', true), async (call) => {
    assert.equal((await call('/api/mock/quotes/1')).status, 503);
  });
  await withApi(
    security('KRW', true),
    async (call) => {
      const ok = await call('/api/mock/quotes/1');
      assert.equal(ok.status, 200);
      assert.equal(ok.data.securityId, 1);
      assert.equal((await call('/api/mock/quotes/x')).status, 400);
    },
    { kis: fakeKis() },
  );
  await withApi(
    security('KRW', true, '999999'),
    async (call) => assert.equal((await call('/api/mock/quotes/1')).status, 409),
    { kis: fakeKis() },
  );
  await withApi(
    security('USD', true),
    async (call) => assert.equal((await call('/api/mock/quotes/1')).status, 409),
    { kis: fakeKis() },
  );
  await withApi(
    security('KRW', false),
    async (call) => assert.equal((await call('/api/mock/quotes/1')).status, 409),
    { kis: fakeKis() },
  );
  await withApi(
    pool([]),
    async (call) => assert.equal((await call('/api/mock/quotes/1')).status, 404),
    { kis: fakeKis() },
  );
});

test('lastPrice makes one call to the current-price endpoint and needs no order book', async () => {
  const kis = script({
    quote: () => ({ status: 200, body: price }),
  });
  const source = kisSource({
    appKey: 'k',
    appSecret: 's',
    fetchFn: kis.fetchFn,
    now: () => new Date('2026-11-24T10:10:00Z'),
  });
  const last = await source.lastPrice('005930');
  assert.deepEqual(last, { symbol: '005930', price: '71000', readAt: '2026-11-24T10:10:00.000Z' });
  const priceCalls = kis.calls.filter((call) => !call.url.endsWith('/oauth2/tokenP'));
  assert.equal(priceCalls.length, 1);
  assert.ok(priceCalls[0].url.includes('/inquire-price?'));
  assert.equal(priceCalls[0].headers.tr_id, 'FHKST01010100');
  // The same answer is not a quote: there is no order book, so quote() reports the market as closed or broken.
  await assert.rejects(source.quote('005930'), (error: unknown) => error instanceof KisError);
});

test('lastPrice maps errors like quote and rejects an answer without a price', async () => {
  for (const [status, msg, code] of [
    [200, 'EGW00201', 'rate_limit'],
    [403, 'EGW00103', 'bad_key'],
    [500, '', 'unavailable'],
  ] as const) {
    const kis = script({ quote: () => ({ status, body: { rt_cd: '1', msg_cd: msg } }) });
    const source = kisSource({ appKey: 'k', appSecret: 'TOPSECRET', fetchFn: kis.fetchFn });
    await assert.rejects(source.lastPrice('005930'), (error: unknown) => {
      assert.ok(error instanceof KisError);
      assert.equal(error.code, code);
      assert.ok(!error.message.includes('TOPSECRET'));
      return true;
    });
  }
  const noPrice = script({ quote: () => ({ status: 200, body: { rt_cd: '0', output: {} } }) });
  await assert.rejects(
    kisSource({ appKey: 'k', appSecret: 's', fetchFn: noPrice.fetchFn }).lastPrice('005930'),
    (error: unknown) => error instanceof KisError && error.code === 'unavailable',
  );
});

test('the fake answers a last price also for the always-closed symbol', async () => {
  const fake = fakeKis(() => new Date('2026-11-24T10:10:00Z'));
  assert.deepEqual(await fake.lastPrice('005930'), {
    symbol: '005930',
    price: '70000',
    readAt: '2026-11-24T10:10:00.000Z',
  });
  assert.equal((await fake.lastPrice('999999')).price, '10000');
});
