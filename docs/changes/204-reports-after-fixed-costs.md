# #204 Generate reports after due fixed costs and show missing reports

- Issue: [#204](https://github.com/sirloinbh/money-ledger/issues/204)
- Branch: `fix/204-reports-after-fixed-costs`
- Parent: #90 Spending review and reports

## Purpose

The code review on 2026-11-18 found three problems in the spending reports: the app made reports even when adding the due fixed-cost entries had failed, so a report could be saved without them; the monthly overspending list was read in a second statement, so under READ COMMITTED it could see entries the totals did not; and `/reports/999` or `/reports/abc` showed "Could not load this report" with a "Try again" button that could never work.

## Changes

- `frontend/src/fixed-costs-api.ts`: new `addDue()` that rejects when adding the due entries failed (the failure is still forgotten, so the next caller tries again). `addDueOnce()` keeps its old meaning (a failure resolves with 0) for callers that go on either way.
- `frontend/src/reports-api.ts`: `makeReportsOnce()` waits on `addDue()`, so when adding the due entries failed, no `POST /api/reports/generate` is sent on that open. The next call tries both again.
- `backend/src/reports.ts`: the monthly overspending list is now part of the report's one content statement (`budgetListSql` as a subquery, filtered on `reached`/`over`), so every number of a report comes from one snapshot. The stored JSON has the same keys and values as before. A weekly report stores `overspending: null` as before.
- `frontend/src/reports.tsx`: the report page checks the id (digits only) before asking the server, and a 404 answer or a bad id shows "Report not found. It may have been removed, or the address is wrong." without "Try again". A report loaded for another id is not shown under the new address.

### Why one statement instead of `REPEATABLE READ`

The issue suggested running generation under `REPEATABLE READ`. Generation first takes `pg_advisory_xact_lock` so two opens wait for each other. Under `REPEATABLE READ` the snapshot would start at that lock statement, before the wait, so the second open would not see the reports the first one saved and its `INSERT … ON CONFLICT DO NOTHING` would fail with a serialization error (`40001`, the same problem #195 reports for net worth). Putting the overspending list into the content statement gives the issue's goal, one snapshot for every number of a report, without that failure.

## Verification

Tests added or changed:

- `frontend/src/reports-api.test.ts` (new): reports are made after the due entries; when `fixed-costs/generate` fails, no `reports/generate` request is sent and the next call tries both again (this test fails when `makeReportsOnce` uses the old `addDueOnce`).
- `frontend/src/reports.test.tsx`: "an unknown report id says the report was not found, without Try again" (`/reports/999`, 404) and "an id that is not a number is not found, and is not sent" (`/reports/abc`).
- `backend/test/reports.integration.test.ts` (unchanged) still checks the stored monthly overspending list (reached and over, with spent, budget, over and percent), so the one-statement query keeps the same content.

Commands (local, test DB `postgres:17-alpine` with every migration applied, `TEST_DATABASE_URL` set):

- `tsx --test test/reports*.test.ts`: 9 pass, 0 fail, 0 skipped.
- `vitest run src/reports.test.tsx src/reports-api.test.ts src/fixed-costs.test.tsx src/app.test.tsx src/dashboard.test.tsx`: 38 pass.
- `npm run check`: pass (backend 412 pass / 0 fail / 0 skipped; frontend 71 files, 467 pass, 3 skipped that were skipped before; skills 4 pass; build ok).
- `npm run knip`: pass (only the existing configuration hints).

Browser check (local API 3195 and Vite 5295):

- 390×844: `/reports/999` shows "Report not found…" with only "All reports"; the server answered 404.
- 1440×900: `/reports/abc` shows the same message and sends no `/api/reports/abc` request; `/reports/1` still shows the saved week. No horizontal scroll.

## Limits

- When adding the due entries keeps failing, no report is made on app open. The daily server job planned in #185 makes them too.
