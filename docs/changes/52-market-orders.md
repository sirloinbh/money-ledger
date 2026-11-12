# #52 Mock investing market buy and sell

- Issue: https://github.com/sirloinbh/money-ledger/issues/52
- Branch: `feat/52-market-orders`

## Purpose

In a mock investing account, fill virtual buys and sells at the current price, and change the cash and the quantity held. The holdings screen and returns (#53) and the trade history (#54) are out of scope.

## Decision (confirmed by the user on 2026-11-08, recorded in an issue comment)

1. We do not keep dollar cash separately and use only one KRW cash balance (`cash_krw`). The fill amount of US stocks is `amount_krw = round(quantity × fill price × fx_rate)`, computed in SQL `numeric`. `fx_rate` is the latest basic rate stored at order time.
2. The fee rate is a setting and the default is 0. Tax is not included.
3. Regardless of market hours, fill right away at the latest stored close. The confirmation screen and the fill record show "M월 D일 종가로 체결" ("Filled at the close of M/D").
4. Both Korean and US accept only whole numbers of shares.
5. An inactive ticker (#97) rejects buys and allows sells.

## Changes

- `database/migrations/015_mock_orders.sql`: safe to run again.
  - `mock_accounts.fee_rate`: the fee rate per account, 0 or more and less than 1%, default 0. There is no screen to change it yet, and it is changed with SQL.
  - `mock_holdings`: the quantity held (integer) and the remaining purchase cost (including fees, average cost method) per account and ticker.
  - `mock_orders`: one order is one fill. A market order fills all at once, so a separate fill table would store the same values twice. So one row keeps the following values together.
    - The order key, the fill price, and the close base date
    - For a US stock, the exchange rate and the exchange rate base date
    - The KRW fill amount, the fee, and the cash after the order
  - CHECKs
    - An integer quantity
    - The pairing of currency and exchange rate (`(currency = 'KRW') = (fx_rate IS NULL)`)
    - A KRW fill price is an integer
    - The same currency as the ticker (composite foreign key)
- `backend/src/mock-orders.ts`
  - `GET /api/mock/accounts/:id/orders/preview`: for the confirmation screen. It returns the fill price, base date, and whether it is delayed, the exchange rate, the fill amount and fee, the cash after the order, the quantity held, and the reason the order cannot be placed. It stores nothing.
  - `POST /api/mock/accounts/:id/orders`: handles it in one transaction in this order.
    1. Lock the account row.
    2. Check the same order key.
    3. Compute the amount from the server price.
    4. Check the balance and the quantity held.
    5. Change the cash and holdings and record the order.
  - Sending again with the same key returns the first order as 200. The same key with different content is 409.
  - The fill price does not take the client's value. A price in the body is ignored.
  - Rejections (409, in Korean)
    - Not enough cash, not enough quantity held, the price changed after confirmation
    - Buying a halted ticker
    - No close, no exchange rate for a US stock
    - A reset account
  - A sell reduces the remaining purchase cost by the proportion sold: `round(cost × (held − sold) / held)`. If all is sold, it deletes the holding row.
- `backend/src/app.ts`: registered the order router before the account router.
- `frontend/src/mock-order.tsx`: "모의 주문" ("Mock order") in the ticker detail (choose buy or sell, quantity, and order confirmation).
  - Pressing order confirmation gets the account and the preview from the server. If it cannot be ordered, it shows the reason.
  - The confirmation dialog shows "M월 D일 종가 …으로 체결합니다" ("Fills at the close of M/D …"), the exchange rate (US), the fill amount and fee, and the cash after the order. The screen does not compute amounts itself.
  - There is one order key per order. Even if the connection drops and it is sent again, it is the same key, so it is not filled twice. After a rejection or a fill, a new key is used.
  - When filled, it shows "…주를 M월 D일 종가로 매수했습니다. 현금 …원" ("Bought … shares at the close of M/D. Cash …") and reloads the cash on the account card.
- `frontend/src/mock-account.tsx`, `mock-trading.tsx`, `security-search.tsx`: we added a `refreshKey` that reloads the account card after an order, and attach the order form to the detail only on the mock investing screen.
- `frontend/src/quote-format.ts`: added `formatPrice` (price display by currency).
- `docs/price-source.md`: recorded the dollar cash decision.

## Verification

- Test DB: the dedicated container `money-ledger-test-agent3`. We ran 015 twice to confirm it is safe to run again.
- `backend/test/mock-orders.integration.test.ts` (9 DB integration tests)
  - Buy fill
    - A price sent by the client is ignored.
    - The cash and holding change.
    - Even if the close changes later, the record stays the same.
  - Sending the same key twice at once → filled only once, the same key with different content → 409
  - Even if two orders come in at once, the cash is not exceeded
  - US buy
    - Exchange rate conversion: `round(3 × 231.5 × 1384.5)`
    - Fee rate: 0.5 won rounds away from zero
  - Sell: the average cost decreases `round(300,003 × 2/3)`, selling all deletes the row, and not enough quantity is rejected
  - 409 for each rejection reason with no change, selling a halted ticker is allowed, a reset account, and a nonexistent account and ticker
  - Preview: amount, reason, and delay, with nothing stored
  - DB CHECKs
- `backend/test/mock-orders.test.ts` (10): validation of the quantity (decimal, 0, number type, over 1 million), the order kind, the ticker, the order key, the body, the account ID, and the preview query. All are Korean 400 before the DB.
- `frontend/src/mock-order.test.tsx` (4)
  - The confirmation dialog text, a single fill, and the cash notice
  - US sell: exchange rate and delay display
  - A bad quantity, no account, and a rejected preview
  - Retrying with the same key after the connection drops, and a new key after a rejection
- `frontend/src/mock-account.test.tsx`: when `refreshKey` changes, the cash is reloaded.
- A defect found during implementation: when selling the whole quantity held, we tried to change it to `quantity = 0`, hit the CHECK, and got a 500. We fixed it to delete the row first when all is sold, and the integration test covers this case.
- Browser: we started the API (3193, test DB, fake source) and Vite (5293) and checked with headless Chrome at 390×844 and 1440×900. At each size we started with a new 10 million won account.
  - Buying 1,000 shares: "현금이 부족합니다" ("Not enough cash")
  - Buying 10 shares of Samsung Electronics: the dialog "11월 6일 종가 70,600원으로 체결합니다 · 체결 금액 706,000원 · 주문 후 현금 9,294,000원". After the fill, the notice text and the cash on the account card 9,294,000 won.
  - Buying 2 shares of Apple: the exchange rate 1,383 won note, 640,329 won
  - Selling 1 share of Apple: 320,164.5 → 320,165 won, cash 8,973,836 won
  - Selling 5 shares of Apple: "보유 수량이 부족합니다" ("Not enough quantity held")
  - No horizontal overflow. In the first check we found a particle error "70,600원로" and fixed it to "원으로".
- We also fixed other integration tests. The `mock-accounts` and `prices` integration tests delete `mock_accounts` and `securities` on reset, and the new `mock_orders` and `mock_holdings` point at both with foreign keys. So we made the two tests delete the order and holding tables first. Before the fix, 26 failed with `2BP01` (dependent objects exist).
- `TEST_DATABASE_URL=<test DB> npm run check` passed (exit code 0)
  - Backend 209 passed, 0 skipped (rerun after merging origin/main (#39): backend 220 passed and 0 skipped, frontend 202 passed and 2 skipped)
  - Frontend 182 passed, 2 skipped (existing)
  - 4 skill tests, build succeeded
- `npm run knip` passed

## Limits and follow-up

- There is no screen to change the fee rate. Change `mock_accounts.fee_rate` with SQL.
- The holdings screen and returns are #53, and the trade history and return trend are made in #54 by reading `mock_holdings` and `mock_orders`.
- Adding the mock investing holdings of US tickers to the daily fetch targets (`trackedUsSecurities`) is done in #53.
- We did not verify with real price keys (#85). The fill price and exchange rate were checked only with fake source values.

## Review record

### Round 1: no defect blocking the merge, 5 addressed, 1 handed to #53

- **We reject it if the price we confirmed and the fill price differ.** If, after the dialog was opened, the day's fetch overwrote the same day's close or a new exchange rate came in, it used to fill at the changed value as it was.
  - The screen also sends the close, base date, and exchange rate it received at confirmation (`expectedPrice`, `expectedPriceDate`, `expectedFxRate`).
  - The server does not use these values as the fill price and only compares them with the latest stored values. If they differ, it returns 409 "시세가 바뀌었습니다. 주문을 다시 확인하세요" ("The price changed. Check the order again").
  - The fill price is still the server price.
- A buy whose purchase cost for the same ticker would exceed the 1,000 trillion ceiling is rejected with "주문 금액이 너무 큽니다" ("The order amount is too large") (409) instead of a 500.
- If the same order key is sent to two accounts at once, the unique key violation (`23505`) is returned as "같은 주문 키로 다른 주문을 보냈습니다" ("A different order was sent with the same order key") (409).
- We changed the text for when a sell would exceed the cash ceiling to "계좌 현금 한도를 넘습니다" ("Exceeds the account cash limit").
- When the connection drops and the result is unknown, it shows "주문이 체결됐을 수 있으니 계좌 현금을 확인하세요" ("The order may have been filled, so check the account cash") and reloads the account card. Retrying with the same key is unchanged.
- Tests added
  - DB integration (11): rejection after the same day's close changed, rejection after a new exchange rate, filling after confirming again, and the same key sent to two accounts at once
  - Validation: no confirmed price
  - Screen: the confirmed price is included in the body sent, and reloading the account after the connection drops
- Handed to #53: showing the quantity held in the sell confirmation. We deal with it together with the holdings screen.
- Verification after the first-round fixes: `TEST_DATABASE_URL=<test DB> npm run check` passed (backend 223 passed and 0 skipped, frontend 202 passed and 2 skipped (existing)), `npm run knip` passed.

### Round 2: 5 first-round fixes confirmed, nothing to fix, 5 optional points addressed

- We made the test of the same key on two accounts deterministic. On another connection we put in an order with the same key without committing, call the API, and then commit. Then it always takes the unique key violation (23505) path. We also got rid of the approach of dropping the account index.
- We narrowed the 23505 handling to the case of the order key constraint (`mock_orders_request_key_key`).
- We added a test for rejecting the purchase cost ceiling (12 DB integration tests).
- The screen treats a 5xx (a proxy timeout and so on) like a dropped connection too. It keeps the order key, says it may have been filled, and reloads the account. We added screen tests (5).
- By the standard, we do not run a third review.
- Verification after the second-round fixes: `TEST_DATABASE_URL=<test DB> npm run check` passed (backend 224 passed and 0 skipped, frontend 203 passed and 2 skipped (existing)), `npm run knip` passed.
