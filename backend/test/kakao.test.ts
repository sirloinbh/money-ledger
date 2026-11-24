import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loginUrl } from '../src/kakao/api.js';
import { decrypt, encrypt } from '../src/kakao/crypto.js';
import {
  accountSummaryMessage,
  formatPct,
  formatWon,
  newsReasonMessage,
  positionsMessage,
} from '../src/kakao/messages.js';

const key = '0'.repeat(63) + '1';

test('tokens round-trip through AES-GCM and the stored text hides the token', () => {
  const stored = encrypt('secret-token', key);
  assert.ok(!stored.includes('secret-token'));
  assert.equal(decrypt(stored, key), 'secret-token');
  assert.notEqual(encrypt('secret-token', key), stored, 'a fresh IV each time');
  assert.throws(() => decrypt(stored, '1'.repeat(64)));
  assert.throws(() => encrypt('x', 'short'), /32 bytes/);
});

test('the login URL asks for talk_message and carries the state', () => {
  const url = new URL(
    loginUrl(
      { restApiKey: 'rest', clientSecret: undefined, redirectUri: 'https://x/cb', tokenKey: key },
      's1',
    ),
  );
  assert.equal(url.searchParams.get('scope'), 'talk_message');
  assert.equal(url.searchParams.get('state'), 's1');
  assert.equal(url.searchParams.get('client_id'), 'rest');
});

test('amounts and percents are formatted from values without float math', () => {
  assert.equal(formatWon(10_000_000), '₩10,000,000');
  assert.equal(formatWon(-11_024), '-₩11,024');
  assert.equal(formatPct('13.31'), '+13.31%');
  assert.equal(formatPct('-1.72'), '-1.72%');
  assert.equal(formatPct('0.00'), '0.00%');
});

test('the account summary lists capital, cash, total value and return', () => {
  const message = accountSummaryMessage(
    {
      capitalKrw: 10_000_000,
      cashKrw: 1_200_000,
      totalValueKrw: 10_940_000,
      profitKrw: 940_000,
      returnPct: '9.40',
    },
    'https://app',
  );
  assert.equal(message.object_type, 'text');
  assert.equal(
    message.text,
    'Mock account summary\nCapital: ₩10,000,000\nCash: ₩1,200,000\nTotal value: ₩10,940,000\nReturn: +9.40% (₩940,000)',
  );
});

test('positions show the strategy, or that it is not chosen yet, and handle none', () => {
  const message = positionsMessage(
    [
      {
        name: 'Samsung Electronics',
        symbol: '005930',
        quantity: '10.00000000',
        strategy: 'day',
        returnPct: '1.50',
      },
      {
        name: 'SK hynix',
        symbol: '000660',
        quantity: '2.50000000',
        strategy: null,
        returnPct: '-0.40',
      },
    ],
    'https://app',
  );
  assert.match(String(message.text), /Samsung Electronics \(005930\) 10 sh, day trade, \+1\.50%/);
  assert.match(String(message.text), /SK hynix \(000660\) 2\.5 sh, strategy not chosen, -0\.40%/);
  assert.match(String(positionsMessage([], 'https://app').text), /No open positions/);
});

test('a long news message is cut to Kakao’s 200 characters', () => {
  const message = newsReasonMessage(
    {
      headline: 'h'.repeat(120),
      effect: 'e'.repeat(120),
      stockName: 'A',
      symbol: '1',
      reason: 'r',
    },
    'https://app',
  );
  assert.equal(String(message.text).length, 200);
  assert.ok(String(message.text).endsWith('…'));
});

test('truncation never splits an emoji in half', () => {
  const message = newsReasonMessage(
    { headline: '📈'.repeat(250), effect: 'e', stockName: 'A', symbol: '1', reason: 'r' },
    'https://app',
  );
  const text = String(message.text);
  assert.equal(Array.from(text).length, 200);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(text), 'no lone surrogate');
});
