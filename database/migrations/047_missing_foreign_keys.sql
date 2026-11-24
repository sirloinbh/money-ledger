-- #320 Foreign keys that 030 and 043 left out because every DB test kept its own DROP TABLE list without CASCADE.
-- The tests now reset the whole schema through one helper (backend/test/helpers.ts resetDatabase), so the keys can
-- exist. No rows are ever deleted from the referenced tables, so existing data satisfies them. Safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mock_cash_flows_account_fk') THEN
    ALTER TABLE mock_cash_flows
      ADD CONSTRAINT mock_cash_flows_account_fk FOREIGN KEY (account_id) REFERENCES mock_accounts (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_picks_security_fk') THEN
    ALTER TABLE daily_picks
      ADD CONSTRAINT daily_picks_security_fk FOREIGN KEY (security_id) REFERENCES securities (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_picks_order_fk') THEN
    ALTER TABLE daily_picks
      ADD CONSTRAINT daily_picks_order_fk FOREIGN KEY (order_id) REFERENCES mock_orders (id);
  END IF;
END
$$;
