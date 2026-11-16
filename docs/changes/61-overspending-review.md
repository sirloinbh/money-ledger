# #61 Overspending review

The ledger page flags the expense categories whose spending this month reached or passed their budget, with the reason in words.

## Decision

The user decided this on 2026-11-16, and it is recorded on #61. Earlier decisions from 2026-11-02 still apply: a fixed amount per category per month, fixed costs included.

- The overspending line is the category's monthly budget from #42. There is no separate criteria amount, so nothing has to be kept in step.
- Spending equal to the budget already counts as overspending. Spending 1 won below it does not. Categories without a budget show "Not set".

## What changed

- `backend/src/budgets.ts`: each row of `GET /api/ledger/budgets?month=` has a `status`, computed in SQL:
  - `unset`: no budget
  - `within`: below the budget
  - `reached`: exactly the budget
  - `over`: above the budget

  `reached` and `over` are overspending. The other fields are unchanged.

- `frontend/src/budget-progress.tsx`
  - A new **Spending review** card above **Budget usage** lists each category at or over its budget, with a warning icon and the reason:
    - over: "spent ₩61,000 of a ₩50,000 budget, ₩11,000 more (122.0%)"
    - reached: "spent ₩50,000, all of the ₩50,000 budget (100.0%)"
  - With nothing flagged, the card says "No category has reached its budget in November 2026." With no budget set at all, it points to the budgets below. A note says that spending equal to the budget counts and that fixed costs are included.
  - In Budget usage, a row exactly at its budget now uses the warning style (red bar, icon, "Budget reached (100.0%)") instead of "₩0 left".
- Fixed costs: their monthly entries are ordinary expense entries in the item's category (#43), so they are counted without extra code. A test confirms it.

## Verification (2026-11-16)

- `backend/test/budgets.integration.test.ts` on the test DB, 20 passed with `budgets.test.ts`, none skipped:
  - Status for over, exactly at, below, and not set.
  - New: ₩49,999 of ₩50,000 is `within`, and 1 won more makes it `reached`.
  - New: a fixed cost added through the fixed-cost API and its monthly run brings its category to `reached`.
- `frontend/src/budget-progress.test.tsx`, 17 passed:
  - The review lists over and reached categories with their reasons and leaves out the others.
  - A row at exactly its budget is red with an icon.
  - The review has a message when nothing is flagged and one when nothing is set.
- Browser check: headless Edge over the DevTools protocol, with the API and Vite running against the test DB. The data was set up through the app's API: budgets of ₩50,000, ₩50,000, and ₩100,000, and spending of ₩50,000, ₩61,000, and ₩99,999.
  - The review listed the first two ("all of the ₩50,000 budget" and "₩11,000 more (122.0%)") and not the third.
  - The rows showed "Budget reached (100.0%)", "₩11,000 over (122.0%)", and "₩1 left (100.0%)".
  - At 390×844 and 1440×900 the page width was 390 and 1425, so there was no horizontal scroll.
- `npm run check` passed: frontend 348 passed / 2 skipped; backend 180 passed / 18 DB tests skipped (no test DB in that run). `npm run knip` passed.
