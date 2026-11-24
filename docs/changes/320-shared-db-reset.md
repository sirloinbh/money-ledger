# 320 Reset the test DB with one shared helper

## Purpose

DB integration tests each kept a hand-written `DROP TABLE IF EXISTS ...` list without `CASCADE`. A new table with a foreign key broke every other file's drop (about 96 tests when #308 tried it), so #308 and #294 shipped tables without keys. One shared reset removes that cost.

## Changes

- `backend/test/helpers.ts`: `resetDatabase(pool)` drops the `public` schema with `CASCADE`, recreates it, and applies every migration file in name order. The files are read once per test file. A reset takes about 170 ms.
- 22 DB integration test files call `resetDatabase` instead of their own `DROP TABLE` list and `runMigration` loop. No test file has a `DROP TABLE` list any more. Tests that only `TRUNCATE` their own tables are unchanged.
- `database/migrations/047_missing_foreign_keys.sql` adds the keys that were left out: `mock_cash_flows.account_id` → `mock_accounts` (#294), `daily_picks.security_id` → `securities` and `daily_picks.order_id` → `mock_orders` (#308). It is safe to re-run. No row is ever deleted from the referenced tables, so existing data satisfies the keys.
- `backend/test/picks.integration.test.ts`: the fake buy now stores a real order (the key rejects made-up ids like 501), and a new test shows each key rejects a missing parent.
- Migrations 030 and 043 are not edited: the runner refuses a changed applied file. Their "no foreign key on purpose" comments stay as history, and 047 states the reason.

## Verification

- `npm run lint`, `npm run typecheck`, `npm run knip`: clean.
- Backend tests on the dedicated test DB (`TEST_DATABASE_URL`), 0 skipped: see the PR for the final `npm run check` result.
