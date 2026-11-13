# #63 Depreciating assets: beds, computers, and appliances

- Issue: https://github.com/sirloinbh/money-ledger/issues/63 (parent #92)
- Branch: `feat/63-depreciating-assets`

## Purpose

If things that lose value over time, such as a bed, a computer, or appliances, are put into assets at their purchase price, the net worth is inflated. When you enter the purchase price, purchase date, useful life, and salvage value, the server computes the current value on the base date and puts it into the asset total.

## Decision (confirmed by the user on 2026-11-02, recorded in an issue comment)

- Calculation method: the straight-line method. The same amount decreases every month.
- Default useful life: bed 10 years (120 months), computer 5 years (60 months), appliance 7 years (84 months). It can be edited directly.
- Default salvage value: 0 won.

## Changes

- `database/migrations/007_depreciable_assets.sql`: added the columns `purchase_price_krw bigint`, `purchased_on date`, `useful_life_months integer` (1 to 1200), and `salvage_value_krw bigint` to `portfolio_assets`. It is safe to run again.
  - `portfolio_assets_depreciation_check`: the four values are all present or all absent. If present, the kind is depreciable, the currency is KRW, the quantity and valuation are empty, and the salvage value is at most the purchase price.
  - We recreated `portfolio_assets_quantity_or_value_check` to also allow assets that have a purchase price.
  - The `portfolio_depreciated_value(...)` function: `purchase price − round((purchase price − salvage value) × months elapsed / useful life)`. The months elapsed are the number of full months counted with `age()`, clamped to 0 through the useful life. So before the purchase date it is the purchase price as it is, and when the useful life ends it stops at the salvage value. Rounding is `numeric` `round()` (0.5 away from zero), and we convert the month count to `integer` so that `double precision` is not mixed in. A month without the same day counts as a month on the 1st of the next month (bought on January 31 → 1 month on March 1).
- `backend/src/assets.ts`
  - The request accepts `depreciation: { purchasePriceKrw, purchasedOn, usefulLifeMonths, salvageValueKrw = 0 }`. A depreciable asset must have this value, and it cannot be put into other kinds. KRW only, with no quantity or valuation, and the salvage value at most the purchase price. Errors are Korean 400.
  - Each asset in the response gets `depreciation` and `currentValueKrw` (the KRW value that goes into the total: the computed value on the base date for a depreciable asset, and the KRW valuation entered for the others).
  - `GET /api/portfolio/assets?asOf=YYYY-MM-DD`: you can choose the base date. If absent, it is today in the service time zone (Asia/Seoul). `asOf` is put in the response. The total adds `currentValueKrw`.
  - We passed the `today` option of `createApp` to the asset router too, so tests can pin today.
- `backend/src/entries.ts`: we export the date validation schema `date` so assets use the same rules (years 1900 to 2100, rejecting nonexistent dates).
- `frontend/src/assets.tsx`: when you choose depreciable in the kind, fields for purchase price, purchase date, default useful life (bed 10 years, computer 5 years, appliance 7 years, or direct input), useful life (months), and salvage value (default 0) appear instead of currency, quantity, and valuation. The list shows "purchase price · purchase date · useful life" and the current value the server computed.

## Verification

- Backend unit tests added (`backend/test/assets.test.ts`): missing depreciation info, putting it in another kind, dollars, sending it together with a valuation, salvage value > purchase price, a negative or over-ceiling purchase price, a missing purchase date or nonexistent date, useful life 0, decimal, or over 1200, and a list base date that does not exist are Korean 400 before the DB.
- DB integration tests added (`backend/test/assets.integration.test.ts`):
  - 1,200,000 won, 60 months: before the purchase date, on the purchase date, and the day before one month it is 1,200,000 won, one month later 1,180,000 won, 30 months 600,000 won, 60 months 0 won, and 0 won after that.
  - Salvage value 100,000 won, 7 months: at 3 months 614,286 won, 1 month 871,429 won, and after the end 100,000 won (it does not go below the salvage value). 5 won, 2 months: after 1 month 2 won (2.5 rounded to 3, but with round-half-to-even it would be 3 won).
  - Bought on January 31: February 28 is still 0 months, March 1 and March 30 are 1 month, and March 31 is 2 months.
  - With today pinned to 2026-11-15, the default base date is today and the current value (1,000,000 won) goes into the asset total as a whole-won integer.
  - Changing a depreciable asset to a normal asset clears the depreciation info. The DB rejects a half schedule, a schedule on another kind, and a salvage value bigger than the purchase price (`23514`).
  - Applying `007` twice gives no error.
