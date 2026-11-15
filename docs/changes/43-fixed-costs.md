# #43 Fixed costs added every month

- Issue: https://github.com/sirloinbh/money-ledger/issues/43
- Branch: `feat/43-fixed-costs`

## Purpose

Register rent, the date savings account, electricity, gas, and phone once, and have their expense entries added every month, so none are missed.

## Decisions (confirmed by the user on 2026-11-15, recorded in an issue comment)

1. Rent and the date savings account use a fixed amount. Electricity, gas, and phone are added as an estimate that the user confirms with the actual amount.
2. No scheduler. Opening the app adds the due entries that are missing, skipped months included.
3. A variable item's estimate is its last confirmed amount; the first month uses the item's own amount.

## Decided during implementation

- Migration 020: `ledger_fixed_costs` (name, expense category, amount, variable, day 1–31, start month, active) and `ledger_fixed_cost_runs` (item, month, entry, confirmed). A run row marks a month as handled, so a month is added once (its primary key also stops two opens at the same time) and an entry the user deletes is not added again.
- An entry is due on its day, or the month's last day when the day is past the end (31 → Feb 28/29, Apr 30), once that date is today or earlier.
- There is no delete. "Stop" turns an item off; "Start again" restarts it from the current month, so the stopped months are not filled in.
- Editing an item only affects entries added later.
- The five items are presets that fill the add form (name, category by its default name, fixed or variable), not seeded rows, because their amounts and days are unknown.
- The ledger page has a "Fixed costs" section after the monthly trend: the month's fixed-cost total next to the other spending, each item with this month's entry (added, estimate to confirm, or none), add, edit, stop or start again, and "Confirm amount".
- The app calls `POST /api/ledger/fixed-costs/generate` once per page load (next to the #49 net worth save); the section waits for it and reloads the rest of the page when entries were added. Saving an item also adds what became due right away.
- API: `GET /api/ledger/fixed-costs?month=`, `POST /`, `PATCH /:id`, `POST /generate`, `PUT /:id/months/:month` (confirm the actual amount).

## Verification so far

- `backend/test/fixed-costs.integration.test.ts` on a dedicated test DB (`money-ledger-test-agent1`, migrations 001–020): 8 subtests passed, 0 skipped: due months once and not before the day, two opens at once add one entry, day 31 incl. a leap year, estimate from the last confirmed amount and confirming, a deleted entry does not come back, stop/start without backfill, the fixed vs other split, input checks. Migration 020 applied twice without error.
- `frontend/src/fixed-costs.test.tsx` (6 tests) and `frontend/src/app.test.tsx` (13 tests, one new for adding due entries once): passed, 3 runs in a row.
- Lint and typecheck of the changed files passed.

## Not done yet (stopped here on 2026-11-15)

- `npm run check` passed on this commit (backend 173 passed, 17 DB tests skipped without a test DB; frontend 320 passed, 2 skipped) and `npm run knip` passed after making `addDueEntries` module-private. Rerun both after the browser check.
- Browser check at 390×844 and 1440×900. A headless Edge script (DevTools protocol, the same approach as #76) was written but stopped on a quoting error in the script itself, not in the app.
- PR, the two automatic reviews, CI, and merge.
