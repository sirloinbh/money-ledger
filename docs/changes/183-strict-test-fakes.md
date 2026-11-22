# #183 Strict test fakes

- Issue: [#183](https://github.com/sirloinbh/money-ledger/issues/183)
- Branch: `test/183-strict-test-fakes`
- Parent: #207 Fast and trustworthy tests

## Purpose

Several screen tests used fakes that answered almost any request: one merged payload for every URL, "any non-GET creates an account", "any GET is the asset list". A wrong path, a wrong method, or a new call still passed. Now each fake answers only the requests it lists, and any other request fails the test and names that request.

## Changes

- **`frontend/src/test/unexpected.ts` (new helper):** `unexpectedRequest(method, url)` records the request and rejects it like a failed connection. An `afterEach` then fails the test with "requests that no test fake answers: [...]". A fake cannot fail the test from inside `fetch`, because the screen catches the error and shows it, so the check runs when the test ends. Existing helpers (`test/live.ts`, `test/setup.ts`) keep their shapes.
- **`app.test.tsx`:** the merged empty payload now answers only the 15 requests the pages make, listed by method and path (the query depends on today's date). `/api/health` keeps its own answer.
- **`dashboard.test.tsx`:** a request the test does not list goes to `unexpectedRequest` instead of becoming "Cannot reach the server" on a card.
- **`mock-account.test.tsx`:** routes by method and path: `GET /api/mock/accounts`, `POST /api/mock/accounts`, and an account's `holdings`, `orders`, `snapshots` (GET) and `reset` (POST). Any account id is accepted, because the tests change the open account to stand for the server moving on. Before, any non-GET created an account.
- **One typed fake asset server, `frontend/src/test/asset-api.ts` (new):** it is shared by `assets.test.tsx` and `asset-trades.test.tsx`.
  - Its answers are typed against the screens' own response types, which are now exported: `Asset` and `AssetsAnswer` from `assets.tsx`, and `Trade` and `TradesAnswer` from `asset-trades.tsx`. These are type-only exports; the screens behave the same.
  - It now sends `allocation`, which the old copies left out, as an empty allocation; that card has its own tests. `asOf` is a query parameter of the list request, not a field of the answer, so the answer type has no `asOf`.
  - Routes: list, add, edit, and delete assets, and list, add, edit, and delete an asset's trades. It merges the two old fakes: totals are added up the way the server does, and trades keep the fixed position.
- **`valuation.test.tsx`:**
  - A row is now the one list item that holds the asset's own "Edit <name>" button, found by role instead of by the `span.font-medium` class.
  - Its fake also became strict: it answers only the price search, the asset list, adding and editing an asset, and an asset's trades.
- **`mock-history.test.tsx`:**
  - The fake serves only account 7's orders and can answer with a failure.
  - New tests:
    - A first load that fails shows the server message and no list or spinner.
    - A filter that fails keeps the old list, no longer busy, and Apply tries again.
    - "Load more" that fails keeps the shown orders and says why.
- **`entries.test.tsx`:**
  - The fake serves only categories, the entry list, adding, editing, and deleting an entry, and the CSV preview and import.
  - New tests for the `onImported` branches (`entries.tsx` `EntryCsv onImported`), each driving a real one-row CSV import:
    - With `onChange`, the parent is told and the manager does not reload by itself.
    - Without one, the list reloads and shows the new row.
    - A failed reload shows the server message.

## Verification

- **"Done when" (misspelled path):** for each changed test file, one request path was misspelled in the screen's source. The file then fails, and the failure names the request:

  | Test file      | Path misspelled          | Result        |
  | -------------- | ------------------------ | ------------- |
  | `app`          | `/api/ledger/rules`      | 7 of 14 fail  |
  | `dashboard`    | `/api/mock/accounts`     | 7 of 7 fail   |
  | `mock-account` | `accountsPath`           | 16 of 16 fail |
  | `mock-history` | `orders`                 | 10 of 10 fail |
  | `assets`       | `assetsPath`             | 26 of 27 fail |
  | `asset-trades` | `trades`                 | 11 of 11 fail |
  | `valuation`    | `trades`                 | 1 of 9 fail   |
  | `entries`      | `/api/ledger/categories` | 26 of 26 fail |

- **Mutation checks for the new tests:**
  - Without `setFailed(query)` in `mock-history.tsx`, the filter-failure test fails.
  - In `entries.tsx`:
    - Ignoring `onChange` fails the parent test.
    - Not reloading fails both no-parent tests.
    - Dropping the error message fails the failed-reload test.
- `npm run check` and `npm run knip` ran in parts through the shared check lock (a full run can crash Vitest on this shared 16 GB machine), with `TEST_DATABASE_URL` on a dedicated `postgres:17-alpine` test DB:
  - `format:check`, `lint`, `contract:check`, `typecheck`: exit 0.
  - Frontend (`--maxWorkers=3`): 72 files, 496 pass, 3 skipped (existing `skipIf` tests).
  - Backend: 449 pass, 0 fail, 0 skipped. `test:skills`: 4 pass. `build`: passes.
  - `knip`: exit 0 (configuration hints only).

## Limits

- `entry-csv.test.tsx` and other files outside the issue keep their fakes. Some of them answer by URL alone. They can move to `unexpectedRequest` when they are next changed.

## Review

- Round 1 (PR #263 comment): approve after one nit, fixed. The shared asset fake's handlers now take the request body as a parameter instead of reading back the last recorded request. The asset tests (38) pass, and the type check and lint pass. No split issues.
- Merges of `origin/main` (after #190, #203, #187, #185, #195, and the #188 backend move):
  - `assets.tsx` is resolved onto the #190 split. `AssetsAnswer` stays in `assets.tsx`, and the shared fake imports `Asset` from `asset-model.ts`.
  - The #203 tests in `mock-history` and `asset-trades` are kept next to the #183 ones. The #203 trade test answers its failure with a plain `Response`.
  - The CSV import test follows the #203 copy ("Import 1 entry").
  - Checks after the merges, in parts through the lock: `format:check`, `lint`, `contract:check`, `typecheck` exit 0. Frontend: 75 files, 524 pass, 3 skipped. Backend: 456 pass. `test:skills`: 4 pass. `build` and `knip` pass.
- Round 2 (PR #263 comment): approve, no findings on the merge resolution.
