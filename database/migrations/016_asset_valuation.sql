-- #47 Current prices for held assets. Safe to re-run.
-- A stock asset can be linked to a security (migration 009): its value is then quantity × the newest stored
-- close. An unlinked stock or other asset can carry a price entered by hand, per unit, with the day it is
-- from. A stored close always wins over a hand price (docs/price-source.md); USD values are converted with
-- the newest stored USD rate. Decisions: 2026-11-10, issue #47.

ALTER TABLE portfolio_assets ADD COLUMN IF NOT EXISTS security_id bigint;
ALTER TABLE portfolio_assets ADD COLUMN IF NOT EXISTS manual_price numeric(20, 4);
ALTER TABLE portfolio_assets ADD COLUMN IF NOT EXISTS manual_price_on date;

-- The asset's currency is the security's currency: (id, currency) is unique in securities.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portfolio_assets_security_fkey') THEN
    ALTER TABLE portfolio_assets ADD CONSTRAINT portfolio_assets_security_fkey
      FOREIGN KEY (security_id, currency) REFERENCES securities (id, currency);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS portfolio_assets_security_idx ON portfolio_assets (security_id)
  WHERE security_id IS NOT NULL;

ALTER TABLE portfolio_assets DROP CONSTRAINT IF EXISTS portfolio_assets_valuation_check;
ALTER TABLE portfolio_assets ADD CONSTRAINT portfolio_assets_valuation_check CHECK (
  (security_id IS NULL OR asset_type = 'stock')
  -- A hand price: both parts, on an unlinked stock or other asset, positive, whole won for KRW.
  AND (manual_price IS NULL) = (manual_price_on IS NULL)
  AND (
    manual_price IS NULL
    OR (
      security_id IS NULL AND asset_type IN ('stock', 'other') AND manual_price > 0
      AND (currency <> 'KRW' OR manual_price = trunc(manual_price))
    )
  )
);
