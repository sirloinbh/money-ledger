# #205 Rebuild finished reports when their entries change

- Issue: [#205](https://github.com/sirloinbh/money-ledger/issues/205)
- Branch: `feat/205-rebuild-changed-reports` (started on the #204 branch, PR #243, merged before this PR)
- Parent: #90 Spending review and reports

## Decision (user, 2026-11-22, recorded on #205)

**Regenerate on change.** When an entry inside a finished report's period is added, edited or deleted, that report is rebuilt automatically. This replaces the 2026-11-16 rule of #62 that a report is a snapshot of the day it was made.

Choices made while applying it (no separate user decision needed; reverse them in a new migration if wanted):

- Only expense entries count, since a report is about spending. An edit that changes none of the date, kind, amount or category (for example only the memo) does not rebuild anything.
- A report also shows the change from the period before it, so an entry dated in that earlier period rebuilds the report too (a week's report follows the week before; a month's report follows the month before).
- Budgets, category names and hidden flags are not watched: a budget change after the month has ended does not rebuild the monthly report by itself. The next entry change in that period picks it up.
- **Back-fill is unchanged:** a period that never got a report (it ended before the first entry, or it is past the 8-week / 12-month catch-up limit) is not created later. This matches #49 (no back-fill).
- Whether a report was seen is kept when it is rebuilt; a rebuilt report is not announced again.

## Changes

- `database/migrations/026_spending_report_changes.sql`
  - `spending_reports.rebuilt_at timestamptz` and an insert-only log table `spending_report_changes (entry_date)`.
  - An `AFTER INSERT OR UPDATE OR DELETE` row trigger on `ledger_entries` logs the old and new date of an expense entry when that date is in a saved report's period or the period before it. Logging in the trigger covers every writer (entry form, CSV import, classification, fixed costs, AI tools) without changing their code. A memo-only edit and income entries log nothing.
  - The log is insert-only, so two entry transactions never wait for each other on it. (The first version marked report rows `stale` with an `UPDATE`; two transactions writing entries of the same two reports in opposite orders could deadlock, found in review round 1.)
  - The trigger takes the reports' advisory lock in shared mode; making or rebuilding reports takes it in exclusive mode. So an entry change either commits before a report is built, and the build sees it, or waits until the build commits and is then logged against the new report. Without this, an entry saved while a new report was being made could be missing from it for good.
- `backend/src/reports.ts`
  - `rebuildChanged` recomputes every report that a logged date touches with the same one-statement query as a new report (#204), sets `rebuilt_at`, and clears the log. It runs under the exclusive lock, so no change is logged in between and clearing the whole log loses none.
  - `generateReports(pool, today)` (the daily job in #185 can export and call it) rebuilds changed reports, then makes the new ones, in one transaction under the exclusive lock.
  - `GET /api/reports` and `GET /api/reports/:id` rebuild first when the log is not empty, so a report opened right after an entry change already shows it.
  - Each report has `updatedOn`: the service date of the last rebuild, or `null`.
- `frontend/src/reports.tsx`, `frontend/src/reports-api.ts`: the report footer now says "Saved on <date>[, updated on <date>]. It is updated when an expense entry in this period, or the one before it, is added, changed or deleted." instead of "Entries changed after that are not reflected here".

## Verification

Tests added or changed:

- `backend/test/reports.integration.test.ts`
  - The reset applies `026` twice (safe to re-run).
  - "a period is made once, even when two opens run at the same time" (the old snapshot assertion was removed; the rest kept).
  - "a report is rebuilt when an expense entry in its period changes (#205)": add, change and delete an entry and the week's report and list follow; October is not rebuilt; `updatedOn` is set; an entry in the week before changes `previousTotal` and `change`; income, a memo-only edit and an entry outside every report's periods log nothing; an income entry turned into an expense is logged; `POST /generate` also rebuilds and clears the log, and `seen` is kept.
  - "two transactions changing entries of the same reports never wait on each other": two open transactions add entries to the week and October in opposite orders and both commit (regression test for review round 1; the deadlock of the first version was reasoned from the lock order, not reproduced against it).
  - "an entry saved while reports are made is never lost": an uncommitted expense entry makes `POST /generate` wait; after the commit the new week's report includes it.
- `frontend/src/reports.test.tsx`: the footer text for a report as first made, and "Saved on …, updated on …" for a rebuilt one. `frontend/src/dashboard.test.tsx`: fixture gains `updatedOn`.

Commands (local, test DB `postgres:17-alpine` with every migration applied, `TEST_DATABASE_URL` set):

- `tsx --test test/reports.integration.test.ts`: 11 pass, 0 fail, 0 skipped (after round 1).
- `vitest run src/reports.test.tsx src/dashboard.test.tsx`: 16 pass.
- `npm run check` and `npm run knip`: see the PR body.

Browser check (local API 3195 and Vite 5295, dev DB): an expense entry added on 2026-11-18 marked the finished week of 11-15 to 11-21; `GET /api/reports` answered it rebuilt (total ₩0 → ₩12,000, `updatedOn` set). The report page shows "Saved on 2026-11-22, updated on 2026-11-22. It is updated when …" at 390×844 and 1440×900, with no horizontal scroll.

## Limits

- Rebuilding happens when reports are listed, read or generated, not inside the entry's own transaction, so the stored content of a changed report is old until the next read. Every read path rebuilds first, so the screen never shows it.
- A large CSV import logs one row per changed entry; the next read rebuilds each touched report once and clears the log.

## Review

- Round 1: changes needed, 1 finding. Marking report rows `stale` from the entry trigger let two transactions writing entries of the same reports in opposite orders deadlock (for example a CSV import and the fixed-cost add on app open). Fixed in "fix: log report changes insert-only so entry writes cannot deadlock (#205)": an insert-only change log replaces the `stale` column, with a regression test.
