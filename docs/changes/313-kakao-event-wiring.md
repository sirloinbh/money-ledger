# Send every mock investing event to KakaoTalk (#313)

Part of epic #303. Issue: <https://github.com/sirloinbh/money-ledger/issues/313>. Built on #311 (send-to-me).

## Purpose

The pick, the buy, a day trade sale and the morning question each happen in their own job. This adds one notifier those jobs call, so each event reaches KakaoTalk as it happens, and a once-a-day account summary.

## Step 1: the notifier and the daily summary (no dependency on #308, #309, #310)

| File                                                                             | Change                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/kakao/notifier.ts`                                                  | `createNotifier(messenger, { link, log, retryDelayMs })` returns `notify(event)` for the typed events `pick-bought`, `day-trade-sold`, `long-hold-question`, `daily-summary`. One retry after 2 s; never throws; a failure is logged                                            |
| `backend/src/kakao/messages.ts`                                                  | Event builders: `pickBoughtMessages` (the news story, then the buy and the 단타 / 장투 question), `dayTradeSoldMessage` (take profit or stop loss, price, net gain, new capital), `longHoldQuestionMessage` (유지 / 매도, no answer by 15:00 means keep), `dailySummaryMessage` |
| `backend/src/kakao/daily-summary.ts`                                             | `kakaoDailySummaryQueue`: pg-boss queue at 19:10 KST on weekdays (after the daily price fetch and the 19:05 net worth save) that sends the open mock account's summary                                                                                                          |
| `backend/src/server.ts`                                                          | Creates the notifier and registers the queue (append-only)                                                                                                                                                                                                                      |
| `backend/test/kakao-notifier.test.ts`, `kakao-daily-summary.integration.test.ts` | Tests, below                                                                                                                                                                                                                                                                    |

How a job uses it (one call, after the trade is committed): `await notifier.notify({ type: 'day-trade-sold', reason: 'take-profit', ... })`. It never throws and never touches the trade, so a send failure cannot roll one back.

Behavior notes:

- A revoked connection is not retried (reconnecting in Settings is the fix); it is logged with `revoked: true`.
- The log line holds the event type and the error message only, never the message text (it carries amounts).
- If one message of a pick fails twice (not revoked), the later ones are still sent.
- The daily summary is skipped, with an info log and no job failure, when KakaoTalk is not connected or there is no open account. (Step 1b below replaced the stored-close skips: a holding without a close is valued at cost.)
- The comparison with the deposit, Buffett (20% a year) and Renaissance (66% a year) is an optional `comparison` provider on the queue (wired in step 1c).

## Review round 1 (separate read-only agent, no blocking findings)

Fixed in a follow-up commit: a pick is now three messages (story, pick and reasoning, buy) so the reasoning is not cut by Kakao's 200 characters, and the 단타 / 장투 question is the first line of the buy message so it is never the line that is cut; (the stale-close skip added here was replaced in step 1b below); a revoked connection stops the rest of an event and logs once; `link` is now a required option of `createNotifier`; tests cover what a failing send leaves behind and the 200-character limit.

## Step 1b: value the daily summary at live prices (coordinator report)

KRX daily closes are stored around 8 AM the next day, so at 19:10 no Korean holding has that day's stored close, and the step 1 rule "skip when a holding's latest close is not from that day" would have skipped the summary almost every day. Replaced:

- Each Korean holding is valued at the live price (`kis.quote(symbol).price`, injected as `livePrice`), else at the latest stored close, else at cost. The multiplication, rounding and return are SQL numeric (`valueForSummary` in `backend/src/kakao/daily-summary.ts`); only whole-won integers are added in code.
- Quotes run one at a time (KIS limits calls per second); a failed quote is logged by symbol and code (`kakao_daily_summary_quote_failed`) and that holding uses its stored close. A close more than 5 days old is counted apart in the note (`1 old close (over 5 days)`).
- One missing price never skips the summary. The message adds a line such as `Prices: 1 live, 1 last close, 1 at cost` unless every holding is live.
- The summary still skips when KakaoTalk is not connected or there is no open account. It runs weekdays only; the shared KRX business-day check replaces that when #321 lands.
- The live price is `kis.lastPrice(symbol)` (#325): the current-price endpoint alone, which works after the close with an empty order book. (`kis.quote()` throws `market_closed` then, so it was not used.) The real KIS answer after hours is not checked until #304.

## Step 1c: the comparison line in the daily summary (#294 landed)

`backend/src/kakao/comparison.ts` (`comparisonFor`) takes the deposit, Buffett (20% a year) and Renaissance (66% a year) returns from `accountReturn` and `benchmarkReturns` in `backend/src/benchmark.ts` (lane-4 agreed to the two `export` keywords added there) over the same days as the account's own return, and the queue passes it as `comparison`. No period yet (no day after the account's start) leaves the line out; a deposit without a stored base rate shows `Deposit n/a`. The comparison covers the account's own return period, which ends at the last stored daily snapshot, so it can end a day before the live-valued headline return (the headline is a simple return on the initial cash; the comparison uses the time-weighted period of #294). A comparison that cannot be read is logged (`kakao_daily_summary_comparison_failed`) and the summary goes out without it. `backend/test/kakao-comparison.integration.test.ts` checks the three figures against a hand calculation (14 days: Buffett 0.70%, Renaissance 1.96%, deposit 0.10% at 2.5%), the unknown deposit, no period, the message text, and a provider that throws (the summary still goes out). `npm run check` and `npm run knip` pass for this step.

Review round 1 (separate read-only agent, no blocking findings): the provider failure is now caught and logged, comments and this record updated.

## Step 2: the day trade sale message (#309 merged)

`dayTradeQueue` (lane-1, `backend/src/mock/day-trade.ts`) got an optional `onSold(sold)` option, called after a run that sold something (two lines changed there; lane-1 asked me to add the call). `backend/src/kakao/day-trade-events.ts` (`notifyDayTradeSales`, wired in `server.ts`) sends one `day-trade-sold` message per sale: take profit or stop loss, the sell price, the net gain after fees and tax (from the saved position), and the account's value after the sale. It never throws, so a send failure cannot undo a sale. Carried-over day trades are not messaged here: the morning keep-or-sell message covers them (#310 step). `backend/test/kakao-day-trade.integration.test.ts` runs the real queue with a scripted price: nothing sold sends nothing; a take profit at 73,605 sends `142 sh at ₩73,605`, `Net gain: ₩473,745 (+4.76%)`, `Capital: ₩10,473,745`; a stop loss with two failing sends leaves the position closed with `stop_loss`; a successful stop loss message; a sale whose capital is unknown is logged and not sent.

The handler awaits the sends: a failing send is retried once after 2 s, so a run with sales can end a few seconds late and the next minute's check waits (singleton). The capital line uses the daily summary's valuation (latest stored close, cost when a holding has none) once per account per run, so two sales in one run show the value after both.

Review round 1 (separate read-only agent, no blocking findings): the capital valuation, the guard order and the skipped-sale log, the extra tests and this note. `npm run check` and `npm run knip` pass.

## Step 3: the pick message (#308 merged)

`runDailyPick` (lane-2, `backend/src/picks/run.ts`) got an optional `onBought(pickId)` dependency, called by `buyFor` once the buy is saved and the order is linked, both for a new pick and for the retry of a stored pick whose buy failed earlier. A throwing hook is logged as `pick_notify_failed` and never turns the saved buy into a failed one. `backend/src/kakao/pick-events.ts` (`notifyPickBought`, wired in `server.ts`) reads the story, effect and reasoning from `daily_picks`, the stock from `securities`, and the quantity, the price and the cost (order amount plus fee, added in SQL) from the order, then sends the three `pick-bought` messages (news and effect, the pick and why, and the day-trade-or-long-hold question). It never throws. `backend/test/kakao-pick.integration.test.ts` runs the real pick run and all-in buy: three messages with `142 sh at ₩70,100` and `Cost: ₩9,955,693`; a second run sends nothing more; a pick whose buy failed is messaged only when the retry buys it; failing sends and a throwing hook leave the buy in place; two runs that overlap on one pick send once.

A pick is messaged at most once: `setPickOrder` now returns whether this run linked the order (the `UPDATE ... WHERE order_id IS NULL` is the claim), and only that run sends. A crash between the link and the send loses the message but never doubles it. The sends are awaited (the Kakao call has a 10 s timeout and a failed send is retried once after 2 s), so the pick job ends a few seconds later at worst; the buy is already saved. Review round 1 (separate read-only agent, no blocking findings): the claim, this note and the overlap test. `npm run check` fails here only in the three migration tests because main has two `043` migrations (not from this change).

## Step 4: the keep-or-sell question message (#310 merged)

`runLongHoldTick` (lane-6, `backend/src/mock/long-hold.ts`) now adds `RETURNING position_id` to the question insert and returns `openedPositionIds`, the positions asked by this tick only (a later tick that asks nothing returns none). `longHoldQueue` got an optional fourth argument `onOpened(positionIds)`, called after a tick that opened questions. `backend/src/kakao/long-hold-events.ts` (`notifyLongHoldQuestions`, wired in `server.ts`) sends one `long-hold-question` message per position: the price is the live price when KIS answers, else the last stored close, else the buy price; the return is that price against the money spent on the buy, computed in SQL numeric (fees are left out, as in the message wording "last price"). It never throws, so a send failure leaves the question open for the web screen and the chatbot. One existing assertion in `mock-long-hold.integration.test.ts` now expects `openedPositionIds`. `backend/test/kakao-long-hold.integration.test.ts` runs the real queue with a fake clock: nothing before 08:30; at 08:30 one message with `last ₩77,110, +10.00%`; a later tick sends nothing; a failing quote falls back to the stored close (`-3.00%`) and then to the buy price (`0.00%`); failing sends leave the question `open`; a dollar position is skipped and logged without stopping the next.

A question is messaged at most once: the insert's `RETURNING` lists only the rows this tick created, so a later or concurrent tick sends nothing; a crash between the insert and the send loses the message (the question stays open on the web screen and for the chatbot) and never doubles it. `server.ts` does not await the sends: one live quote and one send per position can take many seconds, and the next minute's tick (the 09:00 sales) must not wait. Only Korean stocks are messaged (the all-in buy refuses the rest; a dollar price must not be read as won), and a zero buy amount gives `0.00%` instead of an error. Review round 1 (separate read-only agent, no blocking findings): these four points. `npm run check` and `npm run knip` pass.

## Step 5: the daily summary skips KRX holidays (#321 merged)

`sendDailySummary` now asks the shared `isBusinessDay` (`backend/src/prices/krx-calendar.ts`) first and logs `kakao_daily_summary_skipped` with reason `not-business-day` on a holiday; the cron still skips weekends. `backend/test/kakao-daily-summary.integration.test.ts` covers a holiday (2026-12-25), a Saturday, and the business day before. A database error in `isBusinessDay` fails the job and pg-boss retries it, like the other reads. This closes the "weekday-only until #321" limit. Review round 1 (separate read-only agent, no blocking findings): the test now keeps the migrated `krx_holidays` table and only clears its rows. `npm run check` and `npm run knip` pass.

## Verification

- Daily summary valuation (integration test): one holding priced live, one at the last close, one at cost gives the expected total and return (-3.35%) and the `Prices:` line; with no live source it falls back to close and cost.
- Backend unit tests (`kakao-notifier.test.ts`): each event's exact text, a stop loss with a negative gain, the summary with and without the comparison, each event sent through the fake messenger, a retry that succeeds, two failures logged with no amounts and no throw, a revoked connection not retried, the second message of a pick surviving the first one's failure.
- DB integration test (`kakao-daily-summary.integration.test.ts`, dedicated Postgres 17 test DB, not skipped): an account with no holdings is summarized with and without a comparison; not connected and no account send nothing and raise nothing; a failing send does not fail the job.
- `npm run check` with `TEST_DATABASE_URL` on a dedicated Postgres 17 test DB: passed, no skipped DB tests.

## Limits and follow-up

- The calls into the jobs of #308 (pick and buy), #309 (day trade sale) and #310 (morning question) are added as those cards merge: one line each, in files owned by lanes 2, 1 and 6, so the owners are told.
- The daily summary leaves out positions for now (the positions table is in #307).
