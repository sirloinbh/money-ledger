# Price and exchange rate sources

Last updated: **2026-11-08 (Asia/Seoul)**. Decision issue: [#36](https://github.com/sirloinbh/money-ledger/issues/36). US ticker list and implementation: [#51](https://github.com/sirloinbh/money-ledger/issues/51).

## Decision (confirmed by the user on 2026-11-06)

| Item             | Decision                                                                            |
| ---------------- | ----------------------------------------------------------------------------------- |
| Target markets   | Start with Korean stocks (KOSPI, KOSDAQ, ETFs) and US stocks                        |
| Price type       | Use only the **closing price**, fetched once a day. No intraday or real-time prices |
| Mock trade fills | Fill at the **latest stored closing price** at the time of the order                |
| Cost             | Prefer free sources                                                                 |
| Korean source    | KRX Open API: daily trading data for KOSPI, KOSDAQ, and ETFs                        |
| US source        | Tiingo End-of-Day API (free Starter plan)                                           |
| KRW/USD rate     | Korea Eximbank current exchange rate API, USD basic rate                            |
| Key issuance     | The user does it: [#85](https://github.com/sirloinbh/money-ledger/issues/85)        |

## Candidate comparison

The research date is 2026-11-06. The "Confirmed" column shows the level of evidence. **Official** means a value read directly from the provider's page, and **Secondary** means a value seen only in a blog or a library's docs. Recheck secondary values against the official guide after the keys are issued (#85, #47).

### Korean stocks

| Source                                                                                                                           | Data and update time                                                                                       | Call limit                                  | Cost and terms                                                                                                                  | Confirmed                 | Verdict                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **KRX Open API** ([openapi.krx.co.kr](https://openapi.krx.co.kr))                                                                | Daily trading data by market (ticker code, name, open, high, low, close). Updated around 8 AM the next day | 10,000 calls per day per key. 429 above     | Free. After getting a key, apply for each API and get approved (about 1 day). Non-commercial personal use, attribution required | Secondary                 | **Adopted.** It is the exchange's original data and the fastest to update among sources needing no account |
| Public Data Portal, Financial Services Commission stock price info ([15094808](https://www.data.go.kr/data/15094808/openapi.do)) | Relays KRX data once a day. Updated after 1 PM on the business day after the base date                     | 10,000 calls (per day) on a dev account     | Free. Korea Open Government License type 4 (attribution, no commercial use, no changes)                                         | Official, limit secondary | Backup. Use it if KRX approval is blocked                                                                  |
| Korea Investment & Securities KIS Open API                                                                                       | Intraday and real-time prices, and the same-day close                                                      | Per-second limit (not officially confirmed) | Free, but needs a **brokerage account** and an app key                                                                          | Secondary                 | Excluded. We only use closing prices, so there is no reason to open an account                             |
| Portal page scraping (Naver Finance and similar)                                                                                 | Intraday prices                                                                                            | None (unofficial)                           | Automated scraping risks violating the terms                                                                                    | -                         | Excluded                                                                                                   |

### US stocks

| Source                                                          | Data                               | Call limit                                                       | Cost and terms                                                                         | Confirmed                                       | Verdict                                                              |
| --------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| **Tiingo** ([pricing](https://www.tiingo.com/about/pricing))    | US stock and ETF daily close (EOD) | 50 per hour, 1,000 per day, 500 tickers per month, 1GB per month | Free Starter. "Your own personal use" (internal use)                                   | Limits official, EOD in the free tier secondary | **Adopted.** The free limits are plenty for a personal portfolio     |
| Alpha Vantage ([premium](https://www.alphavantage.co/premium/)) | US stock daily prices              | 25 per day                                                       | Free. Real-time and 15-minute delayed data need a paid plan and a separate entitlement | Official                                        | Backup. With more than 25 tickers you cannot fetch them all in a day |
| Finnhub                                                         | Current price, daily candles       | 60 per minute (varies by material)                               | There are reports that the free tier blocks daily candle access                        | Secondary                                       | Excluded. It is uncertain whether daily closes are free              |
| Yahoo Finance (unofficial API)                                  | Korean and US prices               | Unofficial                                                       | Not a public API, and automated scraping risks violating the terms                     | -                                               | Excluded                                                             |

### KRW/USD exchange rate

| Source                                                                             | Data and update time                                             | Call limit               | Cost               | Confirmed | Verdict                                                |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------ | ------------------ | --------- | ------------------------------------------------------ |
| **Korea Eximbank current exchange rate API** (`oapi.koreaexim.go.kr`, `data=AP01`) | Basic rate per currency. Announced around 11 AM on business days | 1,000 per day            | Free               | Secondary | **Adopted**                                            |
| Bank of Korea ECOS statistics API                                                  | Daily statistics of the KRW/USD basic rate                       | Not officially confirmed | Free, key required | Secondary | Backup. Use it if the Eximbank API is blocked for long |

According to the Eximbank notice, the old domain `www.koreaexim.go.kr` was shut down on 2026-04-30. Use only the new domain `oapi.koreaexim.go.kr`. If you call on a non-business day or before 11 AM, you get an empty value. In that case use the last stored rate.

### US ticker list (#51)

The research date is 2026-11-08. **Checked directly** means a value from a file we downloaded and opened.

| Source                                                                                                                         | Company name | Key                                                     | Terms of use                                                                                                                   | Update                                                | Size and delisting                                                                                                                                                                                             | Confirmed                                                                | Verdict                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **Tiingo `supported_tickers.zip`** ([EOD docs 2.1.3](https://www.tiingo.com/documentation/end-of-day))                         | No           | Not needed (downloads without a token)                  | Not stated in the docs. We assume Tiingo's terms ("your own personal use") apply                                               | Docs: "updated daily"                                 | 0.8MB (compressed), 109,000 rows. Columns `ticker,exchange,assetType,priceCurrency,startDate,endDate`. Delisted tickers stay with a past `endDate`                                                             | Columns and row count checked directly, update official, terms secondary | **Adopted.** It is already the chosen source, so no new source is added. There is no name, so US tickers are found only by ticker |
| Nasdaq Trader `nasdaqlisted.txt`, `otherlisted.txt` ([definitions](https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs)) | Yes          | Not needed                                              | The definitions page has no terms text. We could not check the original of the "Disclaimer" link                               | Official: "updated periodically through-out each day" | About 13,000 rows in the two files together, 0.9MB. Columns are separated by pipe characters, with `ETF` and `Test Issue` columns. It is a current listing, so delisted tickers seem to be missing (secondary) | Columns and row count checked directly, update official                  | Candidate. Easiest if name search becomes necessary. Check the terms of use first                                                 |
| SEC `company_tickers.json` ([EDGAR access guide](https://www.sec.gov/os/accessing-edgar-data))                                 | Yes          | No key, but the User-Agent must state a contact (email) | Official: "Please declare your user agent in request headers", 10 per second. It says accuracy and coverage are not guaranteed | Official: "periodically"                              | A User-Agent without an email got 403, so we could not download it. We could not check whether ETFs are included                                                                                               | Only the access terms are official                                       | Candidate. A contact must be sent, and ETFs may be missing                                                                        |

- How US tickers are searched (user decision on 2026-11-08, #51): Korean and US tickers go in the same securities table, and search is done only in the DB. The US list is built by downloading `supported_tickers.zip` once a week and keeping only Stock and ETF entries on NYSE, NASDAQ, and NYSE ARCA that are in USD and still trading. "Still trading" means the latest `endDate` in the file is within 14 days. In the 2026-11-08 file that is about 12,000 entries.
- US tickers are searched only by ticker. The company name is fetched with the meta API (`/tiingo/daily/<ticker>`, 1 call) the first time the detail is opened and stored, and from then on the ticker can also be found by name. The screen says "Search US tickers by ticker symbol".
- A US ticker that drops out of the list is not deleted, only removed from search, because prices and holding records may point at it. If the new list is smaller than half the current number of active tickers, treat it as a broken file and do not store it.

### Delisted and halted Korean tickers (#97)

This is a user decision from 2026-11-08.

- A day on which the KRX response is not empty counts as a business day for that market. If a ticker is missing from that market's response for **10 business days in a row**, it becomes inactive (`active = false`).
  - A row whose closing price comes as `-` or 0 also counts as a missing day. A halted ticker is caught by this rule only when it is missing from the response or arrives like this.
  - If KRX keeps listing a halted ticker with the previous close and a volume of 0, it is not caught. How to count that case will be decided in [#102](https://github.com/sirloinbh/money-ledger/issues/102) after we check real responses.
  - Holidays (empty responses) do not count as business days.
- Inactive tickers are removed from search, and buying is rejected (#52). Selling is allowed.
- The holdings screen (#53) and the ticker detail show "Trading halted" and the last close.
- If the ticker appears in a response again, it becomes active again.
- A US ticker that drops out of the Tiingo list also gets `active = false`, so the "Trading halted" label applies to both Korean and US tickers.
- Implementation: business days are stored in `krx_market_days`, and the last business day a ticker appeared is stored in `securities.krx_last_seen` (migration 012).
  - If `krx_last_seen` is earlier than the earliest of that market's most recent 10 business days, the ticker becomes inactive.
  - Fetching the same day again does not count it twice. The check uses the most recent 10 stored business days, not the day just stored. So fetching a past date later does not bring a missing ticker back to life.
  - The check does not run right after migration 012 is applied. Tickers that have already been missing for more than 10 business days are cleaned up at the next KRX store.

## How and when to fetch

- Fetch the Korean close, the US close, and the exchange rate all together **every day at 12:00 (Asia/Seoul)**. It runs on weekends too, so the US Friday close (which comes out early Saturday morning in Korea) does not wait until Monday.
  - The Korean close comes out around 8 AM the next day, and the exchange rate around 11 AM on business days. The US close comes out after the market ends, in the early morning Korean time.
- The dates to request, per source, run **from the day after the last confirmed date to the most recent date**. A "confirmed date" is a day when we got a value or recorded "no new value". However, the **most recent date counts as confirmed only when we got a value**. The value for that day may not be out yet, so if it is empty we request it again at the next fetch (#51 review). For the US close, if the most recent date is a Saturday or Sunday, it counts as confirmed even when empty. There is no close on weekends, so we avoid calling again on every hourly retry.
  - The most recent date is yesterday's Korean date for Korean closes, and today's Korean date for the exchange rate.
  - For the US it is the US Eastern date at fetch time. At 12:00 Korean time it is the day before the Korean date, and the US market has already closed that day. The US market closes at 05:00 to 06:00 Korean time regardless of daylight saving time.
  - Even if the server was off for several days, it fills in the missed days. However, it does not request days earlier than 10 days before the most recent date. If there is no confirmed date yet (first run), it requests the most recent 10 days and stores all the values it gets.
- An empty response is not a failure. It means a holiday or that there is no value for that day, so record "no new value" and count that date as confirmed.
- Retry only on an HTTP error or a timeout. Retry every hour until 18:00. If the server was off at 12:00, fetch once the next time it starts.
- **What is fetched**
  - Korea: call once a day per market (KOSPI, KOSDAQ, ETF) and store the closes of **all tickers**. That is about 3,000 to 4,000 rows a day, and the number of calls equals the number of markets regardless of the number of tickers. So even a Korean ticker searched for the first time already has a close.
  - US: one call is needed per ticker, so only **tracked tickers** are fetched. Tracked tickers are held assets (#47), tickers held in mock investing (#53), and tickers whose detail was opened within the last 30 days (#51).
  - If you open the detail of a US ticker that is **not tracked**, or register it as an asset, the latest close is fetched once on the spot and the ticker is added to the tracked tickers. A ticker that dropped out after 30 days is handled the same way when opened again.
  - The Tiingo limit (50 per hour) is shared by on-the-spot fetches and the daily fetch. The daily fetch uses at most 40 per hour, leaving 10 for on-the-spot fetches. Over the limit, the detail screen shows "No price. Try again shortly".
  - The free tier also has a "500 tickers per month" limit. We expect a personal portfolio not to exceed it even with tracked and on-the-spot tickers combined, so we do not block it separately.
- One price record stores the **ticker, base date (trading day), close, currency, source, and fetched time**. If the same ticker and base date come again, it is overwritten.
  - The close is the unadjusted close. For Tiingo, use `close`, not `adjClose`. Handling corporate actions such as stock splits is out of scope.
  - The base date of a US close is the US trading day (US Eastern date). The screen shows that date too.
- One exchange rate record stores the **base date and the USD basic rate**.
- The unit price and exchange rate formats follow ["Quantity, foreign currency, and exchange rate" in AGENTS.project.md](../AGENTS.project.md) (#35). The close is `numeric(20,4)` plus `currency`, and the exchange rate is `numeric(12,4)`.
- The Korean ticker list (ticker code and name) is filled from the daily trading data response. The US ticker list is filled weekly from the Tiingo file, as described in "US ticker list (#51)" above.

## Mock trade fill price

- An order fills at the **latest stored closing price** at that moment. The order record keeps the fill price together with the base date of that close.
  - The Korean close of day D is stored at 12:00 on day D+1. So on the morning of day D+1, orders fill at the close of day D-1.
- The trading-day exchange rate for US stocks (`fx_rate` in AGENTS.project.md) is the **latest stored basic rate at order time**. The order record also keeps the exchange rate base date.
- You cannot order a ticker that has no stored close. Korea fetches all tickers, so this only applies on about the first day of a new listing. For the US, the close is fetched on the spot when the detail is opened.
- If there is no stored exchange rate, you cannot order US stocks, because a USD trade row cannot be stored without an exchange rate (AGENTS.project.md `CHECK ((currency = 'KRW') = (fx_rate IS NULL))`).
- You can order with a close whose base date is old. The order screen shows the base date.
- There is no separate dollar cash (user decision on 2026-11-08, #52). Buying and selling use the account's single KRW cash balance, and for US stocks `amount_krw = round(quantity × fill price × fx_rate)` is computed in SQL `numeric` using the latest basic rate at order time. The fee rate is an account setting (default 0), and tax is not included. Quantity is a whole number of shares. The implementation is `backend/src/mock-orders.ts`.

## Storing API keys

- Keys are read only from the server environment variables `KRX_API_KEY`, `TIINGO_API_KEY`, and `KOREAEXIM_API_KEY`.
  - Locally, keep them in `.env`, which is not uploaded to Git (it is already in `.gitignore`).
  - In `.env.example`, keep only the names without values.
- Keys are used only in the backend.
  - Do not put them in screen responses, logs, or error messages.
  - For sources that support header authentication, send the key in a header, not in the URL, because the URL can end up inside an HTTP error object. Tiingo uses `Authorization: Token ...`.
  - For sources that need the key in the URL, remove the key parameter from the URL before leaving it in a log or an error.
- Where the deployed environment stores them is decided when deployment is connected. Deployment is not connected now.
- If a key is missing or an empty string, treat it as not set. The server then skips that source and records "Price source is not configured". A missing key does not stop the server.

## Implementation (#51)

The shared module is `backend/src/prices/`, and the table is in `database/migrations/009_prices.sql`. Mock investing (#52 to #54) and the asset current price (#47) use it together.

| File                                  | What it does                                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sources.ts`                          | The source interface and the shared request function. Does not put the URL or key in error messages                                                                                                       |
| `krx.ts`, `tiingo.ts`, `koreaexim.ts` | The real sources. The KRX key goes in the `AUTH_KEY` header, the Tiingo key in the `Authorization` header, and the Eximbank key in the URL (not left in errors)                                           |
| `fake.ts`                             | A fake source that needs no key. Weekends are empty (like holidays), and the price changes by date                                                                                                        |
| `fetch.ts`                            | The daily fetch. For each source, it fetches within the last 10 days starting the day after the last confirmed date                                                                                       |
| `scheduler.ts`                        | Checks every minute and fetches at 12:00, and on failure retries every hour until 18:00. If started after 12:00, it fetches once. A DB advisory lock keeps several servers from fetching at the same time |
| `store.ts`                            | Table reads and writes, the tracked tickers (`trackedUsSecurities`), and the Tiingo call limit (`reserveCall`)                                                                                            |
| `router.ts`                           | `GET /api/prices/securities?q=` (search) and `GET /api/prices/securities/:id` (detail; a US ticker that is not tracked is fetched on the spot)                                                            |

- Environment variables: with `PRICE_SOURCE=fake`, all three sources use the fake. With `PRICE_JOBS=off`, the daily fetch does not run (when you start one more server on the same DB).
- Tiingo calls are recorded in `price_api_calls`, and the calls within the last hour are counted. The daily fetch uses up to 40, and the on-the-spot fetch from the screen up to 50. The count survives a server restart.
- `trackedUsSecurities` adds the assets linked to a US ticker with a quantity from #47, and the US tickers held by open mock investing accounts from #53 (holdings of closed accounts are excluded).
- **Not verified with real keys (2026-11-08).** Because key issuance (#85) has not happened yet, the KRX and Eximbank response fields (`OutBlock_1`, `ISU_CD`, `TDD_CLSPRC`, `deal_bas_r`, `result`) and the KRX address (`data-dbg.krx.co.kr/svc/apis/...`) were used as the secondary sources describe them. Once we have the keys, we recheck against real responses. The Tiingo price and meta API fields match the official docs, and the ticker list file was downloaded and checked directly.

## What the screen shows when prices cannot be fetched

"Stale" is based on **calendar days**. If `(today's Asia/Seoul date) - base date > 5 days`, the value is treated as stale. It applies the same way to closes and exchange rates.

| Situation                                                    | Screen                                                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| A stored close exists and is not stale                       | Value at the close and show "Close as of M/D"                                                                          |
| A stored close exists but is stale                           | Value at the last close and show "Price delayed · close as of M/D"                                                     |
| No stored close, but a manually entered current price exists | Value at the manual entry and show "Manual entry · M/D"                                                                |
| Neither a stored close nor a manual entry                    | Show "No price" instead of the value. Leave the asset out of the valuation total and say that some assets are left out |
| The exchange rate is stale (US assets)                       | Convert at the last rate and show "Rate delayed · as of M/D"                                                           |
| No exchange rate (US assets)                                 | Show "No exchange rate" instead of the KRW value and leave it out of the total. The dollar value is still shown        |
| The last fetch failed                                        | Show the last value by the rules above. The failure and its time are kept in the server log                            |

- **A manual entry is used only when there is no fetched close.** Assets without a source (real estate, unlisted, and so on) and tickers that have not received a close yet fall here. If a fetched close exists, the fetched close is used even when it is stale.
- For assets (#47), a stock linked to a ticker uses the fetched close, and unlinked stocks and other assets use the manually entered current price per unit (decided on 2026-11-10). If a linked ticker has no close yet, the manual entry is not mixed in; it shows "No price" and is left out of the total. The implementation and display are in [docs/changes/47-asset-valuation.md](changes/47-asset-valuation.md).
- "5 days" is chosen so that a weekend or a three-day holiday such as Saturday, Sunday, and Monday does not look like a delay. When a weekday closure lasts three days, as with Lunar New Year or Chuseok, "Price delayed" shows for a day or two.

## To revisit later

- If intraday prices become necessary, review the Korea Investment & Securities Open API again. It requires opening an account.
- Funds other than Korean ETFs, crypto, and overseas markets other than the US are out of scope.
- For delisted or halted tickers, the fetched close always takes priority, so it cannot be replaced by a manual entry. If it becomes necessary, consider a per-ticker setting that prefers the manual entry.
