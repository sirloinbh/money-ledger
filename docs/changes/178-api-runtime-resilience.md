# #178: keep the API running when the database or job runner fails

Issue: https://github.com/sirloinbh/money-ledger/issues/178 (parent #206)

## Purpose

A pg-boss start-up failure kept the API from ever listening, because `server.ts` awaited `startJobs` and the first
`send` before `listen`. `GET /api/health` was public only because the shared sign-in middleware exempts it
internally, not by the order of the routes. `GET /api/jobs/status` answered 500 when the jobs were off, and the
shutdown handled only `SIGTERM` and skipped `pool.end()` when `jobs.stop()` rejected.

## Changes

| File                           | Change                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/runtime.ts`       | New. `backgroundJobs(mode)` starts the jobs after the API listens and logs a failed start (`jobs_start_failed`) or failed first send; its `status` handler answers 503 with the reason while jobs are off, starting, or failed. `shutdownOnce` closes the server, stops the jobs (a rejection is logged), then ends the pool, once for any number of signals. |
| `backend/src/server.ts`        | Listens first, then starts the jobs through `backgroundJobs`; `SIGINT` is handled like `SIGTERM`. The queue list is unchanged.                                                                                                                                                                                                                                |
| `backend/src/app.ts`           | `GET /api/health` is registered before `app.use('/api', options.auth)`, and the comment says so.                                                                                                                                                                                                                                                              |
| `backend/test/runtime.test.ts` | New behavior tests (below).                                                                                                                                                                                                                                                                                                                                   |

The pool `error` listener the issue asks for already exists: `server.ts` builds the pool with the managed
`createPool` (`standard/db.ts`), which listens on the pool and on every client. A test now pins that an idle-client
error on that pool does not throw; no second listener was added (it would log the same error twice).

`/api/jobs/status` answers 503 `{ "error": "Background jobs are off on this server" }` (or "still starting" /
"failed to start; see the server log") instead of a 500. The OpenAPI entry for this route is #181.

## Verification

- `backend/test/runtime.test.ts` (6 tests, pass): `/api/health` is 200 with an auth middleware that rejects every
  request (and `/api/me` is still 401); a rejected `startJobs` is logged, the API keeps answering, and
  `/api/jobs/status` is 503; jobs off gives 503 without starting pg-boss; running jobs give the shared status view and
  a failed first send is only logged; shutdown waits for a pending start, survives a rejecting `jobs.stop()`, still
  ends the pool, and runs once for two signals; `createPool` survives an idle-client `error` event.
- Manual run (`tsx src/server.ts`, port 3193):
  - wrong DB password: the API printed `API http://localhost:3193`, logged
    `{"event":"jobs_start_failed","message":"password authentication failed for user \"money\""}`, and kept answering
    (`/api/health` 500 from the DB, `/api/jobs/status` 503).
  - test DB with `PRICE_JOBS=off`: `/api/health` 200, `/api/jobs/status` 503 "off".
  - test DB with `JOBS_MODE=send`: `/api/jobs/status` 200 with the `daily-prices` and `dead-letter` queues.
- Test DB `money-ledger-test-agent3` (15493) migrated through 022 with `npm run db:migrate`.

### Commit `fix: keep the API running when jobs fail to start (#178)`

- `TEST_DATABASE_URL=postgres://…@127.0.0.1:15493/money_test npm run check`: exit 0. Backend 417 tests pass, 0
  skipped (DB integration tests ran); frontend 456 pass, 3 skipped (the existing skipped frontend cases); skills 4
  pass; build passes.
- `npm run knip` with the same `TEST_DATABASE_URL`: exit 0.

### Review round 1 (PR #234): changes needed, 1 finding fixed, 1 split off

- Fixed: when `startJobs` failed after `boss.start()` succeeded (for example a queue policy mismatch), the started
  PgBoss kept its own pool and timers, and shutdown could not stop it because no `Jobs` came back.
  `backgroundJobs().start(boss, open, afterStart)` now takes the boss and calls `boss.stop({ graceful: false })` after
  a failed start. The start-failure test asserts that stop call; a manual run with a wrong DB password still logs only
  `jobs_start_failed` and answers 503.
- Split off: #235 (retry a failed job start; pg-boss 12 has `start({ attempts })`, but the managed `startJobs` does
  not pass it). Linked under #206.
- Commit `fix: stop a partly started job runner after a failed start (#178)`: `npm run check` exit 0 (backend 417
  pass / 0 skipped, frontend 456 pass / 3 skipped, skills 4 pass, build ok); `npm run knip` exit 0.

## Limits

- The signal path (`SIGINT`/`SIGTERM`) was tested with fakes only; Windows does not deliver `SIGTERM` to a Node
  process, so it was not run by hand.
