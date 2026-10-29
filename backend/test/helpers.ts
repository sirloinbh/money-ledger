import type { Pool } from 'pg';

import { createApp } from '../src/app.js';

export async function withApi(
  pool: Pool,
  run: (
    call: (path: string) => Promise<{ status: number; data: Record<string, unknown> }>,
  ) => Promise<void>,
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
    await run(async (path) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      return { status: response.status, data: (await response.json()) as Record<string, unknown> };
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
