# Kakao skill webhook: public access design (#314)

Status: design, code guards and a Terraform PR ([shared-aws-infrastructure#118](https://github.com/sirloinbh/shared-aws-infrastructure/pull/118)). Nothing here is deployed. The user chose the shared AWS infrastructure on 2026-11-26; `terraform apply` and every other real AWS or production change still need the user's separate OK, and the first real round trip needs the keys from #304.

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

0. **Exact path**: only `/kakao/skill` itself is the webhook. Any longer path (`/kakao/skill/x`) is a 404 before the limiter, the secret or the body parser run (#314, tested).
1. **App rate limit**: 60 requests a minute per client IP, counted before the secret comparison, so a flood never reaches it. Behind CloudFront and the proxy the address the app sees is the last hop (the CloudFront edge), so the limit is really per edge location; it still caps a flood from one place, and a WAF rate rule (about $6 a month) is the option if more is ever needed.
2. **Method**: only `POST`.
3. **Shared secret**: the `x-kakao-skill-secret` request header must equal `KAKAO_SKILL_SECRET` (16+ characters, random). Both sides are hashed with SHA-256 and compared with `timingSafeEqual`, so response time does not reveal how much of a guess was right. The same value is entered once in Open Builder as the skill's request header.
4. **Body shape**: a 16 kB JSON limit, parsed only after the secret check, and only `userRequest.utterance` and `userRequest.user.id` are read.
5. **User allowlist**: `userRequest.user.id` must be in `KAKAO_ALLOWED_USER_IDS`. The ID is taken from the first request the bot receives from the user (it appears in the skill request, not in any Kakao screen) and set in the environment, not in git.
6. **Fail closed**: if either setting is missing, short or empty, the endpoint refuses every request.

A failure at step 2, 3, 5 or 6 returns the same `403 {"error":"Not allowed"}` with no data and no hint of which check failed. Only a correct secret together with a listed user ID gets a real answer.

### What a leaked secret or user ID allows

- Secret alone (without a listed user ID): nothing; step 5 refuses. User IDs are not secrets in themselves, but they are not published.
- Both: the read-only commands (상태, 포지션, 뉴스, 수익률) the strategy choice (단타, 장투) and, once #312 is finished, the keep-or-sell answers (유지, 매도), all for a **mock** account. No real money, no ledger or portfolio data, no setting changes. Rotating `KAKAO_SKILL_SECRET` in the environment and in Open Builder ends the exposure.

## What is logged

- Refusals: the reason (`method`, `secret`, `user`, `body`, `not-configured`) as one JSON line. Never the secret, the user ID, the request body or the caller's headers.
- Commands: the command name and the result (`ok`, `unavailable`, `error`, `timeout`) as a JSON line and as a row in `kakao_commands`. Never the user ID and never the text the user typed.
- The shared request log adds method, path, status and duration for every request.

Retention follows the platform default for container logs; `kakao_commands` rows carry no personal data.

## Hosting route (decided 2026-11-26)

The user chose the shared AWS infrastructure. The Terraform is in `sirloinbh/shared-aws-infrastructure` (`money-ledger.tf`, PR #118, operations doc section 15):

```
Kakao -> https://<id>.cloudfront.net/kakao/skill
      -> CloudFront viewer-request function: only POST /kakao/skill passes, everything else is a 404 at the edge
      -> https://money-ledger.daysofme.com:8443 (one extra firewall port; 22, 80, 443 stay on the allowed IPs)
      -> shared proxy server block: only POST /kakao/skill, forwarded to the API on 127.0.0.1
      -> app checks above (exact path, rate limit, secret, user allowlist)
```

- Three layers refuse other paths: the edge function, the proxy block, and the app's exact-path check. The origin port is open to everyone because CloudFront's addresses cannot be listed, which is acceptable only because of the last two layers.
- The viewer URL is the default CloudFront name, so no certificate or DNS record is added. Cost is about $0.
- The tunnel from the home server (route B) was not chosen.
- Not done by agents, user steps: apply after reviewing a plan, the proxy server block on the server, `KAKAO_SKILL_SECRET` and `KAKAO_ALLOWED_USER_IDS` in the server `.env`, and entering the URL and header in Open Builder (needs #304).

## Rollout order

1. #312 merged: the endpoint exists and refuses everything without settings.
2. #304 done by the user: Kakao developer keys, channel and Open Builder bot.
3. Merge the Terraform PR, review a plan and apply it only with the user's OK; add the proxy block on the server.
4. Set `KAKAO_SKILL_SECRET` and `KAKAO_ALLOWED_USER_IDS` on the server, register the skill URL and header in Open Builder.
5. Verify: a real message from the user's KakaoTalk gets a reply; a request without the secret gets 403; a request to any other path from outside fails.

## Done when (from #314)

- This document is merged.
- A request to any other path from outside fails.
- A real KakaoTalk message gets a reply and a request without the secret is refused.

The last two are the user-only steps of #314 and stay open after this document merges.
