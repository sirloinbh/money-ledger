import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KakaoApiError, KakaoRevokedError } from '../src/kakao/api.js';
import { fakeMessenger } from '../src/kakao/fake.js';
import {
  dailySummaryMessage,
  dayTradeSoldMessage,
  longHoldQuestionMessage,
  pickBoughtMessages,
} from '../src/kakao/messages.js';
import { createNotifier, type KakaoEvent } from '../src/kakao/notifier.js';

const news = {
  headline: 'Chip demand jumps',
  effect: 'Exports rise',
  stockName: 'Samsung Electronics',
  symbol: '005930',
  reason: 'Largest memory maker',
};
const events: Record<KakaoEvent['type'], KakaoEvent> = {
  'pick-bought': {
    type: 'pick-bought',
    news,
    stockName: 'Samsung Electronics',
    symbol: '005930',
    quantity: '12.00000000',
    priceKrw: 80_000,
    amountKrw: 960_144,
  },
  'day-trade-sold': {
    type: 'day-trade-sold',
    reason: 'take-profit',
    stockName: 'Samsung Electronics',
    symbol: '005930',
    quantity: '12.00000000',
    priceKrw: 84_000,
    netGainKrw: 45_300,
    netGainPct: '4.72',
    capitalKrw: 10_045_300,
  },
  'long-hold-question': {
    type: 'long-hold-question',
    stockName: 'Samsung Electronics',
    symbol: '005930',
    quantity: '12.00000000',
    priceKrw: 81_000,
    returnPct: '1.25',
  },
  'daily-summary': {
    type: 'daily-summary',
    summary: {
      capitalKrw: 10_000_000,
      cashKrw: 1_200_000,
      totalValueKrw: 10_940_000,
      profitKrw: 940_000,
      returnPct: '9.40',
    },
    comparison: { depositPct: '0.12', buffettPct: '0.50', renaissancePct: '1.20' },
  },
};

const quiet = () => {
  const lines: Record<string, unknown>[] = [];
  return { lines, log: (line: Record<string, unknown>) => void lines.push(line) };
};

test('a pick is sent as the news story, then the buy and the day trade or long hold question', () => {
  const [story, buy] = pickBoughtMessages(events['pick-bought'] as never, 'https://app');
  assert.match(String(story.text), /News: Chip demand jumps/);
  assert.equal(
    buy.text,
    'Bought Samsung Electronics (005930)\n12 sh at ₩80,000\nCost: ₩960,144\nDay trade or long hold? Reply 단타 or 장투',
  );
});

test('a day trade sale states take profit or stop loss, net gain and the new capital', () => {
  const sold = events['day-trade-sold'] as never;
  assert.equal(
    dayTradeSoldMessage(sold, 'https://app').text,
    'Take profit: sold Samsung Electronics (005930)\n12 sh at ₩84,000\nNet gain: ₩45,300 (+4.72%)\nCapital: ₩10,045,300',
  );
  const loss = dayTradeSoldMessage(
    { ...(sold as object), reason: 'stop-loss', netGainKrw: -30_100, netGainPct: '-3.13' } as never,
    'https://app',
  );
  assert.match(String(loss.text), /^Stop loss: sold/);
  assert.match(String(loss.text), /Net gain: -₩30,100 \(-3\.13%\)/);
});

test('the long hold question asks keep or sell and says what no answer means', () => {
  assert.equal(
    longHoldQuestionMessage(events['long-hold-question'] as never, 'https://app').text,
    'Keep or sell Samsung Electronics (005930)?\n12 sh, last ₩81,000, +1.25%\nReply 유지 or 매도. No answer by 15:00 means keep.',
  );
});

test('the daily summary adds the deposit, Buffett and Renaissance line only when given', () => {
  const event = events['daily-summary'] as Extract<KakaoEvent, { type: 'daily-summary' }>;
  assert.equal(
    dailySummaryMessage(event, 'https://app').text,
    'Daily summary\nTotal value: ₩10,940,000\nReturn: +9.40% (₩940,000)\nCash: ₩1,200,000\nDeposit +0.12% · Buffett +0.50% · Renaissance +1.20%',
  );
  assert.ok(
    !String(dailySummaryMessage({ summary: event.summary }, 'https://app').text).includes(
      'Buffett',
    ),
  );
});

test('each event type is sent through the messenger', async () => {
  const messenger = fakeMessenger();
  const notifier = createNotifier(messenger, { log: quiet().log, retryDelayMs: 0 });
  for (const event of Object.values(events)) await notifier.notify(event);
  assert.equal(messenger.sent.length, 5, 'the pick is two messages');
});

test('a failed send is retried once and then succeeds without a log line', async () => {
  const messenger = fakeMessenger();
  messenger.failures.push(new KakaoApiError('Kakao send failed (500)'));
  const { lines, log } = quiet();
  await createNotifier(messenger, { log, retryDelayMs: 0 }).notify(events['long-hold-question']);
  assert.equal(messenger.sent.length, 1);
  assert.deepEqual(lines, []);
});

test('two failures are logged with the event type only and never thrown', async () => {
  const messenger = fakeMessenger();
  messenger.failures.push(new KakaoApiError('first'), new KakaoApiError('second'));
  const { lines, log } = quiet();
  await createNotifier(messenger, { log, retryDelayMs: 0 }).notify(events['day-trade-sold']);
  assert.equal(messenger.sent.length, 0);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], {
    level: 'error',
    event: 'kakao_notify_failed',
    type: 'day-trade-sold',
    revoked: false,
    message: 'second',
  });
  assert.ok(!JSON.stringify(lines).includes('45,300'), 'no amounts in the log');
});

test('a revoked connection is not retried, and is logged as revoked', async () => {
  const messenger = fakeMessenger();
  messenger.failures.push(new KakaoRevokedError(), new KakaoRevokedError());
  const { lines, log } = quiet();
  await createNotifier(messenger, { log, retryDelayMs: 0 }).notify(events['daily-summary']);
  assert.equal(messenger.failures.length, 1, 'only one send was tried');
  assert.equal(lines[0].revoked, true);
});

test('the second message of a pick still goes out when the first fails twice', async () => {
  const messenger = fakeMessenger();
  messenger.failures.push(new Error('a'), new Error('b'));
  const { lines, log } = quiet();
  await createNotifier(messenger, { log, retryDelayMs: 0 }).notify(events['pick-bought']);
  assert.equal(messenger.sent.length, 1);
  assert.equal(lines.length, 1);
});
