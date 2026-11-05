import type { Pool, PoolClient } from 'pg';

/** Runs `work` in one transaction: COMMIT when it resolves, ROLLBACK when it throws (and rethrows). */
export async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // A connection that cannot even roll back is dropped instead of going back to the pool.
    await client.query('ROLLBACK').catch(() => {
      broken = true;
    });
    throw error;
  } finally {
    client.release(broken);
  }
}
