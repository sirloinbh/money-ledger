-- #307 Mock investing v2: positions bought all-in at the best ask, with a day trade or long hold strategy.
-- Safe to re-run. The close-price orders of 015 are unchanged: those rows keep fill_source 'close' and tax 0.

-- Fills from the live order book (#305) are marked 'book'. tax_krw is the securities transaction tax on a sale.
ALTER TABLE mock_orders ADD COLUMN IF NOT EXISTS tax_krw bigint NOT NULL DEFAULT 0;
ALTER TABLE mock_orders ADD COLUMN IF NOT EXISTS fill_source text NOT NULL DEFAULT 'close';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mock_orders_tax_check') THEN
    ALTER TABLE mock_orders ADD CONSTRAINT mock_orders_tax_check CHECK (tax_krw >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mock_orders_fill_source_check') THEN
    ALTER TABLE mock_orders ADD CONSTRAINT mock_orders_fill_source_check
      CHECK (fill_source IN ('close', 'book'));
  END IF;
END $$;

-- One row per all-in buy. The buy order is the opening record; the sell order is set when the position closes.
-- strategy is 'undecided' right after the buy; strategy_chosen_at and strategy_source say when and how it was
-- chosen ('web', 'kakao', or 'auto' for a rule such as the +5% / -3% sell).
CREATE TABLE IF NOT EXISTS mock_positions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES mock_accounts (id),
  security_id bigint NOT NULL REFERENCES securities (id),
  buy_order_id bigint NOT NULL UNIQUE REFERENCES mock_orders (id),
  sell_order_id bigint UNIQUE REFERENCES mock_orders (id),
  quantity numeric(20,8) NOT NULL CHECK (quantity > 0 AND quantity = trunc(quantity)),
  strategy text NOT NULL DEFAULT 'undecided' CHECK (strategy IN ('undecided', 'day_trade', 'long_hold')),
  strategy_chosen_at timestamptz,
  strategy_source text CHECK (strategy_source IN ('web', 'kakao', 'auto')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT mock_positions_strategy_chosen_check CHECK (
    (strategy = 'undecided') = (strategy_chosen_at IS NULL AND strategy_source IS NULL)
  ),
  CONSTRAINT mock_positions_closed_check CHECK ((closed_at IS NULL) = (sell_order_id IS NULL))
);

CREATE INDEX IF NOT EXISTS mock_positions_account_idx ON mock_positions (account_id, opened_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS mock_positions_open_idx ON mock_positions (account_id) WHERE closed_at IS NULL;
