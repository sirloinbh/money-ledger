# Suggest recurring payments as fixed costs (#291)

The Ledger page gets a "Recurring payments" card that lists merchants charging about the same amount every month and are not a fixed cost yet. One click registers a suggestion as a fixed cost; "Dismiss" hides the merchant for good.

## The rule

A merchant is recurring when, in each of the last **3 complete months**, it has **exactly one** expense entry and every amount is within **10% of the median** amount. This is the recommendation of the issue; it lives in one constant (`recurringRule` in `backend/src/ledger/recurring.ts`) and the card reads it from the answer.

- The current month is not counted (this month's charge may not have happened yet).
- Two or more charges in one month means a shop you visit, not a bill, so the merchant is skipped.
- Merchants are grouped with the merchant matching of #154 (`merchantKey`: branch words and bracketed parts are ignored, so "스타벅스 강남점" and "스타벅스 역삼점" are one merchant).
- A merchant is skipped when it matches the name of any fixed cost (also a stopped one), or was dismissed. Entries that fixed costs added themselves are ignored.
- Amounts are whole won, so the comparison `|amount - median| * 100 <= median * 10` is exact integer arithmetic.
- The suggestion carries a ready body for `POST /api/ledger/fixed-costs`: the merchant name (30 characters at most), the latest amount, "variable" when the amounts differ, the median day, and a start month **next month**, so this month's real charge is not added a second time.

## Changes

| File                                                                | Change                                                                                                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database/migrations/041_recurring_dismissals.sql`                  | New table `ledger_recurring_dismissals`, keyed by the normalized merchant                                                                                   |
| `backend/src/ledger/recurring.ts`                                   | `detectRecurring` (pure), `GET /api/ledger/recurring` and `POST /api/ledger/recurring/dismiss`                                                              |
| `backend/src/ledger/suggestions.ts`                                 | New helper `sameMerchant`, built on the existing key rules (nothing else changed)                                                                           |
| `backend/src/app.ts`, `backend/src/openapi.ts`, `docs/openapi.json` | Route registered and documented                                                                                                                             |
| `frontend/src/recurring-suggestions.tsx`, `frontend/src/ledger.tsx` | The card, placed with one line under the fixed costs                                                                                                        |
| tests                                                               | `recurring.test.ts`, `recurring.integration.test.ts`, `recurring-suggestions.test.tsx`; `app.test.tsx` and `openapi.test.ts` list the new request and mount |

Registering uses the existing fixed cost route, so its validation, the hidden-category rule and the entry generation are unchanged.

## Verification

- `npm run check` passed on 2026-11-24 (backend with 0 skipped on the dedicated test DB `money_test` of lane 4), and `npm run knip` shows no unused export of this change.
- Tests cover detection (regular, a missing month, amount drift, exactly 10% and one won over, several charges in a month, this month and older months ignored, branch names, already registered, dismissed, zero amounts, ordering), the API on the real DB (registering through the existing route, entries added by a fixed cost ignored, dismissal for any branch name, bad body) and the card (list, one-click register, dismiss, empty, failure).
- Real browser (Playwright Chromium, a seeded ledger with Netflix, KT with amounts 52,000 / 55,000 / 57,000 and a cafe seen once): at 390x844 the card lists KT (varies, day 25) and Netflix with their past charges and 32 px buttons, no horizontal scroll; at 1440x900 "Register as fixed cost" on Netflix removed it from the list, showed "Registered Netflix as a fixed cost" and added it to the fixed cost list (₩10,900, day 5, from 2026-12); "Dismiss" on KT removed it, and the server then answered no suggestions and stored the merchant key.

## Decision

The rule (3 of the last 3 months, within 10%) is the issue's recommendation, used while the coordinator confirms it with the user. If the answer differs, only `recurringRule` and its tests change.
