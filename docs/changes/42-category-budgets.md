# #42 Monthly budget per category and progress

- Issue: https://github.com/sirloinbh/money-ledger/issues/42
- Branch: `feat/42-category-budgets`

## Purpose

Going beyond recording spending, compare the monthly budget set for each category with the actual spending.

## Decision (confirmed by the user on 2026-11-10, recorded in an issue comment)

- For a month in which no budget was set, the value of the most recently set month is carried over when the data is read. We do not create copy rows.
- To make only a specific month different, save it for that month. The saved value becomes the default for that month and for later months that were not set separately.
- Only expense categories are covered. The amount is an integer of 1 won or more, and saving 0 won or clearing it makes it "미설정" ("Not set") from that month.
- The progress follows the month of the #40 monthly summary (`?month=`).
- When the budget is exceeded, we show a red bar and the text "N원 초과" ("N won over") together.
- The migration number is 017.

## Decided during implementation

- The primary key of `ledger_budgets(category_id, kind='expense', month, amount)` is `(category_id, month)`.
  - `(category_id, kind)` points at `ledger_categories(id, kind)`, so a budget attaches only to expense categories.
  - When a category is deleted, its budgets are deleted too (`ON DELETE CASCADE`).
  - `month` holds only day 1 of the month (CHECK), and the amount is 0 or more.
- A month's budget is the most recent row of that category with `month <= that month` (`DISTINCT ON`). If that value is 0, it is not set.
- The amount used, the remaining amount, the excess amount, and the usage rate (one decimal place, 0.5 away from zero) are computed with SQL `numeric`. If not set, all three are `null`.
- A hidden category shows only when it has spending or a budget that month (marked "(숨김)", "hidden"). Uncategorized spending has no category to attach a budget to, so it is not in the list (it appears in the monthly summary).
- The screen is a "카테고리별 예산" ("Budget by category") card under the monthly summary.
  - Each line shows "amount used / budget" and a bar.
  - Within budget, the bar is chart color 1 (`--chart-series-1`) and it shows "N원 남음 (xx.x%)" ("N won left").
  - Over budget, the bar is full in the `destructive` color, and a warning icon and "N원 초과 (xxx.x%)" appear in the same color. Color, text, and icon tell it together.
  - The bar repeats the text, so it is hidden from screen readers.
  - If not set, it shows "미설정" and that month's spending instead of a bar.
  - If the budget was carried over from an earlier month, it shows "2026년 8월에 정한 예산" ("Budget set in August 2026").
- Pressing "수정" ("Edit") opens an amount input on that line and moves focus to the input.
  - Commas are allowed only at thousands positions ("1,00" is rejected).
  - On save it announces "○○ 예산을 2026년 11월부터 N원으로 정했습니다" ("The ○○ budget was set to N won from November 2026") and reloads. Focus goes back to the "수정" button of that line.
  - Moving to another month closes an open input, because otherwise it could be saved to a month you cannot see.
- The function that reads the summary's month moved to `frontend/src/summary-month.ts`, shared by the monthly summary and the budget.

## Changes

- `database/migrations/017_ledger_budgets.sql`: the budget table.
- `backend/src/budgets.ts`, `backend/src/app.ts`:
  - `GET /api/ledger/budgets?month=YYYY-MM` → `{ month, budgets: [{ categoryId, name, hidden, spent, budget, budgetMonth, remaining, over, percent }] }`
  - `PUT /api/ledger/budgets/:categoryId` (`{ month, amount }`): saves or changes that month's value. If it is not an expense category or does not exist, it is 404.
- `frontend/src/budget-progress.tsx`: the budget card (loading, failure and retry, the edit form, and the notice).
- `frontend/src/summary-month.ts`, `frontend/src/monthly-summary.tsx`: moved reading the summary's month to be shared.
- `frontend/src/ledger.tsx`: placed under the monthly summary, and reloads when entries or categories change.

## Tests

- `backend/test/budgets.test.ts`: 3 bad reads and 8 saves are Korean 400 before the DB (month format and range, body format, amount string, decimal, negative, and over the safe integer, and category ID).
- `backend/test/budgets.integration.test.ts`: checks on a real DB.
  - Over, exactly equal, within (rounding 1.25 → 1.3), and not set. Only that month's entries are counted, and uncategorized and income are left out.
  - Carry over: a month before the first budget is not set, later months use the most recent value, and there are no copy rows. Changing an earlier month changes only the months that carry over, and saving again in the same month changes it.
  - 0 won is not set from that month, and when set again later it uses that value.
  - A hidden category appears only when it has spending or a budget. Income and nonexistent categories are 404 and no row is created.
  - The table CHECKs (a month that is not day 1, a negative) and the ends at years 1900 and 2100.
- `frontend/src/budget-progress.test.tsx`: checks the screen.
  - Over (a red bar at 100%, icon and text), within (remaining amount, carried-over month), not set (no bar), and hidden.
  - It follows the address's month, and changing the month closes an open form.
  - Saving comma input and the request body, the notice, and focus return. A blank is saved as 0.
  - 4 kinds of bad amount are rejected before the request. On a save failure the input is kept, and canceling returns focus.
  - Load failure and retry, and reloading on a version change.
