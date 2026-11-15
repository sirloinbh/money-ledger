# #49 Net worth history and trend chart

- Issue: https://github.com/sirloinbh/money-ledger/issues/49
- Branch: `feat/49-net-worth-history`

## Purpose

With only current values, past net worth cannot be worked out later. Save net worth by day and see how it changes over time in a chart.

## Decisions (confirmed by the user 2026-11-10, recorded in an issue comment)

1. When to save: the first time the app opens (any screen), save today's snapshot (Seoul time) once. There is also a "Save current values" button. Saving again the same day overwrites that day's one row with the latest values.
2. What is saved: total assets, total liabilities, net worth, and the number of assets left out. It is the same calculation as the asset screen totals (depreciating and prepaid assets at their current value). A total too large to calculate is not saved, and the user is told. A day with assets left out shows "N left out" in the tooltip and the table.
3. Place and look: a "Net worth trend" card under the "Asset allocation" card on the asset portfolio screen. One net worth line (`--chart-series-1`); the tooltip also shows assets and liabilities. A record table sits below, and the chart loads separately.
4. Periods: 1 month, 3 months, 1 year, and all; 3 months by default. The x axis uses real date spacing.
5. Days without a record: not filled with ₩0; the records are joined. A period with no records shows a note. Past days are not saved after the fact.

## Choices made during implementation

- Save (`POST /api/portfolio/net-worth`):
  - Saves under the server's today in Seoul time.
  - Reads the same totals SQL as the asset screen (`readTotals`, `assets.ts`) inside one snapshot (REPEATABLE READ).
  - The same day is overwritten with `ON CONFLICT (snapshot_date) DO UPDATE`. Two saves at once still leave one row.
  - If any total is too large for JS to handle exactly (2^53 or more), it sends a 422 ("The totals are too large to save the net worth") and saves nothing.
- Table (`019_net_worth_snapshots.sql`): the date is the primary key, amounts are bigint won. A DB CHECK keeps `net worth = assets − liabilities`. Safe to re-run.
- Save when the app opens: sent once when `App` first renders. Not sent again in the same page load (`saveTodayOnce`).
  - A failure passes quietly. Saving by hand on the screen shows the error.
  - The trend card reads the list after this save finishes, so today's record is there from the start.
- Card place: `AssetManager` keeps a slot right under the asset allocation card (`afterAllocation`), and the asset portfolio screen puts the card there. The asset screen tests run unchanged without this card.
- A period starts on the same date N months before today. If that month has no such date, it is that month's last day (3 months before May 31 → February 28). "All" starts at the first record.
- Chart:
  - The x axis is a time axis, drawn from the period's first day to today with real date spacing.
  - Each saved day gets a dot (radius 3px), and the dots are joined with straight lines. A single saved day is a single dot.
  - If any day has a negative net worth, a ₩0 reference line is drawn.
  - The x ticks are evenly spaced, not on the saved days: every 7 days up to a month and a half ("10/17"), each month's first day up to about a year ("Sep '26"), and January and July beyond that. Recharts drops ticks that overlap on a narrow screen.
  - The y axis uses K, M, and B units, like the other charts. With a narrow spread it adds decimals ("2.76B, 2.78B…" rather than "2.8B" five times). 0 is "0".
- The table is folded as "Show as a table (N days)", like #41, because a long period has many rows. It shows date, net worth, assets, and liabilities from the newest date; the unit "(₩)" is in the column headings.
- Screen readers get the chart as one image. It names the period, the number of saved days, the last record and its value, and points to the table.

## Changes

- `database/migrations/019_net_worth_snapshots.sql`: the `net_worth_snapshots` table.
- `backend/src/net-worth.ts`, `backend/src/app.ts`:
  - `POST /api/portfolio/net-worth` → `{ snapshot: { date, assetsKrw, debtsKrw, netKrw, uncounted } }`
  - `GET /api/portfolio/net-worth?from=YYYY-MM-DD` → `{ today, snapshots: [...] }` (oldest first; everything without `from`). A wrong date format is a 400.
- `backend/src/assets.ts`: the totals SQL moved into `readTotals` so the asset list and the net worth save share it (same behavior).
- `frontend/src/net-worth.ts`: the API path, the one save when the app opens, periods and start dates, x ticks and y axis units.
- `frontend/src/net-worth-history.tsx`: the "Net worth trend" card (period buttons, Save current values, chart, table, empty period, failure and retry).
- `frontend/src/net-worth-chart.tsx`: the Recharts line chart (loaded separately).
- `frontend/src/app.tsx`, `frontend/src/portfolio.tsx`, `frontend/src/assets.tsx`: the save when the app opens, the card place.

