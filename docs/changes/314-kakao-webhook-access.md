# Design the public access to the Kakao skill webhook (#314, docs part)

Part of epic #303 (mock investing v2). Issue: <https://github.com/sirloinbh/money-ledger/issues/314>.

## Purpose

Kakao i Open Builder must reach `POST /kakao/skill` (#312) over public HTTPS, but `AGENTS.md` requires private access to be designed before any public exposure. This writes the design down: which path is public, how the secret header and the user allowlist are checked, rate limits, and what is logged. It changes no code, hosting, or AWS resource.

## Changes

| Area | Change                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Docs | `docs/kakao-webhook-access.md`: public path table, the ordered checks, what a leaked secret allows, logging, the two hosting routes with a recommendation, rollout order |

## Verification

- Docs only. `npm run check` (format, lint, tests) passed; the described checks match `backend/src/kakao/skill.ts` from PR #322.

## Limits and follow-up

- Still open on #314 and user-only: choose the hosting route (shared AWS infrastructure or a tunnel), apply it (any AWS or production change needs the user's OK), set the skill URL and secret in Open Builder, and run a real KakaoTalk round trip. #314 stays open.
- The edge rule "forward only `POST /kakao/skill`" and the real-request check from outside are not testable until a route is chosen.

## Update: route chosen, code guard (2026-11-26)

- The user chose the shared AWS infrastructure. The design doc now records the route (CloudFront function, one extra origin port, proxy block, app checks) and the cost, and links [shared-aws-infrastructure#118](https://github.com/sirloinbh/shared-aws-infrastructure/pull/118), which holds the Terraform (also the private photo bucket for #300). Nothing was applied.
- Code guard: `skillHandlers` answers 404 for any path longer than `/kakao/skill` (`app.use` also matches `/kakao/skill/anything`), before the limiter, secret and body parser. Test: `a longer path under /kakao/skill is a 404, even with the right secret`.
- Still user-only and open: apply after reviewing a plan, the proxy server block, the server `.env` values, Open Builder setup and the real round trip (#304 keys). #314 stays open.
