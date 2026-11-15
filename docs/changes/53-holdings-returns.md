# #53 Mock investing holdings and returns

- Issue: https://github.com/sirloinbh/money-ledger/issues/53
- Branch: `feat/53-holdings-returns`

## Purpose

Show the valuation and profit and loss of the tickers a mock investing account holds, and the total assets and return of the whole account. The trade history and the return trend chart are done in #54.

## Calculation rules

There is no new user decision. We follow the #52 decisions as they are (one KRW cash balance, the latest stored close and exchange rate).

- Valuation = `round(quantity held × latest stored close × latest basic rate)`. For Korean tickers the exchange rate is 1. It is the same formula as the order amount and is computed in SQL `numeric`.
- Ticker profit and loss = valuation − remaining purchase cost (`mock_holdings.cost_krw`, including fees, average cost). The ticker return divides this profit and loss by the purchase cost.
- Total assets = cash balance + the valuation of all held tickers.
- Account profit and loss = total assets − starting amount. Account return = account profit and loss ÷ starting amount. Realized profit and loss, valuation profit and loss, and fees are all included.
- The return is in %, rounded at the second decimal place (away from zero), and sent as a string.
- A halted ticker (#97) is valued at the last stored close and marked "거래 중단" ("Trading halted").
- If there is a held ticker with no close or exchange rate, we leave blank that ticker's valuation and the account's total assets and return ("-" instead of a wrong total). An order fills only when there is a close and exchange rate, so this does not normally happen.

## Changes

- `backend/src/mock-holdings.ts`: `GET /api/mock/accounts/:accountId/holdings`
  - `summary`: starting amount, cash, the sum of purchase costs, the sum of valuations, total assets, profit and loss, and return
  - `holdings`: the ticker (including whether it is active), quantity, close, base date, and whether it is delayed, the exchange rate and base date, purchase cost, valuation, profit and loss, and return. In order of largest valuation.
  - It reads the account and the holdings in one SQL statement, so even if an order commits in between, the cash, holdings, and total assets in this response are values from the same moment. The "cash balance" on the account card is loaded separately, so at the moment of an order from another tab it may differ briefly.
  - A nonexistent account is 404. If a KRW amount exceeds the JSON integer range, it ends with an error without rounding.
- `backend/src/prices/store.ts`: added to `trackedUsSecurities` the US tickers held by an open mock investing account. The close is fetched daily even if the detail has not been opened for 30 days.
- `frontend/src/mock-holdings.tsx`: "보유 종목과 수익률" ("Holdings and returns") inside the account card
  - Summary: total assets, valuation, account profit and loss (total assets − starting amount), and return (with +/− sign)
  - Ticker list: name and code, the halted marker, quantity, base close (with the delay marker) and exchange rate, valuation, purchase cost, and profit and loss (return)
  - Each ticker has an "주문" ("Order") button that opens the order form (#52) in place. A halted ticker (#97) does not show in search, so this is the way to sell the holding. When everything is sold and the line disappears, the holdings area shows "… 보유분을 모두 팔았습니다" ("Sold all of the … holding").
  - It reloads after an order (`refreshKey`) and after an account reset. The previous account's values do not show in the new account.
  - The screen does not compute amounts and shows only server values.
- `frontend/src/mock-order.tsx`: the sell confirmation dialog shows "보유 N주 중 M주를 팝니다" ("Sell M of N shares held") (an item handed over from the #52 first review). There can be two order forms on one screen (holdings and the ticker detail), so we make element ids with `useId`.
- `frontend/src/mock-account.tsx`, `mock-trading.tsx`: put the holdings area in the account card, and even an order from the holdings reloads the account card (`onOrdered`).
- `docs/price-source.md`: corrected the description of tracked tickers.

## Verification

- Test DB: the dedicated container `money-ledger-test-agent3` (15493)
- Added 1 DB integration test to `backend/test/mock-orders.integration.test.ts`
  - With no holdings, total assets = cash and return 0
  - After an order, when the close and exchange rate go up, it is valued at the latest values: Samsung Electronics 10 shares 800,000 won (+13.31%), Apple 2 shares `2 × 231.5 × 1,400` = 648,200 won (+1.12%)
  - Total assets = cash + the sum of valuations, and the return is based on the starting amount (+1.01%)
  - A loss is negative and rounded away from zero (−0.04955% → −0.05%)
  - A halted ticker is valued at the last close and `active: false`
  - When all is sold it drops out of the list, and a nonexistent account is 404
- `backend/test/prices.integration.test.ts`: AAPL held by an open account is fetched daily, and MSFT held only by a closed account is not.
- `frontend/src/mock-holdings.test.tsx` (4): summary and ticker display, halted, delay, and exchange rate, no holdings and 0%, reloading, the failure notice and hiding the previous account's values, and selling all from the holdings with the notice
- `frontend/src/mock-order.test.tsx`: the quantity held in the sell dialog
- `frontend/src/mock-account.test.tsx`: after an order, the cash and the total assets change together.
- Browser: we started the API (3193, test DB, fake source) and Vite (5293) and checked with headless Chrome at 390×844 and 1440×900. At each size we started with a new 10 million won account.
  - No holdings: total assets 10,000,000 won, return 0%, "보유 종목이 없습니다" ("No holdings")
  - After buying 10 shares of Samsung Electronics (709,000 won) and 2 shares of Apple (643,333 won) and selling 1 share of Apple, the dialog shows "보유 2주 중 1주를 팝니다".
  - After the sell, cash 8,969,333 won + valuation 1,030,666 won = total assets 9,999,999 won. Account profit and loss −1 won (a rounding difference on 1 share of Apple), return 0%
  - When Samsung Electronics is changed to inactive, it is valued at the last close 70,900 won with the "거래 중단" marker.
  - When we sell all 10 shares with the "주문" on the halted Samsung Electronics line, the dialog shows "보유 10주 중 10주를 팝니다", and after the fill the line disappears and "삼성전자 보유분을 모두 팔았습니다" shows. Cash 9,678,333 won + valuation 321,666 won = total assets 9,999,999 won.
  - The Apple line shows "11월 9일 종가 232.25달러 · 환율 1,385원(11월 10일)" ("close of 11/9 232.25 dollars · exchange rate 1,385 won (11/10)").
  - No horizontal overflow
- `TEST_DATABASE_URL=<dedicated test DB> npm run check` passed: backend 254 passed and 0 skipped, frontend 217 passed and 2 skipped (existing), 4 skill tests, build succeeded
- `npm run knip` passed

## Limits and follow-up

- If a KRW amount exceeds the JSON integer range (2^53), the whole holdings response is 500. It can happen only when a stored close is badly wrong because of a unit error, so we left it.
- If the profit and loss is small like −1 won, the return is rounded at the second decimal place and shows as 0%.
- We did not verify with real price keys (#85).

## Review record

### Round 1: no defect blocking the merge, 4 addressed

- If you reset the account while the order form of a held ticker was open, "… 보유분을 모두 팔았습니다" showed for a ticker the new account does not have. We fixed it so the holdings area is redrawn by account ID (`key={account.id}`), and added a screen test that the notice does not show after a reset (we confirmed it fails before the fix).
- When there are two order forms on one screen (holdings and ticker detail), the names were the same for a screen reader. We named the area and the form with the ticker name, like "삼성전자 모의 주문" ("Samsung Electronics mock order").
- We check with a DB integration test the case where totals are blanked when there is no price or exchange rate (deleting the USD exchange rate makes the Apple valuation and the total assets, profit and loss, and return `null`, the sum of purchase costs stays, and a ticker with no valuation goes last).
- We wrote above that the account card cash and the holdings area total assets are different requests, so they may differ briefly.
- Left as it is: that the whole response is a 500 when the valuation exceeds the integer range (see Limits above).

### Round 2: 4 first-round fixes confirmed solved, no defect blocking the merge, no code change

- Points left as minor
  - If the same ticker is opened in the holdings list and the ticker detail at the same time, the names of the two order forms are the same again. It is rare and told apart by position.
  - The area name ("삼성전자 모의 주문") differs from the visible heading ("모의 주문"). The name-match rule does not apply to areas.

## Merge of origin/main (after #47 PR #108)

- We kept both conditions in `trackedUsSecurities` with OR: the condition of #47 (assets with a quantity linked to a US ticker) and that of #53 (holdings of an open mock investing account).
- The reset of the price integration test applies the migrations of both sides (004, 007, 010, 013, 016, and 005, 015).
- The `valuation.integration.test.ts` of #47 deleted `mock_holdings` on reset and did not recreate it, so it failed once the daily fetch started reading this table. We fixed it to apply 005 and 015.
- `TEST_DATABASE_URL=<dedicated test DB> npm run check` passed: backend 280 passed and 0 skipped, frontend 244 passed and 2 skipped (existing), 4 skill tests, build succeeded. `npm run knip` passed.
