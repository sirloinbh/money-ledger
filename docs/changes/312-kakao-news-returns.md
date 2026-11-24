# Wire the chatbot's 뉴스 and 수익률 to real data (#312, third part)

Part of epic #303. Issue: <https://github.com/sirloinbh/money-ledger/issues/312>. Earlier parts: [312-kakao-chatbot.md](312-kakao-chatbot.md), [312-kakao-strategy-commands.md](312-kakao-strategy-commands.md).

## Purpose

The first part answered 뉴스 and 수익률 with "not ready" because #308 and #294 had not merged. Both have, so the commands now read them.

## Changes

| Area    | Change                                                                                                                                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend | `backend/src/kakao/commands.ts`: `databaseSources` reads today's pick (`pickOfDay`, #308) and the account return with the deposit, Buffett and Renaissance returns (`accountReturn`, `benchmarkReturns`, #294). `kakaoSkill.sources` stays as an override so tests can replace either one. |
| Tests   | `backend/test/kakao-skill.integration.test.ts`: a stored pick is shown with its whole reason and another day's pick is not; 수익률 over 5 days with and without a stored base rate (deposit "n/a" then +0.04%).                                                                            |

## Behavior

- 뉴스 shows the headline, economic effect, pick and reason of today's `daily_picks` row. The send-to-me builder cuts text at 200 characters; the chatbot shows up to 1,000, so the reason is not cut mid-sentence.
- 수익률 shows the account's time-weighted return and the three benchmarks over the same days, with the dates. A benchmark that is not known (the deposit without a stored base rate) shows `n/a`, as in the daily summary. With no day after the account's start it says there is nothing to compare yet.
- Figures come from SQL (`numeric`, rounded half away from zero); the chatbot only formats the strings.

## Verification

- `npm run check` with `TEST_DATABASE_URL` on a dedicated Postgres 17 container, fresh database with every migration: passed (backend 622 tests, 0 skipped); `npm run knip` has no Kakao findings.

## Limits and follow-up

- Still to do for #312: 유지 / 매도, after #310 merges (PR #332).
