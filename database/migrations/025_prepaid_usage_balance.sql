-- #192 The total of a voucher's uses never exceeds its amount paid, checked in the database too. Migration 010
-- left this to the API, and portfolio_prepaid_value's greatest(..., 0) would hide a negative balance.
-- Safe to re-run.

-- Each check locks the asset row first, so two writes for the same voucher are counted one after the other
-- (the API takes the same lock).
CREATE OR REPLACE FUNCTION portfolio_prepaid_usage_check() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target bigint;
  kind text;
  paid bigint;
  used numeric;
BEGIN
  -- Separate branches: each table's NEW only has its own columns.
  IF TG_TABLE_NAME = 'portfolio_assets' THEN
    target := NEW.id;
  ELSE
    target := NEW.asset_id;
  END IF;
  SELECT prepaid_kind, prepaid_amount_krw INTO kind, paid
  FROM portfolio_assets WHERE id = target FOR UPDATE;
  SELECT coalesce(sum(amount_krw), 0) INTO used FROM portfolio_prepaid_usages WHERE asset_id = target;
  IF used > 0 AND (kind IS DISTINCT FROM 'amount' OR used > paid) THEN
    RAISE EXCEPTION 'Prepaid uses of asset % (%) exceed the amount paid (%)', target, used, coalesce(paid, 0)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;

DO $$
DECLARE
  over text;
BEGIN
  -- Existing rows are checked first: an asset over its amount is reported, not silently changed.
  SELECT string_agg(format('asset %s (used %s, paid %s)', a.id, u.used, coalesce(a.prepaid_amount_krw, 0)), ', ')
  INTO over
  FROM portfolio_assets a
  JOIN (SELECT asset_id, sum(amount_krw) AS used FROM portfolio_prepaid_usages GROUP BY asset_id) u
    ON u.asset_id = a.id
  WHERE a.prepaid_kind IS DISTINCT FROM 'amount' OR u.used > a.prepaid_amount_krw;
  IF over IS NOT NULL THEN
    RAISE EXCEPTION 'Prepaid uses above the amount paid: %. Fix them before applying this migration.', over;
  END IF;
END
$$;

-- Constraint triggers run at the end of each statement's row changes, after the new row is visible to the sum.
DROP TRIGGER IF EXISTS portfolio_prepaid_usages_balance ON portfolio_prepaid_usages;
CREATE CONSTRAINT TRIGGER portfolio_prepaid_usages_balance
  AFTER INSERT OR UPDATE OF amount_krw, asset_id ON portfolio_prepaid_usages
  FOR EACH ROW EXECUTE FUNCTION portfolio_prepaid_usage_check();

DROP TRIGGER IF EXISTS portfolio_assets_prepaid_balance ON portfolio_assets;
CREATE CONSTRAINT TRIGGER portfolio_assets_prepaid_balance
  AFTER UPDATE OF prepaid_kind, prepaid_amount_krw ON portfolio_assets
  FOR EACH ROW EXECUTE FUNCTION portfolio_prepaid_usage_check();
