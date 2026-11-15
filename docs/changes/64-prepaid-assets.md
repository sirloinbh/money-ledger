# #64 Prepaid assets for hair salons and gyms

- Issue: https://github.com/sirloinbh/money-ledger/issues/64 (parent #92)
- Branch: `feat/64-prepaid-assets`

## Purpose

Money paid in advance to a hair salon or a gym has already gone out, but the value of the service not yet received remains. We show the remaining value, which shrinks each time a voucher is used or as the days pass for a term pass, as an asset.

## Decision (confirmed by the user on 2026-11-08, recorded in an issue comment)

- Relation to the ledger: record the payment once as an expense in the ledger on the day it is paid, and show only the remaining value in assets. Usage is not counted as an expense again.
- Asset kind: add a new kind "선입금" ("Prepaid"), and rename the other kind from "기타(코인·선입금 등)" ("Other (crypto, prepayments, and so on)") to "기타(코인 등)" ("Other (crypto and so on)").
- Term pass: current value = round(amount paid × remaining days ÷ total days), a whole-won integer. Before the start date it is the amount paid as it is, it can be used through the expiry date itself, and it is 0 won from the next day.
- Amount voucher: balance = amount charged − the sum of usage. The server rejects using more than the balance. The expiry date is optional, and after it passes the value is 0 won. Usage records only get added and deleted.

### Why we renamed the other kind

In #45 (decided on 2026-11-03) we had 6 kinds and put prepayments in "기타(코인·선입금 등)". Back then a prepayment was also an asset whose valuation you wrote by hand. In #64 a prepayment needs its own input and calculation, such as the amount voucher and term pass distinction, usage records, and the expiry date, so it became a separate kind like depreciable assets (#63). So only crypto and so on remain in other, and we matched the name to that. We added a note pointing at this change to the decision item of `docs/changes/45-portfolio-assets.md`.

## Changes

- `database/migrations/010_prepaid_assets.sql` (safe to run again)
  - We recreate `portfolio_assets_asset_type_check` to allow `prepaid`.
  - The columns `prepaid_kind` (`amount`/`period`), `prepaid_amount_krw bigint`, `prepaid_starts_on`, and `prepaid_expires_on`.
  - `portfolio_assets_prepaid_check`: if there is prepaid info, the kind is prepaid, KRW, and there is no quantity or valuation. An amount voucher has no start date, and a term pass has a start date and expiry date with start date ≤ expiry date.
  - We recreate `portfolio_assets_quantity_or_value_check` to allow prepaid assets too.
  - The `portfolio_prepaid_usages` table: the asset (`ON DELETE CASCADE`), the usage date, the amount (`bigint` of 1 won or more), and a memo (100 characters).
  - The `portfolio_prepaid_value(...)` function: computes the value on the base date as decided above. We subtract dates to get an integer number of days and round with `numeric` `round()` (0.5 away from zero).
- `backend/src/assets.ts`
  - The request accepts `prepaid: { kind, amountKrw, startsOn, expiresOn }`. It can be put only in a prepaid asset, and a prepaid asset must have it. Errors are Korean 400.
  - Each asset in the response gets `prepaid` (including the amount used up to the base date, `usedKrw`), and the prepaid value goes into `currentValueKrw` and the total. The value of an amount voucher subtracts only usage up to the base date, so with `?asOf=` the value on a past day also comes out right.
  - `GET/POST /api/portfolio/assets/:id/usages` and `DELETE /api/portfolio/assets/:id/usages/:usageId`. An add locks the asset row in a transaction and then reads the usage sum separately to check the balance. If it is not an amount voucher it is 400, a date after today is 400, a date after the expiry date is 400, and over the balance gives a 400 `잔액보다 많이 쓸 수 없습니다(남은 금액 N원)` ("You cannot use more than the balance (N won left)").
  - An update (PUT) also locks the asset row in a transaction. Changing an asset with usage records to something that is not an amount voucher, fixing the charged amount to less than what has already been used, or moving the expiry date earlier than the last usage date is 400.
  - We match the particle in the amount validation messages to the final consonant (구입가는, 결제액은).
