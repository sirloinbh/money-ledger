import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';

import { createApp } from './app.js';
import { snapshotOpenAccount } from './mock-snapshots.js';
import { logPriceEvent, PRICE_QUEUE, priceQueue, sourcesFromEnv } from './prices/index.js';
import { sharedAuth } from './standard/auth.js';
import { createPool } from './standard/db.js';
import { jobBossOptions, jobsModeFromEnv, jobsStatus, startJobs } from './standard/jobs.js';

const port = Number(process.env.PORT ?? 3105);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = createPool(new Pool({ connectionString: databaseUrl }));
const prices = sourcesFromEnv();
const boss = new PgBoss(jobBossOptions(databaseUrl));
// PRICE_JOBS=off still works (the old switch); JOBS_MODE=off|send is the shared one (docs: price-source.md).
const mode = process.env.PRICE_JOBS === 'off' ? 'off' : jobsModeFromEnv();
// After each daily fetch the open mock account's value is saved for the return chart (#54).
const jobs = await startJobs(
  boss,
  [priceQueue(pool, prices, logPriceEvent, (now) => snapshotOpenAccount(pool, now))],
  { mode },
);
// A server that was off at 12:00 fetches once when it starts; the handler skips it when nothing is due.
// No key: a `singleton` queue allows one running job per key, so a keyed job could overlap the cron's job.
await jobs.send(PRICE_QUEUE, {});
const server = createApp(pool, {
  prices,
  priceLog: logPriceEvent,
  auth: sharedAuth(),
  jobsStatus: jobsStatus(jobs.boss),
  toolsPublicKey: process.env.AI_TOOLS_PUBLIC_KEY,
}).listen(port, '0.0.0.0', () => console.log(`API http://localhost:${port}`));
process.on('SIGTERM', () => {
  server.close(() => {
    void jobs.stop().then(() => pool.end());
  });
});
