-- #299 Which budgets already sent an overspending alert, so each budget alerts at most once per month. Safe to re-run.
-- A row is written before the message is sent (a claim), so two runs at once cannot both send.
CREATE TABLE IF NOT EXISTS budget_alerts_sent (
  category_id bigint NOT NULL REFERENCES ledger_categories (id) ON DELETE CASCADE,
  -- The first day of the month the alert is for.
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  -- 'reached' (spending equals the budget) or 'over' (above it) at the time of the alert.
  status text NOT NULL CHECK (status IN ('reached', 'over')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category_id, month)
);