- `frontend/src/assets.tsx`: added "선입금" to the kinds and renamed other. When you choose prepaid, fields for amount voucher or term pass, the charged amount (or amount paid), the start date of a term pass, and the expiry date (required for a term pass, optional for an amount voucher) appear. The list shows "금액권 · 충전액 · 사용 · 만료" ("Amount voucher · charged · used · expiry") or "기간권 · 결제액 · 시작~만료" ("Term pass · paid · start to expiry") and the current value.
- `frontend/src/prepaid-usages.tsx`: a panel opened with the "사용 기록" ("Usage records") button (`aria-expanded`) on the row of an amount voucher. You add with the usage date (default today), amount, and memo, and delete with the delete button. Changing it reloads the asset list and total. It shows the server's rejection message inside the panel, and puts `aria-invalid` on the date field if the reason is the date and on the amount field if the reason is the balance. The date field allows choosing only up to today. It asks for confirmation before deleting, and after deleting moves focus to the panel heading.

## Verification

- Backend unit tests (`backend/test/assets.test.ts`): missing prepaid info, putting it in another kind, an unknown kind, dollars, together with a valuation, a negative amount paid, a missing expiry date on a term pass, an expiry date earlier than the start date, a start date on an amount voucher, a nonexistent date, and for usage records a missing date, 0 won, a decimal, a memo over 100 characters, and a bad ID. All are Korean 400 before the DB.
- DB integration tests (`backend/test/prepaid.integration.test.ts`)
  - Term pass 270,000 won, 2026-01-01 to 03-31 (90 days): before the start and on the start date 270,000 won, the next day 267,000 won, February 15 135,000 won, the expiry date 3,000 won, and the next day 0 won. A 5 won, 2-day pass on its last day is 3 won (0.5 rounded).
  - Amount voucher 300,000 won: after using 50,000 won and 200,000 won, 50,001 won gives `잔액보다 많이 쓸 수 없습니다(남은 금액 50,000원)`, and exactly 50,000 won is allowed. For each base date only the usage up to that day is subtracted. The list is newest first.
  - If 5 usages of the last balance of 10,000 won are sent to the same amount voucher at once, only 1 succeeds. At first it read the sum with a subquery inside the locking statement, and 2 got through (under READ COMMITTED it read the snapshot before waiting for the lock). We fixed it to read the sum separately after locking.
  - An amount voucher with an expiry date: 100,000 won through the expiry date, 0 won the next day, and usage after the expiry date is 400.
  - The total with today pinned to 2026-02-15: term pass 135,000 won + amount voucher 270,000 won = 405,000 won (a whole-won integer).
  - A usage record on a term pass is 400, a usage record of another asset cannot be deleted (404), and deleting the asset deletes its usage records.
  - Changing an amount voucher with usage records to a term pass is 400, fixing the charged amount to less than what was used is 400, and increasing it makes the current value follow.
  - The DB CHECKs reject a half term pass, a term pass whose expiry date is earlier than the start date, an amount voucher with a start date, a prepaid with a valuation together, and prepaid info on another kind (`23514`). Applying `010` twice gives no error (on empty tables; for a rerun with data, see the first-round review below).
- The existing asset and mock investing integration tests also apply `010` when they recreate tables.
- Frontend tests (`frontend/src/prepaid.test.tsx`): the kind names, the add request and list display for an amount voucher, date checks and adding for a term pass, adding usage, the over-balance message, deleting with the total refresh and focus, rejecting 0 won usage, and filling the fields when editing.
- `TEST_DATABASE_URL=<dedicated test DB money-ledger-test-agent1> npm run check` passed: backend 154 passed and 0 skipped, frontend 162 of 164 passed and 2 skipped (existing), 4 skill tests, build succeeded.
- Browser: we connected the API (3191) to a separate DB `money_browser` in the same container (migrations `001` to `010`) and opened Vite (5291) with headless Chrome (viewport set through CDP). With the screen form we added cash 5,000,000 won, an amount voucher (300,000 won, expiry 2026-12-31), and a term pass (273,000 won, 2026-10-01 to 12-30, 91 days).
  - In the usage panel, adding 45,000 won on 2026-11-01 (a cut and dye) showed "45,000원 사용을 기록했습니다" ("Recorded a usage of 45,000 won"). Then entering 300,000 won was rejected by the server with `잔액보다 많이 쓸 수 없습니다(남은 금액 255,000원)`, and the amount field turned red.
  - As of 2026-11-08: amount voucher 255,000 won, term pass 159,000 won (53 days left, 273,000 × 53 ÷ 91), asset total 5,414,000 won.
  - Mobile 390×844: `scrollWidth` 390 = `clientWidth`. Long names, the "amount voucher · charged · used · expiry" line, and the usage panel wrap in one column.
  - PC 1440×900: `scrollWidth` 1425 = `clientWidth` (excluding the vertical scrollbar). The date, amount, memo, and add of the usage panel lay out on one line.
