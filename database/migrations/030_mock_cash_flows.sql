-- #294 External cash flows of a mock account (deposits positive, withdrawals negative, whole won). The time-weighted
-- return removes them, so a deposit is not counted as a gain (user decision 2026-11-24). Safe to re-run.
CREATE TABLE IF NOT EXISTS mock_cash_flows (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- No foreign key on purpose: tests of other features drop and recreate mock_accounts, and every read filters by
  -- account_id, so a row of a removed account is never read.
  account_id bigint NOT NULL,
  flow_date date NOT NULL,
  -- Counted at the end of flow_date: that day's own return is measured without it.
  amount_krw bigint NOT NULL CHECK (amount_krw <> 0 AND abs(amount_krw) <= 1000000000000000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mock_cash_flows_account_idx ON mock_cash_flows (account_id, flow_date);
