import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { createApp } from '../src/app.js';
import { parseCommand } from '../src/kakao/commands.js';
import { skillConfigFromEnv, type SkillOptions } from '../src/kakao/skill.js';
import { listen } from './helpers.js';

const secret = 'a-shared-secret-of-enough-length';
const config = { secret, allowedUserIds: ['kakao-user-1'] };
const refused = JSON.stringify({ error: 'Not allowed' });
const signed = { 'x-kakao-skill-secret': secret };

const body = (utterance: string, id = 'kakao-user-1') => ({
  userRequest: { utterance, user: { id } },
});

// Every refusal happens before the database is touched, so a stub pool proves nothing was read.
const stubPool = {
  query: () => {
    throw new Error('the database must not be touched');
  },
} as unknown as Pool;

type Reply = { status: number; text: string };

async function withSkill(
  options: SkillOptions,
  run: (
    post: (headers: Record<string, string>, payload: unknown) => Promise<Reply>,
  ) => Promise<void>,
) {
  const { server, port } = await listen(createApp(stubPool, { kakaoSkill: options }));
  try {
    await run(async (headers, payload) => {
      const response = await fetch(`http://127.0.0.1:${port}/kakao/skill`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
      return { status: response.status, text: await response.text() };
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('the skill settings need a long enough secret and at least one user', () => {
  assert.equal(skillConfigFromEnv({}), undefined);
  assert.equal(skillConfigFromEnv({ KAKAO_SKILL_SECRET: secret }), undefined);
  assert.equal(
    skillConfigFromEnv({ KAKAO_SKILL_SECRET: 'short', KAKAO_ALLOWED_USER_IDS: 'a' }),
    undefined,
  );
  assert.deepEqual(
    skillConfigFromEnv({ KAKAO_SKILL_SECRET: secret, KAKAO_ALLOWED_USER_IDS: ' a, b ,,' }),
    { secret, allowedUserIds: ['a', 'b'] },
  );
});

test('commands match in Korean and English, ignoring case and spaces', () => {
  assert.equal(parseCommand('상태'), 'status');
  assert.equal(parseCommand('  Positions '), 'positions');
  assert.equal(parseCommand('뉴스'), 'news');
  assert.equal(parseCommand('수익률'), 'returns');
  assert.equal(parseCommand('buy everything'), undefined);
  assert.equal(parseCommand(''), undefined);
});

test('a request is refused with one answer unless the secret and the user are right', async () => {
  const lines: Record<string, unknown>[] = [];
  await withSkill({ config, log: (line) => lines.push(line) }, async (post) => {
    for (const result of [
      await post({}, body('상태')),
      await post({ 'x-kakao-skill-secret': 'wrong' }, body('상태')),
      await post(signed, body('상태', 'someone-else')),
    ]) {
      assert.equal(result.status, 403);
      assert.equal(result.text, refused);
    }
    assert.equal((await post(signed, { nothing: true })).status, 400);
  });
  assert.deepEqual(
    lines.map((line) => line.reason),
    ['secret', 'secret', 'user', 'body'],
  );
  // Neither the user ID nor the secret reaches the log.
  assert.doesNotMatch(JSON.stringify(lines), /someone-else|kakao-user-1|shared-secret/);
});

test('only POST is answered', async () => {
  const { server, port } = await listen(createApp(stubPool, { kakaoSkill: { config } }));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/kakao/skill`, { headers: signed });
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('with no settings the webhook refuses everyone, even a signed request', async () => {
  await withSkill({ config: undefined }, async (post) => {
    const result = await post(signed, body('상태'));
    assert.equal(result.status, 403);
    assert.equal(result.text, refused);
  });
});

test('too many requests from one address get 429 before the secret is even checked', async () => {
  await withSkill({ config, requestsPerMinute: 2 }, async (post) => {
    assert.equal((await post({}, body('상태'))).status, 403);
    assert.equal((await post({}, body('상태'))).status, 403);
    assert.equal((await post({}, body('상태'))).status, 429);
  });
});
