# #262 Show a failed list reload after a save as a note on the ledger page

- Issue: [#262](https://github.com/sirloinbh/money-ledger/issues/262)
- Branch: `fix/262-ledger-reload-note`
- Parent: #87 Ledger lookup, monthly analysis, and summary dashboard

## Purpose

#203 made the asset screens show a saved change whose list could not be reloaded as a status note: the change is saved, so an error reads as if it failed. The ledger page still showed the same case as an error ("… Could not reload the list"). This applies the #203 rule and wording there.

## Changes

- `entries.tsx`: after a saved entry ("Expense ₩12,500 recorded. The list could not be reloaded; reload the page to see it") and after a delete ("Entry deleted. The list could not be reloaded; …").
- `classification.tsx`: after classifying uncategorized entries (`reloadAfter`) and after adding or deleting a rule (`reload`).
- `categories.tsx`: after adding, renaming, hiding, or showing a category.

All five now call `showStatus` with the #203 sentence instead of `showError`. Nothing else depends on the notice kind there: the "no error, so show Loading" checks apply only before the first load, when the list is still undefined. On the entries list, the existing "Could not load the entries. Try again" line still appears under a failed reload, as before.

## Verification

- New tests (fail on the old sources, pass now): `entries.test.tsx` (a saved entry and a delete whose reload fails show the note and no alert), `classification.test.tsx` (the same for a classification and a rule), `categories.test.tsx` (the existing test now expects the note, not an alert). Targeted runs of the three files: 64 pass.
- Check run in parts under the shared lock, in the foreground, with Vitest capped at 3 workers (coordinator's memory rule): format, lint, contract, typecheck, backend tests (456 pass, 0 skipped, DB), frontend tests (75 files, 520 passed, 3 managed `skipIf` skips), skills tests, build and knip all pass.
- Browser (Vite 5292 + API 3192, local dev DB, Playwright; the page's `fetch` patched to fail the one reload after a save): 390×844 adding an entry shows the status "Expense ₩2,620 recorded. The list could not be reloaded; reload the page to see it", no alert, and the list's "Could not load the entries. Try again" line; 1440×900 adding a category shows "Note262 category added. The list could not be reloaded; …", no alert, the input cleared. No horizontal overflow.

## Limits

- `prepaid-usages.tsx` (asset screen) and `mock-account.tsx` (mock trading) have the same pattern and are left for their owners; the issue notes them.
