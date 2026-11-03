import type { Pool } from 'pg';

import { type AppOptions, createApp } from '../src/app.js';

type Call = (
  path: string,
  init?: {
    method?: string;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
  },
) => Promise<{ status: number; data: Record<string, unknown>; headers: Headers }>;

export async function withApi(
  pool: Pool,
  run: (call: Call) => Promise<void>,
  options: AppOptions = {},
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
      const body =
        init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...init.headers,
        },
        body,
      });
      return {
        status: response.status,
        data: (await response.json()) as Record<string, unknown>,
        headers: response.headers,
      };
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
