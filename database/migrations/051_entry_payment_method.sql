-- #296 How an expense was paid, for the year-end card deduction estimate. Safe to re-run.
-- NULL means unknown: existing entries stay NULL and are left out of the estimate (recommendation of #296).
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS payment_method text
  CHECK (payment_method IN ('credit_card', 'debit_card', 'cash'));

-- The year's total salary the user types in, one row per year. Whole won.
CREATE TABLE IF NOT EXISTS ledger_tax_salaries (
  tax_year integer PRIMARY KEY CHECK (tax_year BETWEEN 2000 AND 2100),
  total_salary bigint NOT NULL CHECK (total_salary >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
