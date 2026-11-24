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
- The daily summary is skipped, with an info log and no job failure, when KakaoTalk is not connected, there is no open account, a holding has no stored close (the total would be unknown), or a holding's latest close is not from that day.
- The comparison with the deposit, Buffett (20% a year) and Renaissance (66% a year) is an optional `comparison` provider on the queue. It is not given yet, so the message leaves the line out; it is added when #294 lands.

## Review round 1 (separate read-only agent, no blocking findings)

Fixed in a follow-up commit: a pick is now three messages (story, pick and reasoning, buy) so the reasoning is not cut by Kakao's 200 characters, and the 단타 / 장투 question is the first line of the buy message so it is never the line that is cut; the daily summary is skipped when a holding has no close for that day (price fetch failed or market closed), instead of sending an earlier day's value as current; a revoked connection stops the rest of an event and logs once; `link` is now a required option of `createNotifier`; tests cover the no-valuation and stale-price skips, what a failing send leaves behind, and the 200-character limit.

## Step 1b: value the daily summary at live prices (coordinator report)

KRX daily closes are stored around 8 AM the next day, so at 19:10 no Korean holding has that day's stored close, and the step 1 rule "skip when a holding's latest close is not from that day" would have skipped the summary almost every day. Replaced:

- Each Korean holding is valued at the live price (`kis.quote(symbol).price`, injected as `livePrice`), else at the latest stored close, else at cost. The multiplication, rounding and return are SQL numeric (`valueForSummary` in `backend/src/kakao/daily-summary.ts`); only whole-won integers are added in code.
- One missing price never skips the summary. The message adds a line such as `Prices: 1 live, 1 last close, 1 at cost` unless every holding is live.
- The summary still skips when KakaoTalk is not connected or there is no open account. It runs weekdays only; the shared KRX business-day check replaces that when #321 lands.
- Open question for lane-1 (owner of `prices/kis*.ts`): `kis.quote()` throws `market_closed` when the order book is empty, which is the normal state at 19:10. If the real KIS answers an empty book after the close, the live price is never used and the summary falls back to the stored close (marked as such). A price-only read on `KisSource` would fix that. This cannot be checked without real keys (#304).

## Verification

- Daily summary valuation (integration test): one holding priced live, one at the last close, one at cost gives the expected total and return (-3.35%) and the `Prices:` line; with no live source it falls back to close and cost.
- Backend unit tests (`kakao-notifier.test.ts`): each event's exact text, a stop loss with a negative gain, the summary with and without the comparison, each event sent through the fake messenger, a retry that succeeds, two failures logged with no amounts and no throw, a revoked connection not retried, the second message of a pick surviving the first one's failure.
- DB integration test (`kakao-daily-summary.integration.test.ts`, dedicated Postgres 17 test DB, not skipped): an account with no holdings is summarized with and without a comparison; not connected and no account send nothing and raise nothing; a failing send does not fail the job.
- `npm run check` with `TEST_DATABASE_URL` on a dedicated Postgres 17 test DB: passed, no skipped DB tests.

## Limits and follow-up

- The calls into the jobs of #308 (pick and buy), #309 (day trade sale) and #310 (morning question) are added as those cards merge: one line each, in files owned by lanes 2, 1 and 6, so the owners are told.
- The daily summary leaves out positions for now (the positions table is in #307).
- The summary comparison waits for #294.
