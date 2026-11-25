import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { createApp } from '../src/app.js';
import type { SkillOptions } from '../src/kakao/skill.js';
import { listen, resetDatabase, runMigration } from './helpers.js';
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
  await resetDatabase(pool);
  await pool.query('TRUNCATE mock_accounts, securities CASCADE');
  await runMigration(pool, '039_kakao_commands.sql');
  await runMigration(pool, '045_kakao_commands_strategy.sql');
  await runMigration(pool, '045_kakao_commands_strategy.sql'); // re-running is safe
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

  // The all-in buy of the same shares (#307): an undecided position the strategy commands act on.
  const buy = await pool.query<{ id: string }>(
    `INSERT INTO mock_orders (account_id, security_id, request_key, side, quantity, price, currency,
       price_date, amount_krw, fee_krw, cash_after_krw, fill_source)
     VALUES ($1, $2, gen_random_uuid(), 'buy', 20, 70500, 'KRW', '2026-11-06', 1410000, 0, 8590000, 'book')
     RETURNING id`,
    [account.rows[0]!.id, security.rows[0]!.id],
  );
  await pool.query(
    'INSERT INTO mock_positions (account_id, security_id, buy_order_id, quantity) VALUES ($1, $2, $3, 20)',
    [account.rows[0]!.id, security.rows[0]!.id, buy.rows[0]!.id],
  );
  const strategyRow = async () =>
    (
      await pool.query<{ strategy: string; strategy_source: string | null }>(
        'SELECT strategy, strategy_source FROM mock_positions',
      )
    ).rows[0]!;

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
    // A position waits for its choice, so the answer offers the two strategy buttons first.
    assert.match(textOf(answer), /strategy not chosen/);
    assert.deepEqual(
      answer.body.template.quickReplies.slice(0, 2).map((reply) => reply.messageText),
      ['단타', '장투'],
    );
  });

  await t.test('단타 chooses a day trade for the waiting position, once', async () => {
    const answer = await ask('단타');
    assert.equal(answer.status, 200);
    assert.match(textOf(answer), /^Day trade: Samsung Electronics \(005930\)\n.*\+5% or -3%/);
    assert.deepEqual(await strategyRow(), { strategy: 'day_trade', strategy_source: 'kakao' });
    assert.match(textOf(await ask('포지션')), /day trade, /);
    assert.equal((await ask('포지션')).body.template.quickReplies.length, 4); // no strategy buttons now
    // Nothing waits any more, so the same word again, or the other one, changes nothing.
    assert.match(textOf(await ask('단타')), /No position is waiting/);
    assert.match(textOf(await ask('장투')), /No position is waiting/);
    assert.equal((await strategyRow()).strategy, 'day_trade');
  });

  await t.test('장투 chooses a long hold', async () => {
    await pool.query(
      "UPDATE mock_positions SET strategy = 'undecided', strategy_chosen_at = NULL, strategy_source = NULL",
    );
    const answer = await ask(' Long Hold ');
    assert.match(textOf(answer), /^Long hold: Samsung Electronics \(005930\)\n.*each morning/);
    assert.deepEqual(await strategyRow(), { strategy: 'long_hold', strategy_source: 'kakao' });
    assert.match(textOf(await ask('포지션')), /long hold, /);
  });

  await t.test('a sold position is not offered a choice', async () => {
    await pool.query(
      "UPDATE mock_positions SET strategy = 'undecided', strategy_chosen_at = NULL, strategy_source = NULL",
    );
    // A sale between the list and the update cannot be staged here; the guard for that race is the 409 branch,
    // covered by the chooseStrategy tests (#307).
    const sell = await pool.query<{ id: string }>(
      `INSERT INTO mock_orders (account_id, security_id, request_key, side, quantity, price, currency,
         price_date, amount_krw, fee_krw, tax_krw, cash_after_krw, fill_source)
       VALUES ($1, $2, gen_random_uuid(), 'sell', 20, 72000, 'KRW', '2026-11-06', 1440000, 0, 0, 10030000, 'book')
       RETURNING id`,
      [account.rows[0]!.id, security.rows[0]!.id],
    );
    await pool.query(
      "UPDATE mock_positions SET sell_order_id = $1, closed_at = now(), exit_reason = 'manual', net_gain_krw = 30000, net_gain_pct = 2.13",
      [sell.rows[0]!.id],
    );
    assert.match(textOf(await ask('단타')), /No position is waiting/);
    await pool.query(
      'UPDATE mock_positions SET sell_order_id = NULL, closed_at = NULL, exit_reason = NULL, net_gain_krw = NULL, net_gain_pct = NULL',
    );
    await pool.query('DELETE FROM mock_orders WHERE id = $1', [sell.rows[0]!.id]);
    await pool.query(
      "UPDATE mock_positions SET strategy = 'undecided', strategy_chosen_at = NULL, strategy_source = NULL",
    );
  });

  await t.test(
    '뉴스 and 수익률 use the source that fills them in, or say they are not ready',
    async () => {
      assert.match(textOf(await ask('뉴스')), /no news pick/);
      assert.match(textOf(await ask('수익률')), /no return to compare/);
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
              startDate: '2026-11-01',
              endDate: '2026-11-06',
              accountPct: '0.30',
              depositPct: '0.12',
              buffettPct: '0.05',
              renaissancePct: '0.18',
            }),
        },
      });
      assert.match(
        textOf(returns),
        /Account: \+0\.30%\nDeposit: \+0\.12%\nBuffett .*: \+0\.05%\nRenaissance .*: \+0\.18%/,
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
        { command: 'strategy', result: 'ok' },
        { command: 'positions', result: 'ok' },
        { command: 'positions', result: 'ok' },
        { command: 'strategy', result: 'unavailable' },
        { command: 'strategy', result: 'unavailable' },
        { command: 'strategy', result: 'ok' },
        { command: 'positions', result: 'ok' },
        { command: 'strategy', result: 'unavailable' },
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

  await t.test('뉴스 reads today’s stored pick and shows the whole reason', async () => {
    const reason = `Chip exports rise, ${'and the order book is deep. '.repeat(10)}`; // longer than a send-to-me message
    await pool.query('TRUNCATE daily_picks');
    await pool.query(
      `INSERT INTO daily_picks (pick_date, news_item_ids, story_title, story_summary, economic_effect, reasoning,
         security_id, model, raw_response)
       VALUES ('2026-11-06', ARRAY[1], 'Chip exports jump', 'Summary', 'Exports lift growth', $1, $2, 'test', '{}')`,
      [reason, security.rows[0]!.id],
    );
    const text = textOf(await ask('뉴스'));
    assert.match(
      text,
      /^News: Chip exports jump\nEffect: Exports lift growth\nPick: Samsung Electronics \(005930\)\nWhy: Chip exports rise/,
    );
    assert.ok(text.length > 200 && text.includes(reason.trimEnd().slice(-30)));
    // Another day's pick is not shown.
    await pool.query("UPDATE daily_picks SET pick_date = '2026-11-05'");
    assert.match(textOf(await ask('뉴스')), /no news pick for today/);
  });

  await t.test(
    '수익률 compares the account with the deposit, Buffett and Renaissance',
    async () => {
      // The account starts on 2026-11-02 (KST), so its first known value is dated 2026-11-01: 5 days to 2026-11-06.
      await pool.query("UPDATE mock_accounts SET created_at = '2026-11-02T01:00:00Z'");
      await pool.query('TRUNCATE mock_snapshots');
      await pool.query(
        `INSERT INTO mock_snapshots (account_id, snapshot_date, cash_krw, value_krw, total_krw, profit_krw, return_pct)
       VALUES ($1, '2026-11-06', 10500000, 0, 10500000, 500000, 5)`,
        [account.rows[0]!.id],
      );
      await pool.query('TRUNCATE base_rates');
      const without = textOf(await ask('수익률'));
      assert.equal(
        without,
        [
          'Return vs benchmarks (2026-11-01 to 2026-11-06)',
          'Account: +5.00%',
          'Deposit: n/a', // no base rate stored yet
          'Buffett (20% a year): +0.25%', // 1.20 ^ (5 / 365) − 1
          'Renaissance (66% a year): +0.70%', // 1.66 ^ (5 / 365) − 1
        ].join('\n'),
      );
      await pool.query(
        "INSERT INTO base_rates (effective_date, rate_pct, source, fetched_at) VALUES ('2026-10-01', 3, 'T', now())",
      );
      assert.match(textOf(await ask('수익률')), /\nDeposit: \+0\.04%\n/); // 3% a year over 5 days
    },
  );
});
