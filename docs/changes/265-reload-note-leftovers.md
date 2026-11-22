# #265 Show a failed reload after a prepaid use or account change as a note

- Issue: [#265](https://github.com/sirloinbh/money-ledger/issues/265)
- Branch: `fix/265-reload-note-leftovers`
- Parent: #87 Ledger lookup, monthly analysis, and summary dashboard

## Purpose

#203 (asset screens) and #262 (ledger page) show a saved change whose reload fails as a status note, because the change is saved. Two places #262 left for their owners still showed an error: prepaid usage records and the mock trading account.

## Changes

- `prepaid-usages.tsx`: after a use is recorded or deleted, "`<done>`. The list could not be reloaded; reload the page to see it" as a status note.
- `mock-account.tsx`: after an account is created or reset, "`<done>`. The account could not be reloaded; reload the page to see it" as a status note. The sentence is the #203 one with the noun this screen reloads; the "no error, so show Loading" check applies only before the first load.

No shared test helper changed (agent4 is working on the test fakes, #183); each test file has its own small `failReloadAfterSave`.

## Verification

- New tests (fail on the old sources, pass now): `prepaid.test.tsx` (a recorded use whose reload fails shows the note and no alert in the panel), `mock-account.test.tsx` (a created account whose reload fails shows the note and no alert). Targeted runs of both files: 28 pass.
- Check run in parts under the shared lock, in the foreground, with Vitest capped at 3 workers (coordinator's memory rule): format, lint, contract, typecheck, backend tests (456 pass, 0 skipped, DB), frontend tests (75 files, 522 passed, 3 managed `skipIf` skips), skills tests, build and knip all pass.
- Browser (Vite 5292 + API 3192, local dev DB, Playwright; the page's `fetch` patched to fail the one reload after a save): 390×844 `/mock-trading` creating an account shows the status "Mock trading account created with ₩10,000,000. The account could not be reloaded; reload the page to see it" and no alert; 1440×900 `/portfolio` recording a ₩2,650 use on a new voucher shows "₩2,650 use recorded. The list could not be reloaded; reload the page to see it" and no alert. No horizontal overflow.

## Review

- Round 1: approve, no blocking findings. Both edits change only the notice kind and sentence in the catch path; the mock account's first-load "Loading" check and the prepaid panel's focus handling are untouched, and no shared test helper changed.
