// Managed file. Edit it in sirloinbh/project-standards templates/app/backend/src/standard/
// Host, CI and deploy command for the shared migration runner (standard/migrations.ts).
// Usage: npm run db:migrate            applies pending files
//        npm run db:migrate -- --status only reports (no database change)
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { migrate, migrationStatus, readMigrations } from './migrations.js';

// The advisory lock key of this app: 581_000 plus its registry slot, so no two apps share one.
const lockKey = 581_000 + 5;
// backend/src/standard (tsx) and /app/dist/standard (the image) are both three levels below the folder that holds database/.
const dir = fileURLToPath(new URL('../../../database/migrations/', import.meta.url));

const flags = process.argv.slice(2);
const unknown = flags.filter((flag) => flag !== '--status');
if (unknown.length) {
  console.error(`Unknown option: ${unknown.join(' ')}. The only option is --status.`);
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required. Check .env.');
  process.exit(1);
}
const client = new Client({ connectionString: url });
await client.connect();
try {
  const files = await readMigrations(dir);
  if (flags.includes('--status')) {
    const status = await migrationStatus(client, files);
    const done = new Set(status.applied.map((row) => row.name));
    for (const file of files) console.log(`${done.has(file.name) ? 'applied' : 'pending'}  ${file.name}`);
    for (const error of status.errors) console.error(`error  ${error}`);
    process.exitCode = status.errors.length ? 1 : 0;
  } else {
    const applied = await migrate(client, files, lockKey);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'No pending migrations.');
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
