-- #54 Daily value of a mock trading account, for the return chart. Safe to re-run.
-- Decisions (2026-11-10): one row per account and KST day, written when the daily price fetch finishes and when
-- an order fills (a later write on the same day replaces it). The values are computed like the holdings screen
-- (#53): cash + holdings at the latest stored close and rate. A row is never recomputed when prices change
-- later, and days before this table existed are not filled in (the chart starts at 0% on the account's start).
CREATE TABLE IF NOT EXISTS mock_snapshots (
  account_id bigint NOT NULL REFERENCES mock_accounts (id),
  snapshot_date date NOT NULL,
  cash_krw bigint NOT NULL CHECK (cash_krw BETWEEN 0 AND 1000000000000000),
  value_krw bigint NOT NULL CHECK (value_krw >= 0),
  total_krw bigint NOT NULL CHECK (total_krw = cash_krw + value_krw),
  profit_krw bigint NOT NULL,
  -- Percent of the initial cash, rounded to 2 places (half away from zero).
  return_pct numeric(14,2) NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, snapshot_date)
);
