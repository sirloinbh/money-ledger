# #48 Asset allocation (shares by kind and by ticker)

- Issue: https://github.com/sirloinbh/money-ledger/issues/48
- Branch: `feat/48-asset-allocation`

## Purpose

See directly on the asset portfolio screen how the asset total is split among which kinds and which assets.

## Decision (confirmed by the user on 2026-11-10, recorded in an issue comment)

1. Location: on the asset portfolio screen, put an "자산 배분" ("Asset allocation") card right under the total, split into tabs by kind and by ticker.
2. Target: only assets are included and debt is left out. Assets left out of the total (no price or exchange rate, no valuation, too large) are also left out of the shares and announced as "N개는 빠졌습니다" ("N are left out"). A 0 won asset shows only in the table as 0.0%.
3. By ticker: one asset is one line. The chart shows the top 8 in order of share and groups the rest as "그 밖의 N개" ("N others"). The table shows all.
4. Chart and shares: use the same horizontal bars as #40 (Recharts, `--chart-series-1`, chart lazy loading). The shares are computed to one decimal place in SQL `numeric`, and the total is made exactly 100.0% with the largest remainder method.

## Decided during implementation

- Share computation (`backend/src/allocation.ts`):
  - Each share is floored in units of 0.1% (the integer quotient of amount × 1000 divided by the total, exact regardless of size with `div`/`mod`), and the 0.1% steps missing to reach 100.0% are added one by one in order of the largest remainder. If the remainders are equal, the larger amount gets it, and then the asset registered first.
  - All computation is SQL `numeric` and the result is sent as a string ("33.4"). If the total amount is 0 won, everything is 0.0%.
  - The share of "그 밖의 N개" in the chart is the sum of the shares of those assets in the table, so the chart also adds up to 100.0% like the table. If there are exactly 9 assets, we do not group, and the 9th also shows by name (we do not create "그 밖의 1개").
  - The by-kind, by-asset, chart, and left-out count are read in one query. The valuation (`assetQuery`) runs only once.
- An asset linked to a ticker shows with the ticker name. If there is no ticker name, the ticker symbol, and if not linked, the asset name.
- The shares are read in the same transaction (the same moment) as the list and totals, so the total amount and the sum of the allocation amounts are always equal.
- Screen:
  - The tabs follow the WAI-ARIA tabs pattern (move with the left and right arrows, Home, and End, and only the selected tab is in the Tab key order).
  - The chart draws only lines with an amount above 0 won. The server also makes the by-ticker chart (top 8, "그 밖의 N개", the 9 boundary) only from assets above 0 won. If there are only 0 won assets, only "모든 자산이 0원이라 차트에 그릴 비중이 없습니다." ("All assets are 0 won, so there are no shares to draw in the chart.") and the table show. If there are no assets to compute shares for, only a guidance text shows, without tabs.
  - On the by-kind chart axis we use only the name before the parenthesis ("현금(예적금 포함)", "Cash (including savings)" → "현금"), because it wrapped to two lines on a narrow axis. The table shows the full name and the number of assets.
  - The amount and share cells of the table do not wrap (we fixed "원" wrapping to the next line at 390px in the browser check).
  - The chart file is loaded separately as in #40 (`React.lazy`), and if it cannot be loaded, it shows "차트를 불러오지 못했습니다. 아래 표에서 값을 확인하세요." ("Could not load the chart. Check the values in the table below.") and loads again next time. The bar length and axis are the share (%). So even a line too big to show exactly in won, such as a by-kind total (`amountKrw: null`, "-" in the table), is drawn as a bar.

## Changes

- `backend/src/allocation.ts` (new file): `readAllocation`: by kind, by asset, the chart (top 8 + the rest), and the number of left-out assets.
- `backend/src/assets.ts`: we added `allocation: { excluded, byType: [{ type, amountKrw, share, count }], byAsset: [{ id, name, type, amountKrw, share }], chart: [{ key, name, amountKrw, share, count }] }` to the `GET /api/portfolio/assets` response. The rest line of the chart is `key: 'rest'`, `name: null`.
- `frontend/src/asset-allocation.tsx` (new file): the "자산 배분" card (tabs, chart, table, and the left-out assets guidance).
- `frontend/src/asset-allocation-chart.tsx` (new file): the horizontal bar chart.
- `frontend/src/assets.tsx`: puts the card under the total. When assets change, it reloads together with the list.

## Tests

- `backend/test/allocation.integration.test.ts`: on a real DB
  - 100/100/100 → 33.4/33.3/33.3, 1/2/4 → 57.1/28.6/14.3 (in order of the largest remainder), and the sum is always 1000 (in 0.1% units).
  - Debt excluded, and the sum of allocation amounts = `totals.assetsKrw`.
  - 2 assets without a KRW value are `excluded`, and a 0 won asset is 0.0%.
  - If the remainders are equal, the larger amount gets the 0.1% (1/4/25 → 3.3/13.3/83.4).
  - Even if the total exceeds 10^17 won (102 assets), the sum is exactly 100.0%.
  - 11 assets → 9 chart lines, and the rest line is 3 assets and 6,000 won, with a share equal to the sum of the corresponding shares in the table. With 9 assets there is no "그 밖의" line. A 0 won asset drops out of the chart and its count (8 non-zero + 2 zero-won → 8 lines, and one more → the 9th by name).
  - A linked asset uses the ticker name (the ticker symbol for a US ticker with no name).
  - No assets, and only 0 won.
