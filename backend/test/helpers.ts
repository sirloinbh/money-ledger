import { readFile } from 'node:fs/promises';

import type { Pool } from 'pg';

import { createApp } from '../src/app.js';

type Call = (
  path: string,
  init?: { method?: string; body?: unknown },
) => Promise<{ status: number; data: Record<string, unknown> }>;

// Ports fetch refuses to connect to ("bad port", WHATWG Fetch). On Windows the dynamic range can start at 1024,
// so listen(0) sometimes gets one of these; the helper then asks for another port (#51).
const fetchBlockedPorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);

async function listen(app: ReturnType<typeof createApp>) {
  for (;;) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No TCP address');
    if (!fetchBlockedPorts.has(address.port)) return { server, port: address.port };
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export async function withApi(
  pool: Pool,
  run: (call: Call) => Promise<void>,
  options: Parameters<typeof createApp>[1] = {},
) {
  const { server, port } = await listen(createApp(pool, options));
  try {
    const address = { port };
    await run(async (path, init = {}) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method: init.method ?? 'GET',
        headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      // 204 No Content has no body.
      const text = await response.text();
      return {
        status: response.status,
        data: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
      };
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
