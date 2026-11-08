-- #64 Prepaid assets (hair salon, gym). Safe to re-run.
-- Decisions (2026-11-08): a new asset type 'prepaid' (coins stay in 'other'); the payment is a ledger expense
-- on the day it is paid and the asset shows only the value left, so using it is not an expense again.
--   amount: stored value. Balance = amount paid - uses. A use larger than the balance is refused. An optional
--           expiry date; after it the value is 0.
--   period: a pass from starts_on to expires_on (both days included). Value = round(amount × days left ÷
--           all days); the amount before the start, 0 from the day after the expiry.

-- Shared checks are replaced only while they do not yet allow what this file adds, so re-running an older
-- migration or this one never narrows a check that a later file widened (rows it allows would then fail).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'portfolio_assets'::regclass
      AND conname = 'portfolio_assets_asset_type_check'
      AND pg_get_constraintdef(oid) LIKE '%''prepaid''%'
  ) THEN
    ALTER TABLE portfolio_assets DROP CONSTRAINT IF EXISTS portfolio_assets_asset_type_check;
    ALTER TABLE portfolio_assets ADD CONSTRAINT portfolio_assets_asset_type_check CHECK (
      asset_type IN ('stock', 'real_estate', 'cash', 'debt', 'depreciable', 'prepaid', 'other')
    );
  END IF;
END
$$;

ALTER TABLE portfolio_assets
  ADD COLUMN IF NOT EXISTS prepaid_kind text CHECK (prepaid_kind IN ('amount', 'period')),
  ADD COLUMN IF NOT EXISTS prepaid_amount_krw bigint
    CHECK (prepaid_amount_krw BETWEEN 0 AND 1000000000000000),
  ADD COLUMN IF NOT EXISTS prepaid_starts_on date,
  ADD COLUMN IF NOT EXISTS prepaid_expires_on date;

-- A prepaid asset is a won asset valued from what was paid, never by hand; the 'prepaid' type always has it.
ALTER TABLE portfolio_assets DROP CONSTRAINT IF EXISTS portfolio_assets_prepaid_check;
ALTER TABLE portfolio_assets ADD CONSTRAINT portfolio_assets_prepaid_check CHECK (
  (prepaid_kind IS NULL AND prepaid_amount_krw IS NULL AND prepaid_starts_on IS NULL
    AND prepaid_expires_on IS NULL AND asset_type <> 'prepaid')
  OR (prepaid_kind IS NOT NULL AND prepaid_amount_krw IS NOT NULL
    AND asset_type = 'prepaid' AND currency = 'KRW'
    AND quantity IS NULL AND value_krw IS NULL AND value_foreign IS NULL
    AND (
      (prepaid_kind = 'amount' AND prepaid_starts_on IS NULL)
      OR (prepaid_kind = 'period' AND prepaid_starts_on IS NOT NULL AND prepaid_expires_on IS NOT NULL
        AND prepaid_starts_on <= prepaid_expires_on)
    ))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'portfolio_assets'::regclass
      AND conname = 'portfolio_assets_quantity_or_value_check'
      AND pg_get_constraintdef(oid) LIKE '%prepaid_kind%'
  ) THEN
    ALTER TABLE portfolio_assets DROP CONSTRAINT IF EXISTS portfolio_assets_quantity_or_value_check;
    ALTER TABLE portfolio_assets ADD CONSTRAINT portfolio_assets_quantity_or_value_check CHECK (
      quantity IS NOT NULL OR value_krw IS NOT NULL OR value_foreign IS NOT NULL
      OR purchase_price_krw IS NOT NULL OR prepaid_kind IS NOT NULL
    );
  END IF;
END
$$;

-- Uses of a stored-value prepaid asset. Add and delete only (decision). The API keeps the total within the
-- amount paid, locking the asset row while it checks.
CREATE TABLE IF NOT EXISTS portfolio_prepaid_usages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id bigint NOT NULL REFERENCES portfolio_assets (id) ON DELETE CASCADE,
  used_on date NOT NULL,
  amount_krw bigint NOT NULL CHECK (amount_krw BETWEEN 1 AND 1000000000000000),
  memo text NOT NULL DEFAULT '' CHECK (char_length(memo) <= 100),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portfolio_prepaid_usages_asset_idx
  ON portfolio_prepaid_usages (asset_id, used_on, id);

-- The value on `as_of`, or NULL when the row is not prepaid. `used` is the total of uses up to `as_of`.
-- Date subtraction gives whole days, and the rounding is numeric round(): 0.5 goes away from zero.
CREATE OR REPLACE FUNCTION portfolio_prepaid_value(
  kind text, amount bigint, starts_on date, expires_on date, used bigint, as_of date
) RETURNS bigint
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN kind IS NULL THEN NULL
    WHEN expires_on IS NOT NULL AND as_of > expires_on THEN 0
    WHEN kind = 'amount' THEN greatest(amount - coalesce(used, 0), 0)
    WHEN as_of < starts_on THEN amount
    ELSE round(amount::numeric * (expires_on - as_of + 1) / (expires_on - starts_on + 1))::bigint
  END
$$;
