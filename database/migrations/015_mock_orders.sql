-- #52 Mock trading market orders and holdings. Safe to re-run.
-- Decisions (2026-11-08): one won cash balance only (no dollar cash); a US order is converted with the latest
-- stored deal base rate at order time. The fee rate is a setting, 0 by default, and no taxes. Every order
-- fills at once at the latest stored close, whole shares only. Inactive securities (#97) cannot be bought.

-- Fee rate per account, a share of the trade amount (0.00015 = 0.015%). Set with SQL for now; a settings screen
-- can come later. Below 1%.
ALTER TABLE mock_accounts ADD COLUMN IF NOT EXISTS fee_rate numeric(7,6) NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mock_accounts_fee_rate_check') THEN
    ALTER TABLE mock_accounts ADD CONSTRAINT mock_accounts_fee_rate_check
      CHECK (fee_rate >= 0 AND fee_rate < 0.01);
  END IF;
END $$;

-- What an account holds now. A row goes away when its quantity reaches 0. cost_krw is the won paid for the
-- shares still held, fees included (average cost: a sale takes away its share of the cost). #53 shows returns.
CREATE TABLE IF NOT EXISTS mock_holdings (
  account_id bigint NOT NULL REFERENCES mock_accounts (id),
  security_id bigint NOT NULL REFERENCES securities (id),
  quantity numeric(20,8) NOT NULL CHECK (quantity > 0 AND quantity = trunc(quantity)),
  cost_krw bigint NOT NULL CHECK (cost_krw BETWEEN 0 AND 1000000000000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, security_id)
);

-- One row per order. A market order fills completely at once, so the order and its fill are one record: the
-- fill price, the date of the close it used and, for USD, the rate and its date are kept with it. Later price
-- or rate changes never change a recorded order (AGENTS.project.md).
CREATE TABLE IF NOT EXISTS mock_orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES mock_accounts (id),
  security_id bigint NOT NULL,
  -- Sent by the screen once per order; a second request with the same key returns the first order.
  request_key uuid NOT NULL UNIQUE,
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity numeric(20,8) NOT NULL CHECK (quantity > 0 AND quantity = trunc(quantity)),
  price numeric(20,4) NOT NULL CHECK (price > 0),
  currency text NOT NULL CHECK (currency IN ('KRW', 'USD')),
  price_date date NOT NULL,
  fx_rate numeric(12,4) CHECK (fx_rate > 0),
  fx_date date,
  -- round(quantity × price × coalesce(fx_rate, 1)), computed once in SQL numeric.
  amount_krw bigint NOT NULL CHECK (amount_krw BETWEEN 0 AND 1000000000000000),
  fee_krw bigint NOT NULL CHECK (fee_krw >= 0),
  -- The account's won cash right after this order, for the order history (#54).
  cash_after_krw bigint NOT NULL CHECK (cash_after_krw BETWEEN 0 AND 1000000000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mock_orders_security_fkey FOREIGN KEY (security_id, currency)
    REFERENCES securities (id, currency),
  CONSTRAINT mock_orders_fx_check CHECK ((currency = 'KRW') = (fx_rate IS NULL)),
  CONSTRAINT mock_orders_fx_date_check CHECK ((fx_rate IS NULL) = (fx_date IS NULL)),
  CONSTRAINT mock_orders_krw_price_check CHECK (currency <> 'KRW' OR price = trunc(price))
);

CREATE INDEX IF NOT EXISTS mock_orders_account_idx ON mock_orders (account_id, created_at DESC, id DESC);
