# Choose day trade or long hold from the KakaoTalk chatbot (#312, second part)

Part of epic #303. Issue: <https://github.com/sirloinbh/money-ledger/issues/312>. First part: [312-kakao-chatbot.md](312-kakao-chatbot.md). Built on #307 (`chooseStrategy` in `backend/src/mock/positions.ts`).

## Purpose

After an all-in buy the position waits for the day trade or long hold choice (step 4 of the v2 loop). This lets the user answer from KakaoTalk, and makes 포지션 show the real strategy now that #307 stores it. 유지 / 매도 follow once #310 merges, so #312 stays open.

## Changes

| Area     | Change                                                                                                                                                                                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database | `043_kakao_commands_strategy.sql`: `kakao_commands` also accepts `strategy` and `answer` (the second is for 유지 / 매도). Number 043 is above every file on main (041 is #307, 042 is lane-6's).                                                                                                                                          |
| Backend  | `commands.ts`: `단타` / `day trade` and `장투` / `long hold` call `chooseStrategy(pool, id, strategy, 'kakao')` for every open undecided position of the open account; 포지션 reads the strategy of each held stock's open position. `skill.ts`: extra quick-reply buttons per answer; both words are recorded as one `strategy` command. |
| Docs     | `docs/kakao-webhook-access.md` lists the strategy choice among what the allowlisted user can do.                                                                                                                                                                                                                                          |

## Behavior

- With all-in buys there is normally one undecided position, so the command applies to all undecided ones; the answer names each stock and the rule ("sells by itself at +5% or -3%", or "kept; I ask again each morning").
- Nothing waiting, or a position sold or chosen elsewhere in between (409 from `chooseStrategy`), answers "No position is waiting…" or skips that one; no error.
- While a position is undecided, the 포지션 answer shows 단타 and 장투 as the first two quick-reply buttons.

## Verification

- `npm run check` with `TEST_DATABASE_URL` on a dedicated Postgres 17 container: passed (backend 575 tests, 0 skipped; the frontend step failed once on an unrelated timing flake and passed twice on rerun).
- `backend/test/kakao-skill.integration.test.ts` (real database, recorded Open Builder bodies): 포지션 shows "strategy not chosen" and the two buttons; 단타 stores `day_trade` with source `kakao`; the same word or the other one again changes nothing; 장투 stores `long_hold`; a sold position is not offered; recorded rows. `backend/test/kakao-skill.test.ts`: the new words match.

## Limits and follow-up

- Still to do for #312: 유지 / 매도 (after #310) and the 뉴스 and 수익률 sources (#308; #294's return data is only exposed through its router, so wiring it needs a small exported function from lane-4's `backend/src/benchmark.ts`, asked of the coordinator).
