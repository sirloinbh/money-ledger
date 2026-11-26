# #359 Day log start page, Week, 12 weeks, and the shared menu order

- Issue: https://github.com/sirloinbh/money-ledger/issues/359
- Branch: `feat/359-day-log-start`

## Decision (user, 2026-11-27, choice A)

- A new **Day log** page at `/`: one day's entries, an "Add entry" button, and a day stepper (`?date=YYYY-MM-DD`, default today in Seoul).
- A **Week** page (`/week`): the 7 days of a week (Sunday to Saturday, as the reports) with the totals of each day. `?date=` is any day of the week shown; the stepper moves a week.
- A **12 weeks** page (`/12-weeks`): the weekly income and expense totals of the last 12 weeks up to this one. A week links to the Week page; a day links to the Day log.
- Menu order: Day log, Week, 12 weeks, Ledger, Asset portfolio, Goals, Mock trading, Reports, Dashboard, Settings.
- The Dashboard moves to `/dashboard`. The start page `/` is now the day log, and an unknown address redirects to it.

## Changes

- `backend/src/ledger/periods.ts`: `GET /api/ledger/periods?from=YYYY-MM-DD&unit=day|week&count=N` returns `{ unit, periods: [{ start, end, income, expense, balance }] }`, oldest first. Empty days and weeks are rows of zeros. For `week`, `from` moves back to its Sunday. At most 31 days or 26 weeks. Sums are SQL `numeric`. `docs/openapi.json` is regenerated.
- `frontend/src/entries.tsx`: `EntryManager` takes an optional `day`. With it the list is that one day, the form opens with "Add entry" (starting on that day) and closes after a save, and the period filters, CSV and card import are not shown (they stay on the Ledger page).
- `frontend/src/day-log.tsx`, `week.tsx`, `twelve-weeks.tsx`, `period-totals.tsx`, `period-data.ts`, `day-nav.ts`: the pages and date helpers.
- `frontend/src/app.tsx`: routes and menu order.
- Tests: validation and database tests of the periods API; day helpers, day log, Week, 12 weeks, EntryManager day mode, menu order and `/dashboard`.

## Notes

- The totals share the ledger query key with the other ledger reads, so a change to an entry reloads the day, week and 12 weeks totals.
