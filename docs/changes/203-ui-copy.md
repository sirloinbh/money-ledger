# #203 Fix English UI copy: plurals, fragments, and shared phrases

- Issue: [#203](https://github.com/sirloinbh/money-ledger/issues/203)
- Branch: `fix/203-ui-copy`
- Parent: #87 Ledger lookup, monthly analysis, and summary dashboard

## Purpose

The code review of 2026-11-18 found broken English on several screens: "1 rows", "Import 1 entries", "1 shares", "Found 3"; notes that were fragments ("2 without a quote … left out."); the form name "Samsung Electronics Add trade"; a reload failure after a successful save shown as an error; raw ISO dates; a `~` range separator; and the quote phrase built inline instead of by `quoteBasis`.

## Changes

- `format.ts`: `countOf(count, one, many?)` ("1 row", "2 rows", "1,234 entries") and `sharesOf(quantity)` ("1 share", "1.5 shares") for decimal strings from the API (no number arithmetic; the singular is found by the text).
- Counts: CSV import (file too long, columns heading, preview heading, more rows, likely duplicates, Import button, result), mock trading (history, holdings, order status, dialog title, "Selling 3 of the 10 shares held"), security search ("Found 3 securities"), net worth table toggle ("Show as a table (1 day)"), depreciation ("useful life 1 month").
- Sentences: the allocation and asset totals notes say "2 assets without a quote … are left out"; the net worth table says "1 asset left out"; the trade form is named "Add a trade to Samsung Electronics" / "Edit a trade of …".
- A reload failure after a saved asset or trade is a status note ("… recorded. The list could not be reloaded; reload the page to see it"), not an error.
- Dates and ranges: the dashboard says "Saved on Nov 16, 2026" and the net worth table rows use `dayLabel`; the entry filter, monthly trend and net worth ranges use an en dash ("2026-10-15 – 2026-11-15").
- `quoteBasis` takes `{ tradeDate, stale }` and is used by `assets.tsx` and `mock-holdings.tsx` instead of rebuilding "Delayed · Nov 6 close".

Touched files owned by other workers (assets, mock trading) only for these strings.

## Verification

- New tests: `format.test.ts` (`countOf`, `sharesOf` singular and plural); `mock-history.test.tsx` ("1 share", never "1 shares"); `entry-csv.test.tsx` ("Columns of one.csv (1 row)", "The 1 row can be imported", "1 row looks like an entry you already have … row 2.", "Import 1 entry", "Columns of two.csv (2 rows)", "1 of 2 rows cannot be imported"); `asset-trades.test.tsx` (a failed reload after a saved trade is a status note and no alert; fails on the old source).
- Updated pins: allocation, assets, valuation, dashboard, entry filters, monthly trend, net worth history, CSV import (13 tests failed on the new copy before the update, as expected).
- Check run in parts under the shared lock, in the foreground, with Vitest capped at 3 workers (coordinator's memory rule): format, lint, contract, typecheck, backend tests (440 pass, 0 skipped, DB), frontend tests (71 files, 484 passed, 3 managed `skipIf` skips), skills tests, build and knip all pass.
- Browser (Vite 5292 + API 3192, local dev DB, Playwright): 390×844 the dashboard net worth card says "Saved on Nov 22, 2026", no horizontal overflow; 1440×900 the entry filter shows "2026-11-05 – 2026-11-25" and the monthly trend "December 2025 – November 2026", no overflow.

## Limits

- Other screens still have counts written by hand with their own singular handling (for example classification); they were already correct and are left as they are.
- The entries, classification and categories sections still show a failed reload after a save as an error; the issue named only the asset screens. A follow-up can align them.
