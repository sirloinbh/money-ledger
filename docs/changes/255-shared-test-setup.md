# #255 Load the shared frontend test setup (standard-setup.ts)

- Issue: [#255](https://github.com/sirloinbh/money-ledger/issues/255)
- Branch: `test/255-shared-test-setup`
- Parent: #207 Fast and trustworthy tests

## Purpose

`frontend/vitest.config.ts` runs only `frontend/src/test/setup.ts`, and that file never imported the managed `standard-setup.ts`. It held a partial copy instead, so the frontend tests ran without two things from the shared setup:

- `configure({ asyncUtilTimeout: 8_000 })`: every `findBy*` and `waitFor` gave up after Testing Library's default 1 second, which fails screen tests at random on a busy PC (several workers run checks on one machine).
- The `ResizeObserver` stand-in for Radix components.

Found in the review of #182 (PR #254).

## Changes

- `frontend/src/test/setup.ts`: now only `import './standard-setup';` with a comment on what the shared setup gives. The copied `jest-dom` import, `matchMedia` stand-in, and `afterEach` cleanup are gone; `standard-setup.ts` does each of them (its cleanup is the same list: Testing Library cleanup, real timers, unstubbed globals, restored mocks, cleared `localStorage`, the html class, the URL). This app has nothing extra to add.
- `frontend/src/test/setup.test.ts` (new): checks that the wait is 8 seconds and that the `ResizeObserver` and `matchMedia` stand-ins exist. With the old `setup.ts` it fails with "expected 1000 to be 8000".
- The managed `standard-setup.ts` and `vitest.config.ts` are unchanged.

## Verification

- `vitest run src/test/setup.test.ts`: passes; with the `origin/main` `setup.ts` it fails as above.
- No test waits on a `findBy*`/`waitFor` timeout on purpose (searched for `.rejects` and `timeout:` in the frontend tests), so the longer wait only changes how long a real failure takes to report (8 seconds instead of 1, within the 15-second test timeout).
- `npm run check` in parts through the shared check lock, with `TEST_DATABASE_URL` on a dedicated `postgres:17-alpine` test DB: `format:check`, `lint`, `contract:check`, `typecheck` exit 0; frontend (`--maxWorkers=3`) 72 files, 487 pass, 3 skipped (existing `skipIf` tests); backend 446 pass, 0 fail, 0 skipped; `test:skills` 4 pass; `build` passes.
- `npm run knip`: exit 0 (configuration hints only).

## Limits

- A test that fails because something never appears now takes up to 8 seconds to fail instead of 1.

## Review

- Round 1 (PR #256 comment): approve, no blocking comments. No fix commits, no split issues.
