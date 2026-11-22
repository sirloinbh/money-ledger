# #235: retry a failed background job start

Issue: https://github.com/sirloinbh/money-ledger/issues/235 (parent #206; split off from #178, PR #234)

## Purpose

Since #178 a failed pg-boss start is only logged, so a database that is briefly down when the API starts left the
daily price fetch and the mock snapshot off until the next restart.

## Decision

The retry lives in the app (`backend/src/runtime.ts`), not in the managed `startJobs`: it retries the whole start
(every registered queue, not only prices), so a queue added later, for example the daily job of #185, is covered
without more code. pg-boss 12's own `start({ attempts })` was not used because the managed `startJobs` calls `start()`
with no options and it would not cover a failure after `boss.start()` (queue creation, schedules).

## Changes

| File                           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/src/runtime.ts`       | `backgroundJobs(mode, log, retryDelaysMs)`: `start(createBoss, open, afterStart)` makes a new boss per attempt, stops a failed one, and tries again after 5, 15, 30, 60, 120 and 300 s (`START_RETRY_DELAYS_MS`, 7 attempts over about 9 minutes). Each failure logs `jobs_start_failed` with `attempt` and `retryInSeconds`, or `final: true`. A new `retrying` state answers `/api/jobs/status` with 503 "failed to start and will try again". `stop()` cancels a waiting retry at once. |
| `backend/src/server.ts`        | Passes `() => new PgBoss(...)` instead of one instance (one line; the queue list is unchanged).                                                                                                                                                                                                                                                                                                                                                                                            |
| `backend/test/runtime.test.ts` | Existing tests use a boss factory; three retry tests below.                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Verification

- `backend/test/runtime.test.ts`: 9 pass (3 runs in a row). New: a start that fails once runs on a new boss, only the
  failed boss is stopped, the first send runs once, and `/api/jobs/status` is 503 "will try again" during the retry
  and 200 after; after the last retry the state is `failed` and the log ends with `final: true`; a stop during a
  60 s retry wait returns at once without a new attempt.
- Manual runs of `src/server.ts` on port 3193:
  - wrong DB password: attempts logged at +0 s (`retryInSeconds: 5`), +5 s (15), +20 s (30); `/api/jobs/status`
    answered 503 "will try again".
  - test DB stopped at start and started 8 s later (`JOBS_MODE=send`): attempts 1 and 2 failed with `ECONNREFUSED`,
    attempt 3 started the jobs, and `/api/jobs/status` answered 200 with the `daily-prices` queue.
- `TEST_DATABASE_URL=<agent3 test DB> npm run check` (shared lock): exit 0. Backend 443 pass / 0 skipped, frontend 480
  pass / 3 skipped, skills 4 pass, build ok.
- `npm run knip`: first exit 1 (`START_RETRY_DELAYS_MS` exported but unused elsewhere); the export was dropped (it is
  only the default), then knip exit 0, and `eslint` and backend `tsc` pass on the changed file.
