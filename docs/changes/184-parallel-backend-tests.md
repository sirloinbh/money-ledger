# #184 Run backend tests in parallel

- Issue: [#184](https://github.com/sirloinbh/money-ledger/issues/184)
- Branch: `test/184-parallel-backend-tests`
- Parent: #207 Fast and trustworthy tests
- Decision: option A (coordinator, 2026-11-22): a database per test file cloned from the test DB, instead of porting health-log's `inSnapshot`. Guards asked for: no test connects to the template; a clear error when it is busy; clones dropped even when a file fails; leftovers of killed runs cleaned by name; an explicit `--test-concurrency`; pool sizes well under `max_connections`; serial and parallel times recorded.

## Purpose

`backend/package.json` ran all 49 test files one at a time (`--test-concurrency=1`) because the 24 DB test files share one database and empty it with `TRUNCATE`.

## Why not `inSnapshot`

health-log's `inSnapshot` runs a test on one connection inside one REPEATABLE READ transaction that is rolled back. Most DB tests here cannot run that way: 11 files reset with `TRUNCATE ... RESTART IDENTITY` and rely on the restarted ids, 21 re-run migrations in their setup (DDL from parallel files would conflict), 9 send concurrent requests with `Promise.all` (several connections, real commits), and the jobs test starts pg-boss. Porting it would have meant rewriting those files and still running some of them one at a time.

## Changes

- `backend/test/test-database.ts`: `testDatabase()` copies `TEST_DATABASE_URL` with `CREATE DATABASE <name> TEMPLATE money_test` through the `postgres` maintenance database and returns the copy's URL. The name is `money_test_c<pid>_<random hex>`.
  - The copy is dropped `WITH (FORCE)` in a root `after()` hook, which runs after the file's tests even when they fail.
  - Before copying, it drops `money_test_c*` copies whose process no longer exists (a killed run).
  - If another session is connected to the template (PostgreSQL error 55006), it fails with "Cannot copy money_test: another session is connected to it ...".
  - Without `TEST_DATABASE_URL` it returns `undefined`, and the DB tests stay skipped as before.
- The 24 DB test files: `const url = await testDatabase();` instead of reading `TEST_DATABASE_URL`. Test bodies are unchanged. `ai-tools.integration.test.ts` read the variable in two places; it now uses `url` too.
- `backend/package.json`: `--test-concurrency=4` (was 1). An explicit number rather than the default (CPU count − 1), for this 16 GB machine and small CI runners.
- Connections: at most 4 files at once, each with its `pg` pool (max 10, opened only as needed) and at most one more pool (a time-zone pool or pg-boss) for a short time, plus one admin connection while copying or dropping. That stays well under `max_connections` (100), so pool sizes are left at the default.
- `README.md` and `docs/project-setup.md`: the DB user must be allowed to create databases, and nothing else may be connected to the test DB during a run.

## Verification

- Times for `npm test -w backend` (461 tests, `TEST_DATABASE_URL` set, local Docker PostgreSQL 17, through the shared check lock):

| Run                                                      | Result           | Time |
| -------------------------------------------------------- | ---------------- | ---- |
| Before: `origin/main` test files, `--test-concurrency=1` | 461 pass, 0 fail | 65 s |
| After, run 1                                             | 461 pass, 0 fail | 25 s |
| After, run 2                                             | 461 pass, 0 fail | 25 s |
| After, run 3                                             | 461 pass, 0 fail | 24 s |

- After each run, no `money_test_c*` database is left.
- Leftover cleanup: a `money_test_c999999_deadbeef` copy (no such process) was dropped by the next test file.
- Busy template: with `psql` connected to `money_test`, a test file fails with the "Cannot copy money_test" message.
- `npm run check` and `npm run knip`: results in the PR body.

## Review

## Limits

- A test file must not connect to `money_test` directly; use `testDatabase()`.
- The database user needs the right to create databases (true for the local container and for CI's `app` user).
