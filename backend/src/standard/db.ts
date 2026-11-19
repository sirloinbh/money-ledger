// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/src/standard/
// Database helpers shared by every app (#676): one pool recipe and one transaction helper, so BEGIN/COMMIT/ROLLBACK
// is not hand-written in each route. This file imports no value from `pg`, so the app passes its own Pool:
//
//   import { Pool } from 'pg';
//   const pool = createPool(new Pool({ connectionString: process.env.DATABASE_URL }));
//   await withTransaction(pool, async (client) => { await client.query('UPDATE ...'); });

/** The part of a pg PoolClient that withTransaction uses. */
export type TxClient = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  /** pg destroys the connection instead of returning it to the pool when `release(true)` is called. */
  release: (destroy?: boolean) => void;
};

/** The part of a pg Pool that these helpers use. */
export type PoolLike<C extends TxClient = TxClient> = {
  connect: () => Promise<C>;
  on: (event: 'error', listener: (err: Error) => void) => unknown;
};

/**
 * Adds the error listener pg needs: an idle client that loses its connection emits `error` on the pool, and without a
 * listener that event crashes the process. The error is logged; the pool drops the dead client and opens a new one.
 */
export function createPool<P extends Pick<PoolLike, 'on'>>(
  pool: P,
  log: (message: string, err: Error) => void = (message, err) => console.error(message, err),
): P {
  pool.on('error', (err) => log('Idle database client failed', err));
  return pool;
}

/**
 * Runs `fn` in one transaction: COMMIT when it resolves, ROLLBACK when it throws (the error is rethrown). If the
 * ROLLBACK itself fails the connection is in an unknown state, so the client is released with `true` and pg destroys
 * it instead of putting it back in the pool.
 */
export async function withTransaction<T, C extends TxClient>(
  pool: Pick<PoolLike<C>, 'connect'>,
  fn: (client: C) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let destroy = false;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      destroy = true;
    }
    throw err;
  } finally {
    client.release(destroy);
  }
}
