# #196 Fix mock order dates, quote drift check, and reset fee

- Issue: [#196](https://github.com/sirloinbh/money-ledger/issues/196)
- Branch: `fix/196-mock-order-dates`
- Parent: #209 Correct mock trading orders and screens

## Purpose

Four defects from the 2026-11-18 code review of `backend/src/mock-orders.ts` and `backend/src/mock-accounts.ts`:

- A mock order read `today()` three times (the quote's stale check and the snapshot's two dates), so an order that ran across KST midnight could mix two dates.
- The quote drift check compared the confirmed close and rate as strings, so `"80000"` never matched the stored `"80000.0000"` and the order was refused as "The quote changed".
- A replayed order (same request key) answered with the account's current cash instead of the cash the first fill left.
- Resetting an account did not copy `fee_rate`, so a custom fee silently became 0 on the new account.

## Changes

- `backend/src/mock-orders.ts`
  - `POST /api/mock/accounts/:id/orders` reads the service date once per request and uses it for the quote and the snapshot.
  - New `sameDecimal(stored, sent)`: compares two plain decimal strings by value (leading zeros of the whole part and trailing zeros of the fraction are dropped), exactly on the digits and never through a JS `number`. Text that is not a plain decimal (`8e4`, `+80000`, `" 80000"`, `""`) never matches, so it is refused as a changed quote (409), as before.
  - The expected price and rate keep their schema (string up to 30 characters or null); the format is now documented with `.describe()` on `expectedPrice`, `expectedPriceDate`, and `expectedFxRate`, which also appears in `docs/openapi.json`.
  - A replay returns `first.cash_after_krw` as `cashKrw`.
- `backend/src/mock-accounts.ts`: reset inserts the new account with `fee_rate` selected from the closed account, in the same transaction.
- `docs/openapi.json`: regenerated with `npm run openapi` (descriptions only).

## Tests

- `backend/test/mock-orders.test.ts`: `sameDecimal` cases for equal values written differently and for values or text that must not match.
- `backend/test/mock-orders.integration.test.ts`
  - "the confirmed close and rate are compared as numbers (#196)": `"70600"` against `"70600.0000"` and `"231.5"`/`"1384.50"` for a US order fill; `"70600.0001"`, `"7.06e4"`, `""`, and a different rate are refused.
  - "an order reads the service date once (#196)": a clock that turns to the next day after its first reading; the snapshot is saved for the first date only.
  - The request-key test now places a later order and replays the first: `cashKrw` is the first fill's `cashAfterKrw`, not the current cash.
- `backend/test/mock-accounts.integration.test.ts`: "reset keeps the account fee rate (#196)". The test setup now also applies `009_prices.sql` and `015_mock_orders.sql`, because `fee_rate` comes from 015.
- Against the old source (`origin/main` versions of the two files), the four new integration checks fail; with the fix they pass.

## Verification

- `tsx --test --test-concurrency=1 test/mock-orders.test.ts test/mock-orders.integration.test.ts test/mock-accounts.integration.test.ts` with `TEST_DATABASE_URL` set to a dedicated PostgreSQL 17 test DB: 38 pass, 0 fail, 0 skipped.
- `npm run check` with `TEST_DATABASE_URL` set to the dedicated test DB (`postgres:17-alpine`, the CI image): exit 0. Backend 415 pass, 0 fail, 0 skipped; frontend 70 files, 456 pass, 3 skipped (the existing `skipIf` tests for the theme and app switcher settings); skills 4 pass; build passes.
- `npm run knip`: exit 0 (configuration hints only).
- A first run on a `postgres:17` (Debian) test DB failed one unrelated classification test that sorts Korean and Latin keywords; the order depends on the collation, and CI uses the Alpine image. On the Alpine image it passes.

## Limits

- The preview already read `today()` once; it is unchanged.
- No frontend change: the screen already sends the strings the preview returned.

## Review

- Round 1 (PR #239 comment): approve, no blocking comments. No fix commits, no split issues.
