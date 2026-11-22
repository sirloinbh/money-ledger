# #195 Save and show daily net worth reliably

- Issue: [#195](https://github.com/sirloinbh/money-ledger/issues/195)
- Branch: `fix/195-net-worth-saves`
- Parent: #91 Investment asset trading and valuation

## Purpose

The code review on 2026-11-18 found four problems with the daily net worth: two saves of the same day at once made the second answer 500 (`40001` from the upsert inside `REPEATABLE READ`); the app-open save was remembered for the life of the page even when it failed, and a tab left open past midnight never saved the new day; a failed period switch showed the previous period's records under the new period's dates, dimmed; and the dashboard card downloaded the whole history to show the last row.

## Changes

- `backend/src/net-worth.ts`
  - The save is `saveNetWorth(pool, day)`. It still reads the totals in one `REPEATABLE READ` snapshot (so assets, debts and net agree) and upserts the day's row, and now runs again with a fresh snapshot when the transaction fails with a serialization error (`40001`), up to 3 times. Other errors, including the 422 for totals past 2^53, are not retried.
  - `GET /api/portfolio/net-worth?latest=true` answers only the latest saved day (or none). Any other `latest` value is a 400. `docs/openapi.json` is regenerated for the new query field.
- `frontend/src/net-worth.ts`: `saveTodayOnce()` remembers the save per service day (Asia/Seoul). A failed save is forgotten, so the next caller tries again, and a new service day saves again.
- `frontend/src/net-worth-history.tsx`: while another period loads, the previous one stays dimmed as before; when that load fails, it is hidden and only the error with "Try again" shows, like `budget-progress.tsx`.
- `frontend/src/dashboard.tsx`: the net worth card asks for `?latest=true`.

## Verification

Tests added or changed:

- `backend/test/net-worth.integration.test.ts`
  - "two saves of the same day at once both succeed (#195)": another transaction writes the day's row and commits while a save waits on it; the save answers 200 with its own totals (with `attempts = 1` this test fails, so it reproduces the `40001`). Three saves at once all answer 200 and leave one row.
  - "`latest=true` gives only the latest saved day": none before any save, then only 2026-11-10 of two saved days; `latest=yes` is a 400.
- `frontend/src/net-worth.test.ts` (new): a day is saved once; a failed save resolves quietly and the next call posts again; a tab past midnight in Seoul (fake clock) saves the new day.
- `frontend/src/net-worth-history.test.tsx`: "a failed period switch hides the previous period instead of showing it under the new dates" (fails on the old `shown = list?.data`), then Try again shows the chosen period.
- `frontend/src/dashboard.test.tsx`: the card's request is now `?latest=true`.

Commands (local, test DB `postgres:17-alpine` with every migration applied, `TEST_DATABASE_URL` set):

- `tsx --test test/net-worth.integration.test.ts`: 9 pass, 0 fail, 0 skipped.
- `vitest run --maxWorkers=2 src/net-worth.test.ts src/net-worth-history.test.tsx src/dashboard.test.tsx src/app.test.tsx`: 35 pass.
- `npm run check` and `npm run knip`: see the PR body.

Browser check (local API 3195 and Vite 5295, dev DB with one ₩2,500,000 bank account):

- 390×844: the dashboard's net worth card shows "Saved on 2026-11-22" and ₩2,500,000; it requested `/api/portfolio/net-worth?latest=true` (the other request is the app-open save). No horizontal scroll.
- 1440×900: the portfolio page's "Net worth trend" card shows the 3-month range and the saved day as before. No horizontal scroll.

## Limits

- After 3 serialization failures in a row the save still answers 500; with one user and saves on open and by hand this is not expected.
- The screens look the same as before on success; only the failure states changed, which the component tests cover rather than the browser check.
