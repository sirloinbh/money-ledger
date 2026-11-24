-- #294 Bank of Korea base rate history, for the deposit comparison of the mock account return. Safe to re-run.
-- One row per day the source published a value (the days the rate was set or changed, or every day). The rate in
-- effect on a day is the latest row on or before it, so a change in the middle of a period applies from its day.
CREATE TABLE IF NOT EXISTS base_rates (
  effective_date date PRIMARY KEY,
  -- Annual percent, e.g. 2.5000.
  rate_pct numeric(7,4) NOT NULL CHECK (rate_pct >= 0 AND rate_pct < 100),
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 40),
  fetched_at timestamptz NOT NULL
);
