# #186 #109 One won rule: a shared ₩1 trillion cap, one `won()` and one date rule

- Issues: [#186](https://github.com/sirloinbh/money-ledger/issues/186), [#109](https://github.com/sirloinbh/money-ledger/issues/109)
- Branch: `refactor/186-money-rules`
- Decision: the user chose option (A) everywhere (2026-11-22, through the coordinator): one app-wide won cap `MAX_WON` = ₩1 trillion (10^12) in `shared/contract.ts`, on the server and the screens. The DB CHECK constraints stay at 10^15 as a backstop, with no migration.

## Purpose

Won amounts had four different upper limits: `Number.MAX_SAFE_INTEGER` for entries, budgets and fixed costs (#109: a month of entries near that limit made the summary total unsafe), ₩1 quadrillion (10^15) for assets, trades and mock orders, `1e15` in the valuation SQL, and a fifth copy in each screen parser. `won()`, which turns a pg `bigint` string into a JSON number, had five copies. The YYYY-MM-DD date rule (#38) was written once on the server and again in the browser.

## Changes

- `shared/contract.ts` (copied to `backend/src/contract.ts` by `npm run contract:sync`):
  - `MAX_WON = 1_000_000_000_000` and `MAX_WON_TEXT = '₩1 trillion'` for messages. Thousands of capped amounts still total to a safe integer (about 9 × 10^15).
  - `serviceDate`: the Zod date rule (YYYY-MM-DD, a real date, years 1900–2100), moved from `ledger/entries.ts`. Every backend date field imports it from the contract, and the screen's `realDate()` now calls it.
- `backend/src/money.ts`: the one `won()`. The copies in `ledger/entries.ts`, `ledger/month.ts`, `mock/holdings.ts`, `portfolio/asset-valuation.ts` and `portfolio/trades.ts` are gone; the other routes import it. Review round 1: fixed costs, mock accounts, mock orders and net worth snapshots also used a plain `Number(...)` on bigint text; they now use `won()` as well.
- The server applies `MAX_WON` to:
  - entries, budgets, fixed costs (Zod `max` first with `abort`, so a huge number gets only the "₩1 trillion or less" message) and the CSV import;
  - asset values, purchase prices, salvage values, prepaid amounts and prepaid uses;
  - trade fees, taxes and the trade amount, and in `settle` the position: the held won cost and realized profit or loss may not pass ₩1 trillion either;
  - the valuation SQL: a value over ₩1 trillion (won or dollars) is `too_large` and left out of the totals;
  - mock orders: the order amount, the holding cost after a buy and the cash after a sell.
- The screens use `wonFromDigits()` in `frontend/src/format.ts` (0 to `MAX_WON`) in the entry, budget, fixed cost, asset, trade and prepaid use forms. Their messages name the cap.
- `docs/openapi.json` regenerated: the request schemas now say `maximum: 1000000000000`.
- Not changed: mock account starting cash keeps its own lower limit (₩10 billion); the security ID keeps `MAX_SAFE_INTEGER`; net worth and allocation totals may pass ₩1 trillion (they are sums, still checked for a safe integer).

## Tests

- Backend: an entry of exactly ₩1 trillion round-trips and one won more is refused with nothing saved; 30 entries at the cap give an exact monthly summary (#109); budget, asset value and purchase price over the cap are 400s; the CSV preview flags an amount over the cap; a buy that takes a position's cost past ₩1 trillion is refused and rolled back; a sell whose realized loss passes the cap is refused; a mock buy that takes a holding past the cap is refused; the contract test pins `MAX_WON` and the date rule. Tests that used 10^15 rows now use 10^12 rows (10,000 of them where a sum must pass 2^53).
- Frontend: `wonFromDigits`, `realDate`, `parseAmount` and the asset form at the new cap.

## User TODO

Existing rows above ₩1 trillion are still valid in the DB (the CHECKs allow 10^15) but can no longer be saved again from the screens. Run this read-only query on the server DB; it should return no rows. If it returns any, decide per row whether to fix the value. It returned 0 rows on the test DB.

```sql
SELECT 'ledger_entries.amount' AS place, id::text AS row_key, amount AS won FROM ledger_entries WHERE amount > 1000000000000
UNION ALL SELECT 'ledger_budgets.amount', category_id || ' ' || month, amount FROM ledger_budgets WHERE amount > 1000000000000
UNION ALL SELECT 'ledger_fixed_costs.amount', id::text, amount FROM ledger_fixed_costs WHERE amount > 1000000000000
UNION ALL SELECT 'portfolio_assets.value_krw', id::text, value_krw FROM portfolio_assets WHERE value_krw > 1000000000000
UNION ALL SELECT 'portfolio_assets.purchase_price_krw', id::text, purchase_price_krw FROM portfolio_assets WHERE purchase_price_krw > 1000000000000
UNION ALL SELECT 'portfolio_assets.salvage_value_krw', id::text, salvage_value_krw FROM portfolio_assets WHERE salvage_value_krw > 1000000000000
UNION ALL SELECT 'portfolio_assets.prepaid_amount_krw', id::text, prepaid_amount_krw FROM portfolio_assets WHERE prepaid_amount_krw > 1000000000000
UNION ALL SELECT 'portfolio_prepaid_usages.amount_krw', id::text, amount_krw FROM portfolio_prepaid_usages WHERE amount_krw > 1000000000000
UNION ALL SELECT 'portfolio_trades.amount_krw', id::text, amount_krw FROM portfolio_trades WHERE amount_krw > 1000000000000
UNION ALL SELECT 'portfolio_trades.fee_krw', id::text, fee_krw FROM portfolio_trades WHERE fee_krw > 1000000000000
UNION ALL SELECT 'portfolio_trades.tax_krw', id::text, tax_krw FROM portfolio_trades WHERE tax_krw > 1000000000000
UNION ALL SELECT 'mock_accounts.cash_krw', id::text, cash_krw FROM mock_accounts WHERE cash_krw > 1000000000000
UNION ALL SELECT 'mock_holdings.cost_krw', account_id || '/' || security_id, cost_krw FROM mock_holdings WHERE cost_krw > 1000000000000
UNION ALL SELECT 'mock_orders.amount_krw', id::text, amount_krw FROM mock_orders WHERE amount_krw > 1000000000000
ORDER BY 1, 2;
```

## Verification

- `npm run check` passes with `TEST_DATABASE_URL` set (backend 461 pass, 0 fail; frontend 521 pass, 3 skipped; skills and build pass); `npm run knip` passes.
- Browser check on the ledger screen (local API and Vite, a throwaway DB): at 390×844 an amount of 1,000,000,000,001 shows "Enter the amount as a whole number of won, from 0 to ₩1 trillion" under the form, wrapping on two lines with no overflow; at 1440×900 an amount of exactly 1,000,000,000,000 saves ("Expense ₩1,000,000,000,000 recorded"). Layouts are unchanged; only messages and limits changed.

## Review

- Round 1 (PR #269 comment): one finding, fixed in a follow-up commit: four routes still turned bigint text into JSON numbers with `Number(...)` instead of `won()`.

## Limits

- The DB CHECK constraints still allow up to 10^15. A tighter CHECK needs a migration and a decision on the rows above; not part of this change.
