# #202 Guard chart components against empty data and render errors

- Issue: [#202](https://github.com/sirloinbh/money-ledger/issues/202)
- Branch: `fix/202-chart-guards`
- Parent: #87 Ledger lookup, monthly analysis, and summary dashboard

## Purpose

The code review on 2026-11-18 found three problems with the charts:

- The five chart components read the first or last item without a guard, so an empty list threw.
- Each of the five screens that load a chart lazily had its own copy of an error boundary. Each copy swapped a mutable module-level `chart.Chart` in `componentDidCatch`, showed any error as "Could not load the chart", and logged nothing.
- Axis names were cut at 8 characters, so "Real estate" became "Real es…" on an axis that fits more.

## Changes

- `frontend/src/lazy-chart.ts` (new)
  - `lazyChart(load)` gives a `Chart` component and `reload()`.
  - A failed import becomes a `ChartLoadError`, so it can be told apart from an error while drawing.
  - `axisName(name)` cuts a name to about 13 Latin-character widths. A Hangul or CJK character counts as two. The "…" is included in the limit.
- `frontend/src/chart-boundary.tsx` (new)
  - `ChartBoundary` holds the `Suspense` fallback ("Loading the chart") and the failure message, plus "Try again" when `onRetry` is given.
  - A `ChartLoadError` is logged with `console.warn` and calls `reload()`, so the next try downloads the file again.
  - Any other error is logged with `console.error` and its component stack. The file is not downloaded again.
  - `EmptyChart` ("Nothing to draw yet.") is the empty state.
- The five screens use the shared boundary. Their own boundary class and mutable chart object are removed, and each message is unchanged.
  - The screens: `asset-allocation.tsx`, `monthly-summary.tsx`, `monthly-trend.tsx`, `net-worth-history.tsx` and `mock-returns.tsx`.
- Each chart component returns `EmptyChart` for an empty list instead of throwing: `asset-allocation-chart.tsx`, `category-share-chart.tsx`, `mock-return-chart.tsx`, `net-worth-chart.tsx` and `trend-chart.tsx`. The screens still do not draw a chart for an empty list; this keeps a stray call from failing.
- `asset-allocation-chart.tsx` and `category-share-chart.tsx` cut axis names with `axisName` instead of 8 characters.

## Verification

Tests added or changed:

- Each chart has a test rendering it with `[]`, which shows "Nothing to draw yet." and no chart image. The tests are in `asset-allocation-chart.test.tsx` (new), `category-share-chart.test.tsx`, `mock-return-chart.test.tsx`, `net-worth-chart.test.tsx` and `trend-chart.test.tsx`.
- `chart-boundary.test.tsx` (new):
  - A failed download is warned about and downloaded again on Try again (two loads).
  - A drawing error is logged with `console.error` and the file is not downloaded again (one load); Try again draws once the data is fixed.
  - Without `onRetry` there is only the message.
- `lazy-chart.test.ts` (new):
  - English names up to 13 characters stay whole.
  - Hangul counts double.
  - A cut name with its "…" stays within the limit.
- The existing tests for a screen's failed chart download pass unchanged: `mock-returns-chart-error.test.tsx` and `monthly-summary-chart-error.test.tsx`.

Commands (local):

- `vitest run --maxWorkers=2` on the 7 chart, boundary and axis files: 19 pass. On the 5 screens and the two chart-error files: 46 pass.
- `npm run check` passed whole before main was merged in (frontend 510 pass + 3 skipped).
- After merging origin/main (#185 and the #188 backend file move), the whole run was stopped by Claude Code for low system memory during lint. As the coordinator asked, it was then rerun in parts, one step at a time through the shared lock: `format:check`, `lint`, `contract:check`, `typecheck`, backend tests (DB on), `npm run test -w frontend -- --maxWorkers=3`, `test:skills`, `build` and `npm run knip`. Every step passed: backend 456 pass / 0 fail / 0 skipped; frontend 78 files, 530 pass + 3 skipped as before; skills 4.

Browser check (local API 3195 and Vite 5295, dev DB with expense categories "Transportation and travel" and "경조사비와선물" and assets "Investment funds account" and "해외주식과국내주식계좌"):

- 390×844, ledger "Expense by category": the axis shows 주거, Transportati…, 경조사비와선…, 식비, inside the card. Portfolio "Asset allocation" by asset shows "Bank account" whole (it was "Bank ac…" before), then "Investment f…" and "해외주식과국…". No horizontal scroll.
- 1440×900, ledger: the same names and no horizontal scroll.

## Limits

- The axis keeps its 88px width on wide screens too; the full names are in the tooltip and the table.
- The width is estimated per character, not measured; names in very wide Latin letters (many "W" or "M") may be cut a little early or touch the bar.

## Review

- Round 1: approve after one nit fixed in this round. The comments above each screen's `lazyChart(...)` still described the old `lazy` swap; they now point at `ChartBoundary`. Checked:
  - Each screen keeps its key and its message, and only `mock-returns.tsx` has Try again, as before.
  - A drawing error no longer downloads the file again and is logged with its component stack.
  - `reload()` only runs for a `ChartLoadError`.
  - The empty-list guards come before any value is read, and the chart components have no hooks, so the early return is safe.
  - `axisName` counts code points, so a surrogate pair is not split.
