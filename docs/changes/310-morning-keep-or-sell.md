# Ask each trading morning whether to keep or sell long holds (#310)

Step 6 of mock investing v2 ([#303](https://github.com/sirloinbh/money-ledger/issues/303)). Stacked on #307 (`sellPosition()` and the position records).

## Changes

| File                                                  | Change                                                                                                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database/migrations/042_mock_position_questions.sql` | `mock_position_questions` (one per long hold per day, status and who answered) and `krx_holidays` (weekday closures, three seeded days)                                                               |
| `backend/src/mock/long-hold.ts`                       | `runLongHoldTick` (opens, sells queued, closes), `answerQuestion`, `GET /api/mock/accounts/:accountId/next-day-questions`, `POST /api/mock/positions/:id/next-day`, pg-boss queue `long-hold-morning` |
| `backend/src/mock/positions.ts`                       | `mockPositionsRouter` takes an `extend` callback so the next-day route is added without an import cycle                                                                                               |
| `backend/src/app.ts`, `server.ts`, `openapi.ts`       | Wiring lines (append-only): two mounts, one queue, two operations                                                                                                                                     |
| `frontend/src/mock-keep-or-sell.tsx`                  | "Keep or sell" card with Keep and Sell buttons (one line in `mock-trading.tsx`); shows nothing when there is no question                                                                              |

## Rules

- **08:30 KST** on a business day (a weekday not in `krx_holidays`): one question for each open `long_hold` position bought before today. One per position and day, so repeated ticks ask once.
- **keep** closes the question until tomorrow. **sell** at or after 09:00 sells at the best bid at once (best bid, fee, tax as in #307); before 09:00 the answer is `sell_queued` and the 09:00 tick sells it. A sale the market cannot fill yet stays queued until 15:30, then the question is `expired` and the position is kept.
- **No answer by 15:00**: the position is kept (`kept`, `answer_source = 'auto'`) and the question closes; it is asked again the next business day. Answering after 15:00 or twice is a 409; no question today is a 404. Of two answers sent at once, only one claims the row.
- Questions of earlier days that are still waiting (server was down) are closed on the next tick.
- The job runs every minute from 08:00 to 15:59 on weekdays (`* 8-15 * * 1-5`, Asia/Seoul) and is idempotent. All times come from the `now` it is given.

## Choices made without asking

- **Holidays come from a hand-kept table** (`krx_holidays`), because the repo has no KRX holiday source. It holds 2026-12-25, 2026-12-31 and 2027-01-01 only; the KRX calendar's other closures (for example Lunar New Year and Chuseok) still have to be added. A missing day only asks a question on a closed day; a sell answer then waits for the market. A follow-up for a real holiday source is worth filing.
- The sell answer before 09:00 is queued instead of rejected, so a late-night or early answer from KakaoTalk still works.

## Checks

- DB integration tests on a dedicated test DB (Postgres 17), none skipped: `mock-long-hold.integration.test.ts` uses a fake clock: no question at 08:29 and one at 08:30, only long holds bought before today, no repeat, keep, answering twice, sell at 09:05 with fee and tax (1,400,000 − 210 − 2,800), sell queued at 08:45 and sold by the 09:00 tick (once), a queued sale in a closed market that expires at 15:30, the 15:00 timeout and a 409 for a late answer, a stale open question closed the next day, no question on a listed holiday, Saturday or Sunday, and a 404 without a question. Eight other DB test files got `mock_position_questions` in their DROP lists.
- Frontend: `mock-keep-or-sell.test.tsx` (answer, keep, server reason, nothing shown).
- Browser check (`PRICE_SOURCE=fake`, API 3196, Vite 5296, test DB with a seeded long hold and open question), Samsung Electronics: 390×844 shows the card with Keep and Sell, no horizontal scroll (page width 390), and pressing Sell showed the server's "The question closed at 15:00" because the check ran at 21:30 KST; 1440×900 same card, no overflow (page width 1440). Answering during the day is covered by the fake-clock tests, not the browser. Console errors were the known Pretendard 403s.
- Real KIS key not checked: waiting on #304.
