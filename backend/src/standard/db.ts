// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/src/standard/
// Database helpers shared by every app (#676): one pool recipe and one transaction helper, so BEGIN/COMMIT/ROLLBACK
// is not hand-written in each route. This file imports no value from `pg`, so the app passes its own Pool:
//
//   import { Pool } from 'pg';
//   const pool = createPool(new Pool({ connectionString: process.env.DATABASE_URL }));
//   await withTransaction(pool, async (client) => { await client.query('UPDATE ...'); });
import type { Pool, PoolClient } from 'pg';

/** The part of a pg PoolClient that withTransaction uses. */
export type TxClient = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  /** pg destroys the connection instead of returning it to the pool when `release(true)` is called. */
  release: (destroy?: boolean) => void;
};

/** The part of a pg client that createPool listens on. */
export type ErrorSource = { on: (event: 'error', listener: (err: Error) => void) => unknown };

/** The events createPool listens for on a pg Pool. */
export type PoolEvents = {
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'connect', listener: (client: ErrorSource) => void): unknown;
};

/** The part of a pg Pool that these helpers use. */
export type PoolLike<C extends TxClient = TxClient> = PoolEvents & { connect: () => Promise<C> };

/** The logger createPool calls for a connection error. An app can pass its own. */
type PoolLog = (message: string, err: Error) => void;

/**
 * The default PoolLog: one JSON line in the shape of the request log (time, level, message), plus the error's message
 * and code (for example ECONNRESET). No stack trace, so the line is one line and easy to parse (#1003).
 */
function logPoolError(message: string, err: Error): void {
  const code = (err as { code?: unknown }).code;
  console.error(
    JSON.stringify({
      time: new Date().toISOString(),
      level: 'error',
      message,
      error: err.message,
      ...(code === undefined ? {} : { code }),
    }),
  );
}

/**
 * Adds the error listeners pg needs, so a lost connection is logged instead of ending the process. pg reports a lost
 * connection as an `error` event, and an event nobody listens to throws. The pool listens for idle clients only: pg stops
 * listening on a client while it is checked out (in a transaction, between its queries). So every connection also gets
 * its own listener, and that one logs; an idle client reports on both, so the pool-level listener stays quiet. Queries on
 * a lost connection still reject (the app answers 500); the pool drops the dead client and opens a new one.
 */
export function createPool<P extends PoolEvents>(pool: P, log: PoolLog = logPoolError): P {
  pool.on('error', () => undefined);
  pool.on('connect', (client) => client.on('error', (err) => log('Database connection failed', err)));
  return pool;
}

/**
 * Runs `fn` in one transaction: COMMIT when it resolves, ROLLBACK when it throws (the error is rethrown). If the
 * ROLLBACK itself fails the connection is in an unknown state, so the client is released with `true` and pg destroys
 * it instead of putting it back in the pool.
 */
export function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T>;
export function withTransaction<T, C extends TxClient>(pool: Pick<PoolLike<C>, 'connect'>, fn: (client: C) => Promise<T>): Promise<T>;
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

/** The part of pg's `types` that setInt8Parser uses. The app passes its own: `import { types } from 'pg'`. */
export type PgTypes = { setTypeParser: (oid: number, parser: (text: string) => unknown) => void };

/** pg's type id of int8 (BIGINT), which pg returns as a string by default. */
export const INT8_OID = 20;

/**
 * Sets the one int8 parser every app uses (ADR-0025, docs/conventions/pg-ids-and-rows.md): a BIGINT becomes a JS
 * number, and a value outside the safe integer range throws instead of being rounded silently. Call it once at
 * startup, before the first query. numeric (type 1700) stays a string.
 */
export function setInt8Parser(types: PgTypes): void {
  types.setTypeParser(INT8_OID, (text) => {
    const value = Number(text);
    if (!Number.isSafeInteger(value)) throw new Error(`int8 value ${text} is outside the safe integer range`);
    return value;
  });
}
