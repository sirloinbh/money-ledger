-- #43 Fixed costs that add an expense entry every month. Safe to re-run.
-- Decisions (2026-11-15): a fixed item uses its amount; a variable one (electricity, gas, phone) is added as an
-- estimate (the last confirmed amount, or the item's amount the first time) that the user confirms later. No
-- scheduler: opening the app adds the entries that are due and missing, skipped months included.

CREATE TABLE IF NOT EXISTS ledger_fixed_costs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 30),
  kind text NOT NULL DEFAULT 'expense' CHECK (kind = 'expense'),
  category_id bigint NOT NULL,
  amount bigint NOT NULL CHECK (amount >= 0),
  variable boolean NOT NULL DEFAULT false,
  -- A day past the month's end (29-31) means that month's last day.
  day_of_month smallint NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  -- The first month that gets an entry: always the 1st of a month.
  start_month date NOT NULL CHECK (start_month = date_trunc('month', start_month)::date),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_fixed_costs_category_fkey FOREIGN KEY (category_id, kind)
    REFERENCES ledger_categories (id, kind) ON DELETE CASCADE
);

-- One row per item and month that was handled, so a month is added once even when the entry is deleted later.
-- entry_id is NULL once the user deletes the entry; confirmed is false while a variable amount is an estimate.
CREATE TABLE IF NOT EXISTS ledger_fixed_cost_runs (
  fixed_cost_id bigint NOT NULL REFERENCES ledger_fixed_costs (id) ON DELETE CASCADE,
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  entry_id bigint UNIQUE REFERENCES ledger_entries (id) ON DELETE SET NULL,
  confirmed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fixed_cost_id, month)
);
