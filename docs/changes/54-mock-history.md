# #54 Mock investing trade history and return trend chart

- Issue: https://github.com/sirloinbh/money-ledger/issues/54
- Branch: `feat/54-mock-history`

## Purpose

Find a mock investing account's past trades by date range and ticker, and see in a chart how the account return changed by date.

## Decision (confirmed by the user on 2026-11-10, recorded in an issue comment)

1. A snapshot is stored as one record per (account, KST date) when the daily price fetch finishes and when an order fills. The same date is overwritten.
2. The values are the same calculation as #53 (cash + the valuation at the latest stored close and exchange rate). Even if prices change later, the stored values are not fixed.
3. The past is not recomputed. The chart starts at 0% on the account start date and connects only the stored snapshots.
4. Only the open account is shown. The records of a closed account are not deleted.
5. The trade history is filtered by date range (KST order date) and ticker and shown 50 at a time, newest first, with "더 보기" ("Show more"). The chart is one return line, and the periods are 1 month, 3 months, and all.

## Changes

- `database/migrations/018_mock_snapshots.sql`: `mock_snapshots` with the primary key (account, date), and cash, valuation, total assets, profit and loss, and return. A `total_krw = cash_krw + value_krw` CHECK. It is safe to run again.
- `backend/src/mock-orders.ts`: `GET /api/mock/accounts/:id/orders?from&to&securityId&before`
  - The date is the day the order time becomes in Seoul time.
  - Newest first, 50 entries, and `before` is the last order ID already seen. `hasMore` tells whether there is a next page.
  - It also returns the list of tickers this account traded (`securities`) for the filter.
  - A bad date, start date > end date, and a bad ticker or position are Korean 400s.
  - When an order fills, it stores that day's snapshot in the same transaction.
- `backend/src/mock-holdings.ts`: pulled the valuation calculation out into `accountValue()` so that the holdings screen and the snapshot use the same formula.
- `backend/src/mock-snapshots.ts`
  - `saveSnapshot()`: if there is a held ticker with no price or exchange rate, it skips without leaving a wrong value.
  - `snapshotOpenAccount()`: after the daily price fetch, stores that day's values of the open account.
  - `GET /api/mock/accounts/:id/snapshots`: the account start date (KST), the starting amount, and the snapshots in date order.
- `backend/src/prices/scheduler.ts`, `server.ts`: every time a daily price fetch runs, it calls `afterFetch`. An error there is recorded separately as `price_after_fetch_error` and is not counted as a price fetch failure.
- `frontend/src/mock-returns.tsx`, `mock-return-chart.tsx`: the "수익률 추이" ("Return trend") card
  - Periods 1 month (default), 3 months, and all
  - It puts 0% on the start date as the first point. If there is a stored value on the start date, it uses that value.
  - The #40 pattern: the chart file is loaded separately with lazy, and on failure "다시 시도" ("Retry") and the table remain. The color is `--chart-series-1`, the chart is one image for screen readers, and all values are in "표로 보기" ("View as table").
- `frontend/src/mock-history.tsx`: the "거래 내역" ("Trade history") card (start date, end date, and ticker filters, clearing filters, and show more)
- `frontend/src/mock-account.tsx`: when there is an open account, it shows the two cards under the account card. It is redrawn by account ID so the previous account's values do not remain after a reset.
- `frontend/src/format.ts`: the signed percent `signedPercent()` is shared with the holdings screen.

## Verification

- Test DB: the dedicated container `money-ledger-test-agent3` (15493)
- `backend/test/mock-orders.integration.test.ts`
  - Trade history: the date range filter at Seoul date boundaries (00:30, 23:59), the ticker filter, 50 and the next page after adding up to 51, bad values 400, and a nonexistent account 404
  - Snapshots: two orders on the same day → one record (the last value), the daily fetch the next day → a new date (+0.94%), a closed account does not store, stored values stay the same even if prices change later, storing again on the same day overwrites (+1.94%, 2 rows), no exchange rate means no store, the account start date is a Seoul date, and a nonexistent account 404
