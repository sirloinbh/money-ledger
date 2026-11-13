# #38 Record, edit, and delete income and expense entries

- Issue: [#38](https://github.com/sirloinbh/money-ledger/issues/38)
- Branch: `feat/38-ledger-entries`

## Purpose

Let the user record, fix, and delete income and expenses with a date, a kind, an amount, a category, and a memo. The list view (#39) and the visualizations (#40, #41) use this data.

## Decision

- Do not add a payment method input (user decision on 2026-11-03, [issue comment](https://github.com/sirloinbh/money-ledger/issues/38#issuecomment-6597669973)).

## Changes: 2026-11-03

- `database/migrations/003_ledger_entries.sql`: added the `ledger_entries` table.
  - It stores the date `date`, the amount `bigint` (0 or more), the direction `kind`, and the memo (at most 200 characters, default empty string).
  - `(category_id, kind)` is a foreign key that references `ledger_categories (id, kind)`, so the kind of the category and the entry must also match in the DB. For this we added a unique index on `ledger_categories (id, kind)`.
  - Added indexes for the date-ordered list and for lookup by category. Every statement is `IF NOT EXISTS`, so it is safe to run again.
- `backend/src/entries.ts`: added the `/api/ledger/entries` API.
  - `GET`: the latest 100, in descending date and ID order, with the category name. Date range and category filters and paging are done in #39.
  - `POST` (201), `PUT /:id` (full update), `DELETE /:id` (204).
  - Server validation (Korean 400): an amount that is not an integer or is below 0, a string amount, a date that is not `YYYY-MM-DD`, a date that does not exist (February 30), an unknown kind, no category, and a memo over 200 characters.
  - It is a 400 if the category does not exist, has a different kind, or is hidden. When updating, an entry can keep a hidden category it already has, but cannot switch to a different hidden category. A foreign key error (23503) is answered with the same 400 as a safety net (for the save method changed in the first review, see the review record below).
  - The `bigint` amount that pg gives as a string is checked with `Number.isSafeInteger` and then sent as a number.
- `backend/src/app.ts`: connected the router.
- `backend/package.json`: backend test files run one at a time (`--test-concurrency=1`). The category and entry DB tests empty the same tables, so running them in parallel would delete each other's data.
- `backend/test/helpers.ts`: a 204 response with no body is returned as an empty object.
- `frontend/src/entries.tsx`: added an entry input form and a list of recent entries at the top of the ledger screen.
  - The default date is today in `Asia/Seoul`. The kind is a radio button and the category is a basic `<select>`.
  - The category list shows only the not-hidden ones of the chosen kind. If the entry being edited has a hidden category, only that one is shown with `(숨김)` ("hidden") added.
  - The amount may contain commas like `12,500`, and anything that is not an integer of 0 or more is blocked before sending. A server error shows the Korean message as received.
  - After recording, only the amount and memo are cleared, and the date and kind stay, to make it easy to enter several on the same day.
  - Deleting asks for confirmation with the central `ConfirmDialog`.
- `frontend/src/format.ts`: today in the service time zone (`serviceToday`) and won display (`formatWon`).
- `frontend/src/categories.tsx`, `ledger.tsx`: when a category changes it notifies through `onChange`, and the entry form reloads the category list.

## Verification

- Tests added
  - `backend/test/entries.test.ts` (12 without a DB): the 8 validation errors above are rejected with a Korean 400 before reaching the DB. A bad ID is 400. A missing category, a different kind, or a hidden category is a 400 before saving.
  - `backend/test/entries.integration.test.ts` (5 on a real DB)
    - Save, the newest-first list, the category name, and trimming the memo
    - The largest safe integer amount goes through unchanged
    - A category of a different kind is rejected both by the server (400) and by the DB foreign key (23503)
    - On update a hidden category can be kept, but another hidden category or a new entry cannot use it
    - After deleting, deleting or updating again gives 404
  - `frontend/src/entries.test.tsx` (12)
    - Today in Seoul is the default date (checked at a time that is the previous day in UTC)
    - Only not-hidden categories of each kind are shown
    - A comma amount is sent as an integer, the date and kind are kept, and it shows in the list
    - 4 kinds of bad amount and a missing category are blocked before sending
    - A server error message is shown and the input is kept
    - When editing, the hidden category is shown too and saved with PUT. Canceling goes back to a new entry
    - Deleting happens after confirmation
    - When the category version changes, the list is reloaded
  - `frontend/src/format.test.ts` (2): the Seoul date at the UTC date boundary, and the won display.
  - `frontend/src/app.test.tsx`: changed the fake API to return an empty entry list too.
- Test DB: applying `003` twice to a disposable `postgres:17-alpine` container gave no error. Inserting directly with a category of a different kind was rejected by the foreign key.
- `TEST_DATABASE_URL=<test DB> npm run check`: passed.
  - Backend 43 passed, 0 skipped (including the DB integration tests).
  - Frontend 89 of 91 passed, 2 skipped (existing tests).
  - 4 skill tests passed.
- Browser: we connected the API to the test DB and checked with headless Chrome (viewport set through CDP).
  - Mobile 390×844: entering amount `8,000`, category `교통` ("Transport"), and memo `택시` ("Taxi") and pressing `기록` ("Record") shows `지출 8,000원을 기록했습니다` ("Recorded an expense of 8,000 won"). The date stays at `2026-11-03`, and `-8,000원` appears at the top of the list. A long memo wraps and `scrollWidth` is 390, so there is no overflow.
  - PC 1440×900: the input form shows in two columns and `scrollWidth` is 1425 (a 15 vertical scrollbar), so there is no overflow.

## Limits

- The list shows only the latest 100. Date range and category filters and paging are built in #39.
- `npm run knip` does not run on this PC because of a native binding problem (see the #37 record), so we check it with CI.

## Review record

### Round 1: 6 points addressed

Addressed (2026-11-03, follow-up commit):

- If you pressed `수정` ("Edit") or `수정 취소` ("Cancel edit") on another row while saving, the edit you had just opened was cleared after the save finished. While saving, we do not accept edit, cancel, or delete, and we change the button text to `저장 중…` ("Saving…"). We do not turn the button off, so focus stays.
- Renaming a category still showed the old name in the entry list. When a category changes, the list is reloaded too.
- If you hid the chosen category, the screen showed `고르세요` ("Choose") but the value stayed and the server rejected it. A category that can no longer be chosen is treated as not chosen.
- `0000-01-01` passed validation and caused a 500 in PostgreSQL. We limited dates to the years 1900 to 2100 and answer with a Korean 400.
- Pressing `수정` left focus on the list. We move it to the date field of the form. We add `aria-invalid` and an `aria-describedby` pointing at the message to the rejected amount and category fields.
- The doc described a foreign key race that cannot happen, and it did not block the race that really can happen (hiding the category between the check and the save). We put the same condition into the save statement. It now uses `INSERT … SELECT … WHERE NOT c.hidden` and `UPDATE … FROM ledger_categories … (NOT c.hidden OR c.id = e.category_id)`, and if no row was saved it rechecks and tells the cause (409 if it cannot find one).

Tests added:

- `backend/test/entries.test.ts`: rejecting year 0000 and 2101 (2), and a category hidden after the check is not saved and is answered with a hidden error (1).
- `frontend/src/entries.test.tsx`: date field focus on edit, marking the bad field, ignoring edits while saving and `저장 중…`, and reloading the list and clearing a hidden category choice when a category changes (4).

Verification after the fixes:

- `TEST_DATABASE_URL=<test DB> npm run check`: passed. Backend 46 passed and 0 skipped, frontend 93 of 95 passed and 2 skipped (existing), 4 skill tests.
- Browser (CDP, mobile 390×844): pressing `수정` on the last row of the list moves focus to `entry-date`, and it is visible inside the screen (402px from the top). The form title changes to `내역 수정` ("Edit entry"). `scrollWidth` 390.

### Round 2: 6 first-round points confirmed, no blocking defect, 4 optional points addressed

- When a delete finished, the delete button in the removed row disappeared, so focus fell to the page. Only when the delete happened, we move focus to the `수입·지출 내역` ("Income and expense entries") heading. If canceled, it goes back to the delete button as before.
- A value newly typed into the amount or memo while saving was cleared after the save finished. We clear it only when it equals what was sent.
- A test name mentioned `수정 취소` ("cancel edit"), which it does not check. We renamed it `opening an edit waits`.
- The conditional save failure path of PUT was not tested. We added tests for a category hidden during the edit (400) and a failure of unknown cause (409).
- During the review an unexplained failure was reported once in a full frontend run. We ran `entries.test.tsx` 8 times and the whole frontend 3 times, and all passed, so we could not reproduce it. If it shows up again in CI, we will open a separate issue.
- Verification: `TEST_DATABASE_URL=<test DB> npm run check` passed (backend 48 passed and 0 skipped, frontend 95 of 97 passed and 2 skipped (existing), 4 skill tests). In a real Chrome (CDP), after canceling a delete focus is on the delete button, and after a delete it is on `H2 수입·지출 내역`.
- By the standard, we do not run a third review.
