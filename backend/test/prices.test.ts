import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';

import type { Pool } from 'pg';

import { addDays, datesToFetch, latestUsDate, seoulHour } from '../src/prices/dates.js';
import { sourcesFromEnv } from '../src/prices/index.js';
import { koreaEximSource, parseEximUsd } from '../src/prices/koreaexim.js';
import { parseKrxDaily } from '../src/prices/krx.js';
import { SourceError } from '../src/prices/sources.js';
import { parseSupportedTickers, parseTiingoCloses, tiingoSource } from '../src/prices/tiingo.js';
import { firstZipEntry } from '../src/prices/zip.js';
import { withApi } from './helpers.js';

test('dates to fetch start the day after the checked date and stay within the last 10 days', () => {
  assert.deepEqual(datesToFetch('2026-11-05', '2026-11-08'), [
    '2026-11-06',
    '2026-11-07',
    '2026-11-08',
  ]);
  assert.deepEqual(datesToFetch('2026-11-08', '2026-11-08'), []);
  // First run, or a server that was off for weeks: only the last 10 days.
  const first = datesToFetch(null, '2026-11-08');
  assert.equal(first.length, 10);
  assert.equal(first[0], '2026-10-30');
  assert.deepEqual(datesToFetch('2026-09-01', '2026-11-08'), first);
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('the latest US date is the New York date after 18:00 there, whatever daylight saving does', () => {
  // 12:00 in Seoul is 23:00 (EDT) or 22:00 (EST) of the day before in New York.
  assert.equal(latestUsDate(new Date('2026-07-10T03:00:00Z')), '2026-07-09');
  assert.equal(latestUsDate(new Date('2026-11-10T03:00:00Z')), '2026-11-09');
  // 23:30 in Seoul is 09:30 in New York: that day's market is not closed yet.
  assert.equal(latestUsDate(new Date('2026-11-10T14:30:00Z')), '2026-11-09');
  assert.equal(seoulHour(new Date('2026-11-10T03:00:00Z')), 12);
  assert.equal(seoulHour(new Date('2026-11-10T15:00:00Z')), 0);
});

test('KRX rows keep the code, name and whole-won close and drop rows without a trade', () => {
  const rows = parseKrxDaily({
    OutBlock_1: [
      { BAS_DD: '20261106', ISU_CD: '005930', ISU_NM: '삼성전자', TDD_CLSPRC: '71,000' },
      { ISU_SRT_CD: '0001a0', ISU_CD: 'KR70001A0000', ISU_NM: ' 새종목 ', TDD_CLSPRC: '5000' },
      { ISU_CD: '000020', ISU_NM: '거래없음', TDD_CLSPRC: '-' },
      { ISU_CD: '000030', ISU_NM: '영원', TDD_CLSPRC: '0' },
      { ISU_CD: 'BAD', ISU_NM: '코드오류', TDD_CLSPRC: '100' },
    ],
  });
  assert.deepEqual(rows, [
    { symbol: '005930', name: '삼성전자', close: '71000' },
    { symbol: '0001A0', name: '새종목', close: '5000' },
  ]);
  assert.deepEqual(parseKrxDaily({ OutBlock_1: [] }), []);
  assert.throws(() => parseKrxDaily({ error: 'x' }), SourceError);
});

test('the Tiingo list keeps NYSE, NASDAQ and NYSE ARCA stocks and ETFs that still trade', () => {
  const csv = [
    'ticker,exchange,assetType,priceCurrency,startDate,endDate',
    'AAPL,NASDAQ,Stock,USD,1980-12-12,2026-11-06',
    'BRK-B,NYSE,Stock,USD,1996-05-09,2026-11-06',
    'SPY,NYSE ARCA,ETF,USD,1993-01-29,2026-11-05',
    'BRKB,NYSE,Stock,USD,2017-09-08,2017-09-27', // delisted long ago
    'VFIAX,NMFQS,Mutual Fund,USD,2000-01-01,2026-11-06',
    'BABA,PINK,Stock,USD,2000-01-01,2026-11-06',
    '000001,SHE,Stock,CNY,2007-01-04,2026-11-06',
    'QQQ,NASDAQ,ETF,USD,1999-03-10,2026-10-25', // within 14 days of the newest date
    '',
  ].join('\r\n');
  assert.deepEqual(parseSupportedTickers(csv), [
    { symbol: 'AAPL', market: 'NASDAQ', kind: 'stock' },
    { symbol: 'BRK-B', market: 'NYSE', kind: 'stock' },
    { symbol: 'SPY', market: 'NYSE_ARCA', kind: 'etf' },
    { symbol: 'QQQ', market: 'NASDAQ', kind: 'etf' },
  ]);
  assert.throws(() => parseSupportedTickers('symbol,name\nAAPL,Apple'), SourceError);
});

test('Tiingo closes use the unadjusted close on the US trading day', () => {
  assert.deepEqual(
    parseTiingoCloses([
      { date: '2026-11-06T00:00:00.000Z', close: 230.5, adjClose: 229.1 },
      { date: '2026-11-05T00:00:00.000Z', close: null },
    ]),
    [{ date: '2026-11-06', close: '230.5' }],
  );
  assert.throws(() => parseTiingoCloses({ detail: 'Not found' }), SourceError);
});

test('the Eximbank USD rate drops thousands commas; an empty day is null; error codes fail', () => {
  assert.equal(
    parseEximUsd([
      { result: 1, cur_unit: 'JPY(100)', deal_bas_r: '905.1' },
      { result: 1, cur_unit: 'USD', deal_bas_r: '1,385.25' },
    ]),
    '1385.25',
  );
  assert.equal(parseEximUsd([]), null);
  assert.throws(() => parseEximUsd([{ result: 3 }]), /result code 3/);
});

test('the first file of a ZIP archive is read, deflated or stored', () => {
  const content = Buffer.from('ticker,exchange\nAAPL,NASDAQ\n');
  const zip = (method: 0 | 8) => {
    const data = method === 8 ? deflateRawSync(content) : content;
    const name = Buffer.from('supported_tickers.csv');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const centralAt = local.length + name.length + data.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt32LE(centralAt, 16);
    return Buffer.concat([local, name, data, central, name, end]);
  };
  assert.equal(firstZipEntry(zip(8)).toString(), content.toString());
  assert.equal(firstZipEntry(zip(0)).toString(), content.toString());
  assert.throws(() => firstZipEntry(Buffer.from('not a zip file at all, just text here')));
});

test('a source without a key is left out; PRICE_SOURCE=fake uses the fake for all', () => {
  const none = sourcesFromEnv({ KRX_API_KEY: '', TIINGO_API_KEY: '   ' });
  assert.deepEqual(none, { krx: undefined, tiingo: undefined, fx: undefined });
  const some = sourcesFromEnv({ KOREAEXIM_API_KEY: 'k' });
  assert.equal(some.fx?.name, 'KOREAEXIM');
  assert.equal(some.krx, undefined);
  const fake = sourcesFromEnv({ PRICE_SOURCE: 'fake', KRX_API_KEY: 'k' });
  assert.equal(fake.krx?.name, 'FAKE');
});

test('source errors never carry the key or the URL', async (t) => {
  const secret = 'SECRET-KEY-123';
  const seen: { url: string; headers: Record<string, string> }[] = [];
  t.mock.method(globalThis, 'fetch', (url: string, init: { headers: Record<string, string> }) => {
    seen.push({ url: String(url), headers: init.headers });
    return Promise.resolve(new Response('oops', { status: 500 }));
  });
  const fx = koreaEximSource(secret);
  await assert.rejects(fx.usd('2026-11-06'), (error: Error) => {
    assert.ok(error instanceof SourceError);
    assert.ok(!error.message.includes(secret) && !error.message.includes('http'));
    return true;
  });
  const tiingo = tiingoSource(secret);
  await assert.rejects(tiingo.closes('AAPL', '2026-11-01', '2026-11-06'), (error: Error) => {
    assert.ok(!error.message.includes(secret));
    return true;
  });
  // Tiingo takes the key in a header, so it is not in the URL at all.
  assert.ok(!seen[1].url.includes(secret));
  assert.equal(seen[1].headers.Authorization, `Token ${secret}`);
});

const reached = async () => {
  throw new Error('the request should have been rejected before the DB');
};
const noDb = { query: reached, connect: reached } as unknown as Pool;

for (const [query, error] of [
  ['', 'Enter a search term'],
  ['?q=%20%20', 'Enter a search term'],
  [`?q=${'가'.repeat(41)}`, 'The search term must be 40 characters or fewer'],
  ['?q=a&q=b', 'Enter a search term'],
] as const) {
  test(`search "${query.slice(0, 12)}" is a 400 before the DB`, async () => {
    await withApi(noDb, async (call) => {
      const response = await call(`/api/prices/securities${query}`);
      assert.equal(response.status, 400);
      assert.deepEqual(response.data, { error });
    });
  });
}

test('a malformed security id is a 400', async () => {
  await withApi(noDb, async (call) => {
    const response = await call('/api/prices/securities/abc');
    assert.equal(response.status, 400);
    assert.deepEqual(response.data, { error: 'Invalid security ID' });
  });
});
