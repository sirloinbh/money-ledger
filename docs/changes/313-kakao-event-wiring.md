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
- If the first message of a pick fails twice, the second is still sent.
- The daily summary is skipped, with an info log and no job failure, when KakaoTalk is not connected, there is no open account, or a holding has no stored close (the total would be unknown).
- The comparison with the deposit, Buffett (20% a year) and Renaissance (66% a year) is an optional `comparison` provider on the queue. It is not given yet, so the message leaves the line out; it is added when #294 lands.

## Verification

- Backend unit tests (`kakao-notifier.test.ts`): each event's exact text, a stop loss with a negative gain, the summary with and without the comparison, each event sent through the fake messenger, a retry that succeeds, two failures logged with no amounts and no throw, a revoked connection not retried, the second message of a pick surviving the first one's failure.
- DB integration test (`kakao-daily-summary.integration.test.ts`, dedicated Postgres 17 test DB, not skipped): an account with no holdings is summarized with and without a comparison; not connected and no account send nothing and raise nothing; a failing send does not fail the job.
- `npm run check`: see the result below.

## Limits and follow-up

- The calls into the jobs of #308 (pick and buy), #309 (day trade sale) and #310 (morning question) are added as those cards merge: one line each, in files owned by lanes 2, 1 and 6, so the owners are told.
- The daily summary leaves out positions for now (the positions table is in #307).
- The summary comparison waits for #294.
