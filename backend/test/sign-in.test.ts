import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAuthMiddleware } from '@sirloinbh/auth-client';
import type { Pool } from 'pg';

import { createApp } from '../src/app.js';
import { listen } from './helpers.js';

// #149: the shared sign-in guards /api. A fake auth service stands in for sirloinbh/shared-auth
// and a fake pool for PostgreSQL, so these run without either.
const user = { id: 'u1', email: 'me@example.com', name: 'Me', image: null };

async function withSignIn(run: (base: string, sessionChecks: () => number) => Promise<void>) {
  let checks = 0;
  const auth = createAuthMiddleware({
    authUrl: 'http://shared-auth-api:3110',
    fetch: async (_url, init) => {
      checks++;
      const cookie = (init?.headers as Record<string, string> | undefined)?.cookie ?? '';
      const ok = cookie.includes('sirloinbh.session_token=good');
      return { ok: true, status: 200, json: async () => (ok ? { user } : null) };
    },
  });
  const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const { server, port } = await listen(createApp(pool, { auth }));
  try {
    await run(`http://127.0.0.1:${port}/api`, () => checks);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const signedIn = { headers: { cookie: 'sirloinbh.session_token=good' } };

test('without a session every /api path but /api/health is 401', async () => {
  await withSignIn(async (base, checks) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    for (const path of [
      '/me',
      '/ledger/categories',
      '/ledger/entries',
      '/ledger/entries/csv',
      '/portfolio/assets',
      '/mock/accounts',
      '/no-such-path',
    ]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 401, path);
      assert.deepEqual(await response.json(), { error: 'unauthorized' });
    }
    assert.equal(checks(), 0, 'no cookie, so the auth service is not asked');
    assert.equal(
      (
        await fetch(`${base}/ledger/categories`, {
          headers: { cookie: 'sirloinbh.session_token=bad' },
        })
      ).status,
      401,
    );
  });
});

test('with a session the API answers and /api/me returns the user', async () => {
  await withSignIn(async (base) => {
    const me = await fetch(`${base}/me`, signedIn);
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { user });
    assert.equal((await fetch(`${base}/ledger/categories`, signedIn)).status, 200);
  });
});
