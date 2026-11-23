# Load Dashboard, Reports and Portfolio through the shared query layer (#278)

## Problem

After #213 the Ledger page and Mock trading read through `useApiQuery` and shared query keys. The Dashboard, the Reports pages and the Portfolio page still had their own `useEffect` load loops, `attempt` counters for Try again, and stale-answer guards.

## Change

- `frontend/src/portfolio-query.ts` (new): `portfolioKey` and `portfolioKeys` (assets, trades, usages, net worth), and `usePortfolioReload`, the same shape as `ledgerKey` and `mockKey`.
- `assets.tsx`, `asset-trades.tsx`, `prepaid-usages.tsx`: the asset list, a trade list and a use list are `useApiQuery` reads under `portfolioKey`. A save reloads every portfolio read with `useReadsReload`, so the trade and use panels no longer pass an `onChanged` callback up to reload the asset list (`onChanged` and `onUsagesChanged` are gone).
- `net-worth-history.tsx`: one query per period with `keepPreviousData` (the old period stays dimmed while the next loads); a save refreshes every net worth read.
- `dashboard.tsx`: each card is a query. The ledger card shares `ledgerKeys.summary(month)` with the Ledger page; the net worth card uses `portfolioKeys.netWorthLatest()`; the mock card uses `mockKeys.dashboard()` (under `mockKey`).
- `reports.tsx`, `reports-api.ts`: `reportsKeys`; opening a report marks it seen and then invalidates `reportsKey`, so the list and the dashboard notice follow within the 30 s fresh time.
- Tests render with `renderWithQuery`.

## Not changed

- `health.ts` is a managed file from `sirloinbh/project-standards` (`templates/ui`), so it is not edited here. Its own polling already aborts on unmount and retries while the server is down; moving it to the shared layer needs a change in the central repo.

## Behavior notes

- Data is fresh for 30 s and a focused window refetches stale data (the shared defaults), so a card revisited within 30 s shows cached values at once.
- The first load of a page is unchanged: today's net worth save and the report generation still run before their reads.

## Verification

Results are in the PR.
