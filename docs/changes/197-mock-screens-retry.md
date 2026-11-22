# #197 Keep mock trading screens in step with orders and retries

- Issue: [#197](https://github.com/sirloinbh/money-ledger/issues/197)
- Branch: `fix/197-mock-screens-retry`
- Parent: #209 Correct mock trading orders and screens

## Purpose

Four screen defects from the 2026-11-18 code review:

- `frontend/src/mock-account.tsx`: every reload (including the one after each order) overwrote the typed reset amount with the account's starting amount.
- `frontend/src/mock-history.tsx`: after a new filter was applied, the old page stayed on screen with no busy state, and "Load more" silently did nothing until the new page arrived.
- `frontend/src/mock-order.tsx`: the preview was cast to `Ready` with `priceDate`, `feeKrw`, and `cashAfterKrw` still possibly null; `crypto.randomUUID()` does not exist on plain HTTP, so every order failed with "Could not check the order".
- `frontend/src/security-search.tsx`: after a security detail failed to load, clicking the same result did nothing, and there was no way to retry.

## Changes

- Mock account: the reset amount is filled in only on the first load and when the open account changes (a reset, or a new account from another tab). Reloads after an order keep what was typed.
- Trade history: the page remembers the query it was loaded for. While a newer filter or refresh loads, a "Updating trade history" status shows, the list has `aria-busy="true"` and is dimmed, and "Load more" has `aria-disabled="true"`. A failed load keeps the old page without the busy state; applying or clearing filters again starts a new attempt.
- Mock order:
  - `readyOf()` checks every value the dialog and the order use (`price`, `priceDate`, `amountKrw`, `feeKrw`, `cashAfterKrw`, and the rate for a USD security) and returns a typed `Ready` without a cast.
  - `newRequestKey()` uses `crypto.randomUUID()` when it exists and otherwise builds a version 4 UUID from `crypto.getRandomValues()`, which also works on plain HTTP. If neither exists, the screen says "This browser cannot create an order key, so the order cannot be placed. Open the app over HTTPS and try again".
- Security search: a failed detail shows a "Try again" button that loads it again (focus moves to the detail heading). Clicking the selected result again after its detail failed also opens it afresh; a detail that loaded is left as it is, so an order being typed in it is kept.

## Tests

- `frontend/src/mock-account.test.tsx`: a typed reset amount survives a reload with a new refresh key; another account fills in its own amount.
- `frontend/src/mock-history.test.tsx`: while a new filter loads, the status shows, the list is busy, "Load more" is `aria-disabled` and sends nothing; afterwards the busy state is gone. The fake `fetch` gained an optional `gate` so a load can be held open.
- `frontend/src/mock-order.test.tsx`: a preview missing any of the five values, or a USD preview without a rate, never opens the dialog; without `crypto.randomUUID` the key is a valid version 4 UUID from `getRandomValues`; without any random source the screen explains why.
- `frontend/src/security-search.test.tsx`: "Try again" and a second click on the same failed result both send the view request again; a working answer replaces the error; another click on the loaded result sends nothing and keeps the typed quantity.
- With the `origin/main` versions of the four screens, all six new tests fail; with the fix they pass.

## Verification

- `vitest run src/mock-account.test.tsx src/mock-history.test.tsx src/mock-order.test.tsx src/security-search.test.tsx`: 46 pass.
- Browser check (Playwright, local API on 3194 and Vite on 5294 against a seeded local DB):
  - 390×844: a forced 503 on the detail shows the error with "Try again"; the retry loads the detail; an order from the detail fills; the typed reset amount `25,000,000` stays after the order; a held history load shows "Updating trade history" with the old list dimmed and `aria-busy="true"`, and both clear when the load finishes. No horizontal overflow.
  - 1440×900: the history list and filters lay out on one row; the reset amount is kept; no horizontal overflow.
- `npm run check` (through the shared check lock) with `TEST_DATABASE_URL` on a dedicated `postgres:17-alpine` test DB: exit 0. Backend 412 pass, 0 fail, 0 skipped; frontend 70 files, 469 pass, 3 skipped (existing `skipIf` theme and app-switcher tests); skills 4 pass; build passes.
- `npm run knip`: exit 0 (configuration hints only).

## Limits

- The order key fallback cannot be checked in a real browser on plain HTTP here (the local check runs on 127.0.0.1, a secure context); it is covered by the component tests.
