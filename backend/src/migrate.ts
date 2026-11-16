// #71 Applies pending migrations: `node dist/migrate.js` in a deploy (deploy/remote-deploy.sh, which mounts the
// files at /database/migrations) and `npm run db:migrate` on the host. From both dist and src this path is the
// repository's database/migrations, or that mount.
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { migrate, readMigrations } from './migrations.js';

const dir = fileURLToPath(new URL('../../database/migrations/', import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required. Check .env.');
  process.exit(1);
}
const pool = new Pool({ connectionString: url });
// A connection lost midway rejects the query, which names the file that failed; this only keeps an idle client's
// error from crashing the process first.
pool.on('error', () => undefined);
try {
  const client = await pool.connect();
  try {
    const applied = await migrate(client, await readMigrations(dir));
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'No migrations to apply.');
  } finally {
    client.release();
  }
} catch (error) {
  // A deploy stops on this exit code, before it starts the new version.
  // A refused connection to localhost, which has two addresses, has a code but an empty message.
  const { message, code } = error as NodeJS.ErrnoException;
  console.error(message || `Cannot connect to the database (${code})`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
