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

## Central flag and sync

- sirloinbh/project-standards#1006 / PR #1007 (merged a64e69f): `features.query` on for money-ledger.
- Sync PR #273 (merged e86ba1c): adds the managed `frontend/src/lib/query.ts` and `query.test.tsx`.

## PR 2: the summary, budget and trend cards (`refactor/213-ledger-cards-query`)

### Changes

- `frontend/src/ledger-query.ts` (new): the ledger page's query keys. Every ledger read starts with `ledgerKey` (`['/api/ledger']`), so one `invalidateQueries` after a ledger change refreshes every section built on it. `usePagedRead` is a read for a card that moves between months or periods: it keeps the previous month on the screen while the next one loads (`placeholderData: keepPreviousData`, which the shared `useApiQuery` does not offer, so it calls `useQuery` with `requestJson` the same way), and `failed` is a load that failed and is not being tried again.
- `MonthlySummary`, `MonthlyTrend`: load through `usePagedRead`; the `version` prop, the hand-written load effect and the "only the latest request" counter are gone (React Query keeps each month's answer under its own key and cancels a request no screen waits for). Try again is `refetch()`.
- `BudgetProgress`: loads through `usePagedRead` and saves through the shared `useApiMutation`, which invalidates every month's budgets (a budget carries on to later months, so a month seen before must not show its old rows from the cache). The save stays pending until the month on the screen has reloaded, so the focus still goes to the row as listed after the save. The `version` prop and the `loadShown` ref are gone.
- `ledger.tsx`: the three cards take no counter. The two counters stay for the sections that still load by hand (fixed costs, entries, uncategorized entries, rules); each bump also invalidates `ledgerKey`, so the migrated cards follow a change made in those sections. The next PRs move those sections and remove the counters.
- `app.tsx`: the app's client is now the shared `createQueryClient()` (30 s fresh data, one retry for network, timeout and 5xx, refetch on window focus, writes never retried). Tests can pass their own client.
- Tests: `frontend/src/test/query.tsx` (new) gives each test one query client without retries (`testQueryClient`, `renderWithQuery`, `forgetQueryClient`); `test/setup.ts` unmounts and empties it after each test. The card tests render through it; "a new version reloads" became "a ledger change (`ledgerKey`) reloads". New test: a budget save makes another month seen before load again instead of showing its cached rows (it fails when the save invalidates nothing). Two tests that simulate a new visit now start with an empty cache, and the late-October test now checks that November shows from the cache while October is still loading.

### Behavior notes

- Shared-layer defaults that are new here (ADR-0027): a month seen in the last 30 s shows from the cache without a request; a load that fails from the network or a 5xx is tried once more before the card says so; coming back to the window refreshes stale cards.
- After a month that failed to load, Try again shows "Loading" instead of dimming the month before (the previous month is no longer kept once a load failed). Nothing else on the cards changes.

### Verification

- `npm run check` with `TEST_DATABASE_URL` on this worker's test DB: passed. Backend 461 passed, 0 failed, 0 skipped; frontend vitest 79 files, 561 passed, 3 skipped; skills tests 4 passed; build passed.
- `npm run knip` with the DB URL set: no unused files, exports or dependencies.
- Browser (local API on 3192 with a scratch DB, Vite on 5292), Ledger page at 390×844 and 1440×900: the summary, budgets and trend load; renaming a category in Categories (still on the counters) renamed it in the summary's table and chart at once (through the `ledgerKey` invalidation); a budget save showed its message, the spending review updated and the focus went back to the row's Edit button; Previous month moved the summary and budgets to October and the address to `?month=2026-10`. No console warnings or errors.
