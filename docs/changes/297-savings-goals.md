# Savings goals with progress (#297)

A new Goals page (`/goals`, "Goals" in the main menu) lets the user set savings goals and see progress, the amount left and the monthly amount needed.

## The rules

- A goal has a name (30 characters at most), a target amount (₩1 to the ₩1 trillion cap, whole won), an optional target date and a progress source.
- **Monthly surplus** source: income minus expenses of the entries dated from the goal's start month through today, never below 0. The start month is the month the goal was created (or the month it was switched to this source), so old surplus is not counted by surprise.
- **Asset account** source: the current KRW value of one asset account, from the same valuation query as the asset screen (`assetQuery`, read only). A debt cannot be chosen. If the account is deleted, the goal stays with no progress ("The account was deleted") until another account is chosen; the account has no value yet (no price or rate) shows its own message.
- The amount left and the percentage use exact integers (BigInt). The monthly amount needed is the amount left divided by the months from this month to the target month (at least 1), rounded up, so paying it every month reaches the target. A past target date shows "Past the target date" and no monthly amount; a reached or finished goal needs none.
- A goal can be edited, finished (it moves below the open goals), reopened and deleted (the page asks first).

## Changes

| File                                                                | Change                                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `database/migrations/050_savings_goals.sql`                         | New table `savings_goals` (the number is rechecked at the final sync with main)               |
| `backend/src/goals.ts`                                              | `GET/POST /api/goals`, `PATCH/DELETE /api/goals/:id`, progress in `toGoal`                    |
| `backend/src/app.ts`, `backend/src/openapi.ts`, `docs/openapi.json` | Route registered and documented                                                               |
| `frontend/src/goals.tsx`, `frontend/src/app.tsx`                    | The page, the route and the menu entry                                                        |
| tests                                                               | `goals.test.ts`, `goals.integration.test.ts`, `goals.test.tsx`; `app.test.tsx` lists the page |

## Verification

- See the PR for the `npm run check` result and the browser check; both are recorded there after they ran.
- Backend: 6 unit tests and 6 DB integration tests (surplus window, negative months, asset values, debts and missing accounts refused, deleted account, edit/finish/reopen/delete, source switch) passed on the lane-3 test DB with 0 skipped.
- Real browser (Playwright Chromium, API 3193, Vite 5293, seeded entries and a ₩2,500,000 savings account): at 390x844 two goals showed ₩1,800,000 saved (30%) with "Save ₩1,400,000 a month for 3 months" and ₩2,500,000 saved (50%), no horizontal scroll, every button at least 32 px tall; at 1440x900 "Finish" moved Travel fund below the open goal with a Finished badge and the status "Travel fund finished".

## Limits and follow-up

- No dashboard card yet; the page is the only place goals show.
- Only the monthly surplus and a single asset account are sources, as the issue asks. Several accounts per goal are not supported.
