# Answer the morning keep-or-sell question from the KakaoTalk chatbot (#312, last part)

Closes #312. Issue: <https://github.com/sirloinbh/money-ledger/issues/312>. Earlier parts: [312-kakao-chatbot.md](312-kakao-chatbot.md), [312-kakao-strategy-commands.md](312-kakao-strategy-commands.md), [312-kakao-news-returns.md](312-kakao-news-returns.md). Built on #310 (`answerQuestion` in `backend/src/mock/long-hold.ts`).

## Purpose

Each trading morning the app asks, for every long hold, "keep or sell?" (#310). This lets the user answer from KakaoTalk (step 6 of the v2 loop).

## Changes

| Area    | Change                                                                                                                                                                                                                                                                                                                                                |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend | `commands.ts`: `유지` / `keep` and `매도` / `sell` answer every open question of today through `answerQuestion(..., 'kakao')`; 포지션 adds 유지 / 매도 buttons while a question is open. `skill.ts` passes the clock and the KIS source (`app.ts` defaults both to the app's own); both words are recorded as `answer` (allowed since migration 045). |
| Tests   | `backend/test/kakao-skill.integration.test.ts`: keep, sell before the open (queued), sell after the open (sold at the best bid, position closed), answering twice, no question, past 15:00, buttons.                                                                                                                                                  |

## Behavior

- The question belongs to today's date in Asia/Seoul; the clock is injectable so tests do not depend on the real time.
- Before 09:00 a sale is `queued` and goes out at the next tick (#310); after it, it sells at the best bid at once. Past 15:00 or already answered answers "already answered or has closed".
- Each answer is recorded in `kakao_commands` as `answer` with its result and without the user ID.

## Verification

- `npm run check` with `TEST_DATABASE_URL` on a fresh Postgres 17 container (every migration applied by `resetDatabase`): passed (backend 657 tests, 0 skipped); `npm run knip` has no Kakao findings.

## Limits and follow-up

- #312 is complete. The real round trip through Open Builder waits on #304 and #314 (user steps).
