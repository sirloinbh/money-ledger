# #47 Current price update and valuation and profit and loss calculation

- Issue: https://github.com/sirloinbh/money-ledger/issues/47 (parent #91)
- Branch: `feat/47-asset-valuation`

## Purpose

Show each asset's current valuation, valuation profit and loss, and rate of return. Prices and exchange rates use the values the shared price module of #51 has already fetched. For assets with no price, you enter the current price directly.

## Decision (confirmed by the user on 2026-11-10, recorded in an issue comment)

1. **Ticker link:** optionally link a ticker to a stock asset (ticker search in the asset form). Once linked, the currency is fixed to the ticker's currency. We do not match automatically by name or code.
2. **Direct entry:** for stock and other (crypto and so on) assets that are not linked, you enter the current price per unit and its base date directly. The valuation is quantity × current price. If a fetched close exists, the fetched close takes priority.
3. **Profit and loss:** valuation profit and loss is the KRW valuation − the KRW cost. The cost includes buy fees (#46). The rate of return is valuation profit and loss ÷ KRW cost. For an asset with no trade records, "원가 없음" ("No cost") is shown instead of profit and loss.
4. **Exchange rate:** US assets are converted to KRW at the latest stored basic rate.
   - If the base date is more than 5 days old, "환율 지연" ("Rate delayed") is shown.
   - If there is no exchange rate, that asset is left out of the total and we announce it.
   - The exchange rate field of the dollar trade form is prefilled with the latest basic rate.
5. **Daily fetch:** held assets linked to US tickers are added to `trackedUsSecurities`.
   - If there is no close when linking, it is fetched once on the spot.
   - A ticker whose trading has halted is valued at the last close and "거래 중단" ("Trading halted") is shown with it.

## Changes

- `database/migrations/016_asset_valuation.sql` (safe to run again)
  - Adds three columns to `portfolio_assets`.
    - `security_id`: the linked ticker.
    - `manual_price numeric(20,4)`: the current price per unit entered directly.
    - `manual_price_on date`: the base date of that current price.
  - A composite foreign key `(security_id, currency)` makes the asset currency equal to the ticker currency.
  - `portfolio_assets_valuation_check` blocks four things.
    - Linking a ticker to a non-stock asset
    - A manually entered current price on a linked asset
    - A row with only one of the current price and the base date, a current price of 0 or less, and decimals in a KRW current price
    - A valuation (`value_krw`, `value_foreign`) on a linked asset
- `backend/src/assets.ts`
  - The asset list, add, and update responses are valued with one SQL (`assetQuery`). Everything is computed in SQL `numeric` and rounded once at the end.
  - The valuation is decided in this order.
    1. Depreciable and prepaid assets: the computed value (#63, #64).
    2. If there is a quantity and a unit price, quantity × unit price.
       - A linked ticker uses the latest close up to the base date as the unit price.
       - An unlinked asset uses the manually entered current price.
       - If a linked ticker has no close, we do not mix in a manual current price or a valuation, and leave it as "시세 없음" ("No price"). A linked asset does not accept a valuation (the DB CHECK blocks it too).
    3. 0 if an asset whose quantity is set by trades has been sold off.
    4. Otherwise the manually entered valuation.
  - A dollar asset is converted at the latest USD basic rate up to the base date. `round(quantity × unit price × exchange rate)` is rounded only once.
  - What we added to the response for each asset:
    - `security`: the linked ticker. Market, code, name, and whether it trades.
    - `manualPrice`: the manually entered current price and its base date.
    - `price`: the unit price actually used and its source (`close` or `manual`), the base date, and whether it is delayed.
    - `fx`: the exchange rate used, its base date, and whether it is delayed.
    - `currentValueForeign`: the dollar valuation.
    - `valueIssue`: the reason there is no KRW valuation. One of `no_price`, `no_fx`, and `too_large`.
    - `costKrw`, `profitKrw`, `returnPercent`: only for assets with trades. The cost is the last cost of `portfolio_trade_positions` (#46), and the rate of return is a % to 2 decimal places.
  - The standard for "delayed" is the same as docs/price-source.md. The base date of the close or exchange rate is more than 5 days old.
  - A valuation over 1,000 trillion (won or dollars) is left out of the total as `too_large`. The list does not break with a 500 error.
  - The totals are added with the same valuation formula. The list and the totals are read from one snapshot (`REPEATABLE READ, READ ONLY`). `uncounted` is the number of assets with no price, exchange rate, or valuation, or that are too large.
  - We added `securityId` and `manualPrice { price, pricedOn }` to the request body. Both can be omitted.
  - A Korean 400 is returned in these cases.
    - Linking a ticker to a non-stock asset
    - Linking a nonexistent ticker
    - The ticker and the asset have different currencies
    - Entering a current price on a linked asset
    - A KRW current price with decimals
    - Entering a current price without a quantity
    - Entering a current price on another kind such as real estate
    - Entering a valuation together with a link
    - Linking a ticker without a quantity
  - If you link a US ticker and there is no stored close, it is fetched once after saving. It uses the same Tiingo hourly limit as the detail screen. Even if it fails, the asset is saved and shown as "시세 없음", and the failure is recorded as `price_fetch_now`.
  - `assetsRouter` now receives `today`, `now`, `prices`, and `log` (`app.ts`).
- `backend/src/prices/store.ts`
  - `trackedUsSecurities` also returns the US tickers linked by assets with a quantity, in addition to those opened in the last 30 days.
- `frontend/src/security-picker.tsx` (new file)
  - The "종목 연결(선택)" ("Link a ticker (optional)") in the asset form. Pressing Enter in the search field searches without saving the asset. The results show the close and its base date.
  - After linking, focus goes to "연결 해제" ("Unlink"), and after unlinking it returns to the search field.
  - An asset with trades cannot change currency, so it shows only tickers of the same currency.
- `frontend/src/assets.tsx`
  - Added the ticker link to the stock form. Once linked, the currency choice is fixed to the ticker's currency and the current price field is hidden.
  - The unlinked stock and other forms have "현재가(1개당, 선택)" ("Current price (per unit, optional)") and "현재가 기준일(비우면 오늘)" ("Current price base date (today if empty)").
  - Each list row shows the basis of the valuation, one per line.
    - "71,500원 · 11월 5일 종가 기준" (over 5 days: "시세 지연 · …")
    - "95,000,000원 · 직접 입력 · 11월 9일"
    - "거래 중단"
    - "환율 1,400.5원 · 11월 3일 기준" (over 5 days: "환율 지연 · …")
    - "환율 없음 · 합계에서 뺐습니다"
    - "아직 받은 종가가 없어 합계에서 뺐습니다"
    - "평가 손익 +15,000원 (+2.14%)"
    - "원가 없음 · 거래를 기록하면 손익을 보여 줍니다"
  - A dollar asset shows the KRW valuation and the dollar valuation together.
  - We changed the guidance under the total to "시세·환율이 없거나 평가금액이 없는 N개는 합계에서 빠졌습니다" ("N assets with no price or exchange rate or no valuation are left out of the total").
- `frontend/src/asset-trades.tsx`
  - The exchange rate field of a new dollar trade is prefilled with the asset's latest basic rate.
  - We attach "M월 D일 매매기준율을 미리 채웠습니다. 거래한 날 환율로 고칠 수 있습니다" ("The basic rate of M/D was prefilled. You can change it to the rate on the trade day") as the field description (`aria-describedby`).
  - A value the user edited is not overwritten even when the list is reloaded.
- `frontend/src/quote-format.ts`: `marketNames` and `securityText` are shared by the mock investing search (`security-search.tsx`) and the asset screen.
- `docs/price-source.md`: corrected the implementation location of tracked tickers and manual entry.

## Verification

- Test DB: we applied migrations 001 to 016 to the dedicated container `money-ledger-test-agent1` (`postgres:17-alpine`, `127.0.0.1:15491`). We ran 016 twice in each test to confirm it is safe to run again.
- `backend/test/valuation.integration.test.ts` (13 DB integration tests)
  - A linked ticker is valued at the latest close. For an earlier base date it uses the close of that time, and after 6 days it is delayed.
  - Dollar holding + trades
    - 2 × 110.25 × 1,400.5 = 308,810 won.
    - The cost is 261,000 won (including fees) and the profit and loss is 47,810 won (18.32%).
    - If all is sold, it is 0 won.
  - With no exchange rate it is left out of the total and only the dollar value remains. An old exchange rate is used but marked delayed.
  - Manually entered current price: a KRW crypto and a dollar unlisted stock (4 decimal places).
  - A linked ticker with no close is "no price".
  - A halted ticker is valued at the last close.
  - Fetching on the spot when linking
    - It calls the fake Tiingo once. Saving again does not call it.
    - A linked holding goes into `trackedUsSecurities`, and drops out if it has no quantity.
    - Even if the fetch fails, the asset is saved and a record is left.
  - 9 kinds of Korean 400, and a too-large value is handled as `too_large`.
  - DB foreign key and CHECKs.
- We changed the existing DB integration tests to apply 016.
  - The price and mock investing tests that delete `securities` also delete and recreate the asset table, because assets reference tickers.
  - We added the new fields to the asset response shape test.
- `frontend/src/valuation.test.tsx` (9)
  - All the valuation basis texts: based on the close, price delayed, manual entry, trading halted, exchange rate, rate delayed, no rate, no price, the sign and % of profit and loss, no cost, and the total guidance.
  - Ticker link: search with Enter without saving. Once linked, the currency is fixed and `securityId` goes into the request.
  - Unlinking, filling the current price when editing, and sending today when the base date is empty.
  - 3 things rejected before sending.
  - Prefilling the dollar trade exchange rate and its description text.
- We added the new fields to the fake server and request bodies of the existing screen tests.
- `TEST_DATABASE_URL=<dedicated test DB> npm run check` passed (exit code 0)
  - Backend 266 passed, 0 skipped
  - Frontend 222 of 224 passed, 2 skipped (existing)
  - Skill check, build succeeded
- Browser check (2026-11-10)
  - Environment: API (3191, test DB, `PRICE_SOURCE=fake`), Vite (5291), headless Chrome (viewport set through CDP). We viewed `/portfolio` at 390×844 and 1440×900.
  - When the server started, the daily fetch ran once and stored fake KRX closes and exchange rates.
  - Assets we put in
    - Stocks: search "삼성" ("Samsung") → linked Samsung Electronics, quantity 10. Search "aapl" → linked AAPL, quantity 2. When linking, the close was fetched right away from the fake Tiingo.
    - Other: Bitcoin, quantity 0.05, current price 95,000,000 won (base date empty → today).
    - Cash: a dollar deposit of 100.5 dollars.
  - The exchange rate field of the AAPL trade panel was prefilled with "1385" and "11월 10일 매매기준율을 미리 채웠습니다…". We recorded a buy of 2 shares × 200 dollars with a fee of 1,000 won.
  - Results on the screen
    - Samsung Electronics: 709,000 won, "70,900원 · 11월 9일 종가 기준", "원가 없음 · …"
    - Apple: 643,333 won (2 × 232.25 × 1,385 = 643,332.5), "464.5달러", "232.25달러 · 11월 9일 종가 기준", "환율 1,385원 · 11월 10일 기준", "평가 손익 +88,333원 (+15.92%)" (cost 555,000 won)
    - Bitcoin: 4,750,000 won, "95,000,000원 · 직접 입력 · 11월 10일"
    - Dollar deposit: 139,193 won (100.5 × 1,385 = 139,192.5), "환율 1,385원 · 11월 10일 기준"
    - The asset total is 6,241,526 won. No assets are left out, so there is no guidance.
  - There is no horizontal overflow at either size (scrollWidth = clientWidth: 390, 1425).
  - The texts for price delayed, rate delayed, no rate, and trading halted were checked only by screen tests and DB integration tests.
- **We did not verify with real API keys.** The keys (#85) do not exist yet, so the automated tests and the browser check all used the fake source (`PRICE_SOURCE=fake`).

## Limits and follow-up

- When we get the keys (#85), we recheck with real closes and exchange rates that the valuation is right.
- The fetched close is the unadjusted close. Corporate actions such as stock splits are not handled (docs/price-source.md).
- For a halted ticker the fetched close always takes priority, so it cannot be replaced by a manual entry. If you unlink it, you can enter manually.
- Mock investing holdings (#53) are not yet in `trackedUsSecurities`.
- `?asOf=` picks that day's close, exchange rate, manual current price, and the depreciation and prepayment value. The quantity and trade cost are current values. The quantity on a past date is handled in the net worth trend (#49).

## Review record

### Round 1: no defect blocking the merge, 1 point to fix and 3 minor points all addressed

- (To fix) For an asset linked to a ticker that has no close yet, it should be "시세 없음", but a manually entered valuation went into the total instead.
  - If you link a US ticker to a #45 stock that has a KRW valuation, that number would be read as dollars and a large amount could go into the total.
  - What we fixed:
    - The valuation formula computes a linked asset only as quantity × close.
    - The API does not accept a link and a valuation together (Korean 400). Linking without a quantity is also 400.
    - The CHECK of 016 also blocks both together.
    - On the screen, when you link a ticker, the valuation field is hidden and the value is not sent.
- A manually entered current price dated after `asOf` is not used on that base date. We wrote in a code comment and in "Limits" above that the quantity and cost are current values.
- Even if the on-the-spot fetch when linking throws an exception, we respond with the saved asset (preventing a 500 and a duplicate save). The exception is recorded as `price_fetch_now`/`error`.
- If you edit a prefilled exchange rate, the "prefilled" guidance disappears.
- We added tests.
  - DB integration: linking an asset that had a valuation gives 400 and no price, linking without a quantity is 400, a manual current price after the base date, an exception in the on-the-spot fetch, and the CHECK that blocks a valuation on a linked asset.
  - Screen: when linked, the valuation field is hidden, and editing the exchange rate removes the guidance.
- The asset integration test starts by deleting the exchange rate left by an earlier run, because after a local browser check the dollar asset was converted and the test failed.
- After the fixes, `TEST_DATABASE_URL=<dedicated test DB> npm run check` passed (backend 266 passed and 0 skipped, frontend 222 passed and 2 skipped (existing), build succeeded).

### Round 2: 4 first-round fixes confirmed, no blocking defect, 2 doc points addressed

- What the reviewer confirmed:
  - There is no path for a manually entered value to enter a linked asset. A linked asset with trades, editing a linked asset, and changing the kind while a ticker is chosen are also fine.
  - 016 is safe to run again, and existing rows cannot violate the new CHECK.
  - There is no regression elsewhere.
- Doc fixes: we added "entering a valuation together with a link" and "linking a ticker without a quantity" to the Korean 400 list, and added "a valuation on a linked asset" to the CHECK list.
- By the standard, we do not run a third review, and we merge after seeing the CI result of the final head.
