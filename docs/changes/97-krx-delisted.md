# #97 Deactivate delisted and halted Korean tickers

- Issue: https://github.com/sirloinbh/money-ledger/issues/97
- Branch: `feat/97-krx-delisted`

## Purpose

Prevent the problem that a Korean ticker that disappeared from the KRX response keeps being searched with its last close and can be bought in a mock order (#52). This is an issue split off in the #51 first review.

## Decision (confirmed by the user on 2026-11-08, recorded in an issue comment)

- If a ticker of that market is missing from a non-empty KRX response for 10 business days in a row, it becomes inactive.
- An inactive ticker is removed from search and buying is rejected. Selling is allowed.
- The holdings screen shows "거래 중단" ("Trading halted") and the last close.
- If it appears in a response again, it becomes active again.

This PR covers only the price module part. Rejecting buys is handled in #52, and the display on the holdings screen in #53, by reading `active`.

## Changes

- `database/migrations/012_krx_listing.sql`: safe to run again.
  - Added `securities.krx_last_seen` (the last business day a Korean ticker appeared) and `krx_market_days` (the KRX business days per market).
  - It fills both values from the closes stored before 012.
- `backend/src/prices/store.ts`: when `saveKrxDay` stores a non-empty day, it does three things.
  - It records the business day.
  - It updates `krx_last_seen` of the tickers that appeared and turns them active again.
  - It turns inactive the tickers whose `krx_last_seen` is earlier than the earliest of that market's most recent 10 business days.
  - The number of business days is counted by stored dates, not by the number of runs, so fetching the same day again does not count it twice.
- `backend/src/prices/router.ts`: added `active` to the ticker response. Search already leaves out inactive tickers. The detail opens even if inactive and shows the last close.
- `frontend/src/security-search.tsx`: added a "거래 중단" marker to the detail of an inactive ticker.
- `docs/price-source.md`: added the section "Delisted and halted Korean tickers (#97)".

## Verification

- Test DB: the dedicated container `money-ledger-test-agent3`. We applied 009 and 012, and ran 012 twice to confirm it is safe to run again.
- We added 2 DB integration tests to `backend/test/prices.integration.test.ts` (all 17 passed).
  - First: the state changes by missing days
    - Missing for 9 business days stays active. Holidays (empty responses), storing the same day again, and business days of another market are not counted.
    - It becomes inactive on the 10th business day and drops out of search. The detail opens with `active: false` and the last close.
    - When it appears again it becomes active.
  - Second: it checks that 012 fills the business days and the last business day from the existing closes and leaves US tickers empty.
- We added 2 screen tests to `frontend/src/security-search.test.tsx` (all 12 passed): "거래 중단" and the last close in the detail of an inactive ticker, and no marker on an active ticker.
- `TEST_DATABASE_URL=<test DB> npm run check` passed (exit code 0): backend 160 passed (0 skipped), frontend 168 passed and 2 skipped (existing), 4 skill tests, build succeeded. These counts include tests of other work merged into main in the meantime.
- `npm run knip` passed
- Browser: we started the API (3193, test DB, fake source) and Vite (5293) and checked with headless Chrome at 390×844 and 1440×900. After searching SK hynix, we changed it to inactive in the DB and opened the detail.
  - At both sizes, "거래 중단" and the last close ("180,600원 · 11월 6일 종가 기준") showed.
  - There was no horizontal overflow.

## Limits and follow-up

- Rejecting buys is handled in #52, and the "거래 중단" display on the holdings screen in #53, by reading `active`.
- An inactive ticker drops out of search, so on the current screen there is no way into the detail until the holdings list (#53) exists.

## Review record

### Round 1: no defect blocking the merge, 5 addressed, 1 split off

- We fixed the problem that storing a past date later brought an inactive ticker back to life. The inactive decision is made on "the most recent 10 stored business days", not "the 10 days up to the day just stored".
  - In the normal flow the result is the same. Even with a late store such as a manual refetch, it goes back to inactive again in the same transaction.
  - We added a test.
- We added a test that checks that a ticker that moved markets (KOSDAQ→KOSPI) does not become inactive because of the old market's business days (18 DB integration tests passed).
- Doc corrections
  - We corrected that a halted ticker is caught by the rule only when it is missing from the response or its close is `-` or 0. The case where it is listed with the previous close and a volume of 0 was split off as [#102](https://github.com/sirloinbh/money-ledger/issues/102) (it needs a check of real responses and a user decision).
  - We wrote that a US ticker also gets `active = false` when it drops out of the list, so "거래 중단" is attached.
  - We wrote that right after 012 is applied, it is cleaned up at the next KRX store.
- Comment: we wrote the meaning of `active` (Korean 10 business days, exclusion from the US list) and that a Korean ticker without `krx_last_seen` does not become inactive.
- Verification after the first-round fixes: `TEST_DATABASE_URL=<test DB> npm run check` passed (backend 161 passed and 0 skipped, frontend 168 passed and 2 skipped (existing)), `npm run knip` passed.

### Round 2: first-round fixes confirmed, nothing to fix

- The decision based on the most recent 10 business days, the late store and market move tests, and the doc corrections were all reflected correctly.
- Note (not addressed): if you manually refetch an old market date late, the ticker's market and name go back to the old values. This behavior has existed since #51 and does not happen in the normal collection flow.
- By the standard, we do not run a third review.
