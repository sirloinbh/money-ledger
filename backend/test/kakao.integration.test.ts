import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { createApp } from '../src/app.js';
import type { KakaoConfig } from '../src/kakao/api.js';
import { decrypt } from '../src/kakao/crypto.js';
import { fakeMessenger } from '../src/kakao/fake.js';
import { createKakaoService } from '../src/kakao/service.js';
import { listen, resetDatabase, withApi } from './helpers.js';
import { testDatabase } from './test-database.js';

const url = await testDatabase();

const config: KakaoConfig = {
  restApiKey: 'rest-key',
  clientSecret: 'client-secret',
  redirectUri: 'https://ledger.example/api/kakao/callback',
  tokenKey: '0'.repeat(63) + '1',
};

type Call = { url: string; headers: Record<string, string>; body: URLSearchParams };
type Answer = { status: number; body: unknown };

// A fake Kakao: answers token and memo calls from queues and records each request.
function fakeKakao() {
  const calls: Call[] = [];
  const tokenAnswers: Answer[] = [];
  const memoAnswers: Answer[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const target = String(input);
    calls.push({
      url: target,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: new URLSearchParams(String(init?.body ?? '')),
    });
    const queue = target.includes('/oauth/token') ? tokenAnswers : memoAnswers;
    const answer = queue.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };
  const refreshes = () => calls.filter((call) => call.body.get('grant_type') === 'refresh_token');
  return { calls, tokenAnswers, memoAnswers, fetcher, refreshes };
}

const token = (access: string, refresh?: string): Answer => ({
  status: 200,
  body: {
    access_token: access,
    expires_in: 21_599,
    ...(refresh ? { refresh_token: refresh, refresh_token_expires_in: 5_184_000 } : {}),
  },
});
const text = (value: string) => ({ object_type: 'text' as const, text: value });

