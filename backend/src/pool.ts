import { Pool } from 'pg';

import { createPool } from './standard/db.js';

// pg reports a lost connection as an `error` event, and an event nobody listens to ends the process. The managed
// createPool listens on the pool, which covers idle clients. pg stops listening on a client while it is checked out
// (in a transaction, between its queries), so every connection also gets its own listener, and that one logs (an idle
// client reports on both, so the pool-level listener stays quiet). Queries on a lost connection still reject and
// answer 500; the pool replaces the connection.
export function connectPool(connectionString: string | undefined) {
  const pool = createPool(new Pool({ connectionString }), () => undefined);
  pool.on('connect', (client) =>
    client.on('error', (error) =>
      console.error(JSON.stringify({ event: 'db_connection_error', message: error.message })),
    ),
  );
  return pool;
}