- `frontend/src/asset-allocation.test.tsx`: the by-kind chart and table and the left-out count, the 0.0% in the by-ticker table and its exclusion from the chart, "그 밖의 N개", the arrow and Home keys, the empty state, when only 0 won exists, the position under the total and above the new asset on the asset screen, a line that cannot be shown in won is also drawn as a bar, each tab has its own panel (the other panels are hidden), and the image name and height of the real chart.

## Verification

- Test DB: the dedicated container `money-ledger-test-agent1` (127.0.0.1:15491). We set `TEST_DATABASE_URL` directly each time.
- `TEST_DATABASE_URL=<test DB> npm run check`: passed. Backend 285 passed (0 skipped), frontend 247 of 249 passed and 2 skipped (existing), 4 skill tests, build succeeded.
  - The chart is split into a separate file (`asset-allocation-chart-*.js`, about 2 kB, with Recharts in the same shared file as #40). The build's "chunks larger than 500 kB" warning existed before.
- Browser: we connected the API (3191, `PRICE_SOURCE=fake`) to the test DB, started Vite (5291), and checked `/portfolio` with headless Chrome (CDP). We put in 13 assets (an apartment, a pension account with a long name, bank accounts, stocks and crypto with a manually entered current price, a dollar deposit, a 0 won account, and a stock with only a quantity) and 1 debt.
  - 390×844:
    - The order is total → asset allocation → new asset → held assets and debt. The description says "시세·환율이나 평가금액이 없거나 금액이 너무 커서 계산하지 못한 1개는 빠졌습니다" ("1 asset that could not be computed because it has no price, exchange rate, or valuation, or the amount is too large is left out") (the stock with only a quantity).
    - By kind: 4 bars (real estate 87.1%, stocks 7.2%, cash 4.5%, other 1.2%), and the table's total amount equals the asset total 597,010,500 won.
    - By ticker: 9 bars (top 8 + "그 밖의 4개" 0.4%), 12 table lines (including the empty account at 0 won 0.0%). The bar thickness is 23px and all are inside the card.
    - In dark mode the bar color is `#3987e5`. No horizontal overflow (scrollWidth 390).
  - 1440×900: the same values and no horizontal overflow. Hovering over a bar shows the tooltip "살고 있는 아파트 520,000,000원 · 87.1%" ("Apartment I live in 520,000,000 won · 87.1%").

## Round 1 automatic review (PR #112)

There was nothing that must be fixed, and we addressed all 7 optional points.

1. The share computation was a plain division. → We get the quotient and remainder exactly with `div`/`mod`. PostgreSQL keeps this division to about 20 digits, so to really be wrong the total would have to be about 10^20 won or more. So we could not make a test that fails with the old code. Instead, we added a test with a total over 10^17 won that checks that the sum is 100.0%.
2. If a by-kind total or the "그 밖의" total exceeded a safe integer, that bar dropped out of the chart, and the chart name also pointed at the wrong item. → We changed the bar length and axis to the share (%).
3. The valuation query ran 6 times for one GET. → We merged them into one query (1 valuation).
4. With 9 assets, "그 밖의 1개" appeared. → The 9th shows by name.
5. The left-out reason text lacked "the amount is too large". → We changed it to "시세·환율이나 평가금액이 없거나 금액이 너무 커서 계산하지 못한 N개는 빠졌습니다."
6. We added tests. They cover a tie with different amounts, the 9 boundary, the remainder when only 0 won assets exist, a large total, and a line that cannot be shown in won. With the old code the 9 boundary test failed.
7. Two tabs pointed at one panel. → Each tab has a panel, and the unselected panels are `hidden`.

Verification:

- `TEST_DATABASE_URL=<test DB> npm run check` passed. Backend 289 passed (0 skipped), frontend 249 of 251 passed and 2 skipped (existing), 4 skill tests, build succeeded.
- We checked the browser again at 390×844 and 1440×900 (light and dark). The number of bars and the share labels match, the axis is %, and there is no horizontal overflow.
- We checked again after merging origin/main (#41, #53). `npm run knip` passed (we removed the unused `chartAssets` export). `npm run check` passed too. Backend 308 passed (0 skipped), frontend 263 of 265 passed and 2 skipped (existing).

## Round 2 automatic review (PR #112)

We confirmed that the 7 first-round fixes went in as intended with no regression. We fixed what remained.

1. (Must fix) A 0 won asset entered the rank and count of the by-ticker chart. With 9 non-zero assets and 1 zero-won asset, the 9th asset was grouped with the 0 won asset into "그 밖의 2개". It also did not match decision 2 (0 won assets only in the table) or the doc's "the 9th by name". → The server makes the chart only from assets above 0 won. The remainder of a 0 won asset is 0, so it does not get a missing 0.1%, and the chart sum is also 100.0%. We changed the test that pinned this behavior to "a 0 won asset drops out of the chart and its count" (8 non-zero + 2 zero-won → 8 lines, and one more → the 9th by name).
2. (Optional) The left-out asset text in the browser check record was from before the first-round fix. → We matched it to the current text.

By the standard, we do not run a third review, and we merge after seeing the CI of the final head.

Verification: `npm run knip` passed. `TEST_DATABASE_URL=<test DB> npm run check` passed. Backend 308 passed (0 skipped), frontend 263 of 265 passed and 2 skipped (existing). The screen layout did not change, so we did not recheck the browser.
