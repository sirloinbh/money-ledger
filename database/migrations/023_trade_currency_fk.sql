-- #191 A trade's currency is always its asset's currency. Migration 013 left this to the API; a mismatched
-- row would mix dollars and won in the position's foreign cost. Safe to re-run.
-- The asset side needs a unique (id, currency) for the composite foreign key. With the default NO ACTION,
-- an asset's currency cannot change while it has trades (the API refuses that with a message first).

DO $$
DECLARE
  mismatched text;
BEGIN
  -- Existing rows are checked first: a mismatch is reported, not silently rewritten.
  SELECT string_agg(format('trade %s (asset %s: %s, trade: %s)', t.id, a.id, a.currency, t.currency), ', ')
  INTO mismatched
  FROM portfolio_trades t JOIN portfolio_assets a ON a.id = t.asset_id
  WHERE t.currency <> a.currency;
  IF mismatched IS NOT NULL THEN
    RAISE EXCEPTION 'Trades whose currency differs from their asset: %. Fix them before applying 027.',
      mismatched;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'portfolio_assets'::regclass AND conname = 'portfolio_assets_id_currency_key'
  ) THEN
    ALTER TABLE portfolio_assets
      ADD CONSTRAINT portfolio_assets_id_currency_key UNIQUE (id, currency);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'portfolio_trades'::regclass AND conname = 'portfolio_trades_asset_currency_fkey'
  ) THEN
    ALTER TABLE portfolio_trades
      ADD CONSTRAINT portfolio_trades_asset_currency_fkey FOREIGN KEY (asset_id, currency)
      REFERENCES portfolio_assets (id, currency) ON DELETE CASCADE;
  END IF;
END
$$;
