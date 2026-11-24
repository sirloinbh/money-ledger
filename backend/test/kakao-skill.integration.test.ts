import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { createApp } from '../src/app.js';
import type { SkillOptions } from '../src/kakao/skill.js';
import { listen, runMigration } from './helpers.js';
import { testDatabase } from './test-database.js';

const url = await testDatabase();

const secret = 'a-shared-secret-of-enough-length';
const config = { secret, allowedUserIds: ['4fa2c0de'] };

/** The shape Kakao i Open Builder sends (trimmed to what the fixtures need; the other fields are ignored). */
const kakaoRequest = (utterance: string, id = '4fa2c0de') => ({
  intent: { id: 'a1', name: 'fallback' },
  userRequest: {
    timezone: 'Asia/Seoul',
    block: { id: 'b1', name: 'fallback' },
    utterance,
    lang: 'ko',
    user: { id, type: 'botUserKey', properties: {} },
  },
  bot: { id: 'bot1', name: 'money-ledger' },
  action: { name: 'skill', params: {}, detailParams: {}, clientExtra: {} },
});

type SkillAnswer = {
  version: string;
  template: {
    outputs: { simpleText: { text: string } }[];
    quickReplies: { label: string; action: string; messageText: string }[];
  };
};

test('KakaoTalk chatbot commands against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  // The test database already holds every earlier migration (the copy of the template); start from empty tables.
  await pool.query('DROP TABLE IF EXISTS kakao_commands');
  await pool.query('TRUNCATE mock_accounts, securities CASCADE');
  await runMigration(pool, '039_kakao_commands.sql');
  await runMigration(pool, '039_kakao_commands.sql'); // re-running is safe

  const ask = async (
    utterance: string,
    options: Partial<SkillOptions> = {},
    headers: Record<string, string> = { 'x-kakao-skill-secret': secret },
  ) => {
    const { server, port } = await listen(
      createApp(pool, { today: () => '2026-11-06', kakaoSkill: { config, ...options } }),
    );
    try {
      const response = await fetch(`http://127.0.0.1:${port}/kakao/skill`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(kakaoRequest(utterance)),
      });
      return { status: response.status, body: (await response.json()) as SkillAnswer };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
  const textOf = (answer: { body: SkillAnswer }) =>
    answer.body.template.outputs[0]!.simpleText.text;
  const recorded = async () =>
    (
      await pool.query<{ command: string; result: string }>(
        'SELECT command, result FROM kakao_commands ORDER BY id',
      )
    ).rows;

  await t.test('without an account every account command says so', async () => {
    const answer = await ask('상태');
    assert.equal(answer.status, 200);
    assert.match(textOf(answer), /no mock trading account/);
  });

  const account = await pool.query<{ id: string }>(
    'INSERT INTO mock_accounts (initial_cash_krw, cash_krw) VALUES (10000000, 8590000) RETURNING id',
  );
  const security = await pool.query<{ id: string }>(
    `INSERT INTO securities (market, symbol, name, kind, currency, active)
     VALUES ('KOSPI', '005930', 'Samsung Electronics', 'stock', 'KRW', true) RETURNING id`,
  );
  await pool.query(
    `INSERT INTO security_prices (security_id, trade_date, close, currency, source)
     VALUES ($1, '2026-11-06', 72000, 'KRW', 'T')`,
    [security.rows[0]!.id],
  );
  await pool.query(
    'INSERT INTO mock_holdings (account_id, security_id, quantity, cost_krw) VALUES ($1, $2, 20, 1410000)',
    [account.rows[0]!.id, security.rows[0]!.id],
  );

  await t.test('상태 shows capital, cash, total value and return from SQL', async () => {
    const answer = await ask('상태');
    assert.equal(answer.status, 200);
    assert.equal(answer.body.version, '2.0');
    // 20 × 72,000 = 1,440,000 held + 8,590,000 cash = 10,030,000 → +30,000 = +0.30%.
    assert.equal(
      textOf(answer),
      [
        'Mock account summary',
        'Capital: ₩10,000,000',
        'Cash: ₩8,590,000',
        'Total value: ₩10,030,000',
        'Return: +0.30% (₩30,000)',
      ].join('\n'),
    );
    // Quick-reply buttons send their own label back as the next message.
    assert.deepEqual(answer.body.template.quickReplies, [
      { label: '상태', action: 'message', messageText: '상태' },
      { label: '포지션', action: 'message', messageText: '포지션' },
      { label: '뉴스', action: 'message', messageText: '뉴스' },
      { label: '수익률', action: 'message', messageText: '수익률' },
    ]);
  });

  await t.test('포지션 lists each holding with its return', async () => {
    const answer = await ask(' Positions ');
    assert.match(textOf(answer), /Open positions\nSamsung Electronics \(005930\) 20 sh,/);
    assert.match(textOf(answer), /\+2\.13%/); // (1,440,000 − 1,410,000) / 1,410,000
  });

  await t.test(
    '뉴스 and 수익률 use the source that fills them in, or say they are not ready',
    async () => {
      assert.match(textOf(await ask('뉴스')), /no news pick/);
      assert.match(textOf(await ask('수익률')), /not ready/);
      const news = await ask('뉴스', {
        sources: {
          news: () =>
            Promise.resolve({
              headline: 'Chip exports jump',
              effect: 'Exports lift growth',
              stockName: 'Samsung Electronics',
              symbol: '005930',
              reason: 'Largest exporter',
            }),
        },
      });
      assert.match(
        textOf(news),
        /News: Chip exports jump[\s\S]*Pick: Samsung Electronics \(005930\)/,
      );
      const returns = await ask('수익률', {
        sources: {
          returns: () =>
            Promise.resolve({
              accountPct: '0.30',
              depositPct: '0.12',
              buffettPct: '0.05',
              renaissancePct: '0.18',
            }),
        },
      });
      assert.match(
        textOf(returns),
        /Account: 0\.30%\nDeposit: 0\.12%\nBuffett .*: 0\.05%\nRenaissance .*: 0\.18%/,
      );
    },
  );

  await t.test('an unknown command gets the help text with the buttons', async () => {
    const answer = await ask('sell everything now');
    assert.equal(answer.status, 200);
    assert.match(textOf(answer), /^Commands:/);
    assert.equal(answer.body.template.quickReplies.length, 4);
  });

  await t.test('a failing source answers a retry message instead of an error', async () => {
    const lines: Record<string, unknown>[] = [];
    const answer = await ask('뉴스', {
      log: (line) => lines.push(line),
      sources: { news: () => Promise.reject(new Error('boom')) },
    });
    assert.equal(answer.status, 200);
    assert.match(textOf(answer), /Something went wrong/);
    assert.ok(lines.some((line) => line.event === 'kakao_skill_error'));
  });

  await t.test('a command slower than the limit answers before Kakao gives up', async () => {
    const answer = await ask('뉴스', {
      timeoutMs: 20,
      sources: { news: () => new Promise(() => undefined) },
    });
    assert.equal(answer.status, 200);
    assert.match(textOf(answer), /took too long/);
  });

  await t.test(
    'each command is recorded with its result and without the user ID or text',
    async () => {
      assert.deepEqual(await recorded(), [
        { command: 'status', result: 'unavailable' },
        { command: 'status', result: 'ok' },
        { command: 'positions', result: 'ok' },
        { command: 'news', result: 'unavailable' },
        { command: 'returns', result: 'unavailable' },
        { command: 'news', result: 'ok' },
        { command: 'returns', result: 'ok' },
        { command: 'unknown', result: 'unavailable' },
        { command: 'news', result: 'error' },
        { command: 'news', result: 'timeout' },
      ]);
      const dump = JSON.stringify((await pool.query('SELECT * FROM kakao_commands')).rows);
      assert.doesNotMatch(dump, /4fa2c0de|sell everything/);
    },
  );

  await t.test('a refused request is not recorded and returns no data', async () => {
    const before = (await recorded()).length;
    const answer = await ask('상태', {}, {});
    assert.equal(answer.status, 403);
    assert.deepEqual(answer.body, { error: 'Not allowed' } as unknown as SkillAnswer);
    assert.equal((await recorded()).length, before);
  });
});
