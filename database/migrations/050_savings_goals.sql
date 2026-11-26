-- #297 Savings goals. Safe to re-run.
-- A goal has a target amount (whole won), an optional target date, and where its progress comes from:
-- 'surplus' = income minus expenses of the entries dated from start_month on (never below 0), or
-- 'asset' = the current value of one asset account (portfolio_assets). If that asset is deleted later, the goal
-- keeps its source but has no asset (asset_id NULL) and shows no progress until another account is chosen.
CREATE TABLE IF NOT EXISTS savings_goals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 30),
  -- Up to 1 trillion won (the one won cap, shared/contract.ts).
  target_amount bigint NOT NULL CHECK (target_amount BETWEEN 1 AND 1000000000000),
  target_date date,
  source text NOT NULL CHECK (source IN ('surplus', 'asset')),
  asset_id bigint REFERENCES portfolio_assets (id) ON DELETE SET NULL,
  -- The first month whose surplus counts (always the 1st of a month); unused for an asset source.
  start_month date NOT NULL CHECK (start_month = date_trunc('month', start_month)::date),
  -- NULL while the goal is open.
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT savings_goals_source_asset_check CHECK (source = 'asset' OR asset_id IS NULL)
);

CREATE INDEX IF NOT EXISTS savings_goals_open_idx ON savings_goals (finished_at NULLS FIRST, target_date NULLS LAST, id);
