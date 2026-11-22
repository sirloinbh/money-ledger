# #190 Split assets.tsx and entries.tsx into smaller components

- Issue: [#190](https://github.com/sirloinbh/money-ledger/issues/190)
- Branch: `chore/190-split-asset-entry-screens`
- Parent: #208 Fast and maintainable asset and entry screens

## Purpose

`assets.tsx` was about 1,260 lines with a 590-line `AssetManager` and unexported pure helpers; `EntryManager` in `entries.tsx` was 437 lines. The code review of 2026-11-18 (architecture M4) asked for smaller components and unit-tested helpers. This is a pure refactor: no behavior change.

## Changes

| File                                     | Holds                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asset-model.ts` (new)                   | The asset types, constants, and pure helpers moved as they were (`toBody`, `prepaidBody`, `depreciationBody`, `handPrice`, `valuationLines`, `valueText`, `depreciationText`, `prepaidText`, `totalText`), now exported, plus `draftFromAsset` (the old body of `startEdit`). |
| `asset-form.tsx` (new)                   | `AssetForm` with `PrepaidFields`, `DepreciationFields`, and `ValueFields`. A small `bind(field)` gives each draft input its value, wrong-field marks, and change handler instead of repeating them.                                                                           |
| `asset-list.tsx` (new)                   | `Summary` and `AssetList`, moved as they were.                                                                                                                                                                                                                                |
| `assets.tsx`                             | `AssetManager`: loading, the edit-follow effect, save, delete, and the layout.                                                                                                                                                                                                |
| `entry-model.ts` (new)                   | Entry types, `emptyDraft`, `parseAmount`, `draftFromEntry`, `categoryChoice` (offered categories and the stale choice), `entryLabel`.                                                                                                                                         |
| `entry-hooks.ts` (new)                   | `useAddressFilters`, `useEntryListing` (request numbering), `useEntryCategories`, `useFilterCleanup` (page past the end, category the filter cannot offer). Each is called where its code was, so effects run in the same order.                                              |
| `entry-form.tsx`, `entry-list.tsx` (new) | `EntryForm` and `EntryList` (moved as it was).                                                                                                                                                                                                                                |
| `entries.tsx`                            | `EntryManager`: the own-change skip, the load effect, the classification follow, save, delete, and the layout.                                                                                                                                                                |

Longest component functions now: `EntryManager` 249 lines, `AssetManager` 194, `AssetList` 163, `EntryForm` 154, `EntryList` 152 (before: `AssetManager` 590, `EntryManager` 437).

No component in another worker's area changed; the asset files were last changed by #189 and #187, and this branch starts from main after both.

## Verification

- New unit tests: `asset-model.test.ts` (16: `toBody` for cash, USD, linked stock, quantity, debt, prepaid, depreciable; `prepaidBody`; `depreciationBody`; `handPrice` incl. today's date; `valuationLines`; `draftFromAsset`), `entry-model.test.ts` (4: `parseAmount`, `draftFromEntry`, `entryLabel`, `categoryChoice`).
- Existing screen tests unchanged and passing: assets, asset trades, valuation, prepaid, portfolio, security picker (83); entries, entry CSV, entry filters, ledger, classification, categories (110).
- Same DOM: a temporary test rendered both screens in 20 states (new asset; each type; pass; the invalid form; editing each of six asset kinds; usage and trade panels open; entry list on page 2; invalid entry; editing an entry with a hidden category; switching kind) against the `origin/main` sources and these. With attributes sorted the dumps are identical (3,711 lines); unsorted, the only difference is that `value` comes last on inputs that use `bind`. The temporary test was removed.
- Check and browser: see below.
- Check run in parts under the shared lock, in the foreground, with Vitest capped at 3 workers (coordinator's memory rule): format, lint, contract, typecheck, backend tests (450 pass, 0 skipped, DB), frontend tests (74 files, 514 passed, 3 managed `skipIf` skips), skills tests, build and knip all pass.
- Browser (Vite 5292 + API 3192, local dev DB, Playwright): 390×844 `/portfolio` shows the right fields for prepaid, depreciable, stock and cash; adding "Browser check 190" says "Browser check 190 added"; Edit opens the edit form with the name focused and the value filled; Cancel returns to the new form keeping focus; no horizontal overflow. 1440×900 `/ledger`: adding an entry says "Expense ₩4,321 recorded", Edit opens the edit form with the date focused and the categories offered; no overflow.

## Limits

- `EntryManager` is just under the limit (249 lines). The next change that grows it should move the classification-follow effect into `entry-hooks.ts` as well.

## Review

- Round 1: 1 nit, fixed. The screen's history comment (#45-#64) was in both `asset-model.ts` and `assets.tsx`; it is now only in `assets.tsx`, and the model points to it. Also checked: the effect order in `EntryManager` matches the old one (address filters, listing, own-change, load, categories, classification follow, address cleanup, focus); `bind` keeps the same handlers and marks per field, including the quantity and hand-price hint overrides; the moved list components are byte-for-byte the old ones apart from `export`.
- Round 2: no findings.
