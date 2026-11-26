# Estimate the year-end tax card deduction (#296)

Entries get a payment method (credit card, debit card, cash). The Ledger page gets a card that adds up the year's expense per method, takes the year's total salary, and shows the threshold, the amount past it, and an estimated deduction.

## Decisions

- **Existing entries have no payment method** (`NULL`, "Not set") and are left out of the estimate; the card says how much expense that is. This is the recommendation of the issue and is used while the coordinator confirms it with the user.
- An edit that does not send `paymentMethod` keeps the current one (so older clients and the AI tools do not wipe it); `null` clears it. Only expenses have one in the form.
- The rules and their sources are in [../card-deduction.md](../card-deduction.md). They live in one constant (`cardRules`).

## Changes

| File                                                                             | Change                                                                                                                                                         |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database/migrations/050_entry_payment_method.sql`                               | `ledger_entries.payment_method` (nullable, three values) and the table `ledger_tax_salaries` (year, total salary)                                              |
| `backend/src/ledger/entries.ts`                                                  | `paymentMethod` in the body and the answer, on create and replace                                                                                              |
| `backend/src/ledger/card-deduction.ts`                                           | `estimateCardDeduction` (pure, bigint), `GET /api/ledger/tax/card-deduction?year=`, `PUT /api/ledger/tax/salary`                                               |
| `backend/src/app.ts`, `backend/src/openapi.ts`, `docs/openapi.json`              | Routes registered and documented                                                                                                                               |
| `frontend/src/entry-form.tsx`, `entry-model.ts`, `entry-list.tsx`, `entries.tsx` | "Paid with" field for expenses, shown in the list                                                                                                              |
| `frontend/src/card-deduction.tsx`, `frontend/src/ledger.tsx`                     | The estimate card                                                                                                                                              |
| tests                                                                            | `card-deduction.test.ts`, `card-deduction.integration.test.ts`, `card-deduction.test.tsx`; existing entry, app and OpenAPI tests list the new field and routes |

## Verification

- `npm run check` passed on 2026-11-26 on the lane test DB `money_test` (container `money-ledger-test-lane1`, port 15491), 0 skipped backend tests.
- Real browser (Playwright Chromium, API 3191 and Vite 5291, a seeded DB with four 2026-11 expenses: credit card ₩45,000, debit card ₩12,000, cash ₩30,000, and one without a method ₩8,000): at 390x844 and 1440x900 there is no horizontal scroll, the "Paid with" field lists Not set / Credit card / Debit card / Cash, and the list shows the method next to the category. Saving a total salary of ₩200,000 through the screen showed the threshold ₩50,000, ₩37,000 past it, an estimated deduction of ₩11,100 (checked by hand: the credit card spending of ₩45,000 uses ₩45,000 of the ₩50,000 threshold, and (₩12,000 + ₩30,000 - ₩5,000) x 30% = ₩11,100), and the ₩8,000 without a method called out as left out.

## Limits

An estimate only; see "Not modeled" in [../card-deduction.md](../card-deduction.md). The card import (#57) fills the payment method for imported entries.
