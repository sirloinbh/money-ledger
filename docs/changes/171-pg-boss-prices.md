# 171. Daily price fetch on pg-boss (project-standards#556, ADR-0018)

## Purpose

Replace the hand-written price scheduler (one-minute `setInterval` plus a Postgres advisory lock) with a pg-boss queue through the shared helper `backend/src/standard/jobs.ts` (delivered by the sync PR).

## Changes

- `backend/package.json`: `pg-boss` 12.38.0 (exact, installed with `--ignore-scripts`), lockfiles synced.
- `backend/src/prices/jobs.ts`: queue `daily-prices`, `policy: 'singleton'`, `schedule: '0 12-18 * * *'` (Asia/Seoul), `retryLimit: 0` because the next hourly run is the retry. The handler calls `runIfDue`.
- `backend/src/prices/scheduler.ts`: removed `startPriceJobs`, the timer, and advisory lock 510001. `runIfDue` keeps the state-table checks, so it is safe to run twice. The singleton queue replaces the lock: pg-boss lets one job of the queue be active across servers.
- `backend/src/server.ts`: `startJobs(new PgBoss(jobBossOptions(...)), [priceQueue], { mode })`, one catch-up job at start (no key, so it counts with the cron's job under `singleton`), SIGTERM: `server.close` then `jobs.stop()` then `pool.end()`. `PRICE_JOBS=off` still maps to mode `off`; `JOBS_MODE` works too.
- `backend/src/app.ts`: option `jobsStatus` mounts `GET /api/jobs/status` after the shared sign-in middleware.
- Tests: the lock test is replaced by a handler and queue test; `test/jobs.integration.test.ts` runs real pg-boss and checks the status route is 401 without sign-in.

## Limits

- `backend/src/standard/jobs.ts` arrived with the sync PR #170.
- The status route has no OpenAPI entry yet.
