-- #63 Depreciating assets (beds, computers, appliances). Safe to re-run.
-- Decisions (2026-11-02): straight-line by month (the same amount every month), useful life presets of
-- 10 years for a bed, 5 for a computer and 7 for an appliance (editable), and a salvage value of 0 by default.

-- All four are set together, on a depreciable won asset, instead of a hand-entered value.
ALTER TABLE portfolio_assets
  ADD COLUMN IF NOT EXISTS purchase_price_krw bigint
    CHECK (purchase_price_krw BETWEEN 0 AND 1000000000000000),
  ADD COLUMN IF NOT EXISTS purchased_on date,
  ADD COLUMN IF NOT EXISTS useful_life_months integer CHECK (useful_life_months BETWEEN 1 AND 1200),
  ADD COLUMN IF NOT EXISTS salvage_value_krw bigint CHECK (salvage_value_krw >= 0);

ALTER TABLE portfolio_assets DROP CONSTRAINT IF EXISTS portfolio_assets_depreciation_check;
ALTER TABLE portfolio_assets ADD CONSTRAINT portfolio_assets_depreciation_check CHECK (
  (purchase_price_krw IS NULL AND purchased_on IS NULL AND useful_life_months IS NULL
    AND salvage_value_krw IS NULL)
  OR (purchase_price_krw IS NOT NULL AND purchased_on IS NOT NULL AND useful_life_months IS NOT NULL
    AND salvage_value_krw IS NOT NULL AND salvage_value_krw <= purchase_price_krw
    AND asset_type = 'depreciable' AND currency = 'KRW'
    AND quantity IS NULL AND value_krw IS NULL AND value_foreign IS NULL)
);

-- A depreciating asset has no hand-entered value: its value comes from the purchase price.
ALTER TABLE portfolio_assets DROP CONSTRAINT IF EXISTS portfolio_assets_quantity_or_value_check;
ALTER TABLE portfolio_assets ADD CONSTRAINT portfolio_assets_quantity_or_value_check CHECK (
  quantity IS NOT NULL OR value_krw IS NOT NULL OR value_foreign IS NOT NULL
  OR purchase_price_krw IS NOT NULL
);

-- The value on `as_of`: the purchase price minus the same amount for every full month since the purchase,
-- never below the salvage value. Before the purchase date nothing is taken off. A month is full on the same
-- day of a later month (2026-01-15 -> 2026-02-15); from the 31st it is the last day only when that day exists
-- (age() counts 2026-01-31 -> 2026-02-28 as 28 days). Rounding is numeric round(): 0.5 goes away from zero.
CREATE OR REPLACE FUNCTION portfolio_depreciated_value(
  price bigint, salvage bigint, purchased date, life_months integer, as_of date
) RETURNS bigint
LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT price - round(
    (price - salvage)::numeric
      * least(
          greatest(
            -- integer, so no double precision reaches round() (that would round half to even).
            (extract(year FROM age(as_of, purchased)) * 12
              + extract(month FROM age(as_of, purchased)))::integer,
            0
          ),
          life_months
        )
      / life_months
  )::bigint
$$;
