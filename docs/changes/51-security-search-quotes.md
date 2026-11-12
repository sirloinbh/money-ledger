# #51 Mock investing ticker search and quote screen

- Issue: https://github.com/sirloinbh/money-ledger/issues/51
- Branch: `feat/51-symbol-search-quotes`

## Purpose

Before ordering, find a ticker by name, code, or ticker symbol and check the current price and its base time. In this issue we build the **shared price module** that fetches and stores prices and exchange rates as decided in [docs/price-source.md](../price-source.md) (#36). The asset current price (#47) and the mock investing orders and holdings (#52 to #54) use the same module.

## Decision (confirmed by the user on 2026-11-08, recorded in an issue comment)

- US ticker search: Korean and US tickers go in the same table, and search is done only in the DB.
  - The US list is filled by downloading Tiingo `supported_tickers.zip` every week.
  - This file has no company names, so US tickers are found only by ticker symbol (option A).
  - The name is fetched with the meta API and stored the first time the detail is opened. From then on it can also be found by name.
- We researched lists that have names (Nasdaq Trader, SEC) and wrote them only as candidates in `docs/price-source.md`.

## Changes

- `database/migrations/009_prices.sql`: creates five tables. It is safe to run again.
  - `securities`: Korean and US tickers. `(currency, symbol)` is unique. A US ticker may have an empty name, and when it drops out of the list it is not deleted but set to `active = false`.
  - `security_prices`: the close per ticker and trading day, `numeric(20,4)` + `currency`.
    - A KRW close must be an integer.
    - That it matches the ticker currency is enforced by the composite foreign key `(security_id, currency)`.
  - `fx_rates`: the USD basic rate, `numeric(12,4)`.
  - `price_fetch_state`: per source and scope, the last confirmed date, the last attempt and success times, and the last error (in Korean, with no key or URL).
  - `price_api_calls`: the record of Tiingo calls. It keeps the hourly limit even after a server restart.
- `backend/src/prices/`: the shared price module. The file list is in ["Implementation (#51)" of docs/price-source.md](../price-source.md#implementation-51).
  - Sources: KRX (key in a header), Tiingo (key in a header, and the ticker list ZIP is unpacked with the built-in `zlib`), Eximbank (key in the URL). The fake source is `fake.ts`.
  - The daily fetch runs at 12:00 (Asia/Seoul).
    - Dates to fetch: for each source, from the day after the last confirmed date, within the last 10 days. An empty response is confirmed as "no new value".
    - If it fails, it retries every hour until 18:00. If the server starts after 12:00, it fetches once.
    - A source with no key is skipped and "Price source is not configured" is recorded.
  - The most recent date of the US close is that day if it is after 18:00 New York time, otherwise the day before. The doc only decided "the New York date at 12:00 Korean time". We added this standard so that, if the server starts late in the evening, it does not request the date of the US market while it is still open.
  - Tiingo is limited by the number of calls in the last hour. The daily fetch uses up to 40, and the on-the-spot fetch from the screen up to 50.
  - `GET /api/prices/securities?q=`: the search term is 1 to 40 characters, at most 20 results, with the latest close.
    - Korean tickers are found by name and code, and US tickers by ticker symbol. A US ticker whose name is stored can be found by name too.
    - `%` and `_` typed by the user are searched as the characters themselves.
  - `GET /api/prices/securities/:id`: returns the ticker, the latest close, whether it is delayed (over 5 days), and for a US ticker the latest exchange rate.
    - A US ticker that is not tracked or has no close yet is fetched on the spot.
    - If there is no close, it tells the reason (`quoteIssue`): source not configured, limit exceeded, fetch failed, or a ticker not in the source.
    - Opening the detail makes that US ticker a target of the daily fetch for 30 days.
- `backend/src/app.ts`, `server.ts`: registered `/api/prices`. The server decides the sources by environment variables and starts the daily fetch.
  - `PRICE_SOURCE=fake`: use the fake source.
  - `PRICE_JOBS=off`: do not run the daily fetch.
- `compose.yaml`, `.env.example`: pass the three price keys to the API container. We added descriptions of `PRICE_SOURCE` and `PRICE_JOBS`.
- `frontend/src/security-search.tsx`, `quote-format.ts`, `mock-trading.tsx`: added "종목 찾기" ("Find a ticker") to the mock investing screen.
  - It shows searching, no results, no search term, and API error with different texts.
  - A result shows the close and "M월 D일 종가 기준" ("close as of M/D"). A US ticker with no close yet shows "열면 시세를 받습니다" ("Open it to get the price").
  - Opening the detail moves focus to the detail heading.
  - The detail shows the close, the base date ("시세 지연 · …" if delayed), and the exchange rate of a US ticker ("환율 지연 · …" if delayed). If a value is missing, it shows "시세 없음" ("No price") or "환율 없음" ("No exchange rate") and the reason.
- `backend/test/helpers.ts`: if the test server gets a port that fetch blocks (5060, 6000, and so on), it gets another port.
  - On this PC the Windows dynamic ports start at 1024, so even the existing tests failed with `fetch failed: bad port` about 3 times out of 5.
- `docs/price-source.md`: added the US ticker list comparison table (Tiingo adopted, Nasdaq Trader and SEC as candidates), the US ticker search decision, and the implementation section.

## Verification

- Test DB: the dedicated container `money-ledger-test-agent3` (`postgres:17-alpine`, `127.0.0.1:15493`). We applied migrations 001 to 009 and ran 009 twice to confirm it is safe to run again.
- `backend/test/prices.test.ts` (14 unit tests):
  - Computing the dates to fetch, the most recent US date (before and after daylight saving, and while the New York market is open)
  - Parsing the KRX, Tiingo, and Eximbank responses, filtering the ticker list CSV, and reading the ZIP
  - Leaving out sources with no key, and that the error message has no key or URL
  - Validating the search term and ID (Korean 400 before the DB)
- `backend/test/prices.integration.test.ts` (15 DB integration tests, after the first-round fixes):
  - The first run fetches 10 days and the next run fetches only the new days. An empty weekend response also counts as a confirmed date.
  - A failed day is continued at the next attempt and the error is recorded. A source with no key is skipped.
  - Starting at 12:00, no duplicates in the same hour, retrying until 18:00, and fetching once when started late
  - Search (by name, code, and ticker, wildcard characters, and the exact ticker first)
  - The US detail on-the-spot fetch and name storage, and 30-day tracking
  - Korean delayed display (5 days and 6 days), reasons for no price, and the Tiingo hourly limit (50 for the screen and 40 for the daily fetch)
  - Deactivating a ticker that dropped out of the list, and the DB CHECKs and foreign keys
- `frontend/src/security-search.test.tsx` (10, a check that the result row updates added after the first review): search results, no results, no search term, and API error, the Korean detail's delay and focus, the US detail's dollars and exchange rate delay, 4 reasons for no price, a detail load failure, and date display
- `TEST_DATABASE_URL=<test DB> npm run check` passed (exit code 0)
  - Backend 135 passed, 0 skipped
  - Frontend 157 of 159 passed, 2 skipped (existing)
  - 4 skill tests, build succeeded
- `npm run knip` passed (this time it ran locally).
- We ran the backend tests with the DB three more times and confirmed all 135 passed (after the port fix).
- Browser: we started the API (3193, test DB, `PRICE_SOURCE=fake`) and Vite (5293). We checked `/mock-trading` at 390×844 and 1440×900 with headless Chrome (viewport set through CDP).
  - When the server started, the daily fetch ran once (20:42, `complete: true`).
  - There is no horizontal overflow at either size (scrollWidth = clientWidth).
  - An empty search term shows "검색어를 입력하세요" ("Enter a search term"), and `zzz` shows "검색 결과가 없습니다" ("No search results").
  - `삼성` ("Samsung"): Samsung Electronics 70,600 won "11월 6일 종가 기준". When the detail is opened, focus goes to the heading.
  - `aapl`: at first "열면 시세를 받습니다" shows. When the detail is opened, it is fetched on the spot, and Apple Inc 231.5 dollars and the exchange rate 1,383 won "11월 6일 기준" show. After that it can also be found with `apple`.
  - The API error display was checked only by screen tests.
- **We did not verify with real API keys.** The keys (#85) do not exist yet, so the automated tests and the browser check all used the fake source.
  - The KRX and Eximbank addresses and response fields were used as the secondary sources describe them.
  - The Tiingo price and meta APIs match the official docs. We downloaded the ticker list file and checked its format directly.

## Limits and follow-up

- When we get the keys (#85), we check the three sources with real responses and fix anything that differs.
- US tickers of assets (#47) and mock investing holdings (#53) must be added to `trackedUsSecurities` to be fetched daily.
- The KRW-converted valuation and orders are done in #52 and #53. This screen shows only the close and the exchange rate.
- To find US tickers by name, a list with names (the Nasdaq Trader candidate) must be added. It needs the user's decision.

## Review record

### Round 1: no defect blocking the merge, 7 addressed, 3 split off

Addressed:

- The most recent date counts as a confirmed date only when a value was received. Before, if the fetch ran while the US close or that day's exchange rate had not come out yet, that date was recorded as "confirmed" and was not fetched again.
  - It is the same for KRX, the exchange rate, and the US close. If the most recent date is empty, it is requested again at the next fetch.
  - We also fixed the definition of "confirmed date" in `docs/price-source.md`.
- We changed the Tiingo call record time from the run start time to the actual call time (start time + elapsed time). The calls of a long run do not drop out of the 1-hour window early.
- Name fetching cleanup
  - If the close fetch is `not_found`, we do not fetch the name (we do not spend a call on a sure 404).
  - A US ticker that has a close but an empty name tries to fetch the name every time the detail is opened.
- We put a DB advisory lock on the daily fetch so that it runs only once even with several servers.
- If the new US list is smaller than half the current number of active tickers, we treat it as a broken file and do not store it (recorded as a failure and retried the next hour).
- After the detail is opened, the fetched name and close show immediately in the search result row too.
- Docs: we fixed the table breaking because of the `|` in the Nasdaq Trader row and the missing KRX key location (the `AUTH_KEY` header) in the implementation table.

Tests added and changed:

- DB integration: fetching again after the most recent date was not yet published (US close and exchange rate), rejecting a short list, the advisory lock, and no name call for a nonexistent ticker. The existing expectations were matched to "an empty most recent date is requested again".
- Screen: after the detail is opened, the result row changes to the name and close.

Issues split off:

- [#96](https://github.com/sirloinbh/money-ledger/issues/96): reduce the daily 404 calls for tracked tickers that are not in Tiingo
- [#97](https://github.com/sirloinbh/money-ledger/issues/97): handling search and orders for delisted and halted Korean tickers (good to decide before #52)
- [#98](https://github.com/sirloinbh/money-ledger/issues/98): separate detail lookup from on-the-spot fetching and tracking registration (together with the authentication design)

Not addressed:

- The text "열면 시세를 받습니다" in the result list when the source is not configured. When the detail is opened, "Price source is not configured" shows.
- A test for the search response order being swapped. The code (the `latest` ref) exists.
- Verification after the first-round fixes
  - `TEST_DATABASE_URL=<test DB> npm run check` passed: backend 138 passed (0 skipped), frontend 157 passed and 2 skipped (existing), 4 skill tests, build succeeded
  - `npm run knip` passed

### Round 2: 7 first-round fixes confirmed, no blocking defect, 2 addressed, 1 added to a split-off issue

- We fixed a regression of the first-round fix. If the most recent date of the US close (New York) is Saturday or Sunday, it counts as confirmed even without a value.
  - Before the fix, on Korean Sunday and Monday, when another source failed and retried every hour, it called all the tracked tickers again each time.
  - If there were more than 40 tracked tickers, only the front ones in symbol order were called again and again, and the back ones might not be fetched that day.
  - Test: check that Tiingo is not called again on a retry the same day.
- A connection that could not release the daily fetch lock is discarded without returning it to the pool. The lock is released when the session ends.
- Added to a split-off issue: a tracked US ticker that has no close at all (an empty weekday response) does an on-the-spot fetch every time the detail is opened. It is the same kind, so we tied it to [#96](https://github.com/sirloinbh/money-ledger/issues/96) with a comment.
- By the standard, we do not run a third review.
- Verification after the second-round fixes
  - `TEST_DATABASE_URL=<test DB> npm run check` passed: backend 138 passed (0 skipped), frontend 157 passed and 2 skipped (existing), 4 skill tests, build succeeded
  - `npm run knip` passed
