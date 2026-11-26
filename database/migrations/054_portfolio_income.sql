-- #295 Dividends and interest received from a held asset. Safe to re-run. Formats follow AGENTS.project.md
-- "Quantity, foreign currency, and exchange rate" (#35): amount_krw is whole won, worked out once when saved as
-- round(amount_foreign × fx_rate) for a dollar receipt; the foreign amount and rate are kept for reference.
CREATE TABLE IF NOT EXISTS portfolio_income (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id bigint NOT NULL REFERENCES portfolio_assets (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('dividend', 'interest')),
  received_on date NOT NULL,
  currency text NOT NULL CHECK (currency IN ('KRW', 'USD')),
  -- USD only; NULL for a won receipt.
  amount_foreign numeric(20, 4),
  -- Won per dollar on the receipt date; NULL for a won receipt.
  fx_rate numeric(12, 4) CHECK (fx_rate > 0),
  amount_krw bigint NOT NULL CHECK (amount_krw BETWEEN 0 AND 1000000000000000),
  -- Tax already withheld at the source, in won (part of amount_krw, which is the amount before tax).
  tax_withheld_krw bigint NOT NULL DEFAULT 0 CHECK (tax_withheld_krw BETWEEN 0 AND 1000000000000000),
  memo text NOT NULL DEFAULT '' CHECK (char_length(memo) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portfolio_income_foreign_check CHECK (
    (currency = 'KRW' AND amount_foreign IS NULL AND fx_rate IS NULL)
    OR (currency <> 'KRW' AND amount_foreign >= 0 AND fx_rate IS NOT NULL)
  ),
  CONSTRAINT portfolio_income_withheld_check CHECK (tax_withheld_krw <= amount_krw)
);

CREATE INDEX IF NOT EXISTS portfolio_income_received_idx ON portfolio_income (received_on, id);
CREATE INDEX IF NOT EXISTS portfolio_income_asset_idx ON portfolio_income (asset_id);