- `mock-accounts.integration.test.ts`: when recreating the asset table, it also applies `007`.
- Frontend tests added (`frontend/src/assets.test.tsx`): depreciation input and the request body, the default useful life list and direct editing, 4 kinds of input error blocked before the request and shown on the fields, and the schedule filled in when editing. 22 frontend asset tests passed.
- We applied `001` to `007` to the dedicated test DB (`money-ledger-test-agent1`, `127.0.0.1:15491`) and applied `007` once more.
- `TEST_DATABASE_URL=<dedicated test DB> npm run check` passed: backend 127 passed and 0 skipped, frontend 154 of 156 passed and 2 skipped (existing), 4 skill tests, build succeeded.
- Browser: we connected the API (3191) to a separate DB `money_browser` in the same container (migrations `001` to `007`) and opened Vite (5291) with headless Chrome (viewport set through CDP). With the screen form we added cash 5,000,000 won, a refrigerator (2,520,000 won, 2025-11-08, appliance 7 years, salvage 100,000 won), and a laptop (1,200,000 won, 2026-01-15, computer 5 years).
  - Current value as of today (2026-11-08): refrigerator 2,174,286 won (12 months), laptop 1,020,000 won (9 months). Asset total and net worth 8,194,286 won.
  - Mobile 390×844: `scrollWidth` 390 = `clientWidth`. Long names and the "purchase price · purchase date · useful life · salvage value" line wrap. The form fields are in the order name, kind, purchase price, purchase date, default useful life, useful life (months), salvage value, and memo.
  - PC 1440×900: `scrollWidth` 1425 = `clientWidth` (excluding the vertical scrollbar). The form lays out in two columns.

## Limits and follow-up

- A row that #45 made as a depreciable asset with only a valuation (no schedule) is still read as it is and goes into the total. When editing, the existing valuation is prefilled in the purchase price field, so you only need to enter the purchase date and useful life. It is not deployed yet.
- We did not build a screen to choose the base date. The screen is always based on today, and the net worth trend (#49) can use `asOf`.

## Review record

### Round 1: no defect blocking the merge, 1 point to fix and 5 minor comments all addressed

- (To fix) PostgreSQL resolves `age(date, date)` as `age(timestamptz, timestamptz)`, so the month count varied with the session TimeZone. In `America/Sao_Paulo`, 2018-11-04 → 2018-12-04 became `29 days 23 hours` because of daylight saving time and was counted as 0 months (1,200,000 won where it should be 1,180,000 won). We now pass the dates as `timestamp` so it does not depend on the time zone. We added an integration test of the same condition.
- We matched the explanation of the rule for a purchase on the 31st to the real behavior. A month without the same day counts as a month on the 1st of the next month. We added March 1 and March 30 boundary tests.
- When editing a depreciable row that #45 made with only a valuation, the existing valuation is prefilled in the purchase price field.
- We put `min=1900-01-01` and `max=2100-12-31` on the purchase date field, and the client also checks the same range as the server.
- Tests added: a PUT from a normal asset to a depreciable asset, a #45-shaped row from before applying `007` is still picked up in the list and total after applying it, the purchase date range, and filling the purchase price when editing an old row.
- We added a warning comment that in queries that use `currentValue` and `columns`, the first argument must be the base date.
- Verification: `TEST_DATABASE_URL=<dedicated test DB> npm run check` passed (backend 129 passed and 0 skipped, frontend 156 of 158 passed and 2 skipped (existing), 4 skill tests, build succeeded).

### Round 2: 6 first-round fixes confirmed, no blocking defect, 2 minor points addressed

- The reviewer took every day from 2000 to 2030 as the purchase date and computed in 8 time zones (São Paulo, Santiago, Tehran, Apia, Havana, Lord Howe, UTC, Seoul), and all results were the same. The 31st and leap day boundaries also matched the comment and doc explanation.
- We changed "the same message as the server" in a test comment to "the same range as the server" (the wording differs between purchase date and date).
- We reflected in "Limits and follow-up" above that the purchase price is prefilled when editing an old row.
- By the standard, we do not run a third review.
