import type { Pool, PoolClient } from 'pg';

import { withTransaction } from './standard/db.js';

/** Runs `work` in one transaction: COMMIT when it resolves, ROLLBACK when it throws (and rethrows). */
export const inTransaction = <T>(pool: Pool, work: (client: PoolClient) => Promise<T>) =>
  withTransaction<T, PoolClient>(pool, work);