- `backend/test/prices.integration.test.ts`: after the daily fetch runs it calls `afterFetch`, its failure is recorded separately, and that day's fetch stays finished.
- Screen tests
  - `mock-returns.test.tsx`: points by period, 0% on the start date, the table, the notice when there is only one point and when there are no values in the period, and load failure
  - `mock-returns-chart-error.test.tsx`: chart file failure → keep the table → retry
  - `mock-return-chart.test.tsx`: the chart image name
  - `mock-history.test.tsx`: display, the date range and ticker filter addresses, clearing filters, rejecting start date > end date, show more, no trades, and reloading
  - `format.test.ts`: `signedPercent`
- Browser: we started the API (3193, test DB, fake source) and Vite (5293) and checked with headless Chrome at 390×844 and 1440×900. At each size we started with a new 10 million won account, changed the account start date to October 20, and put in snapshots of October 25 (−0.5%) and November 1 (+1.2%) as test data.
  - Trade history before orders: "아직 거래가 없습니다." ("There are no trades yet.")
  - After buying 10 shares of Samsung Electronics, buying 2 shares of Apple, and selling 1 share of Apple, 3 trade entries (newest first), and the ticker list "Apple Inc (AAPL)", "삼성전자 (005930)"
  - Filtering the ticker by Apple leaves only the 2 Apple entries.
  - Return trend (all): the four points October 20 0%, October 25 −0.5%, November 1 +1.2%, and November 10 (stored at the order) 0% (−1 won) connect in one line, and the table has the same values.
  - No horizontal overflow. At 390 width the date in the table wrapped to two lines, and we fixed it to one line.
- `TEST_DATABASE_URL=<dedicated test DB> npm run check` passed (after merging origin/main): backend 300 passed and 0 skipped, frontend 264 passed and 2 skipped (existing), 4 skill tests, build succeeded. `npm run knip` passed.

## Limits and follow-up

- There is no screen to see the trade history and return trend of a closed account (decision 4). The records remain.
- If the server is off for a whole day, there is no snapshot for that day, and the chart connects the saved days before and after directly. The horizontal axis places the saved days at equal spacing, so if there are missing days the time spacing looks different from the real one (check the dates by the axis labels and the table).
- We did not verify with real price keys (#85).
- When the valuation cannot be computed because another held ticker has no close or exchange rate, no snapshot is stored. For that day, the last value that could be computed remains.

## Automatic review

### Round 1 (PR #114, as of be6da0e)

Nothing blocking, 1 to fix, and 5 minor.

- Fixed: if you pressed "더 보기" right after changing the filter and before the new list arrived, the new filter's result could be appended after the old list. We keep the request number that made the list together with the list, and continue only when it is the list made by the latest request. We added a screen test.
- Fixed: storing the snapshot after a price fetch could overwrite a value older than an order that came in at the same time. Like orders, it is stored in a short transaction that locks the account row with `FOR UPDATE`.
- Fixed: we changed `initialCashKrw` from `Number()` to `won()`.
- Fixed: we added `role="status"` to the loading text of the two cards.
- Left in docs: that the chart's horizontal axis does not reflect date spacing (Limits and follow-up), and why the order ID cursor does not miss entries even with concurrent orders thanks to the account row lock (a code comment).
- After the first-round fixes `TEST_DATABASE_URL=<dedicated test DB> npm run check` passed: backend 300 passed and 0 skipped, frontend 265 passed and 2 skipped (existing), 4 skill tests, build succeeded. `npm run knip` passed.

### Round 2 (as of e294933)

Nothing blocking and nothing to fix, 2 minor. We confirmed that the first-round fixes are right (orders and snapshot storing both lock the account row first, so there is no deadlock).

- Fixed: there was no test that checks the account lock. We added an integration test that, while the account row is held like an order, the snapshot storing waits and stores the value after the commit.
- Left in docs: that when the valuation cannot be computed, that day's snapshot stays as the last computed value (Limits and follow-up).
- After the second-round fixes `npm run check` passed (backend 300, frontend 265 passed and 2 skipped, 4 skill tests, build), `npm run knip` passed.
- After merging origin/main (#48 asset allocation), we added `mock_snapshots` to the table reset of the new `allocation.integration.test.ts` (it has to be deleted together when the account table is deleted). `npm run check` passed (backend 311, frontend 275 passed and 2 skipped, 4 skill tests, build), `npm run knip` passed.
