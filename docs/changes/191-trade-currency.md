# #191 Keep a trade's currency equal to its asset's currency

- Issue: [#191](https://github.com/sirloinbh/money-ledger/issues/191)
- Branch: `fix/191-trade-currency`
- Parent: #91 Investment asset trading and valuation

## Purpose

Migration 013 left "a trade is in its asset's currency" to the API. A row in another currency mixes dollars and won in the position's foreign cost. The trade form also used the asset's currency when editing, so a USD trade under a won asset lost its rate field and was sent with `fxRate: null`, which silently turned it into a won trade.

## Changes

- New migration `database/migrations/027_trade_currency_fk.sql` (number to be changed to the next free one just before merging, coordinator rule 2026-11-22):
  - Refuses to apply, naming the rows, when a trade's currency differs from its asset's. Existing rows are never rewritten.
  - Adds `UNIQUE (id, currency)` on `portfolio_assets` and the composite foreign key `portfolio_trades (asset_id, currency) → portfolio_assets (id, currency)` with `ON DELETE CASCADE`. With the default `NO ACTION` on update, an asset's currency cannot change while it has trades; the API already refuses that with a message first (`PUT /api/portfolio/assets/:id`).
- `frontend/src/asset-trades.tsx`: the form uses the edited trade's own currency (`editing?.currency ?? currency`) for validation, the unit label, the price input mode and the rate field. A new trade still uses the asset's currency.

## Verification

- `backend/test/trades.integration.test.ts`:
  - The reset applies 027 twice (re-running is safe).
  - "the DB refuses inconsistent trades": a USD trade under a won asset fails with `23503`, and changing the asset's currency under its trades fails with `23503`.
  - "migration 027 reports existing trades in another currency": with the key dropped and a mismatched row, the migration fails with "Trades whose currency differs from their asset: trade N ..."; after the row is fixed it applies and the key holds.
- `frontend/src/asset-trades.test.tsx` "editing a USD trade keeps its rate and currency": the edit form shows the USD price and the 1300 rate, the PUT body keeps `fxRate: '1300'`, and the form returns to the asset's currency afterwards. It fails without the `asset-trades.tsx` change ("Unable to find a label with the text of: Unit price (USD)") and passes with it.
- Commands and results are in the PR body.

## Limits

- A production database with a mismatched row stops the deploy's migration step with the error above; the rows must be fixed by hand. None can be written through the API, which has refused a currency change on an asset with trades since #46.
