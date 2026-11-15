# #40 Monthly income and expense summary and category share chart

- Issue: https://github.com/sirloinbh/money-ledger/issues/40
- Branch: `feat/40-monthly-summary`

## Purpose

See a month's income, expenses, and balance, and the share of spending by category, at the top of the ledger. Also decide the chart tool that the other visualization issues (#41, #48, #49, #54) will share.

## Decision (confirmed by the user on 2026-11-08, recorded in an issue comment)

- Chart tool: Recharts. We installed `recharts@3.10.1` (released 2026-07-25, supports peer react 19) with a pinned version and `--ignore-scripts`. A project hook blocks `npm install` by the agent, so the user ran it directly.
- Category share: horizontal bars.

## Decided during implementation

- The share looks only at spending. Uncategorized spending is one line "미분류" ("Uncategorized"), and spending of hidden categories is counted too (marked "(숨김)", "hidden").
- The share is a percentage of that month's spending, to one decimal place. It is computed with SQL `numeric` `round` (0.5 away from zero) and sent as a string. A month with only 0 won of spending is 0.0%.
- The balance is income − expense. A negative value shows as it is.
- The summary's month is the address `?month=YYYY-MM`, and the default is this month in Seoul time (the address omits it for this month). It moves separately from the entry list filter, and neither clears the other's address values.
- Chart color: the shared design tokens have no chart colors, so we added `--chart-series-1` to `frontend/src/index.css`. It is palette number 1 (blue) of the dataviz baseline, `#2a78d6` (dark `#3987e5`), and it passed the validator for lightness, saturation, and contrast (3:1 or more) against the card surface (white or `#171717`). It is one series, so there is no legend, and the card title is the name.
- The chart has bars of at most 24px thickness, with 4px rounded ends, the share (%) shown at the end of each bar, and a tooltip with name, amount, and share on hover. Long names on the axis are cut at 8 characters (…), and the full name appears in the tooltip and the table.
- The chart values can also be read in the table below (category, amount, share, and the total). For screen readers, the chart is announced as one image ("가장 큰 항목은 …, 모든 값은 아래 표에 있습니다", "The largest item is …, all values are in the table below") and they read the table.
- Recharts (about 382 kB) is loaded separately only when the summary draws the chart (`React.lazy`). It is not in the app's first bundle.

## Changes

- `backend/src/summary.ts`, `backend/src/app.ts`: `GET /api/ledger/summary?month=YYYY-MM` → `{ month, income, expense, balance, categories: [{ categoryId, name, hidden, amount, share }] }`. Validation of the month format and range (1900 to 2100) is a Korean 400. The month runs from day 1 to before day 1 of the next month.
- `frontend/src/monthly-summary.tsx`: the "월별 요약" ("Monthly summary") section (previous and next month, income, expense, and balance, the category spending chart and table, and loading, empty month, and failure with retry). Only the last request is reflected, and while another month loads the previous values are kept dimmed.
- `frontend/src/category-share-chart.tsx`: the horizontal bar chart.
- `frontend/src/ledger.tsx`: puts the summary at the very top of the ledger and reloads it when entries or categories change.
- `frontend/src/entry-filters-state.ts`, `frontend/src/entries.tsx`: when the list filter writes the address, it does not clear other values (`month`).
- `frontend/src/index.css`: the chart color token.
- `frontend/package.json`, `package-lock.json`, `frontend/package-lock.json` (`npm run lockfiles:sync`): added Recharts.

## Tests

- `backend/test/summary.test.ts`: 6 month value validations (missing, month 13, a one-digit month, a date, given twice, year 1899) are Korean 400 before the DB.
- `backend/test/summary.integration.test.ts`: on a real DB
  - The aggregate equals the direct sum of that month's entries (excluding the last day of the previous month and day 1 of the next month, including both end dates).
  - The category sum equals the spending, and the order, hidden, and uncategorized are right.
  - Share rounding (1/3 → 33.3, 2/3 → 66.7), a month with only 0 won of spending (0.0), an empty month, and a negative balance.
- `frontend/src/monthly-summary.test.tsx`: the default this-month request and the card and table values, month moves and keeping the list filter address, reload and a bad month, a negative balance, failure and retry, reloading on a version change, and ignoring an old month's response that arrives late.
- `frontend/src/category-share-chart.test.tsx`: the chart image name and the height by item count. The bars themselves have no layout in jsdom, so we checked them in the browser.
- `frontend/src/entry-filters.test.tsx`: `month` stays even when the filter is applied.

## Verification

