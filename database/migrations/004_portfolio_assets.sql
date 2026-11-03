-- #45 Held assets and debts. Safe to re-run.
-- Formats follow AGENTS.project.md "수량·외화·환율" (#35): won amounts are bigint, foreign amounts are
-- numeric(20,4) and USD only, quantities are numeric(20,8).
CREATE TABLE IF NOT EXISTS portfolio_assets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 50),
  -- stock includes ETFs and funds, cash includes deposits and savings, coins go to other (2026-11-03 decision).
  asset_type text NOT NULL
    CHECK (asset_type IN ('stock', 'real_estate', 'cash', 'debt', 'depreciable', 'other')),
  currency text NOT NULL DEFAULT 'KRW' CHECK (currency IN ('KRW', 'USD')),
  quantity numeric(20, 8) CHECK (quantity > 0),
  -- The value entered by hand: what the asset is worth, or for a debt what is still owed.
  -- Up to 1,000조 won, so thousands of rows still total to a safe JSON integer.
  value_krw bigint CHECK (value_krw BETWEEN 0 AND 1000000000000000),
  value_foreign numeric(20, 4) CHECK (value_foreign >= 0),
  memo text NOT NULL DEFAULT '' CHECK (char_length(memo) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A won amount is always bigint; numeric(20,4) holds USD only.
  CONSTRAINT portfolio_assets_value_currency_check CHECK (
    (currency = 'KRW' AND value_foreign IS NULL) OR (currency = 'USD' AND value_krw IS NULL)
  ),
  -- Without a quantity there is nothing to price later (#47), so the value must be entered.
  CONSTRAINT portfolio_assets_quantity_or_value_check CHECK (
    quantity IS NOT NULL OR value_krw IS NOT NULL OR value_foreign IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS portfolio_assets_type_idx ON portfolio_assets (asset_type, id);
