# #46 Asset buy and sell records and average unit price

- Issue: https://github.com/sirloinbh/money-ledger/issues/46 (parent #91)
- Branch: `feat/46-asset-trades`

## Purpose

When buys and sells of investment assets are recorded, compute the quantity held, the average unit price, and the realized profit and loss. Prices and unrealized profit and loss are done in #47.

## Decision (confirmed by the user on 2026-11-08, recorded in an issue comment)

1. The average unit price is computed with the moving average method.
2. Fees and taxes are entered in won for each trade. A buy fee goes into the acquisition cost, and a sell fee and tax are subtracted from the realized profit and loss.
3. For dollar tickers, the average unit price is shown in dollars, and the realized profit and loss is computed in won (sell KRW amount − KRW average cost × quantity sold − sell costs). Exchange rate changes are part of the profit and loss. The trade exchange rate is entered directly and follows the `fx_rate` and `amount_krw` rules of AGENTS.project.md.
4. Trades are recorded only for stock and other (crypto and so on) assets. For an asset with trades, the quantity is set by the sum of trades and cannot be edited directly. For an asset with no trades, you enter the quantity directly as now.
5. A trade can be edited or deleted at any time. When saving, we recompute in date order and reject it if the quantity held becomes negative at any point.
6. Trades on the same date are computed in the order they were entered.

## Changes

