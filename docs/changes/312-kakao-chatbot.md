# Take mock investing commands from a KakaoTalk chatbot (#312, first part)

Part of epic #303 (mock investing v2). Issue: <https://github.com/sirloinbh/money-ledger/issues/312>.

## Purpose

Step 8 of mock investing v2 takes every input from KakaoTalk. This adds the Kakao i Open Builder skill webhook with its two security checks, and the commands that need nothing from #307 or #310: 상태, 포지션, 뉴스, 수익률. The strategy commands (단타 / 장투) and the morning answer (유지 / 매도) come in a second PR once #307 and #310 merge, so #312 stays open until then.

## Changes

| Area     | Change                                                                                                                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database | `039_kakao_commands.sql`: `kakao_commands` (time, command, result). No Kakao user ID and no typed text is stored.                                                                                                                                                                                                         |
| Backend  | `backend/src/kakao/skill.ts` (the middleware chain: rate limit, secret check, 16 kB JSON parser, user allowlist, command, 4 s timeout, record), `backend/src/kakao/commands.ts` (parsing and the four commands, reply text from the #311 builders). `app.ts` mounts it at `/kakao/skill` before the app-wide JSON parser. |
| Settings | `.env.example`: `KAKAO_SKILL_SECRET` (16+ characters), `KAKAO_ALLOWED_USER_IDS` (comma-separated)                                                                                                                                                                                                                         |

## Behavior

- `POST /kakao/skill` is not under `/api`, so it is not behind the shared sign-in; it is the only route that is meant to become public (#314). It is a plain middleware chain, not a Router, so the sign-in-guarded OpenAPI table does not list it; the access design is in `docs/kakao-webhook-access.md` (#314).
- Order of checks: rate limit per client IP (60 a minute) → method is POST → secret header `x-kakao-skill-secret` (SHA-256 of both sides, then `timingSafeEqual`) → body shape → `userRequest.user.id` against the allowlist. A wrong secret, a wrong user, a wrong method and a server with no settings all get the same `403 {"error":"Not allowed"}` and read nothing from the database.
- Commands match exactly after trimming and lower-casing: `상태`/`status`, `포지션`/`positions`, `뉴스`/`news`, `수익률`/`returns`. Anything else gets the command list. Every answer carries the four quick-reply buttons.
- 뉴스 and 수익률 read from optional sources (`kakaoSkill.sources`) that #308 and #294 fill in. With no source they answer "not ready yet". `server.ts` does not wire a source yet; that is a one-line follow-up when those PRs merge.
- 포지션 shows "strategy not chosen" for every position until #307 stores the choice.
- A command that takes more than 4 s answers "took too long" (Kakao drops an answer after 5 s). A command that throws answers "Something went wrong". Both are recorded.
- Logging: refusals log only the reason; commands log the command and result. The user ID and secret are never logged (a test checks this).

## Verification

- `npm run check` with `TEST_DATABASE_URL` on a dedicated Postgres 17 container (`money-ledger-test-lane-5`, port 15495), no skipped DB tests: passed (backend 499 tests, 0 skipped).
- `backend/test/kakao-skill.test.ts`: settings parsing, command matching, the same refusal for missing secret, wrong secret and wrong user (database never touched), bad body, GET refused, no settings refuses everyone, 429, and no secret or user ID in the log.
- `backend/test/kakao-skill.integration.test.ts` on a dedicated Postgres 17 test DB: a recorded Open Builder request body for every command; no account; 상태 and 포지션 numbers computed in SQL; 뉴스 and 수익률 with and without a source; unknown command; failing source; timeout; recorded rows contain neither the user ID nor the typed text; a refused request is not recorded.

## Limits and follow-up

- Not verified against real Kakao: the request and response shapes follow Open Builder's skill documentation (version 2.0, `simpleText`, `quickReplies`); the real round trip is #314 and needs the keys from #304.
- Open Builder lets a skill send a request header; confirm it accepts `x-kakao-skill-secret` when the skill is registered.
- Still to do for #312: 단타 / 장투 (after #307), 유지 / 매도 (after #310), the 뉴스 and 수익률 sources.
