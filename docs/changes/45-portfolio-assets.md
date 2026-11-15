# #45 Register, edit, and delete held assets

- Issue: https://github.com/sirloinbh/money-ledger/issues/45
- Branch: `feat/45-portfolio-assets`

## Purpose

Register stocks, real estate, cash, debt, depreciable assets, and other assets directly, and check the asset total, the debt total, and the net worth. Prices (#47) and trades and average unit price (#46) are out of scope.

## Decision (confirmed by the user on 2026-11-03, recorded in an issue comment)

- 6 kinds: stocks (including ETFs and funds), real estate, cash (including savings), debt, depreciable assets, and other (crypto, prepayments, and so on). (On 2026-11-08 in #64 we split prepayment into its own kind "선입금" ("Prepaid") and renamed other to "기타(코인 등)" ("Other (crypto and so on)"). The reason is in [64-prepaid-assets.md](64-prepaid-assets.md).)
- Debt is not added to the asset total. It is summed separately and subtracted only in the net worth.
- The format follows "Quantity, foreign currency, and exchange rate" (#35) in AGENTS.project.md. KRW amount bigint, dollar amount numeric(20,4), quantity numeric(20,8). In the API, quantities and dollar amounts are decimal strings.

## Changes

- `database/migrations/004_portfolio_assets.sql`: the `portfolio_assets` table. It is safe to run again. DB CHECKs enforce the pairing of currency and amount columns (no dollar amount on a KRW asset, and so on) and that at least one of quantity and valuation is present.
- `backend/src/assets.ts`: `GET/POST /api/portfolio/assets` and `PUT/DELETE /api/portfolio/assets/:id`. A validation failure is a Korean 400 and a nonexistent asset is 404. GET gives the list and the totals together. The totals add only KRW valuations, and report the number of assets with no KRW valuation (assets with only a quantity, and dollar assets) as `uncounted`. Conversion is done in #47.
- `frontend/src/assets.tsx`: the asset portfolio screen. Three totals, the register and edit form (debt has no quantity field and uses "남은 금액" ("Remaining amount")), a list by kind, and a delete confirmation dialog. When a delete finishes, focus goes to the list heading, and when canceled, to the delete button.
- `frontend/src/format.ts`: `formatDecimal` and `formatUsd` for displaying decimal strings.
- `frontend/src/categories.test.tsx`: changed the focus check after saving a rename to `vi.waitFor`. Focus is moved in an effect after re-rendering, so under the load of a full run, when the button was found first, a single-check assertion failed. The unexplained intermittent failure reported in the #38 review also looks like this (reproduced once in a full run during this work).

## Verification

- At the first commit, `TEST_DATABASE_URL=<test DB> npm run check` passed: backend 67 passed (0 skipped, including the asset DB integration tests), frontend 107 of 109 passed and 2 skipped (existing), 4 skill tests. We ran the whole frontend 2 more times and all passed.
- We applied migration `004` twice to the test DB to confirm it is safe to run again, and confirmed that CHECK constraint violations are rejected.
- With a real Chrome (CDP) we checked `/portfolio` at 390×844 and 1440×900: no horizontal overflow (scrollWidth = clientWidth), and long asset names, 8-decimal quantities, and dollar amounts wrap and display. The totals and the guidance text show normally.
- The local `npm run knip` does not run because the oxc-resolver native binding is missing (the same on main). We check it in CI.

## Limits and follow-up

- Dollar assets and assets with only a quantity are left out of the total. Conversion with prices and exchange rates is #47 (the price source is #36).
- Buy and sell trades and the average unit price are #46.

## Review record

### Round 1: no defect blocking the merge, 3 addressed

- The KRW valuation ceiling was `Number.MAX_SAFE_INTEGER`, so when the sum of two large assets exceeded the safe integer, `GET` gave a 500, and the screen could neither load nor delete the list. We lowered the ceiling per entry to 1,000 trillion won (client, zod, and DB CHECK). A total that still overflows is given as `null` instead of a 500, and the screen shows it as "너무 커서 표시할 수 없음" ("Too large to display").
- Commas were removed regardless of position, so "1,2,3" was saved as 123. Now commas are removed only when they are thousands separators.
- When the cancel button of the edit disappeared, focus fell to the page. We move it to the name field.
- Tests added: over 1,000 trillion (backend unit, DB, and client), a DB integration test (10,000 rows) that the list still comes back as 200 when the total overflows, a bad comma, focus after cancel and a dollar amount round trip, and a total that cannot be displayed.
- Not addressed: marking the field `aria-invalid` on a server 400 (the client checks the same rule first), and the behavior where the quantity silently drops when you switch to debt (debt has no quantity field).
- Verification: `TEST_DATABASE_URL=<test DB> npm run check` passed (backend 69 passed and 0 skipped, frontend 111 of 113 passed and 2 skipped (existing), 4 skill tests).

### Round 2: 3 first-round fixes confirmed, no blocking defect, no further fixes

- The ceiling (1,000 trillion won inclusive in the client, zod, and DB), the comma check, and the focus after cancel were all fixed correctly. The result the reviewer reran was also backend 69/69 and frontend 111 passed and 2 skipped.
- Note (not addressed): `004` is `CREATE TABLE IF NOT EXISTS`, so a local DB whose table was already created with a version before round 1 does not get the new ceiling CHECK. It is not deployed yet and the API (zod) blocks the same ceiling, so you can recreate the local DB.
- Note (not addressed): when the total is "too large to display", the guidance text has no separate explanation. We judged the display text to be enough.
- By the standard, we do not run a third review.