test('KakaoTalk send-to-me against the real database', { skip: !url }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  const reset = async () => {
    await resetDatabase(pool);
  };
  const connect = async (
    service: ReturnType<typeof createKakaoService>,
    kakao: ReturnType<typeof fakeKakao>,
  ) => {
    const login = new URL(await service.startLogin());
    kakao.tokenAnswers.push(token('access-1', 'refresh-1'));
    await service.finishLogin('the-code', login.searchParams.get('state') ?? '');
  };
  const expireIn = (interval: string) =>
    pool.query(`UPDATE kakao_connection SET access_expires_at = now() + interval '${interval}'`);

  await t.test('login stores both tokens encrypted and a state works once', async () => {
    await reset();
    const kakao = fakeKakao();
    const service = createKakaoService(pool, { config, fetch: kakao.fetcher });
    assert.equal((await service.status()).state, 'disconnected');
    const login = new URL(await service.startLogin());
    kakao.tokenAnswers.push(token('access-1', 'refresh-1'));
    const state = login.searchParams.get('state') ?? '';
    await service.finishLogin('the-code', state);

    const exchange = kakao.calls[0];
    assert.equal(exchange.body.get('grant_type'), 'authorization_code');
    assert.equal(exchange.body.get('code'), 'the-code');
    assert.equal(exchange.body.get('client_secret'), 'client-secret');
    assert.equal((await service.status()).state, 'connected');

    const { rows } = await pool.query('SELECT * FROM kakao_connection');
    assert.ok(!JSON.stringify(rows[0]).includes('access-1'));
    assert.equal(decrypt(rows[0].access_token_enc, config.tokenKey), 'access-1');
    assert.equal(decrypt(rows[0].refresh_token_enc, config.tokenKey), 'refresh-1');

    await assert.rejects(service.finishLogin('the-code', state), /expired/);
    await assert.rejects(service.finishLogin('the-code', 'made-up'), /expired/);
  });

  await t.test('an expired login state is refused', async () => {
    await reset();
    const kakao = fakeKakao();
    const service = createKakaoService(pool, { config, fetch: kakao.fetcher });
    await service.startLogin();
    await pool.query("UPDATE kakao_login_states SET expires_at = now() - interval '1 minute'");
    const { rows } = await pool.query('SELECT state FROM kakao_login_states');
    await assert.rejects(service.finishLogin('c', rows[0].state), /expired/);
    assert.equal(kakao.calls.length, 0);
  });

  await t.test('send uses the stored token and refreshes it before it expires', async () => {
    await reset();
    const kakao = fakeKakao();
    const service = createKakaoService(pool, { config, fetch: kakao.fetcher });
    await connect(service, kakao);
    await expireIn('6 hours');

    await service.send(text('hello'));
    const memo = kakao.calls.at(-1);
    assert.equal(memo?.headers.authorization, 'Bearer access-1');
    assert.deepEqual(JSON.parse(memo?.body.get('template_object') ?? '{}'), text('hello'));
    assert.equal(kakao.refreshes().length, 0, 'no refresh yet');

    // Within five minutes of expiry: refresh first. No new refresh token comes back, so the old one stays.
    await expireIn('2 minutes');
    kakao.tokenAnswers.push(token('access-2'));
    await service.send(text('again'));
    assert.equal(kakao.refreshes().at(-1)?.body.get('refresh_token'), 'refresh-1');
    assert.equal(kakao.calls.at(-1)?.headers.authorization, 'Bearer access-2');
    const { rows } = await pool.query('SELECT * FROM kakao_connection');
    assert.equal(decrypt(rows[0].refresh_token_enc, config.tokenKey), 'refresh-1');

    // A new refresh token in the answer replaces the old one.
    await expireIn('1 minute');
    kakao.tokenAnswers.push(token('access-3', 'refresh-2'));
    await service.send(text('third'));
    const after = await pool.query('SELECT * FROM kakao_connection');
    assert.equal(decrypt(after.rows[0].refresh_token_enc, config.tokenKey), 'refresh-2');
  });

  await t.test('two sends at once refresh an expiring token only once', async () => {
    await reset();
    const kakao = fakeKakao();
    const service = createKakaoService(pool, { config, fetch: kakao.fetcher });
    await connect(service, kakao);
    await expireIn('1 minute');
    kakao.tokenAnswers.push(token('access-2'));
    await Promise.all([service.send(text('a')), service.send(text('b'))]);
    assert.equal(kakao.refreshes().length, 1);
  });

  await t.test(
    'a revoked refresh token marks the connection Reconnect and stops sending',
    async () => {
      await reset();
      const kakao = fakeKakao();
      const service = createKakaoService(pool, { config, fetch: kakao.fetcher });
      await connect(service, kakao);
      await expireIn('-1 minute');
      kakao.tokenAnswers.push({ status: 400, body: { error: 'invalid_grant' } });
      await assert.rejects(service.send(text('x')), /revoked/);
      assert.equal((await service.status()).state, 'revoked');
      const before = kakao.calls.length;
      await assert.rejects(service.send(text('y')), /revoked/);
      assert.equal(kakao.calls.length, before, 'nothing is sent while revoked');

      // Connecting again clears it.
      await connect(service, kakao);
      assert.equal((await service.status()).state, 'connected');
    },
  );

  await t.test('a memo refused as an invalid token refreshes once, then retries', async () => {
    await reset();
    const kakao = fakeKakao();
    const service = createKakaoService(pool, { config, fetch: kakao.fetcher });
    await connect(service, kakao);
    await expireIn('6 hours');
    kakao.memoAnswers.push({ status: 401, body: { code: -401 } });
    kakao.tokenAnswers.push(token('access-2'));
    await service.send(text('x'));
    assert.equal(kakao.calls.at(-1)?.headers.authorization, 'Bearer access-2');

    // Refused again after the refresh: revoked.
    kakao.memoAnswers.push(
      { status: 401, body: { code: -401 } },
      { status: 401, body: { code: -401 } },
    );
    kakao.tokenAnswers.push(token('access-3'));
    await assert.rejects(service.send(text('x')), /revoked/);
    assert.equal((await service.status()).state, 'revoked');
  });

  await t.test('other Kakao failures do not mark the connection revoked', async () => {
    await reset();
    const kakao = fakeKakao();
    const service = createKakaoService(pool, { config, fetch: kakao.fetcher });
    await connect(service, kakao);
    await expireIn('6 hours');
    kakao.memoAnswers.push({ status: 500, body: {} });
    await assert.rejects(service.send(text('x')), /Kakao send failed/);
    assert.equal((await service.status()).state, 'connected');
  });

  await t.test('the routes: status, connect, callback, test message, disconnect', async () => {
    await reset();
    const kakao = fakeKakao();
    const service = createKakaoService(pool, { config, fetch: kakao.fetcher });
    const options = { kakao: { service, appUrl: 'https://ledger.example' } };
    await withApi(
      pool,
      async (call) => {
        assert.deepEqual((await call('/api/kakao/status')).data, {
          configured: true,
          state: 'disconnected',
          connectedAt: null,
        });
        assert.equal((await call('/api/kakao/test', { method: 'POST' })).status, 409);

        const started = await call('/api/kakao/connect', { method: 'POST' });
        assert.equal(started.status, 200);
        const state = new URL(String(started.data.url)).searchParams.get('state') ?? '';
        assert.ok(state);

        // Kakao sends the browser back; the app answers with a redirect to Settings.
        const { server, port } = await listen(createApp(pool, options));
        const back = (query: string) =>
          fetch(`http://127.0.0.1:${port}/api/kakao/callback?${query}`, { redirect: 'manual' });
        try {
          kakao.tokenAnswers.push(token('access-1', 'refresh-1'));
          const done = await back(`code=c&state=${state}`);
          assert.equal(done.status, 302);
          assert.equal(
            done.headers.get('location'),
            'https://ledger.example/settings?kakao=connected',
          );
          const replay = await back(`code=c&state=${state}`);
          assert.equal(
            replay.headers.get('location'),
            'https://ledger.example/settings?kakao=failed',
          );
          const denied = await back('error=access_denied');
          assert.equal(
            denied.headers.get('location'),
            'https://ledger.example/settings?kakao=failed',
          );
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }

        assert.equal((await call('/api/kakao/status')).data.state, 'connected');
        await expireIn('6 hours');
        const sent = await call('/api/kakao/test', { method: 'POST' });
        assert.deepEqual([sent.status, sent.data], [200, { sent: true }]);

        kakao.memoAnswers.push({ status: 500, body: {} });
        assert.equal((await call('/api/kakao/test', { method: 'POST' })).status, 502);

        assert.equal((await call('/api/kakao/connection', { method: 'DELETE' })).status, 204);
        assert.equal((await call('/api/kakao/status')).data.state, 'disconnected');
      },
      options,
    );
  });

  await t.test(
    'a revoked token shows as revoked in the status and the test answers 409',
    async () => {
      await reset();
      const kakao = fakeKakao();
      const service = createKakaoService(pool, { config, fetch: kakao.fetcher });
      await connect(service, kakao);
      await pool.query("UPDATE kakao_connection SET status = 'revoked'");
      await withApi(
        pool,
        async (call) => {
          assert.equal((await call('/api/kakao/status')).data.state, 'revoked');
          const sent = await call('/api/kakao/test', { method: 'POST' });
          assert.equal(sent.status, 409);
          assert.match(String(sent.data.error), /Reconnect/);
        },
        { kakao: { service } },
      );
    },
  );

  await t.test(
    'without settings the status says not configured and connect answers 503',
    async () => {
      await reset();
      const service = createKakaoService(pool, { config: undefined });
      await withApi(
        pool,
        async (call) => {
          assert.equal((await call('/api/kakao/status')).data.state, 'not-configured');
          assert.equal((await call('/api/kakao/connect', { method: 'POST' })).status, 503);
        },
        { kakao: { service } },
      );
    },
  );

  await t.test('the fake messenger records messages and can fail', async () => {
    const fake = fakeMessenger();
    await fake.send(text('one'));
    fake.failures.push(new Error('boom'));
    await assert.rejects(fake.send(text('two')), /boom/);
    await fake.send(text('three'));
    assert.deepEqual(
      fake.sent.map((message) => message.text),
      ['one', 'three'],
    );
  });
});