- `database/migrations/013_asset_trades.sql` (safe to run again)
  - `portfolio_trades`: the asset (deleted together with it), buy or sell, trade date, quantity `numeric(20,8)`, currency, unit price `numeric(20,4)` (an integer for KRW), exchange rate `numeric(12,4)` (NULL for KRW, required for dollars), KRW trade amount `amount_krw bigint`, fee and tax `bigint`, and a memo.
  - `portfolio_assets.quantity_from_trades`: turned on once a trade exists. We added it to `portfolio_assets_quantity_or_value_check` so that the asset stays valid even when everything is sold and the quantity is NULL (if it was already widened as in #64, we do not recreate it). If you edit the asset after deleting all trades, it turns off and you enter the quantity directly again.
  - `portfolio_trade_positions(asset_id)`: the only place that computes the quantity held, the cost, and the realized profit and loss. It goes through trades by trade date, then by input order (id), computing everything in `numeric`.
    - Buy: quantity += q, KRW cost += amount + fee + tax, dollar cost += q × unit price (dollar assets only).
    - Sell: cost removed = round(KRW cost × q ÷ quantity held), realized profit and loss = amount − cost removed − fee − tax, and the dollar cost is reduced by the same ratio.
    - The KRW cost always stays a whole-won integer, so it becomes exactly 0 when everything is sold. It stops with `oversold` at the first trade that sells more than is held.
- `backend/src/trades.ts`: `GET/POST /api/portfolio/assets/:id/trades` and `PUT/DELETE /api/portfolio/assets/:id/trades/:tradeId`.
  - A write locks the asset row in one transaction, saves the trade, recomputes in date order, and if there is a sell that overflows, rejects it (rolls back) with `YYYY-MM-DD 매도 수량이 그때 보유 수량(N)보다 많습니다` ("On YYYY-MM-DD the sell quantity is more than the quantity held then (N)"). Otherwise it changes the asset quantity to the sum of trades.
  - The KRW trade amount is computed once when saving, in SQL, as `round(quantity × unit price × coalesce(exchange rate, 1))`.
  - An asset that is not stock or other, an exchange rate on a KRW asset, decimals in a KRW unit price, a missing exchange rate on a dollar trade, a date after today, and a trade amount over 1,000 trillion won are Korean 400s.
  - `GET` gives the trades (newest first, with the quantity held after each trade and the realized profit and loss of sells) and the current position (quantity held, average unit price, KRW cost, and total realized profit and loss). The average unit price is KRW cost ÷ quantity for a KRW asset (including buy fees) and dollar cost ÷ quantity for a dollar asset (excluding KRW fees), rounded to 4 decimal places.
- `backend/src/assets.ts`
  - Gives `hasTrades` for each asset.
  - Editing an asset with trades allows only the stock and other kinds and the same currency, and rejects a quantity that differs from the sum of trades with `거래 기록이 있는 자산의 수량은 거래로만 바뀝니다` ("The quantity of an asset with trade records changes only through trades"). The rule "a valuation is needed when there is no quantity" is applied only to assets without trades, so that the name and so on can still be edited even when all is sold and there is no quantity.
  - Attaches the `/:id/trades` router.
- `backend/src/korean.ts`: the choice of Korean particles (은/는, 을/를) is shared by asset and trade validation.
- `frontend/src/asset-trades.tsx`: a panel opened with the "거래 내역" ("Trade history") button (`aria-expanded`) on the row of a stock or other asset. A summary of the quantity held, average unit price, KRW cost, and realized profit and loss, inputs for buy or sell, trade date (up to today), quantity, unit price, exchange rate (dollars only), fee, tax, and memo, and the trade list with edit and delete (a confirmation dialog). Changing it also reloads the asset list.
- `frontend/src/assets.tsx`: when you edit an asset with trades, the quantity field becomes a read-only "수량(거래 합계)" ("Quantity (sum of trades)") with a guidance text.

## Verification

- Backend unit tests (`backend/test/trades.test.ts`): a missing buy or sell, a missing date, quantity 0, 9 decimal places, or a number type, unit price 0 or 5 decimal places, exchange rate 0, a negative fee, a decimal tax, a memo over 100 characters, a date after today, and a bad asset or trade ID are Korean 400 before the DB.
- DB integration tests (`backend/test/trades.integration.test.ts`)
  - Split buys and a partial sell (KRW): 10 shares × 1,000 won + fee 100 won, and 10 shares × 1,300 won + fee 130 won → average unit price 1,161.5 won. Selling 5 shares × 1,500 won (fee 75 won, tax 15 won) → cost removed round(5,807.5) = 5,808 won, realized profit and loss 1,602 won. The remaining 15 shares have a cost of 17,422 won and an average unit price of 1,161.4667 won. The asset quantity also changes to 15 shares.
  - Dollars: 2 shares × 100.5 dollars (rate 1,300 won, fee 1,000 won) + 1 share × 110 dollars (1,400 won) → average unit price 103.6667 dollars and a KRW cost of 416,300 won. Selling 1.5 shares × 120 dollars (1,350 won) → realized profit and loss 34,850 won.
  - A sell larger than the holding at that time, a sell dated before the buy, deleting or reducing a buy that a later sell depends on, and moving a sell before a buy are all 400 and not saved.
  - Trades on the same date go in input order: a sell on the same day entered before the buy is rejected.
  - When everything is sold, there is no quantity and the cost is 0, the name can be edited in that state, editing a trade reflects the amount and quantity, and after deleting all trades you can enter the quantity directly by editing the asset.
  - Changing the quantity, kind, or currency of an asset with trades is rejected, while writing the same quantity differently (`4.0`) and changing to other are allowed.
  - An exchange rate on a KRW asset, decimals in a KRW unit price, a missing exchange rate on a dollar trade, a cash asset, a date after today, and a trade amount over 1,000 trillion won are 400. A nonexistent asset is 404, and another asset's trade ID is 404.
  - If 4 sells of the whole holding are sent at the same time, only 1 succeeds.
  - DB CHECKs reject decimals in a KRW unit price, an exchange rate on a KRW trade, and a missing exchange rate on a dollar trade, and deleting the asset deletes its trades. Applying `013` twice gives no error.
- The existing asset, prepayment, and mock investing integration tests also apply `013` when they recreate tables. `hasTrades` was added to the response.
- Frontend tests (`frontend/src/asset-trades.test.tsx`): trade history only for stock and other, the position summary and trade lines, the buy request body, the exchange rate being required for dollar trades, the server's overflowing sell message, rejecting decimals in a KRW unit price and a future date, editing and deleting after confirmation and focus, and the read-only quantity of an asset with trades.
- `TEST_DATABASE_URL=<dedicated test DB money-ledger-test-agent1> npm run check` passed: backend 210 passed and 0 skipped, frontend 182 of 184 passed and 2 skipped (existing), 4 skill tests, build succeeded.
- Browser: we connected the API (3191) to a separate DB `money_browser` in the same container (migrations `001` to `013`) and opened Vite (5291) with headless Chrome (viewport set through CDP). With the screen form we made a dollar stock (quantity 1) and, in the trade history panel, recorded 2 buys (2 shares × 100.5 dollars, 1,300 won, fee 1,000 won, and 1 share × 110 dollars, 1,400 won) and 1 sell (1.5 shares × 120 dollars, 1,350 won).
  - Summary: holding 1.5, average unit price 103.6667 dollars, KRW cost 208,150 won, realized profit and loss +34,850 won. The quantity on the asset row also changed from 1 to 1.5.
  - Selling 5 shares was rejected with `2026-02-11 매도 수량이 그때 보유 수량(1.5)보다 많습니다`.
  - Mobile 390×844: `scrollWidth` 390 = `clientWidth`. Long names, trade lines, and input fields wrap in one column.
  - PC 1440×900: `scrollWidth` 1425 = `clientWidth` (excluding the vertical scrollbar). The 4 summary cells and the input fields lay out in four columns.

- After merging `origin/main` (#39 entry filters, #97, migration `012`), `npm run check` passed again: backend 224 passed and 0 skipped, frontend 204 of 206 passed and 2 skipped (existing), 4 skill tests, build succeeded.

## Limits and follow-up

- Unrealized profit and loss (current price) is #47. Prefilling the trade exchange rate from the price module's exchange rate is also in the scope of #47.
- The manual valuation of an asset with trades stays as it is (replaced with prices in #47).
- We moved the asset's "quantity or valuation required" check out of the schema, so when it is together with other input errors the earlier error is shown first, and editing a nonexistent asset gives 404 before this check.

## Review record

### Round 1: no defect blocking the merge, 3 points to fix and minor comments addressed

- (To fix) If you recorded or deleted all trades while an asset was open in the edit form, the form held the old `hasTrades` and quantity, so saving was blocked with a 400. When the list is reloaded, it replaces the open asset with the new values and syncs the quantity field too. Focus stays on the trade panel then (it moves to the name field only when the asset id changes).
- (To fix) For an asset with a manually entered quantity, the first trade changes the quantity to the sum of trades (decision 4). While there are no trades yet, the panel shows the guidance "이미 가진 수량은 매수로 먼저 넣으세요" ("Enter the quantity you already hold first as a buy"). On the server we fixed this behavior (the first sell rejected, the first buy overwriting) with tests.
- (To fix) The average unit price means different things: it includes buy fees for a KRW asset and excludes KRW fees for a dollar asset. A dollar fee has no dollar basis, so we kept decision 3, and changed the field name for dollar assets to "평균 단가(수수료 제외)" ("Average unit price (excluding fees)"). The KRW cost and the realized profit and loss include fees.
- The check for a trade amount over 1,000 trillion won now uses a SQL `numeric` comparison instead of a JS number.
- Recomputation is done only once, and if the quantity held in the middle of the history (1 trillion or more) or the KRW cost or realized profit and loss exceeds a safe integer, it gives a 400 `보유 수량이나 금액이 너무 큽니다` ("The quantity held or the amount is too large") instead of a 500.
- The trade list and the summary are read from one snapshot (REPEATABLE READ, read only).
- We put the unit price in the names of the edit and delete buttons of a trade line to tell apart trades with the same date and quantity.
- Tests added: overwriting the quantity on the first trade, a large quantity in the middle of the history, an asset edit and a trade record running at the same time, rerunning `007` and `010` after `013` with data present, edit form sync and focus, the guidance for a manually entered quantity, and the dollar average unit price name.
- Not addressed: moving focus to the field on a client validation error (the same way as the existing asset form, and it is read through the notice).
- Verification: `TEST_DATABASE_URL=<dedicated test DB> npm run check` passed (backend 228 passed and 0 skipped, frontend 206 of 208 passed and 2 skipped (existing), 4 skill tests, build succeeded).

### Round 2: 7 first-round fixes confirmed, no blocking defect, 1 point to fix and 1 minor comment addressed

- The reviewer confirmed the edit form sync (no repeated renders, focus kept), that `REPEATABLE READ, READ ONLY` works as the first statement of the transaction, and the overflow message and large value conditions of `settle`.
- (To fix) We checked only the total realized profit and loss, so even if the realized profit and loss of a single trade exceeded the safe integer, it was saved when the total was within range, and then the list gave a 500. We now also check each trade's `max(abs(realized_krw))`. We added an extreme input test in the 9,000 trillion won range.
- If an asset deleted in another tab was left open in this tab's edit form, when the list is reloaded we close the form and announce "이미 삭제되어 수정을 닫았습니다" ("Already deleted, so the edit was closed").
- Not addressed: deriving the form sync directly from the list instead of an effect (the reviewer also thought the current approach is reasonable).
- By the standard, we do not run a third review.
- Verification: `TEST_DATABASE_URL=<dedicated test DB> npm run check` passed (backend 229 passed and 0 skipped, frontend 207 of 209 passed and 2 skipped (existing), 4 skill tests, build succeeded).
