# Dividends, interest, realized gains and an overseas tax estimate (#295)

Part of epic #287 (investment journal and income tracking). Issue: <https://github.com/sirloinbh/money-ledger/issues/295>.

## Purpose

Holdings showed value and trades but not the income they produce or the tax that realized overseas gains will bring. The Asset portfolio page now has a "Dividends, interest and gains" section.

## Decision

Cost basis of a realized gain: **moving average** (user decision, 2026-11-26, recorded as a comment on #295). It is the method asset trades already use (#46, `portfolio_trade_positions`), so there is no second calculation. The tax rules and their sources are in [investment-tax.md](../investment-tax.md).

## Changes

| Area     | Change                                                                                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database | `054_portfolio_income.sql`: table `portfolio_income` (asset, dividend or interest, date, currency, foreign amount and rate for USD, `amount_krw`, tax withheld, note). The number is rechecked at the final sync with main.             |
| Backend  | `GET /api/portfolio/income?year=` (income, realized gains per sale, the tax estimate), `POST /api/portfolio/income`, `DELETE /api/portfolio/income/:id`. The table is added to the backup list (#298) so a backup and restore carry it. |
| Frontend | `investment-income.tsx`: year picker, tax estimate, realized gains list, income list with an add form and delete. Shown under the net worth history on the Asset portfolio page.                                                        |
| OpenAPI  | The three routes and `PortfolioIncomeBody`.                                                                                                                                                                                             |

## Behavior

- A won holding takes `amountKrw`. A dollar holding takes `amountForeign` and the day's `fxRate`; `amount_krw = round(amountForeign × fxRate)` is computed once in SQL `numeric` and stored. The amount is before tax; tax already withheld is entered separately and cannot exceed it.
- Realized gain per year is the sum of `realized_krw` of the year's sales (by trade date). A USD asset counts as overseas, a KRW asset as domestic.
- Estimate: `max(overseas gain − 2,500,000, 0) × 22%`, rounded in SQL. A net loss or a gain under the deduction shows ₩0. Losses are not carried to other years. The screen labels it an estimate.
- Dividends and interest are totalled for the year with a notice above ₩20,000,000. The comprehensive income tax is not computed.
- Mock accounts and assets without trades have no cost basis and are left out.

## Verification

- `backend/test/portfolio-income.integration.test.ts` on the lane test DB (PostgreSQL 17, port 15492): 5 tests, 0 skipped. Gain above the deduction with a domestic sale left out (+₩3,500,000 → taxable ₩1,000,000 → ₩220,000); gain under the deduction, gain offset by a loss, and separate years; won and dollar receipts with one rounding (12.3456 × 1385.25 = ₩17,102); the ₩20,000,000 line; refusals (missing amount, rate on a won holding, withheld above amount, future date, fraction of a won, unknown holding); delete once; income removed with its holding. `openapi.test.ts` and `backup.integration.test.ts` pass with the new route and table.
- `frontend/src/investment-income.test.tsx` (6 tests) and the updated `app.test.tsx`.
- Browser (Playwright, lane-2 ports 3192/5292, seeded DB): at 390x844 and 1440x900 the section shows the estimate, gains and income, no horizontal overflow from the section, buttons at least 32 px tall, the form fits the viewport (293 px wide at 390). Saving a USD dividend through the form showed "Income recorded" and ₩14,000 in the list, and the dividend total updated to ₩31,102.
- `npm run check`: see the PR.

## Limits

- A broker's overseas gains statement may use another cost method, so its number can differ from this estimate.
- Records cannot be edited, only deleted and added again.
