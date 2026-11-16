# #62 Weekly and monthly spending reports

Each finished week (Sunday to Saturday) and month gets a saved report. A report has the spending, the change from the period before, and the top three categories. A monthly report also lists the categories that reached or passed their budget. The dashboard shows a notice of new reports until each one is opened.

## Decisions

The user decided these on 2026-11-16, and they are recorded on #62.

- **Notification:** in the app, when it opens. Email or push waits for the publishing decision.
- **Contents:** total spending, the change from the previous period, and the top 3 categories, for both weeks and months. Only the monthly report has the overspending list (#61), because budgets are monthly.
- **Snapshot:** a report keeps what it said when it was made. Later edits to entries do not change it. There is one report per period, never made twice.

## What changed

- `database/migrations/021_spending_reports.sql`: the `spending_reports` table.
  - Columns: `period` (`week` or `month`), `start_date`, `end_date` (inclusive), a `content` snapshot (jsonb with text amounts, so they stay exact), `created_at`, and `seen_at`.
  - `UNIQUE (period, start_date)`.
  - CHECKs: a week starts on a Sunday and lasts 7 days; a month starts on the 1st and ends on its last day.
- `backend/src/reports.ts`, mounted at `/api/reports`:
  - `POST /generate` makes the reports of the finished periods that have none yet. It runs in one transaction behind an advisory lock and inserts with `ON CONFLICT DO NOTHING`, so two opens at once still make one report per period.
  - `GET /` lists the reports (newest first) with the total and whether each was seen.
  - `GET /:id` returns one report and does not change anything.
  - `PUT /:id/seen` marks a report seen, which clears its notice.
  - All sums, changes, and shares are computed in SQL. Overspending reuses the #61 budget query (`budgetListSql`, now exported from `budgets.ts`).
- `frontend/src/reports-api.ts`: `makeReportsOnce()` runs once per page load, after the due fixed-cost entries are added, since those count as spending. `periodLabel` gives "Week of Nov 8 – Nov 14, 2026" or "October 2026".
- `frontend/src/reports.tsx`
  - **Reports** page (`/reports`, new menu item): each report with its period, Weekly or Monthly, the amount spent, and a "New" badge.
  - **Spending report** page (`/reports/:id`):
    - the amount spent and the previous period's, with the change in words ("₩5,000 less than the week before")
    - the top 3 categories with their shares
    - for a month, the overspending list in the #61 wording
    - a line saying when the report was saved and that later edits are not reflected

    Opening it marks it seen.
- `frontend/src/dashboard.tsx`: a "New spending report(s)" box above the cards links each unseen report. With none, nothing is shown.
- `frontend/src/app.tsx`: the routes and menu item, and `makeReportsOnce()` when the app opens.

## Choices made here

- **Which periods are made:** with no report at all, only the latest finished week and month are made, so a first open does not fill in history. After that, missed periods are filled in on the next open, up to 8 weeks and 12 months back.
- **Timing:** a report is saved at the first open after its period ends. Spending entered after that, such as last Saturday's coffee added on Sunday, is not in it. This follows the snapshot decision. The ledger and the monthly summary always show current numbers.
- **What a period contains:** income is not counted, but uncategorized spending is, as one "Uncategorized" row. Category names in a report are kept as they were when it was saved.

## Verification (2026-11-16)

- `backend/test/reports.integration.test.ts` (test DB, 7 passed, none skipped):
  - **Contents:** the latest finished week includes Sunday and Saturday, leaves out the next Sunday and income, and the previous week counts toward the change. The top 3 include uncategorized, with shares to one decimal. October's overspending lists exactly-at-budget and over, but not within.
  - **Seoul boundaries:** 14:59:59 UTC on Saturday 11-14 is still Saturday in Seoul (latest week 11-01). One second later it is Sunday 11-15 in Seoul, and the week of 11-08 is made. The 1st of a month makes the month before.
  - **Once per period:** two opens at the same time make two reports in total (one week, one month), and a third open makes none. A later entry leaves the saved total as it was.
  - **Catch-up:** a first open makes only the latest periods. After 15 weeks away, the next open makes the last 8 weeks and the 4 missed months.
  - **Seen and errors:** GET does not mark a report seen and PUT does. A missing id is a 404.
  - **DB checks:** the CHECKs refuse a week that does not start on Sunday and a month that does not start on the 1st.
- `backend/test/reports.test.ts`: a malformed id is a 400.
- Screen tests:
  - `reports.test.tsx`, 5:
    - the list, with saving before reading
    - the empty list
    - a weekly report, with the change, the top 3, the hidden mark, and being marked seen
    - a monthly report with overspending
    - failure and retry
  - `dashboard.test.tsx`: the notice links the unseen reports only, and does not show when all were opened.
  - `app.test.tsx`: the menu opens Reports.
- Browser check: headless Edge over the DevTools protocol, with the API and Vite running against the test DB. The data was added through the API before the first page load: October budgets and spending, and entries on 11-07, 11-08, 11-10, 11-14, and 11-15.
  - The dashboard announced "Week of Nov 8 – Nov 14, 2026 · spent ₩55,000" and "October 2026 · spent ₩110,000".
  - The week's report showed ₩55,000, the previous week ₩60,000, "₩5,000 less than the week before", and the top 3. Going back, only October was still announced.
  - October showed ₩110,000 and the overspending: 식비 at exactly ₩40,000, and 교통 ₩20,000 over at 140.0%.
  - Page width was 390 at 390×844 and 1425 at 1440×900, so there was no horizontal scroll.
  - A first run added the data after the app had opened, so its reports were saved with ₩0. That is the snapshot working as decided, which is why the data was added first.
- Whole backend suite on the test DB: 374 passed, none skipped.
- `npm run check` passed: frontend 356 passed / 2 skipped; backend 181 passed / 19 DB tests skipped (no test DB in that run). `npm run knip` passed.
