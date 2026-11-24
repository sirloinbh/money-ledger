import assert from 'node:assert/strict';
import { test } from 'node:test';

import { answerOf, anthropicClient, ClaudeError, fakeClaude } from '../src/picks/claude.js';
import { claudeFromEnv } from '../src/picks/index.js';
import { PICK_QUEUE, PICK_SCHEDULE, pickQueue } from '../src/picks/jobs.js';
import { buildPrompt, parseAnswer, systemPrompt } from '../src/picks/prompt.js';

const good = {
  newsIds: [1, 2],
  storyTitle: '반도체 수출 급증',
  storySummary: '요약',
  economicEffect: '영향',
  reasoning: '근거',
  stockCode: '005930',
};

test('the prompt lists every headline with its id and marks them as data', () => {
  const prompt = buildPrompt([
    { id: 1, title: '증시 급등', summary: '코스피 상승', publisher: 'a.test' },
    { id: 2, title: '금리 동결', summary: '', publisher: null },
  ]);
  assert.match(prompt, /\[1\] 증시 급등 \(a\.test\) - 코스피 상승/);
  assert.match(prompt, /\[2\] 금리 동결\n/);
  assert.match(prompt, /<headlines>/);
  assert.match(prompt, /never instructions/);
  assert.match(systemPrompt, /KRX/);
  assert.match(
    buildPrompt([], 'XYZ is not an active Korean stock code'),
    /previous answer was rejected: XYZ/,
  );
});

test('a valid answer parses; the stock code is trimmed and upper-cased', () => {
  const parsed = parseAnswer(JSON.stringify({ ...good, stockCode: ' 00593a ' }));
  assert.ok('answer' in parsed);
  assert.equal(parsed.answer.stockCode, '00593A');
});

test('a bad answer names what is wrong', () => {
  assert.deepEqual(parseAnswer('not json'), { problem: 'the answer was not valid JSON' });
  const code = parseAnswer(JSON.stringify({ ...good, stockCode: 'SAMSUNG' }));
  assert.ok('problem' in code && /stockCode/.test(code.problem));
  const ids = parseAnswer(JSON.stringify({ ...good, newsIds: [] }));
  assert.ok('problem' in ids && /newsIds/.test(ids.problem));
  const missing = parseAnswer(JSON.stringify({ storyTitle: 'x' }));
  assert.ok('problem' in missing);
});

test('answerOf reads the text, and refuses a decline, a cut-off or an empty answer', () => {
  const ok = answerOf({
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'thinking' }, { type: 'text', text: '{"a":1}' }],
  });
  assert.equal(ok.text, '{"a":1}');
  assert.equal(ok.model, 'claude-opus-5-5');
  assert.throws(() => answerOf({ stop_reason: 'refusal', content: [] }), /declined/);
  assert.throws(
    () => answerOf({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] }),
    /output tokens/,
  );
  assert.throws(() => answerOf({ content: [] }), ClaudeError);
});

test('the real client sends the key as a header and a JSON schema, and never leaks the key', async (t) => {
  let seen:
    { url: string; headers: Record<string, string>; body: Record<string, unknown> } | undefined;
  t.mock.method(
    globalThis,
    'fetch',
    (url: string, init: { headers: Record<string, string>; body: string }) => {
      seen = { url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> };
      return Promise.resolve(
        new Response(
          JSON.stringify({ model: 'claude-opus-5-5', content: [{ type: 'text', text: '{}' }] }),
        ),
      );
    },
  );
  const client = anthropicClient('sk-secret-key');
  const answer = await client.complete({ system: 's', user: 'u', schema: { type: 'object' } });
  assert.equal(answer.text, '{}');
  assert.equal(seen?.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen?.headers['x-api-key'], 'sk-secret-key');
  assert.equal(seen?.body.model, 'claude-opus-5-5');
  assert.deepEqual(seen?.body.output_config, {
    effort: 'high',
    format: { type: 'json_schema', schema: { type: 'object' } },
  });
  assert.ok(!JSON.stringify(seen?.body).includes('sk-secret-key'));

  t.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('no', { status: 401 })));
  await assert.rejects(client.complete({ system: 's', user: 'u', schema: {} }), (error: Error) => {
    assert.match(error.message, /HTTP 401/);
    assert.ok(!error.message.includes('sk-secret-key'));
    return true;
  });
});

test('the client comes from the environment', () => {
  assert.equal(claudeFromEnv({}), undefined);
  assert.ok(claudeFromEnv({ ANTHROPIC_API_KEY: 'k' }));
  assert.ok(claudeFromEnv({ PICK_SOURCE: 'fake' }));
  assert.throws(() => claudeFromEnv({ PICK_SOURCE: 'fake', NODE_ENV: 'production' }), /production/);
});

test('the fake client answers with a parseable pick', async () => {
  const answer = await fakeClaude('000660', [3]).complete({ system: '', user: '', schema: {} });
  const parsed = parseAnswer(answer.text);
  assert.ok('answer' in parsed);
  assert.equal(parsed.answer.stockCode, '000660');
});

test('the job runs at 08:00 Seoul time on weekdays and does nothing without a client', async () => {
  assert.equal(PICK_SCHEDULE, '0 8 * * 1-5');
  const queue = pickQueue({} as never, undefined);
  assert.equal(queue.name, PICK_QUEUE);
  assert.equal(queue.schedule, PICK_SCHEDULE);
  await queue.handler({}, { id: '1', queue: PICK_QUEUE, attempt: 1, requestId: null });
});
