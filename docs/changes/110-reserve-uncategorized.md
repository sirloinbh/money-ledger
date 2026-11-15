# #110 Reserve the category name "Uncategorized"

The monthly summary names spending with no category "Uncategorized" (it was "미분류" before the app switched to English). A user category with that name showed as a second row of the same name that nobody could tell apart.

## Decision

The user chose to reserve the name (2026-11-16, recorded on #110). The alternative was relabelling the summary row.

## What changed

- `backend/src/categories.ts`: the category name check refuses "Uncategorized" and "미분류" with a 400. It ignores case and spaces, so `UNCATEGORIZED`, `un categorized`, and `미 분류` are refused too. The check applies when adding and when renaming. A name that only contains the word, such as "Uncategorized food", is allowed.
  - The message is "\"Uncategorized\" is reserved for entries with no category; choose another name". The categories screen already shows the server's message, so the frontend did not change.
- Existing categories with a reserved name are left as they are. They can still be hidden. No local dev database exists on this machine (only test containers), so no existing rows could be checked; if one exists, rename it on the categories screen.

## Verification (2026-11-16)

- `backend/test/categories.test.ts`: 5 reserved spellings refused when adding, refused when renaming, and "Uncategorized food" allowed. 17 passed.
- With the test DB (`categories.integration.test.ts` and the unit tests): 24 passed, none skipped.
- `npm run check` passed: frontend 344 passed / 2 skipped; backend 180 passed / 18 DB tests skipped (no test DB in that run). `npm run knip` passed.

### Review (PR #147)

- No blocking findings. Add and rename are both covered; hiding a category that already has the name still works; the seeded names and the CSV export never use it.
- Not changed (nit): zero-width characters are not stripped. Getting past the check that way is deliberate, and the name would still look different on screen.
