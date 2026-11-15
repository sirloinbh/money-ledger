# #37 Manage income and expense categories

- Issue: [#37](https://github.com/sirloinbh/money-ledger/issues/37)
- Branch: `feat/37-ledger-categories`

## Purpose

Let the user add, rename, and hide the categories used to classify income and expense entries (#38).

## Decision

Follow the recommendation as in the issue comment (2026-11-02).

- Default categories: expense (food, transport, housing, telecom, living, medical, leisure, other) and income (salary, side income, other)
- A category in use is hidden, not deleted. So we did not create a delete API.

## Changes: 2026-11-03

- `database/migrations/002_ledger_categories.sql`: added the `ledger_categories` table.
  - It stores the kind (`income` or `expense`), the name (1 to 30 characters with no leading or trailing spaces), and whether it is hidden.
  - It has a unique constraint on `(kind, name)`. A hidden category still holds its name, so there is no conflict when it is shown again.
  - The default categories are inserted only when the table is empty. Re-running does not bring back a default category that was renamed. The Korean text is written with `U&` escapes.
- `backend/src/categories.ts`: added the `/api/ledger/categories` API.
  - `GET`: the list. `?kind=` filters by kind and `?visible=true` keeps only the ones not hidden. Expenses come first, and within a kind the order is registration order. The input list of #38 uses `visible=true`.
  - `POST`: add (201). Trims leading and trailing spaces from the name.
  - `PATCH /:id`: change the name or the hidden flag. The kind cannot be changed.
  - If the same kind already has the same name, it sends 409 `같은 종류에 이미 있는 카테고리 이름입니다` (Korean for "A category with this name already exists in the same kind"). Other validation errors are Korean 400s too.
- `backend/src/app.ts`: replaced the hand-written 404 and error handling with `notFound` and `errorHandler` from the central `standard/http.ts`, so that `HttpError` (404 and 409) can be answered. The response format (`{ error }`) is the same, and a broken JSON body now gets a 400 instead of a 500.
- `frontend/src/categories.tsx`: added category management to the ledger screen.
  - The expense and income cards each have an add input, a list, renaming, and hide and show again.
  - A hidden category gets a `숨김` ("Hidden") badge and is left out of the in-use count.
  - Results and server errors are shown in a `Notice` at the top of the screen.
- `frontend/src/ledger.tsx`, `page.tsx`: the ledger screen shows category management instead of the empty state. `Page`'s `emptyDescription` became optional.

## Verification

- Tests added
  - `backend/test/categories.test.ts` (9 without a DB): an empty name, a 31-character name, an unknown kind, no body, nothing to change, a bad ID, and an unknown list filter are rejected with a Korean 400 before reaching the DB. A duplicate error from the DB is 409, and changing a missing category is 404.
  - `backend/test/categories.integration.test.ts` (5 on a real DB): the default category list and order, re-running the migration after a rename, trimming and rejecting a same-kind duplicate (a different kind is allowed), rejecting a duplicate on rename, and a hidden category dropping out of and coming back to the `visible=true` list.
  - `frontend/src/categories.test.tsx` (7): the list by kind with the hidden badge and count, trimming on add and refreshing the list, showing a duplicate error and keeping the input, the add button disabled for an empty name, the hide and show again requests, canceling and saving a rename, and a warning when loading fails.
  - `frontend/src/app.test.tsx`: changed it to check that the ledger menu shows the `카테고리` ("Categories") heading instead of the empty state. The category API now returns an empty list.
- Test DB: we started a disposable `postgres:17-alpine` container (`127.0.0.1:15499`, DB `money_test`) with this PC's Docker and applied `001` and `002`. Applying `002` twice gave no error and left only the 11 default categories.
- `TEST_DATABASE_URL=<the test DB above> npm run check`: passed.
  - Backend 21 passed, 0 skipped (including the DB integration tests).
  - Frontend 72 of 74 passed, 2 skipped (existing tests).
  - 4 skill tests passed.
- `npm run standards:check`: passed.
- `npm run knip`: cannot run on this PC. It does not start because the `oxc-resolver` native binding is missing. The same error happens on `main`, so it is unrelated to this change. We check it with the PR CI's knip (strict).
- Browser: we connected the API to the test DB above and opened the Vite dev server with headless Chrome (viewport set through CDP).
  - Mobile 390×844: the expense card shows in one column and `scrollWidth` is 390, so there is no horizontal overflow. Pressing `이름 바꾸기` ("Rename") moves focus to the name field and the save and cancel buttons fit on one line. The hidden `여가` ("Leisure") shows the `숨김` badge and `다시 보이기` ("Show again").
  - PC 1440×900: the expense and income cards show in two columns, and `scrollWidth` is 1425 (a 15 vertical scrollbar), so there is no overflow.
  - Adding the existing `식비` ("Food") through the Vite proxy returns 409 and a Korean error.

## Limits

- "A hidden category does not appear in the new entry input list" was confirmed up to the API (`visible=true`). The input form is built in #38 and uses that filter.
- Reordering categories is out of scope, so we did not add it.

## Review record

### Round 1: 5 points addressed, 2 split off, 1 CodeQL warning

Addressed (2026-11-03, follow-up commit):

- The rename field opened with the name from the first render or with a value that still had leading or trailing spaces. It now starts from the stored name each time it opens.
- If the save succeeded but refreshing the list failed, it looked like the save failed, and pressing again gave a 409. We now report the save success and the refresh failure together and clear the input.
- If you pressed again while saving or hit Enter twice, the 409 of the second request covered the success message. While saving we turn the button off and send only one request.
- Saving or canceling a rename lost focus. We return it to the `이름 바꾸기` button.
- A decomposed (NFD) Korean name pasted on macOS avoided the duplicate check for the same name. The server now converts names to NFC before storing.

Tests added:

- `backend/test/categories.test.ts`: an NFD name is stored as NFC (1).
- `backend/test/categories.integration.test.ts`: renaming to a hidden category's name gives 409, and changing a missing category is 404 (1).
- `frontend/src/categories.test.tsx`: the stored name when reopening a rename, focus return, the refresh failure notice, and blocking duplicate submits (3).

Verification after the fixes:

- `TEST_DATABASE_URL=<test DB> npm run check`: passed. Backend 23 passed and 0 skipped, frontend 75 of 77 passed and 2 skipped (existing), 4 skill tests passed.
- Browser (CDP): at mobile 390×844, after rename then cancel, focus is on the `식비 이름 바꾸기` button. Mobile `scrollWidth` is 390 and PC is 1425, so there is no overflow.

Split off:

- The `dist/migrate.js` that the deploy script calls does not exist, so `002` cannot be applied automatically to an existing production DB. This problem existed before this PR and touches the deploy structure, so we split it off as [#71](https://github.com/sirloinbh/money-ledger/issues/71).
- CodeQL failed with `js/missing-rate-limiting` (high). Like the other apps it needs `express-rate-limit`, but installing a package is a user step, so we split it off as [#70](https://github.com/sirloinbh/money-ledger/issues/70). After merging #70 first, we merge `main` into this PR and check that the warning goes away.

### Round 2: 5 first-round points confirmed, 1 point

- Turning the button off while saving dropped keyboard focus from the button just pressed to the page. A duplicate request is already blocked by the `ref`, so we do not turn the button off. The duplicate submit test now checks that only one POST goes out while the button stays on.
- Verification: `TEST_DATABASE_URL=<test DB> npm run check` passed (backend 23 passed and 0 skipped, frontend 75 passed and 2 skipped (existing), 4 skill tests). In a real Chrome (CDP), pressing `교통 숨기기` ("Hide Transport") with focus on it leaves focus on the same button (`교통 다시 보이기`, "Show Transport again").
- By the standard, we do not run a third review.

### Merge of `main`: 2026-11-03

- [#70](https://github.com/sirloinbh/money-ledger/issues/70) (request rate limit) was merged, so we merged `origin/main` into this branch. The `withApi` option type in `backend/test/helpers.ts` conflicted, so we combined this branch's `call(path, init)` with `main`'s `Parameters<typeof createApp>[1]`. `app.ts` merged automatically, so the rate limit sits in front of the category routes.
- `TEST_DATABASE_URL=<test DB> npm run check`: passed. Backend 25 passed and 0 skipped, frontend 75 passed and 2 skipped (existing), 4 skill tests.
