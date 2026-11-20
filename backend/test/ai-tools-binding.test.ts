import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { createApp } from '../src/app.js';
import { listen } from './helpers.js';

// project-standards#670, #822: the AI tool routes need a token that names its tool and was not used before. A fake
// pool stands in for PostgreSQL: every check here fails before the database, and a passing list call needs none.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'EdDSA', typ: 'JWT' })}.${b64({ iss: 'shared-ai', aud: 'money-ledger', sub: 'owner', client: 'stdio', scope: 'money-ledger:read', iat: now, exp: now + 60, ...claims })}`;
  return `${body}.${sign(null, Buffer.from(body), privateKey).toString('base64url')}`;
}

test('the AI tool routes refuse a token without tool and jti, for another tool, or used twice', async () => {
  const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const toolsPublicKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const { server, port } = await listen(createApp(pool, { toolsPublicKey }));
  const list = (auth: string) =>
    fetch(`http://127.0.0.1:${port}/internal/tools`, {
      headers: { authorization: `Bearer ${auth}` },
    });
  try {
    assert.equal((await list(token())).status, 401, 'an unbound token is refused');
    assert.equal(
      (await list(token({ tool: 'list_entries', jti: randomUUID() }))).status,
      401,
      'wrong tool',
    );
    const once = token({ tool: '@list', jti: randomUUID() });
    assert.equal((await list(once)).status, 200);
    assert.equal((await list(once)).status, 401, 'a replayed token is refused');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
