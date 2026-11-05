-- #50 Mock trading account. Safe to re-run.
-- Virtual money only: nothing here is counted in the ledger or the portfolio totals.
-- Resetting closes the open account (closed_at) and opens a new one; closed accounts are kept, not deleted
-- (2026-11-03 decision). Orders and holdings (#52, #53) will reference the account they belong to.
CREATE TABLE IF NOT EXISTS mock_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- From 1만 원 to 100억 원 of virtual money; the screen suggests 1,000만 원.
  initial_cash_krw bigint NOT NULL CHECK (initial_cash_krw BETWEEN 10000 AND 10000000000),
  -- Won not yet spent on stocks. Same 1,000조 won ceiling as portfolio values, so totals stay safe integers.
  cash_krw bigint NOT NULL CHECK (cash_krw BETWEEN 0 AND 1000000000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT mock_accounts_closed_after_created_check CHECK (closed_at IS NULL OR closed_at >= created_at)
);

-- At most one open account at a time (2026-11-03 decision: one account).
CREATE UNIQUE INDEX IF NOT EXISTS mock_accounts_one_open_idx ON mock_accounts ((true))
  WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS mock_accounts_closed_idx ON mock_accounts (closed_at DESC, id DESC)
  WHERE closed_at IS NOT NULL;