- Test DB: we restarted the dedicated container `money-ledger-test-agent2` (127.0.0.1:15492) and applied migrations 010 and 012.
- `TEST_DATABASE_URL` in this shell pointed at another app's DB (`study_test@localhost:5432`) (the same as #32). We ran once without noticing, but that DB was off, so every connection was refused and nothing changed. After that we set the value explicitly each time.
- `TEST_DATABASE_URL=<test DB> npm run check`: passed. Backend 262 passed (0 skipped), frontend 223 of 225 passed and 2 skipped (existing), 4 skill tests, build succeeded.
  - The build's "chunks larger than 500 kB" warning existed before this change. The first bundle (541 kB) does not contain Recharts. Without Recharts it is the code that was on main plus a few kB of summary code. The chart is split into a separate file (382 kB).
- Browser: we connected the API (3192) to the test DB, started Vite (5292), and checked `/ledger` with headless Chrome (CDP). We put in 43 entries for November (9 categories, a long name "반려동물 용품과 병원비" ("Pet supplies and vet bills"), including uncategorized) and 2 for October.
  - 390×844:
    - November has income 3,200,000 won, expenses 1,373,200 won, and a balance of 1,826,800 won. The 9 bars are 23px thick or less and fit inside the chart. The first bar ends with 16.1%, the first table line is "의료 220,950원 16.1%" ("Medical 220,950 won 16.1%"), and the total is 1,373,200 won.
    - Hovering over a bar shows "의료 220,950원 · 16.1%".
    - "이전 달" → `?month=2026-10`: a balance of -900,000 won and 1 bar at 100.0%. September shows "이 달에는 지출이 없습니다." ("There is no spending this month.")
    - In dark mode the bar color changes to `#3987e5`.
    - No horizontal overflow (scrollWidth 390).
  - 1440×900: the same results. The three cards are in one row, and there is no horizontal overflow in light or dark (scrollWidth = clientWidth).

## Round 1 automatic review (PR #107)

What we fixed in this PR:

1. Changing the summary's month cleared the value being typed into the entry filter form, because the filter was rebuilt from the whole address. → The filter looks only at the filter values in the address, and does not reload or clear the input even when `month` changes.
2. If a request failed while changing months, the previous month's numbers still showed under the new month's name. → On failure we hide the previous month's values and show only the failure text.
3. If the chart file could not be loaded (an old tab after a deploy, offline), the whole app became a blank screen. → We wrapped the chart in a small error boundary that shows "차트를 불러오지 못했습니다. 아래 표에서 값을 확인하세요." ("Could not load the chart. Check the values in the table below.") and keeps the table.
4. The summary's "다시 시도" had the same name as the button in the entry list, and pressing it lost focus. → We added `aria-label="요약 다시 시도"` ("Retry summary") and pressing it moves focus to the "월별 요약" heading.
5. The totals query and the category query ran separately on different connections, so an entry saved between them could land in only one. → We merged them into one SQL statement (CTE and `json_agg`) so they read data from the same moment.
6. We added the missing tests.
   - Server: rejecting year 2101, and responses for 1900-01 and 2100-12.
   - Screen: a month out of range goes back to this month, and regression tests for 1 to 4 above.
   - With the code before the fix, 5 new tests failed. The "다시 시도" test failed because the button name changed. The out-of-range month test passed even before the fix.

Split off:

- The problem that a month's total over `Number.MAX_SAFE_INTEGER` gives a 500. It needs an amount ceiling or an API contract decision, so we split it off as #109.

Verification:

- `TEST_DATABASE_URL=<test DB> npm run check` passed. Backend 264 passed (0 skipped), frontend 228 of 230 passed and 2 skipped (existing), 4 skill tests, build succeeded.
- We checked 390×844 and 1440×900 (light and dark) again with headless Chrome. The results are the same and there is no horizontal overflow.

## Round 2 automatic review (PR #107)

What we fixed in this PR:

1. On a freshly opened `/ledger`, typing a search term and pressing "초기화" ("Reset") without searching left the input. The filter values in the address were already the defaults, so the filter did not change (a regression from remembering the filter as a normalized value in the first-round fix). → "초기화" directly clears the form's input and the period error display, then applies.
2. If the chart file failed to load once, `React.lazy` remembered the failure, and the chart did not come back until a reload. → On failure we recreate the chart load, and moving to another month or pressing "요약 다시 시도" resets the error boundary and loads again.
3. Tests: we added regression tests for both cases. Both failed with the code before the fix.

Split off:

- If the user makes an expense category named "미분류" ("Uncategorized"), the summary shows two lines with the same name → #110 (P4). We have to decide whether to block the name or change the display.

Verification:

- `TEST_DATABASE_URL=<test DB> npm run check` passed. Backend 264 passed (0 skipped), frontend 229 of 231 passed and 2 skipped (existing), 4 skill tests, build succeeded.
- The screen layout did not change, so we did not recheck in the browser.
