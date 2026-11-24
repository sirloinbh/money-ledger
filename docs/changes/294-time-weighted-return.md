# Time-weighted return of the mock account (#294, part 1)

Part of mock investing v2 (#303), step 7. The user decided on 2026-11-24 that the account return is **time-weighted**, so money added to or taken out of the account is not counted as a gain or a loss. The comparison with the deposit and the fixed-rate benchmarks follows in a second PR under the same issue.

## How the return is calculated

- Known values: the account's initial cash dated the day before it started, and every saved daily value (`mock_snapshots`, #54).
- Between two known days: `step = (value now - cash flows in between) / value before`. A flow dated after the earlier day up to and including the later day is taken out of that step.
- Period return: the product of the steps, minus 1, as a percentage rounded to 2 places (half away from zero). It runs in SQL `numeric` (`exp(sum(ln(step)))`), never in JavaScript.
- A period starts at the last known value on or before `from` (default: the account start) and ends at the last known value on or before `to` (default: today). With no known day after the start, `returnPct` is `null`.

## Changes

| File                                                                | Change                                                                                                                      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `database/migrations/030_mock_cash_flows.sql`                       | New table `mock_cash_flows` (deposits positive, withdrawals negative, whole won). Empty until the account can take deposits |
| `backend/src/benchmark.ts`                                          | `accountReturn` (the SQL above) and `GET /api/mock/accounts/:accountId/return?from=&to=`                                    |
| `backend/src/app.ts`, `backend/src/openapi.ts`, `docs/openapi.json` | Route registered (append-only) and documented                                                                               |
| `frontend/src/return-comparison.tsx`                                | The card "Return of your decisions" with 1 month, 3 months and All, placed under the return trend                           |
| `frontend/src/mock-account.tsx`                                     | One line that places the card                                                                                               |

The mock account has no way to add money yet, so for now the cash flows table stays empty and the time-weighted return equals the plain return. The calculation and its tests already cover deposits and withdrawals.

## Tests

- `backend/test/benchmark.integration.test.ts` (real DB): no value yet, chained returns (+5% then +10% = +15.50%), a deposit that is not a gain (17.81% instead of 67.81%), a withdrawal that is not a loss, periods (start between two days, end date, start before the account), half-away rounding, loss, 404 and bad dates.
- `frontend/src/return-comparison.test.tsx`: values and money added, the three periods and their requests, no return yet and reload on mock changes, load failure.

## Migration number

`030` is lane-4's number in `LANES.md`; `026` was already taken on main by `026_spending_report_changes.sql`.

## Verification

- `npm run check` passed on 2026-11-24 (backend 473 tests with 0 skipped on the dedicated test DB `money_test` of lane 4, frontend 573 passed and 3 skipped as before).
- Other tests that drop `mock_accounts` now list `mock_cash_flows` too (a foreign key points at it): `allocation`, `daily-saves`, `mock-accounts`, `mock-orders` and `net-worth` integration tests. `openapi.test.ts` lists the new mount, and `mock-account.test.tsx` answers the new request.
- Real browser (Playwright Chromium, fake prices, a seeded account with values of 2%, 8% and 4.2%): at 390x844 and 1440x900 the card "Return of your decisions" shows +4.2% (`10,000,000` to `10,420,000`, `₩0` added) with no horizontal scroll; "3 months" sets `aria-pressed` and reloads. The API answered `returnPct` 4.20 for the whole period and 2.16 from a start in the middle (checked by hand: 1.02 x 1.0588 x 0.9648).
