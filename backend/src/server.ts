import { Pool } from 'pg';

import { createApp } from './app.js';
import { logPriceEvent, sourcesFromEnv, startPriceJobs } from './prices/index.js';

const port = Number(process.env.PORT ?? 3105);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prices = sourcesFromEnv();
const server = createApp(pool, { prices, priceLog: logPriceEvent }).listen(port, '0.0.0.0', () =>
  console.log(`API http://localhost:${port}`),
);
// PRICE_JOBS=off keeps the daily fetch from running, e.g. for a second local server on the same DB.
const stopPriceJobs =
  process.env.PRICE_JOBS === 'off' ? () => undefined : startPriceJobs(pool, prices, logPriceEvent);
process.on('SIGTERM', () => {
  stopPriceJobs();
  server.close(() => {
    void pool.end();
  });
});