- `frontend/src/app.test.tsx`: added `budgets: []` to the empty response mock.

## Verification

- We applied migration 017 to the test DB.
- `TEST_DATABASE_URL=<test DB> npm run check`: passed. Backend 316 passed (0 skipped), frontend 262 of 264 passed and 2 skipped (existing), 4 skill tests, build succeeded. `npm run knip` passed too.
  - After merging origin/main (#48 asset allocation) with no conflicts, it passed again: backend 327 (0 skipped), frontend 272 of 274 passed and 2 skipped (existing), knip passed.
- Browser: we connected the API (3192) to the test DB and checked `/ledger` with Vite (5292) in headless Chrome (CDP).
  - Data we put in: 8 expenses and 1 uncategorized in November, and food 400,000 won in October. We added the long name "반려동물 용품과 병원비" ("Pet supplies and vet bills") and hid leisure.
  - Budgets: food 350,000 won in August and 300,000 won in November, transport 50,000 won in August, housing 800,000 won in November, and pets 90,000 won in November.
  - 390×844:
    - Food shows "337,500원 / 300,000원", a red bar at 100%, an icon and "37,500원 초과 (112.5%)".
    - Transport shows "18,000원 남음 (64.0%) · 2026년 8월에 정한 예산" and a blue bar at 64%. Housing is 81.3%.
    - Telecom, living, and others are "미설정" with no bar. Leisure shows "(숨김)". The long name fits in the card.
    - Pressing transport "수정" moves focus to the input. After saving "30,000", "교통 예산을 2026년 11월부터 30,000원으로 정했습니다" shows, and focus returns to "교통 예산 수정" ("Edit transport budget"). That line changes to "2,000원 초과 (106.7%)".
    - Pressing "이전 달" ("Previous month") in the summary changes the budget to "2026년 10월 기준" ("as of October 2026"). Food carries over the August budget of 350,000 won and shows "50,000원 초과 (114.3%)", and housing is not set.
    - In dark mode the over color changes to a light red (`oklch(0.704 0.191 22.216)`).
    - No horizontal overflow (scrollWidth 390).
  - 1440×900: the same results, with no horizontal overflow in light or dark.
  - What we fixed during the check: when viewing another month it still said "이번 달 사용률" ("This month's usage rate") and "이번 달 지출" ("This month's spending"), so we changed them to "예산 사용률" ("Budget usage rate") and "지출" ("Spending").

## Round 1 automatic review (PR #115)

There was no blocking problem. What the review confirmed:

- SQL: the month range, carry over, 0 = not set, and null handling are right.
- The expense-category restriction is enforced by the key.
- Concurrent saves are safe because they are a one-statement upsert.
- The TRUNCATE of other tests and the #40 summary's month handling are unchanged.
- Accessibility: color, icon, and text are used together, the bar is hidden from screen readers, and the focus moves are right.

What we fixed in this PR:

1. If you changed the summary's month before the save response arrived, the earlier month was reloaded after the save, and November values stayed dimmed under "2026년 10월 기준". → After a save we load the month that is visible then (keep the latest `load` in a ref).
2. If you saved a hidden category that showed only because of its budget (without spending) as not set, its line disappeared and focus was lost. → After reloading we move focus, and if the line is gone, send it to the "카테고리별 예산" heading.
3. We added regression tests for both cases. Both failed with the code before the fix.

What we left as it is:

- A hidden category that had a budget set in an earlier month still shows as a budget line in later months. It follows the decided rule ("shown if it has a budget"), so we did not change it. To hide it, save that category's budget as not set.

Verification: `TEST_DATABASE_URL=<test DB> npm run check` passed (backend 327, frontend 274 of 276 passed and 2 skipped (existing)), `npm run knip` passed.

## Round 2 automatic review (PR #115)

There was no blocking problem. We were told the backend, migration, and monthly summary are right, and we fixed three small problems on the screen.

1. If the save response came late, it closed the input form of another line the user had opened in the meantime (losing the input) and moved focus to the first line. Even when the month was changed, it took focus from the button just pressed. → When the save finishes, we close the form and move focus only when the same line is still open in the same month.
2. While another month was loading, the previous month's lines left dimmed were shown under the new month's name and "수정" could be pressed. Saving as it was could put the previous month's amount into the new month. → A line is shown with its own month (`shown.month`), and "수정" is blocked while loading.
3. Changing the month closed the form, but the form's error notice stayed. → When the month changes, we clear the notice too.
4. We added 4 regression tests for the cases above. All four failed with the code before the fix.

We reached the review limit (2 rounds).

Verification: `TEST_DATABASE_URL=<test DB> npm run check` passed (backend 327, frontend 278 of 280 passed and 2 skipped (existing)), `npm run knip` passed.

## Merged main again (before merging)

- #54 (018 `mock_snapshots`) got into main, so we merged origin/main again. There were no conflicts. The tests of this PR do not delete `mock_accounts`, so there is nothing to fix.
- We applied 018 to the test DB. `TEST_DATABASE_URL=<test DB> npm run check` passed (backend 330 (0 skipped), frontend 290 of 292 passed and 2 skipped (existing)), `npm run knip` passed.
