# #192 Enforce prepaid balances and mark refused fields by code

- Issue: [#192](https://github.com/sirloinbh/money-ledger/issues/192)
- Branch: `fix/192-prepaid-balance-fields`
- Parent: #91 Investment asset trading and valuation

## Purpose

Migration 010 left "the uses of a voucher never exceed its amount paid" to the API, and `portfolio_prepaid_value`'s `greatest(..., 0)` would hide a negative balance. The usage form picked the refused field by looking for "date" or "balance" in the server message, which also matched words like "update" or "dated", and the tests used hand-written copies of the server messages, so a rewording would pass the tests and break the screen.

## Changes

- `backend/src/assets.ts`: `POST /api/portfolio/assets/:id/usages` answers its date and balance refusals with `fields: [{ path, message }]` (the shared `ApiError` shape): `usedOn` for a date after today or after the expiry, `amountKrw` for a use above the balance. Other refusals keep the plain `{ error }` answer.
- `frontend/src/prepaid-usages.tsx`: the refused field comes from `RequestError.fields` (`usedOn` → date, `amountKrw` → amount). A refusal without fields marks no field.
- New migration `database/migrations/025_prepaid_usage_balance.sql` (first held as 037, renamed to the next free number above `origin/main`, coordinator rule 2026-11-22; checked again right before merging):
  - `portfolio_prepaid_usage_check()` locks the asset row, sums its uses, and raises `check_violation` when uses exist on a non-voucher or exceed the amount paid.
  - Constraint triggers run it after a use is inserted or its amount or asset changes, and after an asset's `prepaid_kind` or `prepaid_amount_krw` changes.
  - Before adding the triggers it refuses to apply, naming the assets, when existing rows are already over their amount.

## Verification

- `backend/test/prepaid.integration.test.ts`:
  - The reset applies the new migration twice (re-running is safe).
  - The balance, expiry and future-date refusals now assert the `fields` entry.
  - "the DB refuses uses above the amount paid": outside the API, a use past the balance, a raised use, a lowered amount paid and a change to a pass all fail with `23514`; exactly the rest still goes in; two concurrent inserts of the last 4,000 won give one success and one refusal.
  - "the balance migration reports vouchers already over their amount": with the asset trigger dropped and the amount lowered under the uses, the migration fails naming the asset; after the fix it applies.
- `frontend/src/prepaid.test.tsx`: the fake server now words its refusals differently from the real one and sends `fields`; the existing balance and expiry tests mark the right field from the path. A new test sends "The balance dated today needs an update before this amount" with `path: 'amountKrw'` and checks that the amount, not the date, is marked, and that a 400 without fields marks nothing. Three tests fail without the `prepaid-usages.tsx` change and pass with it.
- Commands and results are in the PR body.

## Limits

- A production database with a voucher already over its amount stops the deploy's migration step with the error above; it must be fixed by hand. The API has refused such writes since #64.
- Zod validation errors on this route still answer without `fields` (the shared error handler is mounted without them); the form checks those inputs before sending.