- After merging `origin/main` (#51 price module, migration `009`), `npm run check` passed again: backend 183 passed and 0 skipped, frontend 172 of 174 passed and 2 skipped (existing), 4 skill tests, build succeeded.
- Note: during repeated runs, the #60 classification integration test (`classification.integration.test.ts`) failed once. It is a file unrelated to this work, and when we reran only that file 6 times, all passed.

## Limits and follow-up

- Prepayment rows that were put in "기타(코인·선입금 등)" at the time of #45 are not moved automatically. They stay in "기타(코인 등)", so to handle them as an amount voucher or term pass, register them again as prepaid (not deployed yet).
- Usage records are not edited (decision). If you entered one wrong, delete it and enter it again.
- Usage records are not connected to the ledger (decision: usage is not an expense).

## Review record

### Round 1: no defect blocking the merge, 2 points to fix and 7 minor comments addressed

- (To fix) Migration rerun: running `007` again reverted the `portfolio_assets_quantity_or_value_check` that `010` had widened to the old definition without the prepaid condition. If there is a prepaid row, it stops at `007` with a CHECK violation. We changed `007` and `010` to recreate the shared CHECKs (`quantity_or_value`, `asset_type`) only when their own column or kind is not already in them. We added a test that reapplies `004` → `007` → `010` → `007` with prepaid and depreciable rows present.
- (To fix) Usage on a future date: if you entered a date after today, it entered the balance check but was not yet reflected in the "used" and current value on the screen, so the numbers disagreed. A usage record is something actually used, so a date after today is rejected with `오늘 이후 날짜에는 사용을 기록할 수 없습니다` ("You cannot record usage on a date after today").
- We reject an update that moves the expiry date earlier than the last usage date (the same rule as a new usage).
- The DB also rejects a `prepaid` row with no prepaid info.
- If the server rejects because of the date, we put `aria-invalid` on the date field. The client also blocks nonexistent dates and years outside 1900 to 2100 first.
- We add `aria-controls` of the "사용 기록" button only while the panel is open.
- We show a confirmation dialog before deleting a usage record. If it is already deleted and gives 404, we reload the list.
- Tests added: a migration rerun with data, rejecting a future date, rejecting moving the expiry date earlier, lowering the charged amount and adding usage running at the same time, a DB rejection of a `prepaid` kind with missing info, the date field display, `aria-controls`, and the delete confirmation.
- Verification: `TEST_DATABASE_URL=<dedicated test DB> npm run check` passed (backend 187 passed and 0 skipped, frontend 174 of 176 passed and 2 skipped (existing), 4 skill tests, build succeeded).

### Round 2: 9 first-round fixes confirmed, no blocking defect, 6 minor points addressed

- The reviewer ran, on a separate DB, applying to an empty DB, reapplying in several orders with prepaid and depreciable rows present, and the path coming up from main's old `007`, and confirmed that the constraint definitions come out the same.
- We changed the rerun test to directly check the widened CHECK definition (`'prepaid'`, `prepaid_kind`).
- A server rejection is a 400, and if the reason is the date it is shown only on the date field and if the reason is the balance only on the amount field, while a 404 or network error is announced without marking a field.
- We set the `max` of the usage date field to today, and the client also blocks a date after today first.
- We moved the nonexistent date check (`realDate`) to `format.ts` and use it for the term pass and expiry date of the asset form too.
- While deleting a usage record the saving state is also on, and pressing "사용 추가" ("Add usage") then announces "저장 중입니다" ("Saving").
- We matched the API and panel descriptions in the body to the real behavior.
- By the standard, we do not run a third review.
- Verification: `TEST_DATABASE_URL=<dedicated test DB> npm run check` passed (backend 187 passed and 0 skipped, frontend 175 of 177 passed and 2 skipped (existing), 4 skill tests, build succeeded).