## Tests

- `backend/test/net-worth.integration.test.ts`, on a real DB:
  - The saved values equal the asset screen totals (depreciating and prepaid assets at current value; a dollar asset without an exchange rate counts as 1 left out).
  - Saving again the same day leaves one row with the latest values.
  - Days without a record are not filled. Records come oldest first and are cut by `from`. A negative net worth is saved too.
  - A total that is too large is a 422 and saves nothing.
  - A wrong `from` is a 400 that names the date.
  - The DB CHECK blocks `net worth ≠ assets − liabilities`.
- `frontend/src/net-worth-history.test.tsx`: one save on first open then the 3-month list, requests per period and "All", the table (newest first, left-out count), an empty period, Save current values and reading again, the refused save message, failure and retry, period start dates (month end, leap year, across years), x ticks (7 days, monthly, half-yearly), y axis decimals.
- `frontend/src/net-worth-chart.test.tsx`: the chart image name, one saved day, a negative value.
- `frontend/src/app.test.tsx`: whichever screen opens, the save happens once.

## Verification

- Test DB: applied 019 to the dedicated container `money-ledger-test-agent1` (127.0.0.1:15491). Applying it twice gives no error. `TEST_DATABASE_URL` was set by hand each time.
- `npm run knip`: passed.
- `TEST_DATABASE_URL=<test DB> npm run check`:
  - Before merging origin/main it passed: backend 315 passed (0 skipped), frontend 276 of 278 passed and 2 skipped (existing), build succeeded. The chart is its own file `net-worth-chart-*.js` (2.3 kB).
  - After merging origin/main (with #54 and #42), backend 318 passed (0 skipped). Frontend: 287 of 290 passed, 2 skipped (existing), 1 failed. The failure was "without an account the form suggests 1,000만 원 and creates it" in `mock-account.test.tsx`, which came in with #54.
    - Cause: `findByRole('status')` found both the mock account notice and the "loading" text (`role="status"`) of the #54 return trend card.
    - Running that file alone three times fails once. This PR does not touch that screen or file. The control tower was told.
- Because of #54's `mock_snapshots` (018), this PR's integration test setup also clears `mock_snapshots` and applies 018 again.
- Browser: the API (3191) on the test DB and Vite (5291), checked `/portfolio` with headless Chrome (CDP). This was on the Korean screens, before the English UI (#120) was merged in.
  - Data: 8 past records (2025-12-20 to 2026-11-03, 3 of them with 1 asset left out) inserted with SQL. Today's assets were added through the API (an apartment, a bank account, a stock with only a quantity, a loan).
  - Opening the app saved today's record (net worth ₩282,500,000, 1 left out), and it showed at the end of the chart right away.
  - Card order: asset allocation → net worth trend → new asset → assets and liabilities held.
  - 390×844: per period, 4 dots (1 month), 6 (3 months), and 9 (1 year and all), all inside the card. The range text showed both dates, and there was no horizontal overflow (scrollWidth 390).
    - X ticks: 1 month showed 5 weekly ticks from 10/10 to 11/7; 1 year showed month starts (only 4 fit on the narrow screen).
    - The 1-month y axis ran from 276M to 284M (then shown in Korean units).
  - 1440×900: the same results, no horizontal overflow. "All" ran from 2025-12-20 to today.
  - In dark mode the line color is `#3987e5`.
  - Hovering the last dot showed the date, net worth ₩282,500,000, assets ₩532,500,000 · liabilities ₩250,000,000, and 1 left out.
  - The table listed the newest date first and showed the left-out count.
  - "Save current values" showed a message naming the date and the saved ₩282,500,000.
  - Two things were fixed during the check: x ticks that sat on the saved days, and a 1-month y axis that repeated "2.8억" (2.8 × 100M).

## Merge with main (2026-11-15)

- `main` switched the UI, comments, and docs to English (#120, #123, #124, #125) and added `budgets` to the test server data. The only text conflict was `frontend/src/app.test.tsx` (both `snapshots` and `budgets` kept).
- The card, chart, API message, tests, and this record were translated to match: money with `formatWon` (₩), dates as "Nov 10, 2026", period labels "1 month / 3 months / 1 year / All" (as in `mock-returns.tsx`), y axis K/M/B (as in `trend-chart.tsx`), x ticks "10/17" and "Sep '26", table dates as YYYY-MM-DD.
- The browser check above was not repeated on the English screens.
