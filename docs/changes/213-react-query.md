# #213 Adopt the shared query layer on @tanstack/react-query

- Issue: [#213](https://github.com/sirloinbh/money-ledger/issues/213)
- Parent: #214 Shared platform adoption
- Central: sirloinbh/project-standards#788 (shared query layer), ADR-0027

## Order

Same order as health-log, plan-routine, cert-manager and dev-career-portfolio: install the package here first, then turn on `features.query` for money-ledger in the central registry, then merge the sync PR that adds `frontend/src/lib/query.ts`, then move the screens over one group per PR.

## PR 1: install the package and provide a query client (`chore/213-install-react-query`)

### Changes

- `frontend/package.json`, `package-lock.json`: add `@tanstack/react-query` 5.104.1 (exact) and its one dependency `@tanstack/query-core` 5.104.1. npm re-sorted `@vitejs/plugin-react` alphabetically in `frontend/package.json` (same version).
- `frontend/src/app.tsx`: `App` wraps the app in `QueryClientProvider` with one client kept in state. The CI knip-strict job fails a dependency nothing imports, so the provider lands with the install. It uses React Query's defaults until the shared `createQueryClient()` arrives with the sync; nothing calls a query hook yet, so no screen behaves differently.

### Package review

- Install: `npm install --ignore-scripts --save-exact @tanstack/react-query@5.104.1 -w frontend` (approved: user decision A on 2026-11-19, project-standards#690, ADR-0027; the user asked for these installs on 2026-11-23).
- `node .standards/ioc-scan.mjs`: `ioc-scan: no suspicious items` (it notes only the existing esbuild and fsevents install scripts, which do not run with `--ignore-scripts`).
- `npm audit` from the install: `found 0 vulnerabilities`.
- `npm run lockfiles:sync`: this repo has no such script; the workspaces share the one root lockfile, which the install updated.
- License MIT, no install scripts, one dependency.

### Verification

- `npm run check` with `TEST_DATABASE_URL` on this worker's test DB: passed. Backend 461 passed, 0 failed, 0 skipped (DB integration tests ran); frontend vitest 78 files, 550 passed, 3 skipped; skills tests 4 passed; build passed.
- `npm run knip` (without a DB URL, so it cannot load `playwright.config.ts`): no finding for the new package. It lists `e2e/smoke.spec.ts` and `@axe-core/playwright`, the same as on `main` (an artifact of the missing DB URL).
- No browser check: no screen renders differently (nothing calls a query hook yet).
