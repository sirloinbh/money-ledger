# #36 Decide the source of stock price data

Issue: [#36](https://github.com/sirloinbh/money-ledger/issues/36)

## Purpose

Before implementing the current price update (#47) and the mock investing quotes and orders (#51 to #53), decide the following.

- Where to get prices and exchange rates
- How often to fetch and store them
- Where to keep the API keys
- What the screen shows when the price API fails

## User decision (2026-11-06)

- Start with Korean and US stocks.
- Use the closing price fetched once a day.
- Mock investing also fills at the previous close. In the doc we wrote "the latest stored closing price" to match the real behavior.
- Prefer free sources.

## Changes

- Created `docs/price-source.md`.
  - It holds the decision and the candidate comparison tables (4 Korean, 4 US, and 2 exchange rate).
  - It describes the fetch cycle, the mock investing fill price, API key storage, and the screen rules on failure.
- Adopted sources
  - Korea: KRX Open API daily trading data
  - US: Tiingo EOD free Starter
  - Exchange rate: Korea Eximbank current exchange rate API
  - Backup sources are the Public Data Portal stock price info, Alpha Vantage, and Bank of Korea ECOS.
- `.env.example`: added `KRX_API_KEY`, `TIINGO_API_KEY`, and `KOREAEXIM_API_KEY` without values.
- In the "Quantity, foreign currency, and exchange rate" section of `AGENTS.project.md`, replaced the sentence that said "decided in #36" with a link to the new doc.
- Updated `docs/next-steps/README.md`.
  - Changed #60 to done.
  - Changed #36 to decided and added key issuance (#85) as a user step.
- Registered the key issuance step that the user does directly as [#85](https://github.com/sirloinbh/money-ledger/issues/85) (`needs-user`) and linked it as a sub-issue of #79.

## Verification

- This commit only changed docs, so we did not add app tests.
- We researched the candidate information on the web on 2026-11-06.
  - The Tiingo limits, the Alpha Vantage limits, and the update time and terms of the Public Data Portal were confirmed directly on the providers' pages.
  - The KRX call limit and update time, the Eximbank call limit and announcement time, and whether the Tiingo free tier includes EOD were confirmed only from secondary sources. We marked them "Secondary" in the "Confirmed" column of the doc.
- `npm run format:check`: passed ("All matched files use Prettier code style!").
- `npm run standards:check`: passed.
- We checked with a script that every relative link in the 4 changed docs points at a real file. Zero are missing.

## Round 1 review (PR #86)

An independent review agent read the whole PR diff. The comments were 1 must-fix, 9 should-fix, and 6 minor. We addressed all of them in this PR, and split off no issue.

- **Must fix: the range of tickers to fetch**
  - Problem: prices were fetched only for "held and watched tickers". Then a ticker searched for the first time in #51 has no close and cannot be ordered.
  - Fix: for Korea, store all tickers per market. For the US, fetch on the spot when the detail is opened and add the ticker to the tracked tickers.
- **Mock order exchange rate:** aligned with the "trading-day exchange rate" in AGENTS.project.md. Use the latest basic rate stored at order time, and also record the exchange rate base date.
- **Stale value rule:**
  - Added the 5-day delay rule to the exchange rate too.
  - Defined 5 days in Asia/Seoul calendar days.
  - The base date of a US close is the US trading day.
- **Manually entered current price:** used only when there is no fetched close, and shown as "Manual entry · M/D" (the screen text is Korean).
- **Fetch rules:**
  - An empty response (a holiday) is not treated as a failure.
  - The requested dates run from the day after the last base date, up to 10 days at most.
  - Retry only on an HTTP error or a timeout.
  - Use the unadjusted close (Tiingo `close`).
  - Fetch every day at 12:00, including weekends.
- **Wording and candidates:**
  - Changed the wording about the old Eximbank domain to "was shut down".
  - Added Bank of Korea ECOS as a backup candidate for the exchange rate.
  - Narrowed the scope of the KRX verdict wording.
- **Key storage:**
  - Wrote that for sources that support header authentication, the key is sent in a header.
  - Added the three key names to `.env.example` without values.
- **Records:**
  - Left the user decision as a comment on #36.
  - Wrote the link check result in the verification section above.

## Round 2 review (PR #86)

An independent review agent checked the first-round fixes and the final whole diff. It confirmed that all 16 first-round comments were addressed. The new comments were 1 must-fix, 5 should-fix, and 4 minor. We addressed all of them in this PR, and split off no issue. The review is at most 2 rounds, so we do not run a third.

- **Must fix: the US close date**
  - Problem: we wrote the most recent date of the US close as "yesterday in US Eastern time". Then the close is always fetched a day late.
  - Fix: changed to "the US Eastern date at fetch time". At 12:00 Korean time, the US market has already closed that day.
- **Filling in missed dates:**
  - A day with an empty response also counts as a "confirmed date".
  - Days earlier than 10 days are not requested.
  - On the first run, request the most recent 10 days.
- **On-the-spot fetch for US tickers:** opening a US ticker that is not tracked fetches it right away. A ticker that dropped out of tracking after 30 days is handled the same way when opened again.
- **Tiingo limit:**
  - The daily fetch uses at most 40 per hour and leaves 10 for on-the-spot fetches.
  - Over the limit, show "No price. Try again shortly" (the screen text is Korean).
- **When there is no exchange rate:** we wrote that mock orders for US stocks are blocked. This matches the `fx_rate` CHECK in AGENTS.project.md.
- **Holiday wording:** fixed so that the "three-day holiday" and the Lunar New Year and Chuseok wording agree.
- **Minor:**
  - Changed the number of Korean rows to "about 3,000 to 4,000 rows".
  - Wrote that a key that is an empty string counts as no key.
  - Left the setting to prefer manual entry for delisted tickers in "To revisit later".
  - Added a phrase to AGENTS.project.md defining the mock order exchange rate.

## Limits and follow-up work

- Recheck the values confirmed only from secondary sources against the official guide after the keys are issued (#85), and fix this doc.
- The price storage table, the fetch job, and the screens are implemented in #47 and #51.
- Whether to keep dollar cash separately is decided in #52.
