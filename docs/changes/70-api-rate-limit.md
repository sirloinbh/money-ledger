# #70 API request rate limit

- Issue: [#70](https://github.com/sirloinbh/money-ledger/issues/70)
- Branch: `chore/70-api-rate-limit`

## Purpose

CodeQL `js/missing-rate-limiting` (high) appeared on every route that calls the DB and blocked the #37 PR (#69). CodeQL recognizes only Express middleware, so we also put a limit on the API server, separate from the nginx limit. This follows the central baseline project-standards#291 and the approach of life-journal.

## Changes: 2026-11-03

- The user installed it with `npm install express-rate-limit@8.7.1 --save-exact --ignore-scripts -w backend` (a project hook blocks installs by the agent). npm reordered `devDependencies` in `backend/package.json` by name.
- We aligned the sub-repository lockfile `backend/package-lock.json` with the root lockfile using `npm run lockfiles:sync`.
- `backend/src/app.ts`: put a limit of 600 per minute per IP on all of `/api` (the same level as nginx's 10 per second). Over the limit it sends 429 and `요청이 너무 많습니다. 잠시 후 다시 시도해 주세요` (Korean for "Too many requests. Please try again shortly"). The response headers use the `RateLimit` (draft-8) format. So that tests can change the limit, `createApp` has a `requestsPerMinute` option.
- `backend/test/helpers.ts`: `withApi` passes `createApp`'s options through as they are.

## Verification

- `backend/test/rate-limit.test.ts` (2 tests): with a limit of 2, the third request gets a Korean 429. With the default limit, 50 requests in a row all get 200.
- `TEST_DATABASE_URL=<test DB> npm run check`: passed. Backend 8 passed and 0 skipped, frontend 65 of 67 passed and 2 skipped (existing), 4 skill tests passed.
- `npm run standards:check`: passed.

## Limits

- In production the requests go through nginx, so the IP the API sees is the single frontend container. The app has one user, so working as an overall limit is fine, and the per-client limit is nginx's job. This is the same judgment as the other apps.

## Review record

### Round 1: nothing to fix, 1 minor point addressed

- The runtime check (`ERR_ERL_*`) confirmed that it does not block requests, because nginx does not add `X-Forwarded-For` and `trust proxy` is off.
- "retry hint" in the test title is not something the test checks, so we removed it from the title.
- Nothing needed fixing, so we do not run a second review.
