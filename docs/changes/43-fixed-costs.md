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

## Verification

- `backend/test/fixed-costs.integration.test.ts` on a dedicated test DB (`money-ledger-test-agent1`, migrations 001–020): 8 subtests passed, 0 skipped: due months once and not before the day, two opens at once add one entry, day 31 incl. a leap year, estimate from the last confirmed amount and confirming, a deleted entry does not come back, stop/start without backfill, the fixed vs other split, input checks. Migration 020 applied twice without error.
- `frontend/src/fixed-costs.test.tsx` (6 tests) and `frontend/src/app.test.tsx` (13 tests, one new for adding due entries once): passed, 3 runs in a row.
- Lint and typecheck of the changed files passed.

- `npm run check` (with `TEST_DATABASE_URL` unset): passed (backend 173 passed, 17 DB tests skipped; frontend 320 passed, 2 skipped). `npm run knip` passed after making `addDueEntries` module-private.
- Full backend on the dedicated test DB (`money-ledger-test-agent2`, migrations 001–020), 2026-11-16: 348 passed, 0 failed, 0 skipped.

### Browser (2026-11-16)

Headless Edge driven over the DevTools protocol (the Claude in Chrome extension was not connected), the local API on the test DB and Vite, `/ledger?month=2026-11`, today 2026-11-16.

- 390×844 (mobile emulation): the Rent preset filled the name and 주거; with ₩500,000, day 25 and start 2026-09, saving added 2026-09-25 and 2026-10-25 and showed "No entry this month" for November (the 25th is not due yet). The Electricity preset (variable, ₩40,000, day 10) showed "Estimate ₩40,000 on 2026-11-10 · needs the actual amount"; "Confirm amount" focused the field, and 52,340 showed "Added ₩52,340" with the status "Electricity confirmed at ₩52,340". Page width 390, no horizontal scroll.
- 1440×900: after a reload the same two items and totals ("Fixed costs ₩52,340") showed, and the entries were still exactly the three above (no month added twice). The add form lays out in two columns.

### First review (PR #144)

- No blocking issues. Fixed in this PR:
  - A start month more than 24 months back is refused (422), so a typo like 2006 for 2026 cannot add hundreds of entries at once. The form hint says so.
  - On the screen, a save counts as done once the item's own request succeeds. If adding its entries then fails, the alert says the change was saved and the entries come at the next open; the list still reloads, so a retry cannot add the item twice.
  - A failed add on app open is no longer remembered, so the next load tries again.
  - Confirming only changes an entry that is still an expense; an entry changed to income in the entry list gets 404 and the run stays unconfirmed.
  - Closing the add or edit form puts the focus on the section title instead of the page.
- Tests: DB subtests for the start-month limit and the income case, screen tests for the failed add after a save and the focus on close.
- Not changed: the totals count fixed-cost entries by their date, the item row by the month they were added for. If the user moves an entry to another month in the entry list, the two differ for that entry; this is expected. The extra fetch when the first open adds entries is kept (it refreshes the other cards).
- After the fixes: `npm run check` passed (frontend 322 passed / 2 skipped; backend 173 passed / 17 DB tests skipped), `npm run knip` passed, and the fixed-cost DB tests passed 9/9 subtests on the test DB.

### Second review (PR #144)

- Nothing to fix: the 24-month boundary (exactly 24 back is allowed), the confirm 404 rollback, the retry of a failed add, and the save/add split were checked.
- Left as is (nitpicks): the focus after closing a form is not conditional on where the focus is; and the warning after a failed add says "the next time the app opens", which is accurate there, because the add on open has already succeeded by the time an item is saved.
