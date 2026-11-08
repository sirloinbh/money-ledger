-- #46 Buy and sell records of held assets, with the held quantity, moving-average cost and realized
-- profit worked out from them. Safe to re-run. Formats follow AGENTS.project.md "수량·외화·환율" (#35).
-- Decisions (2026-11-08):
--   - Moving average. Fees and taxes are won amounts entered per trade: a buy's go into the cost, a sell's
--     come off the realized profit.
--   - A USD asset shows its average price in dollars; realized profit is in won (sell amount in won − average
--     won cost × quantity sold − sell costs), so exchange-rate moves count. The trade's rate is entered.
--   - Only stock and other (coins) assets have trades. An asset with trades takes its quantity from them.
--   - Trades can be changed or deleted any time; a change that makes the quantity negative at any point in
--     date order is refused. Trades on the same date count in the order they were entered (id).

-- Set once an asset gets a trade: its quantity is then the trades' total (NULL while none is held). It stays
-- set when the last trade is deleted, so the asset is still valid with nothing held; editing the asset while
-- it has no trades clears it and the quantity is entered by hand again.
ALTER TABLE portfolio_assets ADD COLUMN IF NOT EXISTS quantity_from_trades boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'portfolio_assets'::regclass
      AND conname = 'portfolio_assets_quantity_or_value_check'
      AND pg_get_constraintdef(oid) LIKE '%quantity_from_trades%'
  ) THEN
    ALTER TABLE portfolio_assets DROP CONSTRAINT IF EXISTS portfolio_assets_quantity_or_value_check;
    ALTER TABLE portfolio_assets ADD CONSTRAINT portfolio_assets_quantity_or_value_check CHECK (
      quantity IS NOT NULL OR value_krw IS NOT NULL OR value_foreign IS NOT NULL
      OR purchase_price_krw IS NOT NULL OR prepaid_kind IS NOT NULL OR quantity_from_trades
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS portfolio_trades (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id bigint NOT NULL REFERENCES portfolio_assets (id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  traded_on date NOT NULL,
  quantity numeric(20, 8) NOT NULL CHECK (quantity > 0),
  -- Same as the asset's currency (checked by the API).
  currency text NOT NULL CHECK (currency IN ('KRW', 'USD')),
  price numeric(20, 4) NOT NULL CHECK (price > 0),
  -- Won per dollar on the trade date; NULL for a won trade.
  fx_rate numeric(12, 4) CHECK (fx_rate > 0),
  -- round(quantity × price × coalesce(fx_rate, 1)), worked out once when saved.
  amount_krw bigint NOT NULL CHECK (amount_krw BETWEEN 0 AND 1000000000000000),
  fee_krw bigint NOT NULL DEFAULT 0 CHECK (fee_krw BETWEEN 0 AND 1000000000000000),
  tax_krw bigint NOT NULL DEFAULT 0 CHECK (tax_krw BETWEEN 0 AND 1000000000000000),
  memo text NOT NULL DEFAULT '' CHECK (char_length(memo) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portfolio_trades_won_price_check CHECK (currency <> 'KRW' OR price = trunc(price)),
  CONSTRAINT portfolio_trades_fx_check CHECK ((currency = 'KRW') = (fx_rate IS NULL))
);

CREATE INDEX IF NOT EXISTS portfolio_trades_asset_idx ON portfolio_trades (asset_id, traded_on, id);

-- The one place the position is worked out: the asset's trades in date order (then id), each with the
-- quantity, won cost and foreign cost held after it, and a sell's realized profit. Stops at the first sell
-- larger than what is held then, returning that row with oversold = true.
--   buy:  quantity += q; cost_krw += amount_krw + fee_krw + tax_krw; cost_foreign += q × price (USD only)
--   sell: taken = round(cost_krw × q ÷ quantity); realized = amount_krw − taken − fee_krw − tax_krw;
--         cost_krw −= taken; cost_foreign −= cost_foreign × q ÷ quantity; quantity −= q
-- cost_krw stays a whole won amount, so selling everything leaves exactly 0. All arithmetic is numeric.
CREATE OR REPLACE FUNCTION portfolio_trade_positions(target_asset bigint)
RETURNS TABLE (
  trade_id bigint,
  quantity_after numeric,
  cost_krw_after numeric,
  cost_foreign_after numeric,
  realized_krw numeric,
  oversold boolean
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  t record;
  held numeric := 0;
  cost numeric := 0;
  cost_foreign numeric := 0;
  taken numeric;
BEGIN
  FOR t IN
    SELECT * FROM portfolio_trades WHERE asset_id = target_asset ORDER BY traded_on, id
  LOOP
    realized_krw := NULL;
    oversold := false;
    IF t.side = 'buy' THEN
      held := held + t.quantity;
      cost := cost + t.amount_krw + t.fee_krw + t.tax_krw;
      IF t.currency <> 'KRW' THEN
        cost_foreign := cost_foreign + t.quantity * t.price;
      END IF;
    ELSIF t.quantity > held THEN
      trade_id := t.id;
      quantity_after := held - t.quantity;
      cost_krw_after := cost;
      cost_foreign_after := cost_foreign;
      oversold := true;
      RETURN NEXT;
      RETURN;
    ELSE
      taken := round(cost * t.quantity / held);
      realized_krw := t.amount_krw - taken - t.fee_krw - t.tax_krw;
      cost := cost - taken;
      cost_foreign := cost_foreign - cost_foreign * t.quantity / held;
      held := held - t.quantity;
    END IF;
    trade_id := t.id;
    quantity_after := held;
    cost_krw_after := cost;
    cost_foreign_after := cost_foreign;
    RETURN NEXT;
  END LOOP;
END
$$;
