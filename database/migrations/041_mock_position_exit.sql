-- #309 Day trade auto sell: why and how a position closed, and what happens to a day trade that reached neither level.
-- Safe to re-run. Numbered after 040 (mock_positions): the runner refuses a file numbered before one already applied.

-- exit_reason: 'take_profit' (+5%) and 'stop_loss' (-3%) from the day trade rule, 'manual' for any other sale.
-- net_gain_krw / net_gain_pct: the sale's cash after fee and tax minus the buy amount plus its fee, and that gain as
-- a percentage of the buy amount plus fee (2 places, half away from zero). Set in the same row update that closes it.
-- carried_over_at: a day trade that reached neither level by 15:20 became a long hold (strategy_source 'auto').
ALTER TABLE mock_positions ADD COLUMN IF NOT EXISTS exit_reason text;
ALTER TABLE mock_positions ADD COLUMN IF NOT EXISTS net_gain_krw bigint;
ALTER TABLE mock_positions ADD COLUMN IF NOT EXISTS net_gain_pct numeric(12,2);
ALTER TABLE mock_positions ADD COLUMN IF NOT EXISTS carried_over_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mock_positions_exit_check') THEN
    ALTER TABLE mock_positions ADD CONSTRAINT mock_positions_exit_check CHECK (
      (closed_at IS NULL) = (exit_reason IS NULL AND net_gain_krw IS NULL AND net_gain_pct IS NULL)
      AND (exit_reason IS NULL OR exit_reason IN ('take_profit', 'stop_loss', 'manual'))
    ) NOT VALID;
  END IF;
END $$;
