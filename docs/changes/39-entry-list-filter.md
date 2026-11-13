# #39 Ledger entry list with date range and category filters

- Issue: https://github.com/sirloinbh/money-ledger/issues/39
- Branch: `feat/39-entry-list-filter`

## Purpose

So that the user can still find and fix the entries they want as records pile up, filter the entry list by date range, kind, category, and search term, and split it into pages.

## Decided during implementation

The issue had no "Decisions before implementation", so the following were decided while implementing.

- The default list is this month in Seoul time (day 1 to the last day). If you clear both the start and end dates and search, it is the whole period.
- `from` and `to` include both end dates. If the start date is later than the end date, both the screen and the server reject it with `시작일이 종료일보다 늦습니다` ("The start date is later than the end date").
- The search term is looked up in the merchant and memo, ignoring case (at most 50 characters). `%`, `_`, and `\` are searched as the characters typed.
- The category filter chooses "All", "Uncategorized", or any category (including hidden categories, marked "(숨김)", "hidden"). When you choose a kind, only categories of that kind show, and the selection of a category of another kind is cleared.
- One page is 50 entries. Changing the filter goes back to the first page.
- The filter stays in the address (`?from=…&to=…&kind=…&category=…&q=…&page=…`), so it is kept across reloads and link sharing. A typed filter is applied only when you press "조회" ("Search"), while "이전 달·이번 달·다음 달" ("Previous month, This month, Next month") and "초기화" ("Reset") apply immediately.

## Changes

- `backend/src/entries.ts`: `GET /api/ledger/entries` accepts `from`, `to`, `kind`, `category` (a number or `none`), `q`, `page`, and `size` (at most 100, default 50). The response is `{ entries, total, page, pageSize }`. A bad value is a Korean 400. `uncategorized=true` for the bulk classification of uncategorized entries stays as it is (latest 200, `entries` only).
- `frontend/src/entry-filters-state.ts`: address ↔ filter conversion, month range and month move, and the period name ("2026년 11월" (November 2026), "2026-10-01 ~ 2026-11-30", "전체 기간" ("All periods")).
- `frontend/src/entry-filters.tsx`: the period name, the previous, this, and next month buttons, and the filter form (start date, end date, kind, category, search term, search and reset).
- `frontend/src/entries.tsx`: the list loads with the address's filter. It shows the count, "이전 쪽·다음 쪽" ("Previous page, Next page") and "n / m쪽" ("page n of m"), an empty result ("조건에 맞는 내역이 없습니다.", "No entries match."), and a load failure ("내역을 불러오지 못했습니다." + "다시 시도", "Could not load entries." + "Try again"). The list name changed from "최근 내역" ("Recent entries") to "내역 목록" ("Entry list"). Even if you change filters quickly, only the result of the last request shows.
- There is no migration. The date range condition uses the existing `ledger_entries_entry_date_idx`.

## Tests

- `backend/test/entries.test.ts`: 10 filter value validations (a nonexistent date, format, start > end, kind, category 0 and letters, a 51-character search term, page 0, page given twice, size 101) are Korean 400 before the DB.
- `backend/test/entries.integration.test.ts`: on a real DB, both ends of the range included (10-31, 11-01, and 11-30 boundaries), kind, category, and uncategorized, merchant and memo search (ignoring case, `%` and `_` as typed), paging and `total`, a page beyond the range (an empty list, total kept), and `uncategorized=true` kept.
- `frontend/src/entry-filters.test.tsx`: helpers (month range and leap years, month moves across years, reading and writing the address, period names) and the screen (the default this-month request, search → address and request, reopening with the same address restores the filter, categories matching the kind, rejecting start > end, the month buttons and reset, page moves and returning to the first page on filter change, an empty result, and failure and retry).
- `frontend/src/entries.test.tsx`: renders inside a router, and the list name and the empty list text were matched to the new screen.

## Verification

- Test DB: a dedicated container `money-ledger-test-agent2` (`postgres:17-alpine`, 127.0.0.1:15492, migrations 001 to 006 applied automatically).
- `TEST_DATABASE_URL=<test DB> npm run check`: passed. Backend 120 passed (0 skipped), frontend 159 of 161 passed and 2 skipped (existing), 4 skill tests, build succeeded.
- Browser: we connected the API (3192) to the test DB, started Vite (5292), and checked `/ledger` with headless Chrome (viewport set through CDP). We put 96 entries for October and November in the test DB.
  - 390×844: at first "2026년 11월" has 16 entries. "이전 달" ("Previous month") → address `?from=2026-10-01&to=2026-10-31`, 50 rows of 80, "1 / 2쪽". "다음 쪽" ("Next page") → `page=2`, 30 rows, "2 / 2쪽". Searching 2026-10-01 to 2026-11-30, expenses, and "스타벅스" ("Starbucks") gives 42 entries, and after a reload the address, search term, and result are the same. Uncategorized plus a nonexistent search term shows "조건에 맞는 내역이 없습니다.", and start > end shows "시작일이 종료일보다 늦습니다" without sending a request. No horizontal overflow (scrollWidth 390).
  - 1440×900: the same scenario gives the same results. The filter lays out in one row (6 fields) and a row with a long memo does not break. No horizontal overflow (scrollWidth = clientWidth).
- Before the PR we merged `origin/main` (f5437dd, including #51 and #63). There were no conflicts. We applied 007 and 009 to the test DB and ran `TEST_DATABASE_URL=<test DB> npm run check` again: passed. Backend 169 passed (0 skipped), frontend 178 of 180 passed and 2 skipped (existing), 4 skill tests, build succeeded.

## Round 1 automatic review (PR #103)

There were no points on the backend. We fixed the points from the screen in this PR.

1. If you changed the filter before a save or delete finished, the reload after it finished was requested with the old condition and discarded, so the save result was missing from the new list. → The list loader always requests with the current condition at the time of the call.
2. Changing the page or filter made the list and page buttons disappear, and keyboard focus fell to `body`. → While the new list loads, we keep the previous list dimmed and show `aria-busy` and "불러오는 중…" ("Loading…"). The page buttons use `aria-disabled` instead of `disabled`, so focus stays even on the last page.
3. Deleting the last entry on the last page, or an address with a page beyond the range, showed "2 / 1쪽". → We change the address to the last page (`replace`).
4. A bad date or category value in the address caused a 400 on every request and could not be escaped even with "다시 시도". A category that did not match the kind made the screen and the condition disagree. → When reading the address, we drop values the server would reject. If start > end, it goes back to this month. After the categories load, a category that does not match the kind or does not exist is removed from the address.
5. Test additions: an old response that arrives late, a filter change while saving, keeping the page buttons and focus while loading, a page out of range, a category that does not match, and bad address values. With the code before the fix, 5 new tests failed. The test of an old response that arrives late passed even before the fix. It was already handled behavior, so we keep it as a test that confirms what the doc says.
6. A reference comment (the entry form and the filter form have the same names "종류" (Kind) and "카테고리" (Category)) is left as it is, because each of the two forms has its own name ("새 내역", "New entry", and "내역 필터", "Entry filter").

Verification: `TEST_DATABASE_URL=<test DB> npm run check` passed. Backend 169 passed (0 skipped), frontend 184 of 186 passed and 2 skipped (existing), 4 skill tests, build succeeded. We checked 390×844 and 1440×900 again with headless Chrome.

- The first scenario gives the same results.
- Going to the last page with "다음 쪽" leaves focus on that button (`aria-disabled=true`).
- `?…&page=9` changes to `page=2`.
- `?from=2026-13-01&to=2026-10-31&kind=income&category=1` becomes `?from=&to=2026-10-31&kind=income` and shows an empty result without a 400.
- There is no horizontal overflow at either size.

## Round 2 automatic review (PR #103)

The fixes for first-round points 1 to 5, the match between the address check and the server rules, and no repeated effects were confirmed. We fixed two more things. The review is at most two rounds, so we do not review again after this fix.

1. If two list requests with the same condition went out (a save right after a filter change, or a bulk classification elsewhere), an old response that arrived late could overwrite the save result. → We filter responses by request number, not by condition, so only the last request fills the list.
2. If loading the next page failed, the page buttons disappeared and focus fell to `body`. → We append the failure text and "다시 시도" on top of the previous list, and keep the list and the page buttons. After a failure we clear "불러오는 중…".
3. 2 regression tests: a same-condition request started before the save still leaves the saved entry even if it arrives last. The page buttons and focus remain even if loading a page fails. Both failed with the code before the fix.

Verification: `TEST_DATABASE_URL=<test DB> npm run check` passed. Backend 169 passed (0 skipped), frontend 186 of 188 passed and 2 skipped (existing), 4 skill tests, build succeeded. With headless Chrome at 390×844 and 1440×900, we checked again the first scenario, focus on the last page, a page out of range, and cleaning of bad address values. The results are the same and there is no horizontal overflow.
