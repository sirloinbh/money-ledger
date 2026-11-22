# #188 Split backend assets.ts and group backend files by domain

- Issue: [#188](https://github.com/sirloinbh/money-ledger/issues/188)
- Branch: `refactor/188-split-assets`
- Parent: #208 Fast and maintainable asset and entry screens

## Purpose

`backend/src/assets.ts` had 890 lines: Zod schemas, the valuation SQL builder, row mapping and seven routes. Twenty files sat flat in `backend/src/` while `prices/` already had a module shape. A stray comment above `readTotals` described `total`. This is a pure move: no behavior, API or SQL change.

## Changes

- `assets.ts` split, code moved as is:
  - `portfolio/asset-schema.ts` (247 lines): request schemas, asset types, `requireQuantityOrValue`.
  - `portfolio/asset-valuation.ts` (271 lines): `Row`, `assetQuery`, `readTotals`, `sumTotals`, the listed-rows query, `total`, `won`, `toAsset`.
  - `portfolio/assets.ts` (401 lines): the routes, `UsageRefusal`, `lockForUses`.
  - The stray "A total as a JSON number" comment is removed, and the `lockForUses` doc comment now sits on `lockForUses` (it was above `UsageRefusal`).
- Files moved into domain folders (`git mv`; only relative imports changed, and ESLint re-sorted them):

| Folder                   | Files                                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/ledger/`    | `entries.ts`, `entry-csv.ts`, `budgets.ts`, `categories.ts`, `fixed-costs.ts`, `rules.ts`, `summary.ts`, `trend.ts`, `suggestions.ts`, `reports.ts`, `month.ts` |
| `backend/src/portfolio/` | `assets.ts`, `asset-schema.ts`, `asset-valuation.ts`, `allocation.ts`, `trades.ts`, `net-worth.ts`                                                              |
| `backend/src/mock/`      | `accounts.ts`, `holdings.ts`, `orders.ts`, `snapshots.ts` (were `mock-*.ts`)                                                                                    |

- Left at the top: `app.ts`, `server.ts`, `runtime.ts`, `db.ts`, `migrate.ts`, `contract.ts`, `openapi.ts`, `openapi-cli.ts`, `ai-tools.ts` (the standards check and `backend/package.json` scripts name these paths), plus `prices/` and the managed `standard/`.
- `docs/price-source.md`: the mock order path. The comment in the applied migration 026 that names `backend/src/reports.ts` is left as is (applied migrations are checksum-pinned, #180); history in `docs/changes` and `docs/daily` keeps the old paths.

## Verification

- Largest file under `backend/src` is now `ledger/entries.ts` (461 lines).
- Apart from the split commit, every changed line in `backend/` is an `import` line (checked with `git diff -M`).
- Typecheck, lint, format and the OpenAPI contract check pass; the full check results are in the PR body.

## Limits

- Open branches of other workers that touch moved files need `origin/main` merged in; git follows the renames.
