# Kakao skill webhook: public access design (#314)

Status: design only. Nothing here is deployed. Choosing the hosting route and every real AWS or production change need the user's decision (see "Open decisions"), and the first real round trip needs the keys from #304.

## Why this exists

Kakao i Open Builder calls the chatbot from Kakao's servers, so the skill endpoint of #312 must be reachable over public HTTPS. Everything else in Money Ledger is one person's private data with no login of its own, and `AGENTS.md` requires private access to be designed before any public exposure. The rule of this design: **exactly one path is public, and it is safe to be public because it answers nothing without two secrets.**

## What is public

| Path                | Public                                    | Why                                                                            |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| `POST /kakao/skill` | Yes                                       | The only thing Open Builder calls                                              |
| Everything else     | No (`/api/*`, the web app, `/internal/*`) | Private data; reached only through the shared sign-in or from the home network |

The public entry must forward only `POST /kakao/skill` to the API and refuse every other method and path before they reach the app (a 404 from the edge, not from Express). A request to any other path from outside must fail; that is part of "done" for #314 and is tested with a real request from outside, not only in unit tests.

`/kakao/skill` is deliberately not under `/api`: the `/api` prefix carries the shared sign-in, the rate limit and the OpenAPI table, and none of those fit a webhook that Kakao calls without a browser session. A route under `/api` would also tempt someone to publish `/api` as a whole.

## Checks, in order (implemented in #312, `backend/src/kakao/skill.ts`)

1. **Edge rate limit** (hosting layer, see below) and the app's own limit of 60 requests a minute per client IP, counted before anything else, so a flood never reaches the secret comparison.
2. **Method**: only `POST`.
3. **Shared secret**: the `x-kakao-skill-secret` request header must equal `KAKAO_SKILL_SECRET` (16+ characters, random). Both sides are hashed with SHA-256 and compared with `timingSafeEqual`, so response time does not reveal how much of a guess was right. The same value is entered once in Open Builder as the skill's request header.
4. **Body shape**: a 16 kB JSON limit, parsed only after the secret check, and only `userRequest.utterance` and `userRequest.user.id` are read.
5. **User allowlist**: `userRequest.user.id` must be in `KAKAO_ALLOWED_USER_IDS`. The ID is read from the chatbot's own first message and set in the environment, not in git.
6. **Fail closed**: if either setting is missing, short or empty, the endpoint refuses every request.

A failure at step 2, 3, 5 or 6 returns the same `403 {"error":"Not allowed"}` with no data and no hint of which check failed. Only a correct secret together with a listed user ID gets a real answer.

### What a leaked secret or user ID allows

- Secret alone (without a listed user ID): nothing; step 5 refuses. User IDs are not secrets in themselves, but they are not published.
- Both: the read-only commands (상태, 포지션, 뉴스, 수익률) and, after #312 is finished, the strategy and keep-or-sell answers for a **mock** account. No real money, no ledger or portfolio data, no setting changes. Rotating `KAKAO_SKILL_SECRET` in the environment and in Open Builder ends the exposure.

## What is logged

- Refusals: the reason (`method`, `secret`, `user`, `body`, `not-configured`) as one JSON line. Never the secret, the user ID, the request body or the caller's headers.
- Commands: the command name and the result (`ok`, `unavailable`, `error`, `timeout`) as a JSON line and as a row in `kakao_commands`. Never the user ID and never the text the user typed.
- The shared request log adds method, path, status and duration for every request.

Retention follows the platform default for container logs; `kakao_commands` rows carry no personal data. Neither is shipped to a third party.

## Hosting route (open decision)

Two routes fit; the choice is the user's (#314 task 2). Neither is applied by this document.

| Route                                                                | How                                                                                                                               | For                                                                       | Against                                                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A. Shared AWS infrastructure (`sirloinbh/shared-aws-infrastructure`) | An HTTPS front (load balancer or API gateway style) forwards only `POST /kakao/skill` to the API and applies a request rate limit | A stable URL with a managed certificate; nothing runs on the home network | Real AWS changes (`terraform apply`, IAM), recurring cost, the user's OK                |
| B. Tunnel from the home server                                       | A tunnel exposes one hostname and one path to the API port on `127.0.0.1`                                                         | No new cloud resources                                                    | Depends on the home machine being up; the tunnel's access rules must be set to one path |

Recommendation: A if the API already runs on the shared AWS stack when this is exposed; otherwise B. Either way the edge rule is the same (one method, one path) and the app checks above stay on.

## Rollout order

1. #312 merged: the endpoint exists and refuses everything without settings.
2. #304 done by the user: Kakao developer keys, channel and Open Builder bot.
3. User picks the route above; any AWS or production change is applied only with the user's OK.
4. Set `KAKAO_SKILL_SECRET` and `KAKAO_ALLOWED_USER_IDS` on the server, register the skill URL and header in Open Builder.
5. Verify: a real message from the user's KakaoTalk gets a reply; a request without the secret gets 403; a request to any other path from outside fails.

## Done when (from #314)

- This document is merged.
- A request to any other path from outside fails.
- A real KakaoTalk message gets a reply and a request without the secret is refused.

The last two are the user-only steps of #314 and stay open after this document merges.
