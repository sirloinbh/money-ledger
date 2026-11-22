# #182 Remove order and clock dependence from frontend tests

- Issue: [#182](https://github.com/sirloinbh/money-ledger/issues/182)
- Branch: `test/182-order-clock-free-tests`
- Parent: #207 Fast and trustworthy tests

## Purpose

Frontend tests must give the same result alone, in another order, or on another date, and must not prove a negative with a real sleep. The 2026-11-18 code review found tests that passed only in file order, on the real date, vacuously, or after a timed wait.

## Changes

Only test files change; no app code and no shared test helper changed.

- **Once per page load** (`dashboard.test.tsx`, `net-worth-history.test.tsx`, `reports.test.tsx`): `saveTodayOnce`, `addDueOnce`, and `makeReportsOnce` keep module-level promises, so only the first test of a file sent their POSTs. Each test now runs `vi.resetModules()` and imports the screen afresh (`await import(...)`), so every test starts like a new page load. The production modules are unchanged.
  - The dashboard test now asserts that opening sends `POST /api/portfolio/net-worth` (before its `GET`) and `POST /api/reports/generate`.
  - The net worth test pins the clock to 2026-11-16 (`vi.setSystemTime`) instead of the real date. Two tests that passed only because the opening save had already happened in an earlier test now say what they need: the opening save is refused (quietly, as the app does) so the saved days stay as given; the period test expects the value the opening save wrote.
- **Vacuous order check** (`reports.test.tsx`): the test asserts that both `POST /api/reports/generate` and `GET /api/reports` were sent before comparing their positions (`indexOf` is -1 when missing).
- **`rerender`** (`mock-returns.test.tsx`): the refresh-key reload now rerenders the same card instead of rendering a second one, and checks that only one table is shown.
- **Invalid `?trend=`** (`monthly-trend.test.tsx`): `5`, `0`, `-6`, `12.5`, `abc`, and an empty value each load 12 months, with "12 months" pressed and "24 months" not pressed; `?trend=24` checks `aria-pressed` too.
- **Real sleeps** replaced by awaited results:
  - `budget-progress.test.tsx` (three tests): the reload after a late save now answers with a visible change (October gets a row; November's Food budget becomes ₩1,000), and the test waits for it to be shown before checking that the month, the other row's value, and the focus did not move.
  - `classification.test.tsx`: the sleep is removed. The version bump is reported right after the classification and before the list reloads, so a second load from it would already be counted when the reloaded list shows. Checked by mutation: with `takeSkip()` ignored in `classification.tsx`, the test fails with "expected 3 to be 2" without the sleep.
- **Chart-error tests** (`mock-returns-chart-error.test.tsx`, `monthly-summary-chart-error.test.tsx`): the `vi.mock` factory no longer throws (which relied on Vitest running a throwing factory again). It runs once and returns a module whose chart export throws on its first read, so the screen's `import(...).then((module) => module.Chart)` rejects like a failed download the first time and succeeds on "Try again".

## Verification

- Mutation check for the module reset: with the dashboard module shared again and another test run first, "each card shows its area…" fails on the missing POSTs.
- Every test of the nine changed files run alone (`-t "^<name>$"`, one Vitest worker; the `test.each` groups by prefix) and each file with `--sequence.shuffle` seeds 1, 2, 3: all pass. Counts: dashboard 7, net-worth-history 10, reports 7 plus 3 cases, mock-returns 3, monthly-trend 7, budget-progress 17, classification 20 plus 5 cases, each chart-error file 1.
- `npm run check` ran in parts through the shared check lock (coordinator rule: a full run can crash Vitest or be stopped on this 16 GB machine), with `TEST_DATABASE_URL` on a dedicated `postgres:17-alpine` test DB:
  - `format:check`, `lint`, `contract:check`, `typecheck`: exit 0.
  - `npm run test -w backend`: 435 pass, 0 fail, 0 skipped.
  - `npm run test -w frontend -- --maxWorkers=3`: 71 files, 473 pass, 3 skipped (existing `skipIf` theme and app-switcher tests).
  - `test:skills`: 4 pass. `build`: passes.
- `npm run knip`: exit 0 (configuration hints only). A first knip run without `TEST_DATABASE_URL` failed to load `playwright.config.ts` and so reported `e2e/smoke.spec.ts` as unused; with the variable set it passes.

## Limits

- `vi.resetModules()` re-imports the app modules for each test in those three files. It does not reset `node_modules` packages (React stays one instance).
