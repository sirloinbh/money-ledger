import { readFile } from 'node:fs/promises';

import type { Pool } from 'pg';

import { createApp } from '../src/app.js';

type Call = (
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<{ status: number; data: Record<string, unknown> }>;

export async function withApi(
  pool: Pool,
  run: (call: Call) => Promise<void>,
  options: { today?: () => string } = {},
) {
  const server = createApp(pool, options).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No TCP address');
    await run(async (path, init = {}) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method: init.method ?? 'GET',
        headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      return { status: response.status, data: (await response.json()) as Record<string, unknown> };
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

/** Runs a migration file from database/migrations against the test DB (they are all safe to re-run). */
export async function runMigration(pool: Pool, file: string) {
  const sql = await readFile(new URL(`../../database/migrations/${file}`, import.meta.url), 'utf8');
  await pool.query(sql);
}
