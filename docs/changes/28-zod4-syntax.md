# #28 Move the backend validation code to zod 4 syntax

- Issue: [#28](https://github.com/sirloinbh/money-ledger/issues/28)
- Branch: `chore/28-zod4-syntax`

## Purpose

This is step 1 of central `sirloinbh/project-standards#386`. So that this app does not break when the central repo raises `zod` to 4.6.7, we move the code first. The Dependabot alert for security advisory GHSA-mrhx-c7xc-m3w5 is closed by that sync. It is not closed by this PR alone.

## Changes: 2026-11-01

- `ZodError` in `backend/src/app.ts` is imported from `zod/v4`. The installed 3.25.76 already contains this path, so we did not change the install or the lockfile.
- This app has no zod schemas yet, so there is nothing to check for `z.record`, `.default()`, or `z.array`.
- We added a test to `backend/test/health.test.ts` that checks that an error from a zod 4 schema is answered with a 400 and its message.

## Changed responses

None. There is currently no path that throws `ZodError`.

## Verification

- `npm run check`: passed. Backend: 5 of 6 passed and 1 skipped (`TEST_DATABASE_URL` was left empty, so DB integration tests were excluded). Frontend: 55 of 57 passed and 2 skipped. 4 skill tests passed.
- DB integration tests are checked by the PR CI.
- We have not yet confirmed the behavior on 4.6.7. We check it with the CI of the central sync PR.
